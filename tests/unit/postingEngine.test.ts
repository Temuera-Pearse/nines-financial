import { afterEach, describe, expect, it } from 'vitest'

import { toIdempotencyKey } from '../../src/shared/idempotency/types.js'
import { AppError } from '../../src/shared/types/AppError.js'
import { toOwnerId } from '../../src/domains/accounting/types/identifiers.js'
import { createTestApplication, type TestApplicationHarness } from '../support/testApp.js'

async function createAccount(harness: TestApplicationHarness, input: {
  accountType:
    | 'user_available'
    | 'deposit_clearing'
    | 'settlement_clearing'
  ownerType: 'user' | 'platform' | 'settlement'
  ownerId: string
  key: string
}) {
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

describe('PostingEngineService', () => {
  let harness: TestApplicationHarness | undefined

  afterEach(async () => {
    if (harness) {
      await harness.close()
      harness = undefined
    }
  })

  it('accepts a balanced transaction and updates balances', async () => {
    harness = await createTestApplication()
    const funding = await createAccount(harness, {
      accountType: 'deposit_clearing',
      ownerType: 'platform',
      ownerId: 'platform-main',
      key: 'funding',
    })
    const userAvailable = await createAccount(harness, {
      accountType: 'user_available',
      ownerType: 'user',
      ownerId: 'user-1',
      key: 'user-available',
    })

    const transaction = await harness.container.services.postingEngineService.postTransaction({
      idempotencyKey: toIdempotencyKey('post-balanced'),
      transactionType: 'deposit_confirmed_credit',
      referenceType: 'deposit',
      referenceId: 'deposit-1',
      correlationId: 'corr_post-balanced',
      causationId: 'cause_post-balanced',
      entries: [
        {
          accountId: funding.accountId,
          direction: 'debit',
          amountMinor: '1000',
          currency: 'USDC',
        },
        {
          accountId: userAvailable.accountId,
          direction: 'credit',
          amountMinor: '1000',
          currency: 'USDC',
        },
      ],
    })

    const entries = await harness.container.repositories.ledgerRepository.listAllEntries()
    const userBalance = await harness.container.repositories.accountRepository.getBalance(userAvailable.accountId)

    expect(transaction.entries).toHaveLength(2)
    expect(entries).toHaveLength(2)
    expect(userBalance?.balance.amountMinor).toBe(1000n)
  })

  it('rejects an unbalanced transaction without writing entries', async () => {
    harness = await createTestApplication()
    const funding = await createAccount(harness, {
      accountType: 'deposit_clearing',
      ownerType: 'platform',
      ownerId: 'platform-main',
      key: 'funding',
    })
    const userAvailable = await createAccount(harness, {
      accountType: 'user_available',
      ownerType: 'user',
      ownerId: 'user-1',
      key: 'user-available',
    })

    await expect(
      harness.container.services.postingEngineService.postTransaction({
        idempotencyKey: toIdempotencyKey('post-unbalanced'),
        transactionType: 'deposit_confirmed_credit',
        referenceType: 'deposit',
        referenceId: 'deposit-bad',
        correlationId: 'corr_post-unbalanced',
        causationId: 'cause_post-unbalanced',
        entries: [
          {
            accountId: funding.accountId,
            direction: 'debit',
            amountMinor: '1000',
            currency: 'USDC',
          },
          {
            accountId: userAvailable.accountId,
            direction: 'credit',
            amountMinor: '900',
            currency: 'USDC',
          },
        ],
      }),
    ).rejects.toMatchObject({
      category: 'invariant_violation',
      code: 'UNBALANCED_TRANSACTION',
    } satisfies Partial<AppError>)

    const entries = await harness.container.repositories.ledgerRepository.listAllEntries()
    expect(entries).toHaveLength(0)
  })

  it('rejects postings to frozen accounts', async () => {
    harness = await createTestApplication()
    const funding = await createAccount(harness, {
      accountType: 'deposit_clearing',
      ownerType: 'platform',
      ownerId: 'platform-main',
      key: 'funding',
    })
    const userAvailable = await createAccount(harness, {
      accountType: 'user_available',
      ownerType: 'user',
      ownerId: 'user-1',
      key: 'user-available',
    })

    await harness.container.services.accountService.freezeAccount({
      accountId: userAvailable.accountId,
      correlationId: 'corr_freeze',
      causationId: 'cause_freeze',
    })

    await expect(
      harness.container.services.postingEngineService.postTransfer({
        idempotencyKey: toIdempotencyKey('post-frozen'),
        transactionType: 'deposit_confirmed_credit',
        referenceType: 'deposit',
        referenceId: 'deposit-frozen',
        debitAccountId: funding.accountId,
        creditAccountId: userAvailable.accountId,
        amountMinor: '1000',
        currency: 'USDC',
        correlationId: 'corr_post-frozen',
        causationId: 'cause_post-frozen',
      }),
    ).rejects.toMatchObject({
      category: 'forbidden',
      code: 'ACCOUNT_NOT_POSTABLE',
    } satisfies Partial<AppError>)
  })
})
