import { afterEach, describe, expect, it } from 'vitest'

import { toIdempotencyKey } from '../../src/shared/idempotency/types.js'
import { toOwnerId } from '../../src/domains/accounting/types/identifiers.js'
import {
  createTestApplication,
  type TestApplicationHarness,
} from '../support/testApp.js'

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

async function setupScenario() {
  const harness = await createTestApplication()
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

  await harness.container.services.postingEngineService.postTransfer({
    idempotencyKey: toIdempotencyKey('seed-invariant'),
    transactionType: 'deposit_confirmed_credit',
    referenceType: 'deposit',
    referenceId: 'deposit-invariant',
    debitAccountId: funding.accountId,
    creditAccountId: available.accountId,
    amountMinor: '1000',
    currency: 'USDC',
    correlationId: 'corr_seed-invariant',
    causationId: 'cause_seed-invariant',
  })

  const reservation =
    await harness.container.services.reservationService.reserveFunds({
      idempotencyKey: toIdempotencyKey('reserve-invariant'),
      transactionType: 'bet_reserve',
      referenceType: 'bet',
      referenceId: 'bet-invariant',
      sourceAccountId: available.accountId,
      reserveAccountId: reserved.accountId,
      amountMinor: '400',
      currency: 'USDC',
      correlationId: 'corr_reserve-invariant',
      causationId: 'cause_reserve-invariant',
    })

  return {
    harness,
    accounts: { funding, available, reserved, holding },
    reservation,
  }
}

describe('Ledger invariants', () => {
  let harness: TestApplicationHarness | undefined

  afterEach(async () => {
    if (harness) {
      await harness.close()
      harness = undefined
    }
  })

  it('keeps total debits equal to total credits across postings', async () => {
    const scenario = await setupScenario()
    harness = scenario.harness

    await harness.container.services.reservationService.captureFunds({
      idempotencyKey: toIdempotencyKey('capture-invariant'),
      reservationId: scenario.reservation.transactionId,
      destinationAccountId: scenario.accounts.holding.accountId,
      correlationId: 'corr_capture-invariant',
      causationId: 'cause_capture-invariant',
    })

    const entries =
      await harness.container.repositories.ledgerRepository.listAllEntries()
    const totalDebits = entries
      .filter((entry) => entry.direction === 'debit')
      .reduce(
        (runningTotal, entry) => runningTotal + entry.amount.amountMinor,
        0n,
      )
    const totalCredits = entries
      .filter((entry) => entry.direction === 'credit')
      .reduce(
        (runningTotal, entry) => runningTotal + entry.amount.amountMinor,
        0n,
      )

    expect(totalDebits).toBe(totalCredits)
  })

  it('preserves append-only behaviour by adding new rows for follow-up actions', async () => {
    const scenario = await setupScenario()
    harness = scenario.harness
    const initialEntries =
      await harness.container.repositories.ledgerRepository.listAllEntries()
    const originalReservation =
      await harness.container.repositories.ledgerRepository.getById(
        scenario.reservation.transactionId,
      )

    await harness.container.services.reservationService.releaseFunds({
      idempotencyKey: toIdempotencyKey('release-invariant'),
      reservationId: scenario.reservation.transactionId,
      correlationId: 'corr_release-invariant',
      causationId: 'cause_release-invariant',
    })

    const finalEntries =
      await harness.container.repositories.ledgerRepository.listAllEntries()
    const reservationAfterRelease =
      await harness.container.repositories.ledgerRepository.getById(
        scenario.reservation.transactionId,
      )

    expect(initialEntries).toHaveLength(4)
    expect(finalEntries).toHaveLength(6)
    expect(reservationAfterRelease?.entries).toEqual(
      originalReservation?.entries,
    )
  })

  it('does not duplicate money movement on idempotent retries', async () => {
    const scenario = await setupScenario()
    harness = scenario.harness

    const replayReservation =
      await harness.container.services.reservationService.reserveFunds({
        idempotencyKey: toIdempotencyKey('reserve-invariant'),
        transactionType: 'bet_reserve',
        referenceType: 'bet',
        referenceId: 'bet-invariant',
        sourceAccountId: scenario.accounts.available.accountId,
        reserveAccountId: scenario.accounts.reserved.accountId,
        amountMinor: '400',
        currency: 'USDC',
        correlationId: 'corr_reserve-invariant',
        causationId: 'cause_reserve-invariant',
      })

    const entries =
      await harness.container.repositories.ledgerRepository.listAllEntries()

    expect(replayReservation.transactionId).toBe(
      scenario.reservation.transactionId,
    )
    expect(entries).toHaveLength(4)
  })

  it('keeps the balance read model aligned with ledger-derived balances', async () => {
    const scenario = await setupScenario()
    harness = scenario.harness

    await harness.container.services.reservationService.captureFunds({
      idempotencyKey: toIdempotencyKey('capture-invariant-balance'),
      reservationId: scenario.reservation.transactionId,
      destinationAccountId: scenario.accounts.holding.accountId,
      correlationId: 'corr_capture-invariant-balance',
      causationId: 'cause_capture-invariant-balance',
    })

    for (const account of Object.values(scenario.accounts)) {
      const entries =
        await harness.container.repositories.ledgerRepository.listEntriesByAccountId(
          account.accountId,
        )
      const derivedBalance = entries.reduce((runningTotal, entry) => {
        const increasesBalance = entry.direction === account.normalBalance
        return (
          runningTotal +
          (increasesBalance
            ? entry.amount.amountMinor
            : -entry.amount.amountMinor)
        )
      }, 0n)
      const readModelBalance =
        await harness.container.repositories.accountRepository.getBalance(
          account.accountId,
        )

      expect(readModelBalance?.balance.amountMinor).toBe(derivedBalance)
    }
  })

  it('prevents a second reservation resolution row at the database layer', async () => {
    const scenario = await setupScenario()
    harness = scenario.harness

    await harness.container.services.reservationService.captureFunds({
      idempotencyKey: toIdempotencyKey('capture-invariant-guardrail'),
      reservationId: scenario.reservation.transactionId,
      destinationAccountId: scenario.accounts.holding.accountId,
      correlationId: 'corr_capture-invariant-guardrail',
      causationId: 'cause_capture-invariant-guardrail',
    })

    await expect(
      harness.database.query(
        `
          INSERT INTO ledger_transactions (
            transaction_id,
            transaction_type,
            reference_type,
            reference_id,
            status,
            related_transaction_id,
            correlation_id,
            causation_id,
            idempotency_key,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          'txn_guardrail_duplicate_resolution',
          'bet_release',
          scenario.reservation.referenceType,
          scenario.reservation.referenceId,
          'posted',
          scenario.reservation.transactionId,
          'corr_guardrail_duplicate_resolution',
          'cause_guardrail_duplicate_resolution',
          'idem_guardrail_duplicate_resolution',
          new Date('2026-04-22T12:05:00.000Z'),
        ],
      ),
    ).rejects.toBeTruthy()
  })
})
