import { afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'

import {
  createTestApplication,
  stateChangingHeaders,
  type TestApplicationHarness,
} from '../support/testApp.js'

async function createAccount(
  harness: TestApplicationHarness,
  requestKey: string,
  body: {
    accountType: string
    ownerType: string
    ownerId: string
    currency?: string
  },
) {
  const response = await request(harness.app)
    .post('/accounts')
    .set(stateChangingHeaders(requestKey))
    .send({ ...body, currency: body.currency ?? 'USDC' })

  expect(response.status).toBe(201)
  return response.body.account.accountId as string
}

describe('Ledger HTTP', () => {
  let harness: TestApplicationHarness | undefined

  afterEach(async () => {
    if (harness) {
      await harness.close()
      harness = undefined
    }
  })

  it('posts transactions atomically and leaves no partial writes on failure', async () => {
    harness = await createTestApplication()
    const fundingAccountId = await createAccount(harness, 'create-funding', {
      accountType: 'deposit_clearing',
      ownerType: 'platform',
      ownerId: 'platform-main',
    })
    const userAccountId = await createAccount(harness, 'create-user', {
      accountType: 'user_available',
      ownerType: 'user',
      ownerId: 'user-http-1',
    })

    const response = await request(harness.app)
      .post('/ledger/transactions')
      .set(stateChangingHeaders('bad-transaction'))
      .send({
        transactionType: 'deposit_confirmed_credit',
        referenceType: 'deposit',
        referenceId: 'deposit-bad-http',
        entries: [
          {
            accountId: fundingAccountId,
            direction: 'debit',
            amountMinor: '1000',
            currency: 'USDC',
          },
          {
            accountId: 'acct_missing',
            direction: 'credit',
            amountMinor: '1000',
            currency: 'USDC',
          },
        ],
      })

    const entries =
      await harness.container.repositories.ledgerRepository.listAllEntries()
    const userBalanceResponse = await request(harness.app).get(
      `/accounts/${userAccountId}/balance`,
    )

    expect(response.status).toBe(404)
    expect(entries).toHaveLength(0)
    expect(userBalanceResponse.body.balance.balanceMinor).toBe('0')
  })

  it('replays duplicate idempotent requests and rejects mismatched payloads', async () => {
    harness = await createTestApplication()
    const fundingAccountId = await createAccount(harness, 'create-funding', {
      accountType: 'deposit_clearing',
      ownerType: 'platform',
      ownerId: 'platform-main',
    })
    const userAccountId = await createAccount(harness, 'create-user', {
      accountType: 'user_available',
      ownerType: 'user',
      ownerId: 'user-http-1',
    })

    const payload = {
      transactionType: 'deposit_confirmed_credit',
      referenceType: 'deposit',
      referenceId: 'deposit-http-1',
      entries: [
        {
          accountId: fundingAccountId,
          direction: 'debit',
          amountMinor: '1000',
          currency: 'USDC',
        },
        {
          accountId: userAccountId,
          direction: 'credit',
          amountMinor: '1000',
          currency: 'USDC',
        },
      ],
    }

    const firstResponse = await request(harness.app)
      .post('/ledger/transactions')
      .set(stateChangingHeaders('idem-http-1'))
      .send(payload)
    const replayResponse = await request(harness.app)
      .post('/ledger/transactions')
      .set(stateChangingHeaders('idem-http-1'))
      .send(payload)
    const mismatchResponse = await request(harness.app)
      .post('/ledger/transactions')
      .set(stateChangingHeaders('idem-http-1'))
      .send({
        ...payload,
        referenceId: 'deposit-http-2',
      })

    const entries =
      await harness.container.repositories.ledgerRepository.listAllEntries()
    const userBalanceResponse = await request(harness.app).get(
      `/accounts/${userAccountId}/balance`,
    )

    expect(firstResponse.status).toBe(201)
    expect(replayResponse.status).toBe(201)
    expect(replayResponse.body.transaction.transactionId).toBe(
      firstResponse.body.transaction.transactionId,
    )
    expect(firstResponse.body.transaction.idempotencyKey).toBe('idem-http-1')
    expect(replayResponse.body.transaction.idempotencyKey).toBe('idem-http-1')
    expect(mismatchResponse.status).toBe(409)
    expect(mismatchResponse.body.error.category).toBe('idempotency_conflict')
    expect(entries).toHaveLength(2)
    expect(userBalanceResponse.body.balance.balanceMinor).toBe('1000')
  })
})
