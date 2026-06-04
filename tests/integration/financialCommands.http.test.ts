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
  const depositSource = await harness.container.services.accountService.createAccount({
    accountType: 'deposit_clearing',
    ownerType: 'platform',
    ownerId: toOwnerId(`deposit-source-${userId}`),
    currency: 'USDC',
    correlationId: `corr_deposit_source_${userId}`,
    causationId: `cause_deposit_source_${userId}`,
    idempotencyKey: toIdempotencyKey(`deposit-source-${userId}`),
  })

  await harness.container.services.postingEngineService.postTransfer({
    idempotencyKey: toIdempotencyKey(`fund-player-${userId}`),
    transactionType: 'deposit_confirmed_credit',
    referenceType: 'deposit',
    referenceId: `deposit-${userId}`,
    debitAccountId: depositSource.accountId,
    creditAccountId: playerAccount.availableAccountId,
    amountMinor,
    currency: 'USDC',
    correlationId: `corr_fund_${userId}`,
    causationId: `cause_fund_${userId}`,
  })

  return playerAccount
}

function reserveStakeBody(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: 'reserve-stake-key',
    correlationId: 'corr_reserve_stake',
    causationId: 'cause_reserve_stake',
    userId: 'player-1',
    betId: 'bet-1',
    raceId: 'race-1',
    selectionId: 'horse-1',
    stakeMinor: '1200',
    currency: 'USDC',
    ...overrides,
  }
}

function poolBody(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: 'financial-command-pool-race-1',
    correlationId: 'corr_financial_command_pool',
    causationId: 'cause_financial_command_pool',
    raceId: 'race-1',
    currency: 'USDC',
    ...overrides,
  }
}

function selectionBody(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: 'financial-command-selection-race-1-horse-1',
    correlationId: 'corr_financial_command_selection',
    causationId: 'cause_financial_command_selection',
    raceId: 'race-1',
    selectionId: 'horse-1',
    currency: 'USDC',
    ...overrides,
  }
}

function placeBetBody(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: 'financial-command-place-bet-1',
    correlationId: 'corr_financial_command_place_bet',
    causationId: 'cause_financial_command_place_bet',
    betId: 'bet-1',
    userId: 'player-1',
    raceId: 'race-1',
    selectionId: 'horse-1',
    stakeMinor: '1200',
    currency: 'USDC',
    ...overrides,
  }
}

function acceptedBet(overrides: Record<string, unknown> = {}) {
  return {
    betId: 'bet-1',
    userId: 'player-1',
    selectionId: 'horse-1',
    stakeMinor: '1200',
    ...overrides,
  }
}

function settleBetBody(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: 'settle-bet-key',
    correlationId: 'corr_settle_bet',
    causationId: 'cause_settle_bet',
    raceId: 'race-1',
    winningSelectionId: 'horse-1',
    houseTakeBps: 0,
    currency: 'USDC',
    ...overrides,
  }
}

function operatorHeaders(operatorId = 'operator-1'): Record<string, string> {
  return {
    'x-nines-authenticated-user-id': operatorId,
    'x-nines-operator-role': 'settlement_operator',
  }
}

async function ensureOpenPoolSelection(
  harness: TestApplicationHarness,
  raceId: string,
  selectionId: string,
) {
  await request(harness.app)
    .post('/commands/create-race-pool')
    .send(
      poolBody({
        idempotencyKey: `financial-command-pool-${raceId}`,
        raceId,
      }),
    )
  await request(harness.app)
    .post('/commands/register-pool-selection')
    .send(
      selectionBody({
        idempotencyKey: `financial-command-selection-${raceId}-${selectionId}`,
        raceId,
        selectionId,
      }),
    )
}

async function ensureOpenPoolSelections(
  harness: TestApplicationHarness,
  raceId: string,
  selectionIds: string[],
  bettingOpensAt: string,
) {
  await request(harness.app)
    .post('/commands/create-race-pool')
    .send(
      poolBody({
        idempotencyKey: `financial-command-pool-${raceId}`,
        raceId,
        bettingOpensAt,
      }),
    )

  for (const selectionId of selectionIds) {
    await request(harness.app)
      .post('/commands/register-pool-selection')
      .send(
        selectionBody({
          idempotencyKey: `financial-command-selection-${raceId}-${selectionId}`,
          raceId,
          selectionId,
        }),
      )
  }
}

async function freezePool(harness: TestApplicationHarness, raceId = 'race-1') {
  return request(harness.app)
    .post('/commands/freeze-pool')
    .send({
      idempotencyKey: `financial-command-freeze-${raceId}`,
      correlationId: `corr_financial_command_freeze_${raceId}`,
      causationId: `cause_financial_command_freeze_${raceId}`,
      raceId,
      currency: 'USDC',
      reasonCode: 'race_finished',
    })
}

async function placeFundedBet(
  harness: TestApplicationHarness,
  bet: ReturnType<typeof acceptedBet>,
  raceId: string,
) {
  await fundPlayer(harness, String(bet.userId), String(bet.stakeMinor))

  return request(harness.app)
    .post('/commands/place-bet')
    .send(
      placeBetBody({
        idempotencyKey: `place-${bet.betId}`,
        userId: bet.userId,
        betId: bet.betId,
        raceId,
        selectionId: bet.selectionId,
        stakeMinor: bet.stakeMinor,
      }),
    )
}

async function reserveAcceptedBet(
  harness: TestApplicationHarness,
  bet: ReturnType<typeof acceptedBet>,
  raceId = 'race-1',
) {
  await ensureOpenPoolSelection(harness, raceId, String(bet.selectionId))
  await fundPlayer(harness, String(bet.userId), String(bet.stakeMinor))

  return request(harness.app)
    .post('/commands/place-bet')
    .send(
      placeBetBody({
        idempotencyKey: `place-${bet.betId}`,
        userId: bet.userId,
        betId: bet.betId,
        raceId,
        selectionId: bet.selectionId,
        stakeMinor: bet.stakeMinor,
      }),
    )
}

async function createPendingCarryover(
  harness: TestApplicationHarness,
  sourceRaceId = 'race-carryover-source',
) {
  await ensureOpenPoolSelections(
    harness,
    sourceRaceId,
    ['horse-loser', 'horse-winner'],
    '2026-04-22T11:59:00.000Z',
  )
  await placeFundedBet(
    harness,
    acceptedBet({
      betId: `bet-${sourceRaceId}-loser`,
      userId: `player-${sourceRaceId}-loser`,
      selectionId: 'horse-loser',
      stakeMinor: '1000',
    }),
    sourceRaceId,
  )
  await freezePool(harness, sourceRaceId)

  return request(harness.app)
    .post('/commands/settle-bet')
    .send(
      settleBetBody({
        idempotencyKey: `settle-${sourceRaceId}-carryover`,
        raceId: sourceRaceId,
        winningSelectionId: 'horse-winner',
        houseTakeBps: 1000,
      }),
    )
}

