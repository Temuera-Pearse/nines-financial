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

const contractReserveStakeCommand = {
  idempotencyKey: 'phase-2-8-reserve-stake',
  correlationId: 'corr_phase_2_8_reserve_stake',
  causationId: 'cause_phase_2_8_reserve_stake',
  userId: 'player-contract-1',
  betId: 'bet-contract-1',
  raceId: 'race-contract-1',
  selectionId: 'horse-1',
  stakeMinor: '1200',
  currency: 'USDC',
} as const

const contractSettleBetCommand = {
  idempotencyKey: 'phase-2-8-settle-bet',
  correlationId: 'corr_phase_2_8_settle_bet',
  causationId: 'cause_phase_2_8_settle_bet',
  raceId: 'race-contract-1',
  winningSelectionId: 'horse-1',
  acceptedBets: [
    {
      betId: 'bet-contract-1',
      userId: 'player-contract-1',
      selectionId: 'horse-1',
      stakeMinor: '1200',
    },
    {
      betId: 'bet-contract-2',
      userId: 'player-contract-2',
      selectionId: 'horse-2',
      stakeMinor: '800',
    },
  ],
  totalPoolMinor: '2000',
  houseTakeBps: 0,
  currency: 'USDC',
} as const

const contractApplyHouseTakeCommand = {
  idempotencyKey: 'phase-2-8-apply-house-take',
  correlationId: 'corr_phase_2_8_apply_house_take',
  causationId: 'cause_phase_2_8_apply_house_take',
  raceId: 'race-contract-1',
  amountMinor: '300',
  currency: 'USDC',
} as const

function expectOnlyKeys(body: Record<string, unknown>, keys: string[]): void {
  expect(Object.keys(body).sort()).toEqual([...keys].sort())
}

async function provisionAndFundPlayer(
  harness: TestApplicationHarness,
  userId: string = contractReserveStakeCommand.userId,
  amountMinor: string = '5000',
) {
  const playerAccount =
    await harness.container.services.playerAccountProvisioningService.provisionIfNeeded(
      {
        idempotencyKey: toIdempotencyKey(`phase-2-8-provision-${userId}`),
        userId: toUserId(userId),
        currency: 'USDC',
        correlationId: 'corr_phase_2_8_provision_player',
        causationId: 'cause_phase_2_8_provision_player',
      },
    )
  const depositSource =
    await harness.container.services.accountService.createAccount({
      accountType: 'deposit_clearing',
      ownerType: 'platform',
      ownerId: toOwnerId(`phase-2-8-deposit-source-${userId}`),
      currency: 'USDC',
      correlationId: 'corr_phase_2_8_deposit_source',
      causationId: 'cause_phase_2_8_deposit_source',
      idempotencyKey: toIdempotencyKey(`phase-2-8-deposit-source-${userId}`),
    })

  await harness.container.services.postingEngineService.postTransfer({
    idempotencyKey: toIdempotencyKey(`phase-2-8-fund-${userId}`),
    transactionType: 'deposit_confirmed_credit',
    referenceType: 'deposit',
    referenceId: `phase-2-8-deposit-${userId}`,
    debitAccountId: depositSource.accountId,
    creditAccountId: playerAccount.availableAccountId,
    amountMinor,
    currency: 'USDC',
    correlationId: 'corr_phase_2_8_fund_player',
    causationId: 'cause_phase_2_8_fund_player',
  })

  return playerAccount
}

