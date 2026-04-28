import { afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'

import { toIdempotencyKey } from '../../src/shared/idempotency/types.js'
import {
  toOwnerId,
  type AccountId,
} from '../../src/domains/accounting/types/identifiers.js'
import { toUserId } from '../../src/domains/account/types/identifiers.js'
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
      idempotencyKey: toIdempotencyKey(key),
      userId: toUserId(userId),
      currency: 'USDC',
      correlationId: `corr_${key}`,
      causationId: `cause_${key}`,
    },
  )
}

async function fundPlayerAvailableBalance(
  harness: TestApplicationHarness,
  availableAccountId: AccountId,
) {
  const sourceAccount =
    await harness.container.services.accountService.createAccount({
      accountType: 'deposit_clearing',
      ownerType: 'platform',
      ownerId: toOwnerId('platform-main'),
      currency: 'USDC',
      correlationId: 'corr_create_deposit_source',
      causationId: 'cause_create_deposit_source',
      idempotencyKey: toIdempotencyKey('create-deposit-source'),
    })

  await harness.container.services.postingEngineService.postTransfer({
    idempotencyKey: toIdempotencyKey('fund-player-available'),
    transactionType: 'deposit_confirmed_credit',
    referenceType: 'deposit',
    referenceId: 'deposit-player-account-http',
    debitAccountId: sourceAccount.accountId,
    creditAccountId: availableAccountId,
    amountMinor: '2500000',
    currency: 'USDC',
    correlationId: 'corr_fund_player',
    causationId: 'cause_fund_player',
  })
}

