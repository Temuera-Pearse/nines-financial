import { afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'

import { toUserId } from '../../src/domains/account/types/identifiers.js'
import { toOwnerId } from '../../src/domains/accounting/types/identifiers.js'
import { toIdempotencyKey } from '../../src/shared/idempotency/types.js'
import {
  createTestApplication,
  stateChangingHeaders,
  type TestApplicationHarness,
} from '../support/testApp.js'

async function provisionPlayerAccount(
  harness: TestApplicationHarness,
  userId: string,
  key: string,
) {
  return harness.container.services.playerAccountProvisioningService.provisionIfNeeded(
    {
      idempotencyKey: toIdempotencyKey(`provision-${key}`),
      userId: toUserId(userId),
      currency: 'USDC',
      correlationId: `corr_provision_${key}`,
      causationId: `cause_provision_${key}`,
    },
  )
}

async function fundPlayer(
  harness: TestApplicationHarness,
  userId: string,
  amountMinor = '5000',
) {
  const playerAccount = await provisionPlayerAccount(
    harness,
    userId,
    `fund-${userId}`,
  )
  const depositSource =
    await harness.container.services.accountService.createAccount({
      accountType: 'deposit_clearing',
      ownerType: 'platform',
      ownerId: toOwnerId(`betting-deposit-source-${userId}`),
      currency: 'USDC',
      correlationId: `corr_deposit_source_${userId}`,
      causationId: `cause_deposit_source_${userId}`,
      idempotencyKey: toIdempotencyKey(`betting-deposit-source-${userId}`),
    })

  await harness.container.services.postingEngineService.postTransfer({
    idempotencyKey: toIdempotencyKey(`betting-fund-player-${userId}`),
    transactionType: 'deposit_confirmed_credit',
    referenceType: 'deposit',
    referenceId: `betting-deposit-${userId}`,
    debitAccountId: depositSource.accountId,
    creditAccountId: playerAccount.availableAccountId,
    amountMinor,
    currency: 'USDC',
    correlationId: `corr_fund_${userId}`,
    causationId: `cause_fund_${userId}`,
  })

  return playerAccount
}

function poolBody(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: 'pool-key',
    correlationId: 'corr_pool',
    causationId: 'cause_pool',
    raceId: 'race-1',
    currency: 'USDC',
    ...overrides,
  }
}

function selectionBody(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: 'selection-key',
    correlationId: 'corr_selection',
    causationId: 'cause_selection',
    raceId: 'race-1',
    selectionId: 'horse-1',
    currency: 'USDC',
    ...overrides,
  }
}

function betBody(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: 'bet-key',
    correlationId: 'corr_bet',
    causationId: 'cause_bet',
    betId: 'bet-1',
    userId: 'player-1',
    raceId: 'race-1',
    selectionId: 'horse-1',
    stakeMinor: '1200',
    currency: 'USDC',
    ...overrides,
  }
}

async function openPoolWithSelection(
  harness: TestApplicationHarness,
  raceId = 'race-1',
  selectionId = 'horse-1',
  options: Record<string, unknown> = {},
) {
  await request(harness.app)
    .post('/commands/create-race-pool')
    .send(
      poolBody({
        idempotencyKey: `pool-${raceId}`,
        raceId,
        ...options,
      }),
    )
  await request(harness.app)
    .post('/commands/register-pool-selection')
    .send(
      selectionBody({
        idempotencyKey: `selection-${raceId}-${selectionId}`,
        raceId,
        selectionId,
      }),
    )
}

async function placeBet(
  harness: TestApplicationHarness,
  overrides: Record<string, unknown> = {},
) {
  return request(harness.app)
    .post('/commands/place-bet')
    .set(
      stateChangingHeaders(
        String(overrides.idempotencyKey ?? 'bet-key'),
        String(overrides.correlationId ?? 'corr_bet'),
        String(overrides.causationId ?? 'cause_bet'),
      ),
    )
    .send(betBody(overrides))
}

