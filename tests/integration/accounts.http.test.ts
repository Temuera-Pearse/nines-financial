import { afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'

import { createTestApplication, stateChangingHeaders, type TestApplicationHarness } from '../support/testApp.js'

describe('Accounts HTTP', () => {
  let harness: TestApplicationHarness | undefined

  afterEach(async () => {
    if (harness) {
      await harness.close()
      harness = undefined
    }
  })

  it('creates an account and exposes its balance read model', async () => {
    harness = await createTestApplication()

    const createResponse = await request(harness.app)
      .post('/accounts')
      .set(stateChangingHeaders('create-account-http'))
      .send({
        accountType: 'user_available',
        ownerType: 'user',
        ownerId: 'user-http-1',
        currency: 'USDC',
      })

    expect(createResponse.status).toBe(201)
    expect(createResponse.body.account.accountType).toBe('user_available')
    expect(createResponse.body.account.accountClass).toBe('liability')
    expect(createResponse.body.account.normalBalance).toBe('credit')

    const accountId = createResponse.body.account.accountId as string
    const getResponse = await request(harness.app).get(`/accounts/${accountId}`)
    const balanceResponse = await request(harness.app).get(`/accounts/${accountId}/balance`)

    expect(getResponse.status).toBe(200)
    expect(getResponse.body.account.accountId).toBe(accountId)
    expect(balanceResponse.status).toBe(200)
    expect(balanceResponse.body.balance.balanceMinor).toBe('0')
    expect(balanceResponse.body.balance.totalDebitsMinor).toBe('0')
    expect(balanceResponse.body.balance.totalCreditsMinor).toBe('0')
  })
})