describe('Player account HTTP', () => {
  let harness: TestApplicationHarness | undefined

  afterEach(async () => {
    if (harness) {
      await harness.close()
      harness = undefined
    }
  })

  it('persists provisioned player accounts and exposes balance DTOs', async () => {
    harness = await createTestApplication()
    const playerAccount = await provisionPlayerAccount(
      harness,
      'user-player-http-1',
      'provision-player-http-1',
    )

    await fundPlayerAvailableBalance(
      harness,
      playerAccount.availableAccountId,
    )

    const persisted = await harness.database.query<{
      count: number
    }>(
      'SELECT count(*)::int AS count FROM player_accounts WHERE player_account_id = $1',
      [playerAccount.playerAccountId],
    )
    const availableAccount =
      await harness.container.repositories.accountRepository.getById(
        playerAccount.availableAccountId,
      )
    const lockedAccount =
      await harness.container.repositories.accountRepository.getById(
        playerAccount.reservedAccountId,
      )
    const summaryResponse = await request(harness.app)
      .get('/player/accounts/USDC')
      .set('x-nines-authenticated-user-id', 'user-player-http-1')
    const balanceResponse = await request(harness.app)
      .get('/player/accounts/USDC/balance')
      .set('x-nines-authenticated-user-id', 'user-player-http-1')

    expect(persisted.rows[0]?.count).toBe(1)
    expect(availableAccount?.accountType).toBe('user_available')
    expect(lockedAccount?.accountType).toBe('user_locked')
    expect(summaryResponse.status).toBe(200)
    expect(summaryResponse.body.currency).toBe('USDC')
    expect(summaryResponse.body.userId).toBe('user-player-http-1')
    expect(summaryResponse.body.spendableBalanceMinor).toBe('2500000')
    expect(balanceResponse.status).toBe(200)
    expect(balanceResponse.body.lockedBalanceMinor).toBe('0')
    expect(balanceResponse.body.displayBalanceMinor).toBe('2500000')
  })

  it('reuses first-touch provisioning under duplicate requests', async () => {
    harness = await createTestApplication()

    const [firstAccount, secondAccount] = await Promise.all([
      provisionPlayerAccount(
        harness,
        'user-player-concurrent',
        'provision-player-concurrent-1',
      ),
      provisionPlayerAccount(
        harness,
        'user-player-concurrent',
        'provision-player-concurrent-2',
      ),
    ])
    const persisted = await harness.database.query<{
      count: number
    }>(
      'SELECT count(*)::int AS count FROM player_accounts WHERE user_id = $1 AND currency = $2',
      ['user-player-concurrent', 'USDC'],
    )

    expect(firstAccount.playerAccountId).toBe(secondAccount.playerAccountId)
    expect(persisted.rows[0]?.count).toBe(1)
  })

  it('mounts admin account-control routes and persists lifecycle state', async () => {
    harness = await createTestApplication()
    const playerAccount = await provisionPlayerAccount(
      harness,
      'user-player-controls',
      'provision-player-controls',
    )
    const adminHeader = { 'x-nines-authenticated-user-id': 'admin-1' }

    const restrictionResponse = await request(harness.app)
      .post(`/admin/accounts/${playerAccount.playerAccountId}/restrictions`)
      .set(adminHeader)
      .set(stateChangingHeaders('apply-restriction-http'))
      .send({
        blockedActions: ['bet_reserve'],
        reasonCode: 'risk_review',
        reasonText: 'Risk review pending',
        ticketId: 'TICKET-1',
      })
    const suspensionResponse = await request(harness.app)
      .post(`/admin/accounts/${playerAccount.playerAccountId}/suspension`)
      .set(adminHeader)
      .set(stateChangingHeaders('apply-suspension-http'))
      .send({
        reasonCode: 'kyc_review',
        reasonText: 'KYC review pending',
        ticketId: 'TICKET-2',
      })
    const freezeResponse = await request(harness.app)
      .post(`/admin/accounts/${playerAccount.playerAccountId}/freeze`)
      .set(adminHeader)
      .set(stateChangingHeaders('apply-freeze-http'))
      .send({
        reasonCode: 'chargeback_review',
        reasonText: 'Chargeback review pending',
        ticketId: 'TICKET-3',
      })
    const inspectionResponse = await request(harness.app)
      .get(`/admin/accounts/${playerAccount.playerAccountId}`)
      .set(adminHeader)

    expect(restrictionResponse.status).toBe(201)
    expect(restrictionResponse.body.account.effectiveStatus).toBe('restricted')
    expect(suspensionResponse.status).toBe(201)
    expect(suspensionResponse.body.account.effectiveStatus).toBe('suspended')
    expect(freezeResponse.status).toBe(201)
    expect(freezeResponse.body.account.effectiveStatus).toBe('frozen')
    expect(freezeResponse.body.accountingCoreSync.availableAccountStatus).toBe(
      'frozen',
    )
    expect(inspectionResponse.status).toBe(200)
    expect(inspectionResponse.body.account.effectiveStatus).toBe('frozen')
    expect(inspectionResponse.body.account.activeRestrictionCount).toBe(1)
    expect(inspectionResponse.body.account.hasActiveSuspension).toBe(true)
    expect(inspectionResponse.body.account.hasActiveFreeze).toBe(true)

    const liftFreezeResponse = await request(harness.app)
      .post(`/admin/accounts/${playerAccount.playerAccountId}/freeze/lift`)
      .set(adminHeader)
      .set(stateChangingHeaders('lift-freeze-http'))
      .send({
        reasonCode: 'review_clear',
        reasonText: 'Review cleared',
        ticketId: 'TICKET-3',
      })
    const liftSuspensionResponse = await request(harness.app)
      .post(`/admin/accounts/${playerAccount.playerAccountId}/suspension/lift`)
      .set(adminHeader)
      .set(stateChangingHeaders('lift-suspension-http'))
      .send({
        reasonCode: 'kyc_clear',
        reasonText: 'KYC cleared',
        ticketId: 'TICKET-2',
      })
    const liftRestrictionResponse = await request(harness.app)
      .post(
        `/admin/accounts/${playerAccount.playerAccountId}/restrictions/${restrictionResponse.body.restriction.restrictionId}/lift`,
      )
      .set(adminHeader)
      .set(stateChangingHeaders('lift-restriction-http'))
      .send({
        reasonCode: 'risk_clear',
        reasonText: 'Risk review cleared',
        ticketId: 'TICKET-1',
      })

    expect(liftFreezeResponse.status).toBe(200)
    expect(liftFreezeResponse.body.account.effectiveStatus).toBe('suspended')
    expect(liftSuspensionResponse.status).toBe(200)
    expect(liftSuspensionResponse.body.account.effectiveStatus).toBe(
      'restricted',
    )
    expect(liftRestrictionResponse.status).toBe(200)
    expect(liftRestrictionResponse.body.account.effectiveStatus).toBe('active')
  })
})