describe('betting intake HTTP routes', () => {
  let harness: TestApplicationHarness | undefined

  afterEach(async () => {
    if (harness) {
      await harness.close()
      harness = undefined
    }
  })

  it('creates a race pool open for betting', async () => {
    harness = await createTestApplication()

    const response = await request(harness.app)
      .post('/commands/create-race-pool')
      .send(poolBody())

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      raceId: 'race-1',
      currency: 'USDC',
      status: 'open',
      bettingOpensAt: null,
      bettingClosesAt: null,
      frozenAt: null,
    })
  })

  it('safely ignores duplicate race pool creation with matching business identity', async () => {
    harness = await createTestApplication()

    const first = await request(harness.app)
      .post('/commands/create-race-pool')
      .send(poolBody())
    const duplicate = await request(harness.app)
      .post('/commands/create-race-pool')
      .send(
        poolBody({
          idempotencyKey: 'pool-key-duplicate-business-event',
          correlationId: 'corr_pool_duplicate',
          causationId: 'cause_pool_duplicate',
        }),
      )
    const auditCount = await harness.database.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM audit_events
        WHERE event_type = 'financial.pool.opened'
          AND entity_id = 'race-1'
      `,
    )

    expect(first.status).toBe(201)
    expect(duplicate.status).toBe(201)
    expect(duplicate.body).toEqual(first.body)
    expect(auditCount.rows[0]?.count).toBe(1)
  })

  it('registers selections only while the pool is open', async () => {
    harness = await createTestApplication()
    await request(harness.app).post('/commands/create-race-pool').send(poolBody())

    const response = await request(harness.app)
      .post('/commands/register-pool-selection')
      .send(selectionBody())

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      raceId: 'race-1',
      selectionId: 'horse-1',
      currency: 'USDC',
      status: 'active',
    })
  })

  it('safely ignores duplicate selection registration with matching business identity', async () => {
    harness = await createTestApplication()
    await request(harness.app).post('/commands/create-race-pool').send(poolBody())

    const first = await request(harness.app)
      .post('/commands/register-pool-selection')
      .send(selectionBody())
    const duplicate = await request(harness.app)
      .post('/commands/register-pool-selection')
      .send(
        selectionBody({
          idempotencyKey: 'selection-key-duplicate-business-event',
          correlationId: 'corr_selection_duplicate',
          causationId: 'cause_selection_duplicate',
        }),
      )
    const auditCount = await harness.database.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM audit_events
        WHERE event_type = 'financial.pool.selection_registered'
          AND entity_id = 'race-1:horse-1'
      `,
    )

    expect(first.status).toBe(201)
    expect(duplicate.status).toBe(201)
    expect(duplicate.body).toEqual(first.body)
    expect(auditCount.rows[0]?.count).toBe(1)
  })

  it('freezes pools without ledger movement and prevents later bets', async () => {
    harness = await createTestApplication()
    await openPoolWithSelection(harness)
    await fundPlayer(harness, 'player-1')

    const freeze = await request(harness.app)
      .post('/commands/freeze-pool')
      .send({
        idempotencyKey: 'freeze-race-1',
        correlationId: 'corr_freeze',
        causationId: 'cause_freeze',
        raceId: 'race-1',
        currency: 'USDC',
        reasonCode: 'race_started',
      })
    const bet = await placeBet(harness)
    const ledgerCount = await harness.database.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM ledger_transactions
        WHERE reference_type = 'bet' AND reference_id = 'bet-1'
      `,
    )

    expect(freeze.status).toBe(200)
    expect(freeze.body.status).toBe('frozen')
    expect(bet.status).toBe(200)
    expect(bet.body.accepted).toBe(false)
    expect(bet.body.bet.status).toBe('rejected')
    expect(bet.body.bet.rejectionCode).toBe('POOL_NOT_OPEN')
    expect(ledgerCount.rows[0]?.count).toBe(0)
  })

  it('safely ignores duplicate pool freeze with matching business identity', async () => {
    harness = await createTestApplication()
    await openPoolWithSelection(harness)

    const first = await request(harness.app)
      .post('/commands/freeze-pool')
      .send({
        idempotencyKey: 'freeze-race-1',
        correlationId: 'corr_freeze',
        causationId: 'cause_freeze',
        raceId: 'race-1',
        currency: 'USDC',
        reasonCode: 'race_started',
      })
    const duplicate = await request(harness.app)
      .post('/commands/freeze-pool')
      .send({
        idempotencyKey: 'freeze-race-1-duplicate-business-event',
        correlationId: 'corr_freeze_duplicate',
        causationId: 'cause_freeze_duplicate',
        raceId: 'race-1',
        currency: 'USDC',
        reasonCode: 'race_started',
      })
    const auditCount = await harness.database.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM audit_events
        WHERE event_type = 'financial.pool.frozen'
          AND entity_id = 'race-1'
      `,
    )

    expect(first.status).toBe(200)
    expect(duplicate.status).toBe(200)
    expect(duplicate.body).toEqual(first.body)
    expect(auditCount.rows[0]?.count).toBe(1)
  })

  it('returns pool lifecycle state and registered selections', async () => {
    harness = await createTestApplication()
    await openPoolWithSelection(harness)

    const response = await request(harness.app).get('/races/race-1/pool')

    expect(response.status).toBe(200)
    expect(response.body.pool).toMatchObject({
      raceId: 'race-1',
      currency: 'USDC',
      status: 'open',
    })
    expect(response.body.selections).toEqual([
      expect.objectContaining({
        raceId: 'race-1',
        selectionId: 'horse-1',
        status: 'active',
      }),
    ])
  })

  it('accepts a valid bet and reserves stake in user_locked', async () => {
    harness = await createTestApplication()
    await openPoolWithSelection(harness)
    await fundPlayer(harness, 'player-1')

    const response = await placeBet(harness)
    const balance = await request(harness.app).get(
      '/player/accounts/player-1/USDC/balance',
    )
    const ledgerCount = await harness.database.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM ledger_transactions
        WHERE reference_type = 'bet'
          AND reference_id = 'bet-1'
          AND transaction_type = 'bet_reserve'
      `,
    )

    expect(response.status).toBe(201)
    expect(response.body.accepted).toBe(true)
    expect(response.body.reservationId).toMatch(/^txn_/)
    expect(response.body.bet).toMatchObject({
      betId: 'bet-1',
      userId: 'player-1',
      raceId: 'race-1',
      selectionId: 'horse-1',
      stakeMinor: '1200',
      currency: 'USDC',
      status: 'accepted',
      rejectionCode: null,
    })
    expect(ledgerCount.rows[0]?.count).toBe(1)
    expect(balance.body.spendableBalanceMinor).toBe('3800')
    expect(balance.body.lockedBalanceMinor).toBe('1200')
  })

  it('rejects missing pool without ledger effect', async () => {
    harness = await createTestApplication()
    await fundPlayer(harness, 'player-1')

    const response = await placeBet(harness)
    const ledgerCount = await harness.database.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM ledger_transactions
        WHERE reference_type = 'bet' AND reference_id = 'bet-1'
      `,
    )

    expect(response.status).toBe(200)
    expect(response.body.accepted).toBe(false)
    expect(response.body.bet.rejectionCode).toBe('POOL_NOT_FOUND')
    expect(ledgerCount.rows[0]?.count).toBe(0)
  })

  it('rejects inactive or missing selections without ledger effect', async () => {
    harness = await createTestApplication()
    await request(harness.app).post('/commands/create-race-pool').send(poolBody())
    await request(harness.app)
      .post('/commands/register-pool-selection')
      .send(selectionBody({ status: 'inactive' }))
    await fundPlayer(harness, 'player-1')

    const inactive = await placeBet(harness)
    const missing = await placeBet(harness, {
      idempotencyKey: 'bet-missing-selection',
      betId: 'bet-missing-selection',
      selectionId: 'horse-missing',
    })
    const ledgerCount = await harness.database.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM ledger_transactions
        WHERE reference_type = 'bet'
          AND reference_id IN ('bet-1', 'bet-missing-selection')
      `,
    )

    expect(inactive.body.bet.rejectionCode).toBe('POOL_SELECTION_INACTIVE')
    expect(missing.body.bet.rejectionCode).toBe('POOL_SELECTION_NOT_FOUND')
    expect(ledgerCount.rows[0]?.count).toBe(0)
  })

  it('rejects invalid stakeMinor and non-USDC at the command boundary', async () => {
    harness = await createTestApplication()

    const invalidStake = await placeBet(harness, { stakeMinor: '12.00' })
    const nonUsdc = await placeBet(harness, {
      idempotencyKey: 'bet-non-usdc',
      betId: 'bet-non-usdc',
      currency: 'USD',
    })

    expect(invalidStake.status).toBe(400)
    expect(invalidStake.body.error.code).toBe('INVALID_COMMAND_REQUEST')
    expect(nonUsdc.status).toBe(400)
    expect(nonUsdc.body.error.code).toBe('INVALID_COMMAND_REQUEST')
  })

  it('rejects insufficient funds without ledger effect', async () => {
    harness = await createTestApplication()
    await openPoolWithSelection(harness)
    await provisionPlayerAccount(harness, 'player-1', 'insufficient')

    const response = await placeBet(harness)
    const ledgerCount = await harness.database.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM ledger_transactions
        WHERE reference_type = 'bet' AND reference_id = 'bet-1'
      `,
    )

    expect(response.status).toBe(200)
    expect(response.body.accepted).toBe(false)
    expect(response.body.bet.rejectionCode).toBe('INSUFFICIENT_FUNDS')
    expect(ledgerCount.rows[0]?.count).toBe(0)
  })

  it('replays duplicate place-bet requests and conflicts on material payload changes', async () => {
    harness = await createTestApplication()
    await openPoolWithSelection(harness)
    await fundPlayer(harness, 'player-1')

    const first = await placeBet(harness, { idempotencyKey: 'bet-replay' })
    const second = await placeBet(harness, { idempotencyKey: 'bet-replay' })
    const conflict = await placeBet(harness, {
      idempotencyKey: 'bet-replay',
      betId: 'bet-1',
      stakeMinor: '1300',
    })
    const ledgerCount = await harness.database.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM ledger_transactions
        WHERE reference_type = 'bet'
          AND reference_id = 'bet-1'
          AND transaction_type = 'bet_reserve'
      `,
    )

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(second.body).toEqual(first.body)
    expect(conflict.status).toBe(409)
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_PAYLOAD_MISMATCH')
    expect(ledgerCount.rows[0]?.count).toBe(1)
  })

  it('does not allow concurrent place-bet commands to overspend', async () => {
    harness = await createTestApplication()
    await openPoolWithSelection(harness)
    await fundPlayer(harness, 'player-1', '1000')

    const [first, second] = await Promise.all([
      placeBet(harness, {
        idempotencyKey: 'bet-concurrent-1',
        betId: 'bet-concurrent-1',
        stakeMinor: '800',
      }),
      placeBet(harness, {
        idempotencyKey: 'bet-concurrent-2',
        betId: 'bet-concurrent-2',
        stakeMinor: '800',
      }),
    ])
    const accepted = [first.body, second.body].filter(
      (body) => body.accepted === true,
    )
    const rejected = [first.body, second.body].filter(
      (body) => body.accepted === false,
    )
    const balance = await request(harness.app).get(
      '/player/accounts/player-1/USDC/balance',
    )

    expect(accepted).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].bet.rejectionCode).toBe('INSUFFICIENT_FUNDS')
    expect(balance.body.displayBalanceMinor).toBe('1000')
    expect(balance.body.lockedBalanceMinor).toBe('800')
    expect(balance.body.spendableBalanceMinor).toBe('200')
  })

  it('derives live pool totals from accepted bets only', async () => {
    harness = await createTestApplication()
    await openPoolWithSelection(harness)
    await request(harness.app)
      .post('/commands/register-pool-selection')
      .send(
        selectionBody({
          idempotencyKey: 'selection-race-1-horse-2',
          selectionId: 'horse-2',
        }),
      )
    await fundPlayer(harness, 'player-1')
    await fundPlayer(harness, 'player-2')
    await provisionPlayerAccount(harness, 'player-3', 'rejected-total')
    await placeBet(harness, {
      idempotencyKey: 'bet-total-1',
      betId: 'bet-total-1',
      userId: 'player-1',
      selectionId: 'horse-1',
      stakeMinor: '1200',
    })
    await placeBet(harness, {
      idempotencyKey: 'bet-total-2',
      betId: 'bet-total-2',
      userId: 'player-2',
      selectionId: 'horse-2',
      stakeMinor: '800',
    })
    await placeBet(harness, {
      idempotencyKey: 'bet-total-rejected',
      betId: 'bet-total-rejected',
      userId: 'player-3',
      selectionId: 'horse-1',
      stakeMinor: '999',
    })

    const poolTotal = await request(harness.app).get(
      '/races/race-1/pool-totals',
    )
    const selectionTotals = await request(harness.app).get(
      '/races/race-1/selection-totals',
    )

    expect(poolTotal.body).toMatchObject({
      raceId: 'race-1',
      currency: 'USDC',
      totalAcceptedStakeMinor: '2000',
      acceptedBetCount: 2,
    })
    expect(selectionTotals.body.selectionTotals).toEqual([
      expect.objectContaining({
        selectionId: 'horse-1',
        totalAcceptedStakeMinor: '1200',
        acceptedBetCount: 1,
      }),
      expect.objectContaining({
        selectionId: 'horse-2',
        totalAcceptedStakeMinor: '800',
        acceptedBetCount: 1,
      }),
    ])
  })

  it('persists audit and outbox rows for accepted and rejected bets', async () => {
    harness = await createTestApplication()
    await openPoolWithSelection(harness)
    await fundPlayer(harness, 'player-1')
    await provisionPlayerAccount(harness, 'player-2', 'rejected-events')
    await placeBet(harness, {
      idempotencyKey: 'bet-event-accepted',
      betId: 'bet-event-accepted',
      userId: 'player-1',
    })
    await placeBet(harness, {
      idempotencyKey: 'bet-event-rejected',
      betId: 'bet-event-rejected',
      userId: 'player-2',
      stakeMinor: '9000',
    })

    const auditRows = await harness.database.query<{ event_type: string }>(
      `
        SELECT event_type
        FROM audit_events
        WHERE event_type IN (
          'financial.bet.accepted',
          'financial.bet.rejected',
          'financial.wallet.balance_changed'
        )
        ORDER BY event_type ASC
      `,
    )
    const outboxRows = await harness.database.query<{ event_type: string }>(
      `
        SELECT event_type
        FROM outbox_events
        WHERE event_type IN (
          'financial.bet.accepted',
          'financial.bet.rejected',
          'financial.wallet.balance_changed'
        )
        ORDER BY event_type ASC
      `,
    )

    expect(auditRows.rows.map((row) => row.event_type)).toEqual([
      'financial.bet.accepted',
      'financial.bet.rejected',
      'financial.wallet.balance_changed',
    ])
    expect(outboxRows.rows.map((row) => row.event_type)).toEqual([
      'financial.bet.accepted',
      'financial.bet.rejected',
      'financial.wallet.balance_changed',
    ])
  })
})
