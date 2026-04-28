import { afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'

import { toIdempotencyKey } from '../../src/shared/idempotency/types.js'
import { toOwnerId } from '../../src/domains/accounting/types/identifiers.js'
import {
  createTestApplication,
  stateChangingHeaders,
  type TestApplicationHarness,
} from '../support/testApp.js'

async function createAccount(
  harness: TestApplicationHarness,
  input: {
    accountType: 'deposit_clearing' | 'user_available'
    ownerType: 'platform' | 'user'
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

describe('System HTTP', () => {
  let harness: TestApplicationHarness | undefined

  afterEach(async () => {
    if (harness) {
      await harness.close()
      harness = undefined
    }
  })

  it('verifies and rebuilds the balance read model after drift', async () => {
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
      ownerId: 'user-maintenance-1',
      key: 'available',
    })

    await harness.container.services.postingEngineService.postTransfer({
      idempotencyKey: toIdempotencyKey('seed-maintenance-balance'),
      transactionType: 'deposit_confirmed_credit',
      referenceType: 'deposit',
      referenceId: 'deposit-maintenance-1',
      debitAccountId: funding.accountId,
      creditAccountId: available.accountId,
      amountMinor: '1000',
      currency: 'USDC',
      correlationId: 'corr_seed-maintenance-balance',
      causationId: 'cause_seed-maintenance-balance',
    })

    await harness.database.query(
      `
        UPDATE account_balances
        SET balance_minor = $2,
            total_debits_minor = $3,
            total_credits_minor = $4
        WHERE account_id = $1
      `,
      [available.accountId, '999', '0', '999'],
    )

    const verificationBefore = await request(harness.app).get(
      '/system/balances/verify',
    )

    expect(verificationBefore.status).toBe(200)
    expect(verificationBefore.body.verification.mismatchCount).toBe(1)
    expect(verificationBefore.body.verification.mismatches[0].accountId).toBe(
      available.accountId,
    )

    const rebuildResponse = await request(harness.app)
      .post('/system/balances/rebuild')
      .set(stateChangingHeaders('rebuild-balances-http'))
      .send({})

    expect(rebuildResponse.status).toBe(200)
    expect(rebuildResponse.body.rebuild.mismatchCountBefore).toBe(1)

    const verificationAfter = await request(harness.app).get(
      '/system/balances/verify',
    )
    const balanceResponse = await request(harness.app).get(
      `/accounts/${available.accountId}/balance`,
    )
    const auditEvents =
      await harness.container.repositories.auditEventRepository.listByEntity(
        'system',
        'account_balances',
      )

    expect(verificationAfter.status).toBe(200)
    expect(verificationAfter.body.verification.mismatchCount).toBe(0)
    expect(balanceResponse.body.balance.balanceMinor).toBe('1000')
    expect(auditEvents).toHaveLength(1)
    expect(auditEvents[0]?.eventType).toBe('account_balance_read_model_rebuilt')
  })
})
