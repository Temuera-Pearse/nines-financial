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
    acceptedBets: [acceptedBet()],
    totalPoolMinor: '1200',
    houseTakeBps: 0,
    currency: 'USDC',
    ...overrides,
  }
}

async function reserveAcceptedBet(
  harness: TestApplicationHarness,
  bet: ReturnType<typeof acceptedBet>,
  raceId = 'race-1',
) {
  await fundPlayer(harness, String(bet.userId), String(bet.stakeMinor))

  return request(harness.app)
    .post('/commands/reserve-stake')
    .send(
      reserveStakeBody({
        idempotencyKey: `reserve-${bet.betId}`,
        userId: bet.userId,
        betId: bet.betId,
        raceId,
        selectionId: bet.selectionId,
        stakeMinor: bet.stakeMinor,
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

    const settlement = await request(harness.app)
      .post('/commands/settle-bet')
      .send(
        settleBetBody({
          idempotencyKey: 'settle-single-winner',
          acceptedBets: [winner, loser],
          totalPoolMinor: '3000',
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
    expect(settlement.body.settledBets).toEqual([
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
    ])
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

    const settlement = await request(harness.app)
      .post('/commands/settle-bet')
      .send(
        settleBetBody({
          idempotencyKey: 'settle-proportional-winners',
          acceptedBets: [winnerSmall, winnerLarge, loser],
          totalPoolMinor: '5000',
        }),
      )

    expect(settlement.status).toBe(200)
    expect(settlement.body.settledBets).toEqual([
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
    ])
  })

  it('rejects settlement when no accepted bets are on the winning selection', async () => {
    harness = await createTestApplication()
    const loser = acceptedBet({
      betId: 'bet-no-winner',
      userId: 'player-no-winner',
      selectionId: 'horse-2',
      stakeMinor: '1000',
    })
    await reserveAcceptedBet(harness, loser)

    const settlement = await request(harness.app)
      .post('/commands/settle-bet')
      .send(
        settleBetBody({
          idempotencyKey: 'settle-no-winning-bets',
          acceptedBets: [loser],
          totalPoolMinor: '1000',
        }),
      )
    const captureCount = await harness.database.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM ledger_transactions
        WHERE transaction_type = 'bet_capture'
          AND reference_id = 'bet-no-winner'
      `,
    )

    expect(settlement.status).toBe(409)
    expect(settlement.body.error.code).toBe('NO_WINNING_BETS_RULE_UNDEFINED')
    expect(captureCount.rows[0]?.count).toBe(0)
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

    const settlement = await request(harness.app)
      .post('/commands/settle-bet')
      .send(
        settleBetBody({
          idempotencyKey: 'settle-rounding',
          acceptedBets: [betB, betA, betC, loser],
          totalPoolMinor: '100',
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

    const settlement = await request(harness.app)
      .post('/commands/settle-bet')
      .send(
        settleBetBody({
          idempotencyKey: 'settle-house-take',
          acceptedBets: [winner, loser],
          totalPoolMinor: '1000',
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
          AND t.reference_id = 'race-1'
          AND e.direction = 'credit'
      `,
    )

    expect(settlement.status).toBe(200)
    expect(settlement.body.houseTakeMinor).toBe('12')
    expect(settlement.body.netPoolMinor).toBe('988')
    expect(settlement.body.settledBets[0]).toMatchObject({
      betId: 'bet-house-win',
      payoutMinor: '988',
    })
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
    const body = settleBetBody({
      idempotencyKey: 'settle-duplicate',
      acceptedBets: [winner],
      totalPoolMinor: '1200',
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
      '/commands/settle-bet',
      settleBetBody({ acceptedBets: [acceptedBet({ stakeMinor: '12.00' })] }),
    ],
    ['/commands/settle-bet', settleBetBody({ totalPoolMinor: '12.00' })],
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