describe('financial command HTTP routes', () => {
  let harness: TestApplicationHarness | undefined

  afterEach(async () => {
    if (harness) {
      await harness.close()
      harness = undefined
    }
  })

  it('reserves stake and moves spendable funds into user_locked', async () => {
    harness = await createTestApplication()
    await fundPlayer(harness, 'player-1')

    const response = await request(harness.app)
      .post('/commands/reserve-stake')
      .send(reserveStakeBody())
    const balanceResponse = await request(harness.app)
      .get('/player/accounts/USDC/balance')
      .set('x-nines-authenticated-user-id', 'player-1')

    expect(response.status).toBe(201)
    expect(response.body.reservationId).toMatch(/^txn_/)
    expect(response.body.acceptedAt).toBe('2026-04-22T12:00:00.000Z')
    expect(balanceResponse.body.spendableBalanceMinor).toBe('3800')
    expect(balanceResponse.body.lockedBalanceMinor).toBe('1200')
  })

  it('rejects stake reservations when spendable balance is insufficient', async () => {
    harness = await createTestApplication()
    await provisionPlayerAccount(harness, 'player-1', 'insufficient')

    const response = await request(harness.app)
      .post('/commands/reserve-stake')
      .send(reserveStakeBody())

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('INSUFFICIENT_FUNDS')
  })

  it('deduplicates reserve-stake by command idempotency key', async () => {
    harness = await createTestApplication()
    await fundPlayer(harness, 'player-1')
    const body = reserveStakeBody({ idempotencyKey: 'reserve-duplicate' })

    const first = await request(harness.app)
      .post('/commands/reserve-stake')
      .send(body)
    const second = await request(harness.app)
      .post('/commands/reserve-stake')
      .send(body)
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
    expect(ledgerCount.rows[0]?.count).toBe(1)
  })

  it('releases reservations and restores spendable balance', async () => {
    harness = await createTestApplication()
    await fundPlayer(harness, 'player-1')
    const reserve = await request(harness.app)
      .post('/commands/reserve-stake')
      .send(reserveStakeBody({ idempotencyKey: 'reserve-release' }))

    const release = await request(harness.app)
      .post('/commands/release-reservation')
      .send({
        idempotencyKey: 'release-reservation-key',
        correlationId: 'corr_release',
        causationId: 'cause_release',
        reservationId: reserve.body.reservationId,
        reasonCode: 'bet_cancelled',
      })
    const balanceResponse = await request(harness.app)
      .get('/player/accounts/player-1/USDC/balance')

    expect(release.status).toBe(200)
    expect(release.body.reservationId).toBe(reserve.body.reservationId)
    expect(balanceResponse.body.spendableBalanceMinor).toBe('5000')
    expect(balanceResponse.body.lockedBalanceMinor).toBe('0')
  })

  it('settles a race where a single winner gets the net pool', async () => {
    harness = await createTestApplication()
    const winner = acceptedBet({
      betId: 'bet-win',
      userId: 'player-win',
      selectionId: 'horse-1',
      stakeMinor: '1000',
    })
    const loser = acceptedBet({
      betId: 'bet-loss',
      userId: 'player-loss',
      selectionId: 'horse-2',
      stakeMinor: '2000',
    })
    await reserveAcceptedBet(harness, winner)
    await reserveAcceptedBet(harness, loser)
    await freezePool(harness)

    const settlement = await request(harness.app)
      .post('/commands/settle-bet')
      .send(
        settleBetBody({
          idempotencyKey: 'settle-single-winner',
          houseTakeBps: 1000,
        }),
      )
    const winnerBalanceResponse = await request(harness.app)
      .get('/player/accounts/player-win/USDC/balance')
    const loserBalanceResponse = await request(harness.app)
      .get('/player/accounts/player-loss/USDC/balance')
    const transactionCount = await harness.database.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM ledger_transactions
        WHERE reference_id IN ('bet-win', 'bet-loss', 'race-1')
          AND transaction_type IN ('bet_capture', 'settlement_payout')
      `,
    )

    expect(settlement.status).toBe(200)
    expect(settlement.body).toMatchObject({
      raceId: 'race-1',
      winningSelectionId: 'horse-1',
      totalPoolMinor: '3000',
      houseTakeMinor: '300',
      netPoolMinor: '2700',
      roundingResidualMinor: '0',
      settledAt: '2026-04-22T12:00:00.000Z',
    })
    expect(settlement.body).toMatchObject({
      status: 'completed',
      reasonCode: null,
      carryoverMinor: '0',
    })
    expect(settlement.body.settlementRunId).toMatch(/^settlement_run_/)
    expect(settlement.body.settledBets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          betId: 'bet-win',
          resultStatus: 'won',
          payoutMinor: '2700',
        }),
        expect.objectContaining({
          betId: 'bet-loss',
          resultStatus: 'lost',
          payoutMinor: '0',
          payoutTransactionId: null,
        }),
      ]),
    )
    expect(winnerBalanceResponse.body.spendableBalanceMinor).toBe('2700')
    expect(winnerBalanceResponse.body.lockedBalanceMinor).toBe('0')
    expect(loserBalanceResponse.body.spendableBalanceMinor).toBe('0')
    expect(loserBalanceResponse.body.lockedBalanceMinor).toBe('0')
    expect(transactionCount.rows[0]?.count).toBe(3)
  })

  it('splits the net pool proportionally across multiple winners', async () => {
    harness = await createTestApplication()
    const winnerSmall = acceptedBet({
      betId: 'bet-win-small',
      userId: 'player-small',
      selectionId: 'horse-1',
      stakeMinor: '1000',
    })
    const winnerLarge = acceptedBet({
      betId: 'bet-win-large',
      userId: 'player-large',
      selectionId: 'horse-1',
      stakeMinor: '3000',
    })
    const loser = acceptedBet({
      betId: 'bet-loss-prop',
      userId: 'player-prop-loss',
      selectionId: 'horse-2',
      stakeMinor: '1000',
    })
    await reserveAcceptedBet(harness, winnerSmall)
    await reserveAcceptedBet(harness, winnerLarge)
    await reserveAcceptedBet(harness, loser)
    await freezePool(harness)

    const settlement = await request(harness.app)
      .post('/commands/settle-bet')
      .send(
        settleBetBody({
          idempotencyKey: 'settle-proportional-winners',
        }),
      )

    expect(settlement.status).toBe(200)
    expect(settlement.body.settledBets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          betId: 'bet-win-small',
          resultStatus: 'won',
          payoutMinor: '1250',
        }),
        expect.objectContaining({
          betId: 'bet-win-large',
          resultStatus: 'won',
          payoutMinor: '3750',
        }),
        expect.objectContaining({
          betId: 'bet-loss-prop',
          resultStatus: 'lost',
          payoutMinor: '0',
        }),
      ]),
    )
  })

  it('rolls the net pool into carryover when no accepted bets backed the winner', async () => {
    harness = await createTestApplication()
    const loser = acceptedBet({
      betId: 'bet-no-winner',
      userId: 'player-no-winner',
      selectionId: 'horse-2',
      stakeMinor: '1000',
    })
    await reserveAcceptedBet(harness, loser)
    await ensureOpenPoolSelection(harness, 'race-1', 'horse-1')
    await freezePool(harness)

    const settlement = await request(harness.app)
      .post('/commands/settle-bet')
      .send(
        settleBetBody({
          idempotencyKey: 'settle-no-winning-bets',
          winningSelectionId: 'horse-1',
          houseTakeBps: 1000,
        }),
      )
    const carryover = await harness.database.query<{
      amount_minor: string
      status: string
      reason_code: string
    }>(
      `
        SELECT amount_minor::text, status, reason_code
        FROM settlement_carryovers
        WHERE race_id = 'race-1'
      `,
    )
    const bet = await request(harness.app).get('/bets/bet-no-winner')

    expect(settlement.status).toBe(200)
    expect(settlement.body).toMatchObject({
      status: 'completed',
      reasonCode: 'NO_WINNING_STAKE_ROLLOVER',
      totalPoolMinor: '1000',
      houseTakeMinor: '100',
      netPoolMinor: '900',
      carryoverMinor: '900',
    })
    expect(settlement.body.settledBets).toEqual([
      expect.objectContaining({
        betId: 'bet-no-winner',
        resultStatus: 'lost',
        payoutMinor: '0',
      }),
    ])
    expect(carryover.rows[0]).toMatchObject({
      amount_minor: '900',
      status: 'pending',
      reason_code: 'NO_WINNING_STAKE_ROLLOVER',
    })
    expect(bet.body.bet.status).toBe('settled_loss')
  })

  it('applies a pending carryover exactly once to the next eligible pool', async () => {
    harness = await createTestApplication()
    const sourceSettlement = await createPendingCarryover(harness)
    await ensureOpenPoolSelections(
      harness,
      'race-carryover-target',
      ['horse-1'],
      '2026-04-22T12:01:00.000Z',
    )
    const body = {
      idempotencyKey: 'apply-carryover-target',
      correlationId: 'corr_apply_carryover_target',
      causationId: 'cause_apply_carryover_target',
      targetRaceId: 'race-carryover-target',
      currency: 'USDC',
    }

    const first = await request(harness.app)
      .post('/commands/apply-carryovers-to-race')
      .send(body)
    const replay = await request(harness.app)
      .post('/commands/apply-carryovers-to-race')
      .send(body)
    const ledgerCount = await harness.database.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM ledger_transactions
        WHERE transaction_type = 'settlement_carryover_apply'
      `,
    )
    const carryovers = await request(harness.app).get(
      '/carryovers?status=applied&targetRaceId=race-carryover-target',
    )

    expect(sourceSettlement.status).toBe(200)
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({
      targetRaceId: 'race-carryover-target',
      currency: 'USDC',
      totalAppliedMinor: '900',
    })
    expect(first.body.appliedCarryovers).toEqual([
      expect.objectContaining({
        sourceRaceId: 'race-carryover-source',
        targetRaceId: 'race-carryover-target',
        status: 'applied',
        amountMinor: '900',
      }),
    ])
    expect(replay.status).toBe(200)
    expect(replay.body).toEqual(first.body)
    expect(ledgerCount.rows[0]?.count).toBe(1)
    expect(carryovers.body.carryovers).toEqual(first.body.appliedCarryovers)
  })

  it('leaves carryover pending when no future eligible pool exists', async () => {
    harness = await createTestApplication()
    const sourceSettlement = await createPendingCarryover(harness)

    const carryovers = await request(harness.app).get(
      '/carryovers?status=pending',
    )
    const reconciliation = await request(harness.app).get(
      '/races/race-carryover-source/settlement-reconciliation',
    )

    expect(sourceSettlement.status).toBe(200)
    expect(carryovers.status).toBe(200)
    expect(carryovers.body.carryovers).toEqual([
      expect.objectContaining({
        sourceRaceId: 'race-carryover-source',
        status: 'pending',
        amountMinor: '900',
        targetRaceId: null,
      }),
    ])
    expect(reconciliation.body.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PENDING_CARRYOVER_ELIGIBLE_BUT_UNAPPLIED',
        }),
      ]),
    )
  })

  it('does not let a zero-carryover retry block later eligible application', async () => {
    harness = await createTestApplication()
    await ensureOpenPoolSelections(
      harness,
      'race-late-carryover-target',
      ['horse-1'],
      '2026-04-22T12:01:00.000Z',
    )
    const body = {
      idempotencyKey: 'apply-late-carryover-target',
      correlationId: 'corr_apply_late_carryover_target',
      causationId: 'cause_apply_late_carryover_target',
      targetRaceId: 'race-late-carryover-target',
      currency: 'USDC',
    }

    const noOp = await request(harness.app)
      .post('/commands/apply-carryovers-to-race')
      .send(body)
    const noOpApplicationRows = await harness.database.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM settlement_carryover_applications
        WHERE idempotency_key = $1
      `,
      [body.idempotencyKey],
    )
    const noOpClearingAccounts = await harness.database.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM accounts
        WHERE account_type = 'settlement_clearing'
          AND owner_type = 'settlement'
          AND owner_id = $1
      `,
      [`race:${body.targetRaceId}`],
    )
    await createPendingCarryover(harness, 'race-late-carryover-source')
    const applied = await request(harness.app)
      .post('/commands/apply-carryovers-to-race')
      .send(body)
    const applicationRows = await harness.database.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM settlement_carryover_applications
        WHERE idempotency_key = $1
      `,
      [body.idempotencyKey],
    )

    expect(noOp.status).toBe(200)
    expect(noOp.body).toMatchObject({
      targetRaceId: 'race-late-carryover-target',
      totalAppliedMinor: '0',
      appliedCarryovers: [],
    })
    expect(noOpApplicationRows.rows[0]?.count).toBe(0)
    expect(noOpClearingAccounts.rows[0]?.count).toBe(0)
    expect(applied.status).toBe(200)
    expect(applied.body).toMatchObject({
      targetRaceId: 'race-late-carryover-target',
      totalAppliedMinor: '900',
    })
    expect(applied.body.appliedCarryovers).toEqual([
      expect.objectContaining({
        sourceRaceId: 'race-late-carryover-source',
        targetRaceId: 'race-late-carryover-target',
        status: 'applied',
      }),
    ])
    expect(applicationRows.rows[0]?.count).toBe(1)
  })

  it('uses applied carryover as distributable pool basis during settlement', async () => {
    harness = await createTestApplication()
    await createPendingCarryover(harness)
    await ensureOpenPoolSelections(
      harness,
      'race-carryover-target',
      ['horse-1', 'horse-2'],
      '2026-04-22T12:00:00.000Z',
    )
    await request(harness.app)
      .post('/commands/apply-carryovers-to-race')
      .send({
        idempotencyKey: 'apply-carryover-for-settlement',
        correlationId: 'corr_apply_carryover_for_settlement',
        causationId: 'cause_apply_carryover_for_settlement',
        targetRaceId: 'race-carryover-target',
        currency: 'USDC',
      })
    await placeFundedBet(
      harness,
      acceptedBet({
        betId: 'bet-carryover-target-win',
        userId: 'player-carryover-target-win',
        selectionId: 'horse-1',
        stakeMinor: '100',
      }),
      'race-carryover-target',
    )
    await placeFundedBet(
      harness,
      acceptedBet({
        betId: 'bet-carryover-target-loss',
        userId: 'player-carryover-target-loss',
        selectionId: 'horse-2',
        stakeMinor: '100',
      }),
      'race-carryover-target',
    )
    await freezePool(harness, 'race-carryover-target')

    const settlement = await request(harness.app)
      .post('/commands/settle-bet')
      .send(
        settleBetBody({
          idempotencyKey: 'settle-applied-carryover-target',
          raceId: 'race-carryover-target',
          winningSelectionId: 'horse-1',
        }),
      )
    const targetTotal = await request(harness.app).get(
      '/races/race-carryover-target/pool-totals',
    )

    expect(settlement.status).toBe(200)
    expect(settlement.body).toMatchObject({
      totalPoolMinor: '1100',
      acceptedStakeMinor: '200',
      appliedCarryoverMinor: '900',
      houseTakeMinor: '0',
      netPoolMinor: '1100',
      carryoverMinor: '0',
    })
    expect(settlement.body.settledBets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          betId: 'bet-carryover-target-win',
          payoutMinor: '1100',
          resultStatus: 'won',
        }),
        expect.objectContaining({
          betId: 'bet-carryover-target-loss',
          payoutMinor: '0',
          resultStatus: 'lost',
        }),
      ]),
    )
    expect(targetTotal.body).toMatchObject({
      totalAcceptedStakeMinor: '0',
      appliedCarryoverMinor: '900',
      totalDistributableBasisMinor: '900',
    })
  })

  it('verifies the full internal economic loop with carryover and clean reconciliation', async () => {
    harness = await createTestApplication()
    await ensureOpenPoolSelections(
      harness,
      'race-loop-source',
      ['horse-loser', 'horse-winner'],
      '2026-04-22T11:59:00.000Z',
    )
    await placeFundedBet(
      harness,
      acceptedBet({
        betId: 'bet-loop-source-loser',
        userId: 'player-loop-source-loser',
        selectionId: 'horse-loser',
        stakeMinor: '1000',
      }),
      'race-loop-source',
    )
    await freezePool(harness, 'race-loop-source')
    const sourceSettlement = await request(harness.app)
      .post('/commands/settle-bet')
      .send(
        settleBetBody({
          idempotencyKey: 'settle-loop-source',
          raceId: 'race-loop-source',
          winningSelectionId: 'horse-winner',
          houseTakeBps: 1000,
        }),
      )
    await ensureOpenPoolSelections(
      harness,
      'race-loop-target',
      ['horse-1', 'horse-2'],
      '2026-04-22T12:00:00.000Z',
    )
    const appliedCarryover = await request(harness.app)
      .post('/commands/apply-carryovers-to-race')
      .send({
        idempotencyKey: 'apply-loop-carryover',
        correlationId: 'corr_apply_loop_carryover',
        causationId: 'cause_apply_loop_carryover',
        targetRaceId: 'race-loop-target',
        currency: 'USDC',
      })
    await placeFundedBet(
      harness,
      acceptedBet({
        betId: 'bet-loop-target-win',
        userId: 'player-loop-target-win',
        selectionId: 'horse-1',
        stakeMinor: '100',
      }),
      'race-loop-target',
    )
    await placeFundedBet(
      harness,
      acceptedBet({
        betId: 'bet-loop-target-loss',
        userId: 'player-loop-target-loss',
        selectionId: 'horse-2',
        stakeMinor: '100',
      }),
      'race-loop-target',
    )
    await freezePool(harness, 'race-loop-target')
    const targetSettlement = await request(harness.app)
      .post('/commands/settle-bet')
      .send(
        settleBetBody({
          idempotencyKey: 'settle-loop-target',
          raceId: 'race-loop-target',
          winningSelectionId: 'horse-1',
        }),
      )
    const winnerBalance = await request(harness.app).get(
      '/player/accounts/player-loop-target-win/USDC/balance',
    )
    const loserBalance = await request(harness.app).get(
      '/player/accounts/player-loop-target-loss/USDC/balance',
    )
    const report = await request(harness.app).get(
      '/races/race-loop-target/settlement-reconciliation',
    )
    const run = await request(harness.app)
      .post('/admin/operations/reconciliation/races/race-loop-target/runs')
      .set({
        ...stateChangingHeaders('run-loop-target-reconciliation'),
        ...operatorHeaders('operator-loop'),
      })
      .send({})

    expect(sourceSettlement.status).toBe(200)
    expect(sourceSettlement.body).toMatchObject({
      carryoverMinor: '900',
      reasonCode: 'NO_WINNING_STAKE_ROLLOVER',
    })
    expect(appliedCarryover.status).toBe(200)
    expect(appliedCarryover.body.totalAppliedMinor).toBe('900')
    expect(targetSettlement.status).toBe(200)
    expect(targetSettlement.body).toMatchObject({
      totalPoolMinor: '1100',
      acceptedStakeMinor: '200',
      appliedCarryoverMinor: '900',
      netPoolMinor: '1100',
      carryoverMinor: '0',
    })
    expect(winnerBalance.body.spendableBalanceMinor).toBe('1100')
    expect(winnerBalance.body.lockedBalanceMinor).toBe('0')
    expect(loserBalance.body.spendableBalanceMinor).toBe('0')
    expect(loserBalance.body.lockedBalanceMinor).toBe('0')
    expect(report.status).toBe(200)
    expect(report.body.issues).toEqual([])
    expect(run.status).toBe(201)
    expect(run.body.reconciliationRun).toMatchObject({
      raceId: 'race-loop-target',
      classification: 'informational',
      actionRequired: false,
      issueCount: 0,
    })
  })

  it('rejects settlement when the financial race pool is missing', async () => {
    harness = await createTestApplication()

    const settlement = await request(harness.app)
      .post('/commands/settle-bet')
      .send(settleBetBody({ idempotencyKey: 'settle-missing-pool' }))

    expect(settlement.status).toBe(404)
    expect(settlement.body.error.code).toBe('RACE_POOL_NOT_FOUND')
  })

  it('rejects settlement when the financial race pool is not frozen', async () => {
    harness = await createTestApplication()
    const winner = acceptedBet({
      betId: 'bet-open-pool',
      userId: 'player-open-pool',
      selectionId: 'horse-1',
      stakeMinor: '1200',
    })
    await reserveAcceptedBet(harness, winner)

    const settlement = await request(harness.app)
      .post('/commands/settle-bet')
      .send(
        settleBetBody({
          idempotencyKey: 'settle-open-pool',
        }),
      )

    expect(settlement.status).toBe(409)
    expect(settlement.body.error.code).toBe('RACE_POOL_NOT_FROZEN')
  })

  it('rejects settlement when the winning selection is not registered active', async () => {
    harness = await createTestApplication()
    const winner = acceptedBet({
      betId: 'bet-drift-winner',
      userId: 'player-drift-winner',
      selectionId: 'horse-1',
      stakeMinor: '1200',
    })
    await reserveAcceptedBet(harness, winner)
    await freezePool(harness)

    const settlement = await request(harness.app)
      .post('/commands/settle-bet')
      .send(
        settleBetBody({
          idempotencyKey: 'settle-invalid-winner',
          winningSelectionId: 'horse-missing',
        }),
      )

    expect(settlement.status).toBe(409)
    expect(settlement.body.error.code).toBe('WINNING_SELECTION_NOT_ACTIVE')
  })

  it('marks manual review explicitly and blocks settlement until resolved', async () => {
    harness = await createTestApplication()
    await ensureOpenPoolSelection(harness, 'race-manual-review', 'horse-1')
    await freezePool(harness, 'race-manual-review')
    const body = {
      idempotencyKey: 'mark-manual-review',
      correlationId: 'corr_mark_manual_review',
      causationId: 'cause_mark_manual_review',
      raceId: 'race-manual-review',
      currency: 'USDC',
      operatorId: 'operator-1',
      reasonCode: 'SETTLEMENT_INPUT_DRIFT',
      reasonText: 'detected by reconciliation',
    }

    const marked = await request(harness.app)
      .post('/commands/mark-settlement-manual-review')
      .set(operatorHeaders('operator-1'))
      .send(body)
    const replay = await request(harness.app)
      .post('/commands/mark-settlement-manual-review')
      .set(operatorHeaders('operator-1'))
      .send(body)
    const blockedSettlement = await request(harness.app)
      .post('/commands/settle-bet')
      .send(
        settleBetBody({
          idempotencyKey: 'settle-manual-review-blocked',
          raceId: 'race-manual-review',
        }),
      )
    const manualReviewItems = await request(harness.app)
      .get('/admin/operations/manual-review')
      .set(operatorHeaders('operator-1'))
    const resolved = await request(harness.app)
      .post('/commands/resolve-settlement-manual-review')
      .set(operatorHeaders('operator-1'))
      .send({
        idempotencyKey: 'resolve-manual-review',
        correlationId: 'corr_resolve_manual_review',
        causationId: 'cause_resolve_manual_review',
        raceId: 'race-manual-review',
        currency: 'USDC',
        operatorId: 'operator-1',
        resolutionCode: 'RETRY_ALLOWED',
      })
    const settlement = await request(harness.app)
      .post('/commands/settle-bet')
      .send(
        settleBetBody({
          idempotencyKey: 'settle-after-manual-review',
          raceId: 'race-manual-review',
        }),
      )

    expect(marked.status).toBe(200)
    expect(marked.body).toMatchObject({
      actionType: 'mark_manual_review',
      raceId: 'race-manual-review',
      poolStatus: 'manual_review',
      settlementRunStatus: 'manual_review',
      operatorId: 'operator-1',
      reasonCode: 'SETTLEMENT_INPUT_DRIFT',
      reasonText: 'detected by reconciliation',
    })
    expect(marked.body.settlementRunId).toMatch(/^settlement_run_/)
    expect(replay.body).toEqual(marked.body)
    expect(blockedSettlement.status).toBe(409)
    expect(blockedSettlement.body.error.code).toBe('RACE_POOL_NOT_FROZEN')
    expect(manualReviewItems.status).toBe(200)
    expect(manualReviewItems.body.manualReviewItems).toEqual([
      expect.objectContaining({
        raceId: 'race-manual-review',
        poolStatus: 'manual_review',
        settlementRunStatus: 'manual_review',
        reasonCode: 'SETTLEMENT_INPUT_DRIFT',
        errorMessage: 'detected by reconciliation',
      }),
    ])
    expect(resolved.status).toBe(200)
    expect(resolved.body).toMatchObject({
      actionType: 'resolve_manual_review',
      poolStatus: 'frozen',
      settlementRunStatus: 'failed',
      reasonCode: 'RETRY_ALLOWED',
    })
    expect(settlement.status).toBe(200)
    expect(settlement.body.status).toBe('completed')
  })

  it('requires authenticated operator headers for remediation commands', async () => {
    harness = await createTestApplication()
    await ensureOpenPoolSelection(harness, 'race-guarded-review', 'horse-1')
    await freezePool(harness, 'race-guarded-review')

    const response = await request(harness.app)
      .post('/commands/mark-settlement-manual-review')
      .send({
        idempotencyKey: 'mark-without-operator-auth',
        correlationId: 'corr_mark_without_operator_auth',
        causationId: 'cause_mark_without_operator_auth',
        raceId: 'race-guarded-review',
        currency: 'USDC',
        reasonCode: 'AUTH_REQUIRED',
      })

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('MISSING_AUTHENTICATED_OPERATOR_ID')
  })

  it('requires the optional operator shared secret when configured', async () => {
    const previousSecret =
      process.env.NINES_FINANCIAL_OPERATOR_SHARED_SECRET
    process.env.NINES_FINANCIAL_OPERATOR_SHARED_SECRET = 'phase-3-6-secret'

    try {
      harness = await createTestApplication()
      await ensureOpenPoolSelection(harness, 'race-shared-secret-review', 'horse-1')
      await freezePool(harness, 'race-shared-secret-review')
      const body = {
        idempotencyKey: 'mark-with-shared-secret',
        correlationId: 'corr_mark_with_shared_secret',
        causationId: 'cause_mark_with_shared_secret',
        raceId: 'race-shared-secret-review',
        currency: 'USDC',
        operatorId: 'operator-secret',
        reasonCode: 'SECRET_REQUIRED',
      }

      const missingSecret = await request(harness.app)
        .post('/commands/mark-settlement-manual-review')
        .set(operatorHeaders('operator-secret'))
        .send(body)
      const accepted = await request(harness.app)
        .post('/commands/mark-settlement-manual-review')
        .set({
          ...operatorHeaders('operator-secret'),
          'x-nines-operator-secret': 'phase-3-6-secret',
        })
        .send(body)

      expect(missingSecret.status).toBe(403)
      expect(missingSecret.body.error.code).toBe(
        'MISSING_OPERATOR_SHARED_SECRET',
      )
      expect(accepted.status).toBe(200)
    } finally {
      if (previousSecret === undefined) {
        delete process.env.NINES_FINANCIAL_OPERATOR_SHARED_SECRET
      } else {
        process.env.NINES_FINANCIAL_OPERATOR_SHARED_SECRET = previousSecret
      }
    }
  })

  it('rejects invalid manual-review remediation transitions', async () => {
    harness = await createTestApplication()
    await ensureOpenPoolSelection(harness, 'race-invalid-remediation', 'horse-1')
    await freezePool(harness, 'race-invalid-remediation')

    const response = await request(harness.app)
      .post('/commands/void-pool-from-manual-review')
      .set(operatorHeaders('operator-1'))
      .send({
        idempotencyKey: 'void-without-manual-review',
        correlationId: 'corr_void_without_manual_review',
        causationId: 'cause_void_without_manual_review',
        raceId: 'race-invalid-remediation',
        currency: 'USDC',
        operatorId: 'operator-1',
        reasonCode: 'VOID_REQUESTED',
      })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('POOL_NOT_IN_MANUAL_REVIEW')
  })

  it('voids a pool only through explicit manual-review remediation', async () => {
    harness = await createTestApplication()
    await ensureOpenPoolSelection(harness, 'race-void-review', 'horse-1')
    await freezePool(harness, 'race-void-review')
    await request(harness.app)
      .post('/commands/mark-settlement-manual-review')
      .set(operatorHeaders('operator-1'))
      .send({
        idempotencyKey: 'mark-void-review',
        correlationId: 'corr_mark_void_review',
        causationId: 'cause_mark_void_review',
        raceId: 'race-void-review',
        currency: 'USDC',
        operatorId: 'operator-1',
        reasonCode: 'UNSUPPORTED_RESULT',
      })

    const voided = await request(harness.app)
      .post('/commands/void-pool-from-manual-review')
      .set(operatorHeaders('operator-1'))
      .send({
        idempotencyKey: 'void-review',
        correlationId: 'corr_void_review',
        causationId: 'cause_void_review',
        raceId: 'race-void-review',
        currency: 'USDC',
        operatorId: 'operator-1',
        reasonCode: 'VOID_CONFIRMED',
      })
    const pool = await request(harness.app).get('/races/race-void-review/pool')

    expect(voided.status).toBe(200)
    expect(voided.body).toMatchObject({
      actionType: 'void_pool_from_manual_review',
      poolStatus: 'voided',
      settlementRunStatus: 'failed',
      reasonCode: 'VOID_CONFIRMED',
    })
    expect(pool.body.pool.status).toBe('voided')
  })

  it('allocates rounding remainder deterministically by largest remainder then bet id', async () => {
    harness = await createTestApplication()
    const betB = acceptedBet({
      betId: 'bet-b',
      userId: 'player-b',
      selectionId: 'horse-1',
      stakeMinor: '1',
    })
    const betA = acceptedBet({
      betId: 'bet-a',
      userId: 'player-a',
      selectionId: 'horse-1',
      stakeMinor: '1',
    })
    const betC = acceptedBet({
      betId: 'bet-c',
      userId: 'player-c',
      selectionId: 'horse-1',
      stakeMinor: '1',
    })
    const loser = acceptedBet({
      betId: 'bet-rounding-loss',
      userId: 'player-rounding-loss',
      selectionId: 'horse-2',
      stakeMinor: '97',
    })
    await reserveAcceptedBet(harness, betB)
    await reserveAcceptedBet(harness, betA)
    await reserveAcceptedBet(harness, betC)
    await reserveAcceptedBet(harness, loser)
    await freezePool(harness)

    const settlement = await request(harness.app)
      .post('/commands/settle-bet')
      .send(
        settleBetBody({
          idempotencyKey: 'settle-rounding',
        }),
      )

    expect(settlement.status).toBe(200)
    expect(settlement.body.roundingResidualMinor).toBe('0')
    expect(
      Object.fromEntries(
        settlement.body.settledBets.map(
          (bet: { betId: string; payoutMinor: string }) => [
            bet.betId,
            bet.payoutMinor,
          ],
        ),
      ),
    ).toMatchObject({
      'bet-a': '34',
      'bet-b': '33',
      'bet-c': '33',
    })
  })

  it('posts house take before distributing winners', async () => {
    harness = await createTestApplication()
    const winner = acceptedBet({
      betId: 'bet-house-win',
      userId: 'player-house-win',
      selectionId: 'horse-1',
      stakeMinor: '600',
    })
    const loser = acceptedBet({
      betId: 'bet-house-loss',
      userId: 'player-house-loss',
      selectionId: 'horse-2',
      stakeMinor: '400',
    })
    await reserveAcceptedBet(harness, winner)
    await reserveAcceptedBet(harness, loser)
    await freezePool(harness)

    const settlement = await request(harness.app)
      .post('/commands/settle-bet')
      .send(
        settleBetBody({
          idempotencyKey: 'settle-house-take',
          houseTakeBps: 125,
        }),
      )
    const houseTakePosting = await harness.database.query<{
      amount_minor: string
      account_type: string
    }>(
      `
        SELECT e.amount_minor::text, a.account_type
        FROM ledger_transactions t
        JOIN ledger_entries e ON e.transaction_id = t.transaction_id
        JOIN accounts a ON a.account_id = e.account_id
        WHERE t.transaction_type = 'settlement_house_take'
          AND e.direction = 'credit'
      `,
    )

    expect(settlement.status).toBe(200)
    expect(settlement.body.houseTakeMinor).toBe('12')
    expect(settlement.body.netPoolMinor).toBe('988')
    expect(settlement.body.settledBets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          betId: 'bet-house-win',
          payoutMinor: '988',
        }),
      ]),
    )
    expect(houseTakePosting.rows[0]).toMatchObject({
      amount_minor: '12',
      account_type: 'house_take_revenue',
    })
  })

  it('deduplicates settle-bet by command idempotency key', async () => {
    harness = await createTestApplication()
    const winner = acceptedBet({
      betId: 'bet-duplicate',
      userId: 'player-duplicate',
      selectionId: 'horse-1',
      stakeMinor: '1200',
    })
    await reserveAcceptedBet(harness, winner)
    await freezePool(harness)
    const body = settleBetBody({
      idempotencyKey: 'settle-duplicate',
    })

    const first = await request(harness.app).post('/commands/settle-bet').send(body)
    const second = await request(harness.app).post('/commands/settle-bet').send(body)
    const transactionCount = await harness.database.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM ledger_transactions
        WHERE reference_id = 'bet-duplicate'
          AND transaction_type IN ('bet_capture', 'settlement_payout')
      `,
    )

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body).toEqual(first.body)
    expect(transactionCount.rows[0]?.count).toBe(2)
  })

  it('persists settlement run, settled pool, and terminal bet states', async () => {
    harness = await createTestApplication()
    const winner = acceptedBet({
      betId: 'bet-terminal-win',
      userId: 'player-terminal-win',
      selectionId: 'horse-1',
      stakeMinor: '1000',
    })
    const loser = acceptedBet({
      betId: 'bet-terminal-loss',
      userId: 'player-terminal-loss',
      selectionId: 'horse-2',
      stakeMinor: '1000',
    })
    await reserveAcceptedBet(harness, winner)
    await reserveAcceptedBet(harness, loser)
    await freezePool(harness)

    const settlement = await request(harness.app)
      .post('/commands/settle-bet')
      .send(settleBetBody({ idempotencyKey: 'settle-terminal-states' }))
    const pool = await request(harness.app).get('/races/race-1/pool')
    const run = await harness.database.query<{
      status: string
      total_pool_minor: string
      result_snapshot: unknown
    }>(
      `
        SELECT status, total_pool_minor::text, result_snapshot
        FROM settlement_runs
        WHERE settlement_run_id = $1
      `,
      [settlement.body.settlementRunId],
    )
    const bets = await harness.database.query<{ bet_id: string; status: string }>(
      `
        SELECT bet_id, status
        FROM financial_bets
        WHERE race_id = 'race-1'
        ORDER BY bet_id ASC
      `,
    )

    expect(settlement.status).toBe(200)
    expect(pool.body.pool.status).toBe('settled')
    expect(run.rows[0]).toMatchObject({
      status: 'completed',
      total_pool_minor: '2000',
    })
    expect(Object.fromEntries(bets.rows.map((bet) => [bet.bet_id, bet.status]))).toMatchObject({
      'bet-terminal-loss': 'settled_loss',
      'bet-terminal-win': 'settled_win',
    })
  })

  it('detects completed settlement drift with non-terminal financial bets', async () => {
    harness = await createTestApplication()
    const winner = acceptedBet({
      betId: 'bet-drift-terminal',
      userId: 'player-drift-terminal',
      selectionId: 'horse-1',
      stakeMinor: '1200',
    })
    await reserveAcceptedBet(harness, winner)
    await freezePool(harness)
    const settlement = await request(harness.app)
      .post('/commands/settle-bet')
      .send(settleBetBody({ idempotencyKey: 'settle-drift-terminal' }))
    await harness.database.query(
      `
        UPDATE financial_bets
        SET status = 'accepted'
        WHERE bet_id = 'bet-drift-terminal'
      `,
    )

    const report = await request(harness.app).get(
      '/races/race-1/settlement-reconciliation',
    )

    expect(settlement.status).toBe(200)
    expect(report.status).toBe(200)
    expect(report.body.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'COMPLETED_SETTLEMENT_WITH_NON_TERMINAL_BETS',
          severity: 'error',
        }),
      ]),
    )
  })

  it('detects eligible pending carryovers that have not been applied', async () => {
    harness = await createTestApplication()
    await createPendingCarryover(harness)
    await ensureOpenPoolSelections(
      harness,
      'race-carryover-target',
      ['horse-1'],
      '2026-04-22T12:01:00.000Z',
    )

    const report = await request(harness.app).get(
      '/races/race-carryover-source/settlement-reconciliation',
    )

    expect(report.status).toBe(200)
    expect(report.body.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PENDING_CARRYOVER_ELIGIBLE_BUT_UNAPPLIED',
          severity: 'warning',
        }),
      ]),
    )
  })

  it('detects applied carryover ledger amount mismatches', async () => {
    harness = await createTestApplication()
    await createPendingCarryover(harness)
    await ensureOpenPoolSelections(
      harness,
      'race-carryover-target',
      ['horse-1'],
      '2026-04-22T12:01:00.000Z',
    )
    const applied = await request(harness.app)
      .post('/commands/apply-carryovers-to-race')
      .send({
        idempotencyKey: 'apply-carryover-mismatch',
        correlationId: 'corr_apply_carryover_mismatch',
        causationId: 'cause_apply_carryover_mismatch',
        targetRaceId: 'race-carryover-target',
        currency: 'USDC',
      })

    await harness.database.query(
      `
        UPDATE ledger_entries
        SET amount_minor = 899
        WHERE transaction_id = $1
          AND direction = 'credit'
      `,
      [applied.body.appliedCarryovers[0].applicationTransactionId],
    )

    const report = await request(harness.app).get(
      '/races/race-carryover-target/settlement-reconciliation',
    )

    expect(applied.status).toBe(200)
    expect(report.status).toBe(200)
    expect(report.body.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'CARRYOVER_LEDGER_AMOUNT_MISMATCH',
          severity: 'error',
        }),
      ]),
    )
  })

  it('records admin-triggered reconciliation run summaries', async () => {
    harness = await createTestApplication()
    await createPendingCarryover(harness)
    await ensureOpenPoolSelections(
      harness,
      'race-carryover-target',
      ['horse-1'],
      '2026-04-22T12:01:00.000Z',
    )

    const carryovers = await request(harness.app)
      .get('/admin/operations/carryovers?status=pending')
      .set(operatorHeaders('operator-1'))
    const report = await request(harness.app)
      .get('/admin/operations/reconciliation/races/race-carryover-source')
      .set(operatorHeaders('operator-1'))
    const headers = {
      ...stateChangingHeaders('admin-reconciliation-run-source'),
      ...operatorHeaders('operator-1'),
    }
    const run = await request(harness.app)
      .post(
        '/admin/operations/reconciliation/races/race-carryover-source/runs',
      )
      .set(headers)
      .send({})
    const replay = await request(harness.app)
      .post(
        '/admin/operations/reconciliation/races/race-carryover-source/runs',
      )
      .set(headers)
      .send({})
    const runs = await request(harness.app)
      .get(
        '/admin/operations/reconciliation/runs?raceId=race-carryover-source',
      )
      .set(operatorHeaders('operator-1'))
    const applyLedgerCount = await harness.database.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM ledger_transactions
        WHERE transaction_type = 'settlement_carryover_apply'
      `,
    )
    const pendingCarryoversAfterRun = await request(harness.app)
      .get('/admin/operations/carryovers?status=pending')
      .set(operatorHeaders('operator-1'))

    expect(carryovers.status).toBe(200)
    expect(carryovers.body.carryovers).toEqual([
      expect.objectContaining({
        sourceRaceId: 'race-carryover-source',
        status: 'pending',
        amountMinor: '900',
      }),
    ])
    expect(report.status).toBe(200)
    expect(report.body.reconciliation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PENDING_CARRYOVER_ELIGIBLE_BUT_UNAPPLIED',
        }),
      ]),
    )
    expect(run.status).toBe(201)
    expect(run.body.reconciliationRun).toMatchObject({
      raceId: 'race-carryover-source',
      currency: 'USDC',
      status: 'completed',
      classification: 'discrepancy',
      actionRequired: true,
      issueCount: 1,
      errorCount: 0,
      warningCount: 1,
      requestedByOperatorId: 'operator-1',
      idempotencyKey: 'admin-reconciliation-run-source',
    })
    expect(run.body.reconciliationRun.reconciliationRunId).toMatch(
      /^settlement_reconciliation_run_/,
    )
    expect(replay.body).toEqual(run.body)
    expect(runs.status).toBe(200)
    expect(runs.body.reconciliationRuns).toEqual([run.body.reconciliationRun])
    expect(applyLedgerCount.rows[0]?.count).toBe(0)
    expect(pendingCarryoversAfterRun.body.carryovers).toEqual(
      carryovers.body.carryovers,
    )
  })

  it('detects stale manual-review settlement states', async () => {
    harness = await createTestApplication()
    await ensureOpenPoolSelection(harness, 'race-stale-review', 'horse-1')
    await freezePool(harness, 'race-stale-review')
    await request(harness.app)
      .post('/commands/mark-settlement-manual-review')
      .set(operatorHeaders('operator-1'))
      .send({
        idempotencyKey: 'mark-stale-review',
        correlationId: 'corr_mark_stale_review',
        causationId: 'cause_mark_stale_review',
        raceId: 'race-stale-review',
        currency: 'USDC',
        operatorId: 'operator-1',
        reasonCode: 'AGING_REVIEW',
      })
    await harness.database.query(
      `
        UPDATE race_pools
        SET created_at = '2026-04-20T12:00:00.000Z',
            updated_at = '2026-04-20T12:00:00.000Z',
            frozen_at = '2026-04-20T12:00:00.000Z'
        WHERE race_id = 'race-stale-review'
      `,
    )
    await harness.database.query(
      `
        UPDATE settlement_runs
        SET created_at = '2026-04-20T12:00:00.000Z',
            updated_at = '2026-04-20T12:00:00.000Z',
            started_at = '2026-04-20T12:00:00.000Z'
        WHERE race_id = 'race-stale-review'
      `,
    )

    const report = await request(harness.app).get(
      '/races/race-stale-review/settlement-reconciliation',
    )

    expect(report.status).toBe(200)
    expect(report.body.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'MANUAL_REVIEW_POOL_STALE',
          severity: 'warning',
        }),
        expect.objectContaining({
          code: 'MANUAL_REVIEW_SETTLEMENT_STALE',
          severity: 'warning',
        }),
      ]),
    )
  })

  it('rejects a conflicting second settlement after completion', async () => {
    harness = await createTestApplication()
    const winner = acceptedBet({
      betId: 'bet-conflicting-settlement',
      userId: 'player-conflicting-settlement',
      selectionId: 'horse-1',
      stakeMinor: '1200',
    })
    await reserveAcceptedBet(harness, winner)
    await freezePool(harness)

    const first = await request(harness.app)
      .post('/commands/settle-bet')
      .send(settleBetBody({ idempotencyKey: 'settle-conflict-first' }))
    const second = await request(harness.app)
      .post('/commands/settle-bet')
      .send(
        settleBetBody({
          idempotencyKey: 'settle-conflict-second',
          winningSelectionId: 'horse-1',
        }),
      )

    expect(first.status).toBe(200)
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('RACE_ALREADY_SETTLED')
  })

  it('settles an empty frozen pool with zero postings', async () => {
    harness = await createTestApplication()
    await ensureOpenPoolSelection(harness, 'race-1', 'horse-1')
    await freezePool(harness)

    const settlement = await request(harness.app)
      .post('/commands/settle-bet')
      .send(settleBetBody({ idempotencyKey: 'settle-empty-pool' }))
    const postings = await harness.database.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM ledger_transactions
        WHERE transaction_type IN (
          'bet_capture',
          'settlement_house_take',
          'settlement_payout',
          'settlement_carryover'
        )
      `,
    )

    expect(settlement.status).toBe(200)
    expect(settlement.body).toMatchObject({
      totalPoolMinor: '0',
      houseTakeMinor: '0',
      netPoolMinor: '0',
      carryoverMinor: '0',
      settledBets: [],
    })
    expect(postings.rows[0]?.count).toBe(0)
  })

  it('applies house take through settlement clearing and revenue accounts', async () => {
    harness = await createTestApplication()

    const response = await request(harness.app)
      .post('/commands/apply-house-take')
      .set(stateChangingHeaders('house-take'))
      .send({
        raceId: 'race-house-take',
        amountMinor: '300',
        currency: 'USDC',
      })
    const transactionCount = await harness.database.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM ledger_transactions
        WHERE transaction_type = 'settlement_house_take'
          AND reference_id = 'race-house-take'
      `,
    )

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      raceId: 'race-house-take',
      amountMinor: '300',
      appliedAt: '2026-04-22T12:00:00.000Z',
    })
    expect(transactionCount.rows[0]?.count).toBe(1)
  })

  it.each([
    ['/commands/reserve-stake', reserveStakeBody({ stakeMinor: '12.00' })],
    [
      '/commands/apply-house-take',
      {
        idempotencyKey: 'bad-house-take-amount',
        correlationId: 'corr_bad_house_take',
        causationId: 'cause_bad_house_take',
        raceId: 'race-1',
        amountMinor: '12.00',
        currency: 'USDC',
      },
    ],
  ])('rejects loose decimal amounts for %s', async (path, body) => {
    harness = await createTestApplication()

    const response = await request(harness.app).post(path).send(body)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_COMMAND_REQUEST')
  })

  it.each([
    ['/commands/reserve-stake', reserveStakeBody({ currency: 'USD' })],
    ['/commands/settle-bet', settleBetBody({ currency: 'USD' })],
    [
      '/commands/apply-house-take',
      {
        idempotencyKey: 'bad-house-take-currency',
        correlationId: 'corr_bad_house_take_currency',
        causationId: 'cause_bad_house_take_currency',
        raceId: 'race-1',
        amountMinor: '300',
        currency: 'USD',
      },
    ],
  ])('rejects non-USDC commands for %s', async (path, body) => {
    harness = await createTestApplication()

    const response = await request(harness.app).post(path).send(body)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_COMMAND_REQUEST')
  })
})