describe('nines-back-end financial client route contract', () => {
  let harness: TestApplicationHarness | undefined

  afterEach(async () => {
    if (harness) {
      await harness.close()
      harness = undefined
    }
  })

  it('returns the reserveStake response shape consumed by nines-back-end', async () => {
    harness = await createTestApplication()
    await provisionAndFundPlayer(harness)

    const response = await request(harness.app)
      .post('/commands/reserve-stake')
      .set(
        stateChangingHeaders(
          contractReserveStakeCommand.idempotencyKey,
          contractReserveStakeCommand.correlationId,
          contractReserveStakeCommand.causationId,
        ),
      )
      .send(contractReserveStakeCommand)

    expect(response.status).toBe(201)
    expectOnlyKeys(response.body, ['reservationId', 'acceptedAt'])
    expect(response.body.reservationId).toMatch(/^txn_/)
    expect(response.body.acceptedAt).toBe('2026-04-22T12:00:00.000Z')
  })

  it('returns stable idempotent reserveStake replay responses', async () => {
    harness = await createTestApplication()
    await provisionAndFundPlayer(harness)

    const first = await request(harness.app)
      .post('/commands/reserve-stake')
      .set(
        stateChangingHeaders(
          contractReserveStakeCommand.idempotencyKey,
          contractReserveStakeCommand.correlationId,
          contractReserveStakeCommand.causationId,
        ),
      )
      .send(contractReserveStakeCommand)
    const second = await request(harness.app)
      .post('/commands/reserve-stake')
      .set(
        stateChangingHeaders(
          contractReserveStakeCommand.idempotencyKey,
          contractReserveStakeCommand.correlationId,
          contractReserveStakeCommand.causationId,
        ),
      )
      .send(contractReserveStakeCommand)

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(second.body).toEqual(first.body)
  })

  it('returns the releaseReservation response shape consumed by nines-back-end', async () => {
    harness = await createTestApplication()
    await provisionAndFundPlayer(harness)
    const reserve = await request(harness.app)
      .post('/commands/reserve-stake')
      .send(contractReserveStakeCommand)

    const response = await request(harness.app)
      .post('/commands/release-reservation')
      .set(
        stateChangingHeaders(
          'phase-2-8-release-reservation',
          'corr_phase_2_8_release_reservation',
          'cause_phase_2_8_release_reservation',
        ),
      )
      .send({
        idempotencyKey: 'phase-2-8-release-reservation',
        correlationId: 'corr_phase_2_8_release_reservation',
        causationId: 'cause_phase_2_8_release_reservation',
        reservationId: reserve.body.reservationId,
        reasonCode: 'bet_cancelled',
      })

    expect(response.status).toBe(200)
    expectOnlyKeys(response.body, ['reservationId', 'releasedAt'])
    expect(response.body.reservationId).toBe(reserve.body.reservationId)
    expect(response.body.releasedAt).toBe('2026-04-22T12:00:00.000Z')
  })

  it('returns the settleBet response shape consumed by nines-back-end', async () => {
    harness = await createTestApplication()
    await provisionAndFundPlayer(harness)
    await provisionAndFundPlayer(harness, 'player-contract-2')
    await request(harness.app)
      .post('/commands/reserve-stake')
      .send(contractReserveStakeCommand)
    await request(harness.app)
      .post('/commands/reserve-stake')
      .send({
        ...contractReserveStakeCommand,
        idempotencyKey: 'phase-2-8-reserve-stake-2',
        userId: 'player-contract-2',
        betId: 'bet-contract-2',
        selectionId: 'horse-2',
        stakeMinor: '800',
      })

    const response = await request(harness.app)
      .post('/commands/settle-bet')
      .set(
        stateChangingHeaders(
          contractSettleBetCommand.idempotencyKey,
          contractSettleBetCommand.correlationId,
          contractSettleBetCommand.causationId,
        ),
      )
      .send(contractSettleBetCommand)
    const replay = await request(harness.app)
      .post('/commands/settle-bet')
      .set(
        stateChangingHeaders(
          contractSettleBetCommand.idempotencyKey,
          contractSettleBetCommand.correlationId,
          contractSettleBetCommand.causationId,
        ),
      )
      .send(contractSettleBetCommand)

    expect(response.status).toBe(200)
    expectOnlyKeys(response.body, [
      'raceId',
      'winningSelectionId',
      'totalPoolMinor',
      'houseTakeMinor',
      'netPoolMinor',
      'roundingResidualMinor',
      'settledBets',
      'settledAt',
    ])
    expect(response.body).toMatchObject({
      raceId: contractSettleBetCommand.raceId,
      winningSelectionId: 'horse-1',
      totalPoolMinor: '2000',
      houseTakeMinor: '0',
      netPoolMinor: '2000',
      roundingResidualMinor: '0',
      settledAt: '2026-04-22T12:00:00.000Z',
    })
    expect(response.body.settledBets).toEqual([
      expect.objectContaining({
        betId: 'bet-contract-1',
        resultStatus: 'won',
        payoutMinor: '2000',
      }),
      expect.objectContaining({
        betId: 'bet-contract-2',
        resultStatus: 'lost',
        payoutMinor: '0',
      }),
    ])
    expect(replay.status).toBe(200)
    expect(replay.body).toEqual(response.body)
  })

  it('returns the applyHouseTake response shape consumed by nines-back-end', async () => {
    harness = await createTestApplication()

    const response = await request(harness.app)
      .post('/commands/apply-house-take')
      .set(
        stateChangingHeaders(
          contractApplyHouseTakeCommand.idempotencyKey,
          contractApplyHouseTakeCommand.correlationId,
          contractApplyHouseTakeCommand.causationId,
        ),
      )
      .send(contractApplyHouseTakeCommand)

    expect(response.status).toBe(200)
    expectOnlyKeys(response.body, ['raceId', 'amountMinor', 'appliedAt'])
    expect(response.body).toEqual({
      raceId: contractApplyHouseTakeCommand.raceId,
      amountMinor: '300',
      appliedAt: '2026-04-22T12:00:00.000Z',
    })
  })

  it('returns player account summary and balance shapes consumed by nines-back-end', async () => {
    harness = await createTestApplication()
    await provisionAndFundPlayer(harness)

    const summaryResponse = await request(harness.app).get(
      '/player/accounts/player-contract-1/USDC',
    )
    const balanceResponse = await request(harness.app).get(
      '/player/accounts/player-contract-1/USDC/balance',
    )

    expect(summaryResponse.status).toBe(200)
    expectOnlyKeys(summaryResponse.body, [
      'playerAccountId',
      'userId',
      'currency',
      'effectiveStatus',
      'displayBalanceMinor',
      'spendableBalanceMinor',
      'asOf',
    ])
    expect(summaryResponse.body).toMatchObject({
      userId: 'player-contract-1',
      currency: 'USDC',
      effectiveStatus: 'active',
      displayBalanceMinor: '5000',
      spendableBalanceMinor: '5000',
      asOf: '2026-04-22T12:00:00.000Z',
    })
    expect(balanceResponse.status).toBe(200)
    expectOnlyKeys(balanceResponse.body, [
      'playerAccountId',
      'currency',
      'spendableBalanceMinor',
      'lockedBalanceMinor',
      'restrictedBalanceMinor',
      'displayBalanceMinor',
      'asOf',
    ])
    expect(balanceResponse.body).toMatchObject({
      currency: 'USDC',
      spendableBalanceMinor: '5000',
      lockedBalanceMinor: '0',
      restrictedBalanceMinor: '0',
      displayBalanceMinor: '5000',
      asOf: '2026-04-22T12:00:00.000Z',
    })
  })

  it('returns the insufficient-funds error shape consumed by nines-back-end', async () => {
    harness = await createTestApplication()
    await harness.container.services.playerAccountProvisioningService.provisionIfNeeded(
      {
        idempotencyKey: toIdempotencyKey('phase-2-8-provision-unfunded'),
        userId: toUserId(contractReserveStakeCommand.userId),
        currency: 'USDC',
        correlationId: 'corr_phase_2_8_provision_unfunded',
        causationId: 'cause_phase_2_8_provision_unfunded',
      },
    )

    const response = await request(harness.app)
      .post('/commands/reserve-stake')
      .set(
        stateChangingHeaders(
          contractReserveStakeCommand.idempotencyKey,
          contractReserveStakeCommand.correlationId,
          contractReserveStakeCommand.causationId,
        ),
      )
      .send(contractReserveStakeCommand)

    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({
      error: {
        category: 'conflict',
        code: 'INSUFFICIENT_FUNDS',
        retryable: false,
        details: {
          currentBalanceMinor: '0',
          requestedDebitMinor: '1200',
        },
      },
      correlationId: contractReserveStakeCommand.correlationId,
      causationId: contractReserveStakeCommand.causationId,
    })
  })

  it('returns the validation error shape consumed by nines-back-end', async () => {
    harness = await createTestApplication()

    const response = await request(harness.app)
      .post('/commands/reserve-stake')
      .set(
        stateChangingHeaders(
          contractReserveStakeCommand.idempotencyKey,
          contractReserveStakeCommand.correlationId,
          contractReserveStakeCommand.causationId,
        ),
      )
      .send({
        ...contractReserveStakeCommand,
        stakeMinor: '12.00',
      })

    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({
      error: {
        category: 'validation_error',
        code: 'INVALID_COMMAND_REQUEST',
        retryable: false,
      },
      correlationId: contractReserveStakeCommand.correlationId,
      causationId: contractReserveStakeCommand.causationId,
    })
    expect(response.body.error.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'stakeMinor' }),
      ]),
    )
  })
})
