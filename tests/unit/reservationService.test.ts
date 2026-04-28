import { afterEach, describe, expect, it } from 'vitest'

import { toIdempotencyKey } from '../../src/shared/idempotency/types.js'
import { toOwnerId } from '../../src/domains/accounting/types/identifiers.js'
import { createTestApplication, type TestApplicationHarness } from '../support/testApp.js'

async function createAccount(
  harness: TestApplicationHarness,
  input: {
    accountType:
      | 'deposit_clearing'
      | 'user_available'
      | 'user_locked'
      | 'settlement_clearing'
    ownerType: 'platform' | 'user' | 'settlement'
    ownerId: string
    key: string
  },
) {
  return harness.container.services.accountService.createAccount({
    accountType: input.accountType,
    ownerType: input.ownerType,
    ownerId: toOwnerId(input.ownerId),
    currency: 'USDC',
    correlationId: `corr_${input.key}`,
    causationId: `cause_${input.key}`,
    idempotencyKey: toIdempotencyKey(`acct_${input.key}`),
  })
}

async function seedAvailableBalance(harness: TestApplicationHarness, fundingAccountId: string, userAvailableAccountId: string) {
  await harness.container.services.postingEngineService.postTransfer({
    idempotencyKey: toIdempotencyKey('seed-user-available'),
    transactionType: 'deposit_confirmed_credit',
    referenceType: 'deposit',
    referenceId: 'seed-deposit',
    debitAccountId: fundingAccountId as never,
    creditAccountId: userAvailableAccountId as never,
    amountMinor: '1000',
    currency: 'USDC',
    correlationId: 'corr_seed-user-available',
    causationId: 'cause_seed-user-available',
  })
}

describe('ReservationService', () => {
  let harness: TestApplicationHarness | undefined

  afterEach(async () => {
    if (harness) {
      await harness.close()
      harness = undefined
    }
  })

  it('moves funds from available to reserved and back on release', async () => {
    harness = await createTestApplication()
    const funding = await createAccount(harness, {
      accountType: 'deposit_clearing',
      ownerType: 'platform',
      ownerId: 'platform-main',
      key: 'funding',
    })
    const available = await createAccount(harness, {
      accountType: 'user_available',
      ownerType: 'user',
      ownerId: 'user-1',
      key: 'available',
    })
    const reserved = await createAccount(harness, {
      accountType: 'user_locked',
      ownerType: 'user',
      ownerId: 'user-1',
      key: 'reserved',
    })

    await seedAvailableBalance(harness, funding.accountId, available.accountId)

    const reservation = await harness.container.services.reservationService.reserveFunds({
      idempotencyKey: toIdempotencyKey('reserve-bet-1'),
      transactionType: 'bet_reserve',
      referenceType: 'bet',
      referenceId: 'bet-1',
      sourceAccountId: available.accountId,
      reserveAccountId: reserved.accountId,
      amountMinor: '400',
      currency: 'USDC',
      correlationId: 'corr_reserve-bet-1',
      causationId: 'cause_reserve-bet-1',
    })

    const release = await harness.container.services.reservationService.releaseFunds({
      idempotencyKey: toIdempotencyKey('release-bet-1'),
      reservationId: reservation.transactionId,
      correlationId: 'corr_release-bet-1',
      causationId: 'cause_release-bet-1',
    })

    const availableBalance = await harness.container.services.accountService.getAccountBalance(available.accountId)
    const reservedBalance = await harness.container.services.accountService.getAccountBalance(reserved.accountId)

    expect(release.transactionType).toBe('bet_release')
    expect(availableBalance.balance.amountMinor).toBe(1000n)
    expect(reservedBalance.balance.amountMinor).toBe(0n)
  })

  it('moves reserved funds to the destination account on capture', async () => {
    harness = await createTestApplication()
    const funding = await createAccount(harness, {
      accountType: 'deposit_clearing',
      ownerType: 'platform',
      ownerId: 'platform-main',
      key: 'funding',
    })
    const available = await createAccount(harness, {
      accountType: 'user_available',
      ownerType: 'user',
      ownerId: 'user-1',
      key: 'available',
    })
    const reserved = await createAccount(harness, {
      accountType: 'user_locked',
      ownerType: 'user',
      ownerId: 'user-1',
      key: 'reserved',
    })
    const holding = await createAccount(harness, {
      accountType: 'settlement_clearing',
      ownerType: 'settlement',
      ownerId: 'bet-intake-main',
      key: 'holding',
    })

    await seedAvailableBalance(harness, funding.accountId, available.accountId)

    const reservation = await harness.container.services.reservationService.reserveFunds({
      idempotencyKey: toIdempotencyKey('reserve-bet-2'),
      transactionType: 'bet_reserve',
      referenceType: 'bet',
      referenceId: 'bet-2',
      sourceAccountId: available.accountId,
      reserveAccountId: reserved.accountId,
      amountMinor: '400',
      currency: 'USDC',
      correlationId: 'corr_reserve-bet-2',
      causationId: 'cause_reserve-bet-2',
    })

    const capture = await harness.container.services.reservationService.captureFunds({
      idempotencyKey: toIdempotencyKey('capture-bet-2'),
      reservationId: reservation.transactionId,
      destinationAccountId: holding.accountId,
      correlationId: 'corr_capture-bet-2',
      causationId: 'cause_capture-bet-2',
    })

    const availableBalance = await harness.container.services.accountService.getAccountBalance(available.accountId)
    const reservedBalance = await harness.container.services.accountService.getAccountBalance(reserved.accountId)
    const holdingBalance = await harness.container.services.accountService.getAccountBalance(holding.accountId)

    expect(capture.transactionType).toBe('bet_capture')
    expect(availableBalance.balance.amountMinor).toBe(600n)
    expect(reservedBalance.balance.amountMinor).toBe(0n)
    expect(holdingBalance.balance.amountMinor).toBe(400n)
  })
})
