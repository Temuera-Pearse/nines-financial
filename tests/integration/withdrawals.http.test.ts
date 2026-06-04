import { createHmac } from 'node:crypto'

import { afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'

import { toUserId } from '../../src/domains/account/types/identifiers.js'
import { toOwnerId } from '../../src/domains/accounting/types/identifiers.js'
import type {
  FaultInjector,
  FaultPoint,
} from '../../src/shared/faults/FaultInjector.js'
import { toIdempotencyKey } from '../../src/shared/idempotency/types.js'
import { AppError } from '../../src/shared/types/AppError.js'
import {
  createTestApplication,
  stateChangingHeaders,
  type TestApplicationHarness,
} from '../support/testApp.js'

class OneShotFaultInjector implements FaultInjector {
  private fired = false

  constructor(private readonly faultPoint: FaultPoint) {}

  trigger(point: FaultPoint): void {
    if (this.fired || point !== this.faultPoint) {
      return
    }

    this.fired = true
    throw new AppError({
      category: 'internal_error',
      code: 'SIMULATED_WITHDRAWAL_INTERRUPT',
      message: 'Simulated process interruption for withdrawal retry coverage',
      retryable: true,
      details: { point },
    })
  }
}

function playerHeaders(userId = 'withdrawal-player-1', key = 'withdrawal-key') {
  return {
    'x-nines-authenticated-user-id': userId,
    ...stateChangingHeaders(key, `corr_${key}`, `cause_${key}`),
  }
}

function operatorHeaders(key = 'withdrawal-operator-key', role = 'treasury_operator') {
  return {
    'x-nines-authenticated-user-id': 'operator-withdrawals',
    'x-nines-operator-role': role,
    ...stateChangingHeaders(key, `corr_${key}`, `cause_${key}`),
  }
}

async function provisionPlayerAccount(
  harness: TestApplicationHarness,
  userId: string,
  key: string,
) {
  return harness.container.services.playerAccountProvisioningService.provisionIfNeeded(
    {
      idempotencyKey: toIdempotencyKey(`withdrawal-provision-${key}`),
      userId: toUserId(userId),
      currency: 'USDC',
      correlationId: `corr_withdrawal_provision_${key}`,
      causationId: `cause_withdrawal_provision_${key}`,
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
  const depositSource =
    await harness.container.services.accountService.createAccount({
      accountType: 'deposit_clearing',
      ownerType: 'platform',
      ownerId: toOwnerId(`withdrawal-deposit-source-${userId}`),
      currency: 'USDC',
      correlationId: `corr_withdrawal_deposit_source_${userId}`,
      causationId: `cause_withdrawal_deposit_source_${userId}`,
      idempotencyKey: toIdempotencyKey(
        `withdrawal-deposit-source-${userId}`,
      ),
    })

  await harness.container.services.postingEngineService.postTransfer({
    idempotencyKey: toIdempotencyKey(`withdrawal-fund-player-${userId}`),
    transactionType: 'deposit_confirmed_credit',
    referenceType: 'deposit',
    referenceId: `withdrawal-deposit-${userId}`,
    debitAccountId: depositSource.accountId,
    creditAccountId: playerAccount.availableAccountId,
    amountMinor,
    currency: 'USDC',
    correlationId: `corr_withdrawal_fund_${userId}`,
    causationId: `cause_withdrawal_fund_${userId}`,
  })

  return playerAccount
}

async function createWithdrawal(
  harness: TestApplicationHarness,
  overrides: Record<string, unknown> = {},
  userId = 'withdrawal-player-1',
) {
  const idempotencyKey = String(
    overrides.idempotencyKey ?? 'withdrawal-create-key',
  )

  return request(harness.app)
    .post('/withdrawal-requests')
    .set(playerHeaders(userId, idempotencyKey))
    .send({
      amountMinorUnits: '1000',
      currency: 'USDC',
      destinationKind: 'simulated_external_account',
      destinationReference: 'simulated-destination-1',
      provider: 'simulated',
      ...overrides,
    })
}

async function playerBalance(harness: TestApplicationHarness, userId: string) {
  return request(harness.app)
    .get('/player/accounts/USDC/balance')
    .set({ 'x-nines-authenticated-user-id': userId })
}

async function transactionCount(
  harness: TestApplicationHarness,
  transactionType: string,
) {
  const result = await harness.database.query<{ count: number }>(
    `
      SELECT count(*)::int AS count
      FROM ledger_transactions
      WHERE transaction_type = $1
    `,
    [transactionType],
  )

  return result.rows[0]?.count ?? 0
}

async function auditEventsFor(
  harness: TestApplicationHarness,
  eventType: string,
) {
  const result = await harness.database.query<{
    payload: Record<string, unknown>
  }>(
    `
      SELECT payload
      FROM audit_events
      WHERE event_type = $1
      ORDER BY created_at ASC
    `,
    [eventType],
  )

  return result.rows
}

async function approveWithdrawal(
  harness: TestApplicationHarness,
  withdrawalRequestId: string,
  key = 'withdrawal-approve-helper',
) {
  return request(harness.app)
    .post(`/withdrawal-requests/${withdrawalRequestId}/approve`)
    .set(operatorHeaders(key, 'treasury_admin'))
    .send({ reason: 'Treasury approved for simulated submission' })
}

async function submitWithdrawal(
  harness: TestApplicationHarness,
  withdrawalRequestId: string,
  key = 'withdrawal-submit-helper',
  role = 'treasury_admin',
) {
  return request(harness.app)
    .post(`/withdrawal-requests/${withdrawalRequestId}/submit`)
    .set(operatorHeaders(key, role))
    .send({ submissionNote: 'Submit to simulated withdrawal provider' })
}

async function syncWithdrawalProviderStatus(
  harness: TestApplicationHarness,
  withdrawalRequestId: string,
  key = 'withdrawal-sync-helper',
  simulatedProviderStatus = 'pending',
  role = 'treasury_operator',
) {
  return request(harness.app)
    .post(`/withdrawal-requests/${withdrawalRequestId}/sync-provider-status`)
    .set(operatorHeaders(key, role))
    .send({
      reason: 'Sync simulated withdrawal provider status',
      simulatedProviderStatus,
    })
}

async function finalizeWithdrawal(
  harness: TestApplicationHarness,
  withdrawalRequestId: string,
  key = 'withdrawal-finalize-helper',
  role = 'treasury_admin',
) {
  return request(harness.app)
    .post(`/withdrawal-requests/${withdrawalRequestId}/finalize`)
    .set(operatorHeaders(key, role))
    .send({ reason: 'Finalize simulated provider-confirmed withdrawal' })
}

async function releaseAfterProviderFailure(
  harness: TestApplicationHarness,
  withdrawalRequestId: string,
  key = 'withdrawal-provider-failure-release-helper',
  role = 'treasury_admin',
) {
  return request(harness.app)
    .post(
      `/withdrawal-requests/${withdrawalRequestId}/release-after-provider-failure`,
    )
    .set(operatorHeaders(key, role))
    .send({ reason: 'Release reservation after simulated provider failure' })
}

async function markProviderFailureTerminal(
  harness: TestApplicationHarness,
  withdrawalRequestId: string,
  key = 'withdrawal-provider-failure-terminal-helper',
  role = 'treasury_admin',
) {
  return request(harness.app)
    .post(
      `/withdrawal-requests/${withdrawalRequestId}/mark-provider-failure-terminal`,
    )
    .set(operatorHeaders(key, role))
    .send({ reason: 'Provider outcome reviewed as terminal without release' })
}

async function markProviderUnknownReviewed(
  harness: TestApplicationHarness,
  withdrawalRequestId: string,
  key = 'withdrawal-provider-unknown-reviewed-helper',
  role = 'treasury_admin',
) {
  return request(harness.app)
    .post(
      `/withdrawal-requests/${withdrawalRequestId}/mark-provider-unknown-reviewed`,
    )
    .set(operatorHeaders(key, role))
    .send({ reason: 'Unknown provider outcome reviewed by treasury' })
}

async function createSubmittedWithdrawal(
  harness: TestApplicationHarness,
  userId: string,
  key: string,
  simulatedProviderStatus: 'pending' | 'confirmed' | 'failed' | 'rejected' | 'unknown',
) {
  await fundPlayer(harness, userId, '5000')
  const created = await createWithdrawal(
    harness,
    { idempotencyKey: `${key}-create` },
    userId,
  )
  await approveWithdrawal(
    harness,
    created.body.withdrawalRequestId,
    `${key}-approve`,
  )
  await submitWithdrawal(
    harness,
    created.body.withdrawalRequestId,
    `${key}-submit`,
  )

  if (simulatedProviderStatus !== 'pending') {
    return syncWithdrawalProviderStatus(
      harness,
      created.body.withdrawalRequestId,
      `${key}-sync-${simulatedProviderStatus}`,
      simulatedProviderStatus,
    )
  }

  return request(harness.app)
    .get(`/withdrawal-requests/${created.body.withdrawalRequestId}`)
    .set({ 'x-nines-authenticated-user-id': userId })
}

async function providerSubmissionCount(harness: TestApplicationHarness) {
  const result = await harness.database.query<{ count: number }>(
    `
      SELECT count(*)::int AS count
      FROM withdrawal_provider_submissions
    `,
  )

  return result.rows[0]?.count ?? 0
}

async function withdrawalWebhookReceiptCount(
  harness: TestApplicationHarness,
  status?: string,
) {
  const result = await harness.database.query<{ count: number }>(
    `
      SELECT count(*)::int AS count
      FROM withdrawal_provider_webhook_receipts
      WHERE ($1::TEXT IS NULL OR status = $1)
    `,
    [status ?? null],
  )

  return result.rows[0]?.count ?? 0
}

async function withdrawalProviderEventCount(harness: TestApplicationHarness) {
  const result = await harness.database.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM withdrawal_provider_events',
  )

  return result.rows[0]?.count ?? 0
}

function signWithdrawalWebhook(
  body: Record<string, unknown>,
  timestamp: string,
  nonce: string,
): string {
  return createHmac('sha256', 'test-withdrawal-webhook-secret')
    .update(`${timestamp}.${nonce}.${JSON.stringify(body)}`)
    .digest('hex')
}

async function signedWithdrawalWebhook(
  harness: TestApplicationHarness,
  body: Record<string, unknown>,
  options: {
    timestamp?: string
    nonce?: string
    signature?: string
  } = {},
) {
  const timestamp = options.timestamp ?? '2026-04-22T12:00:00.000Z'
  const nonce =
    options.nonce ?? `withdrawal-webhook-${body.externalWithdrawalId}`
  const signature =
    options.signature ?? signWithdrawalWebhook(body, timestamp, nonce)

  return request(harness.app)
    .post('/provider-events/withdrawals/webhook/simulated')
    .set({
      'x-nines-provider-signature': signature,
      'x-nines-provider-timestamp': timestamp,
      'x-nines-provider-nonce': nonce,
      'x-correlation-id': `corr_${nonce}`,
      'x-causation-id': `cause_${nonce}`,
    })
    .send(body)
}

describe('withdrawal HTTP routes', () => {
  let harness: TestApplicationHarness | undefined

  afterEach(async () => {
    if (harness) {
      await harness.close()
      harness = undefined
    }
  })

  it('creates a withdrawal request and reserves available funds through the ledger', async () => {
    harness = await createTestApplication()
    await fundPlayer(harness, 'withdrawal-player-1', '5000')

    const response = await createWithdrawal(harness)
    const balance = await playerBalance(harness, 'withdrawal-player-1')

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      playerId: 'withdrawal-player-1',
      currency: 'USDC',
      amountMinorUnits: '1000',
      status: 'reserved',
      provider: 'simulated',
      releaseLedgerTransactionId: null,
    })
    expect(response.body.withdrawalRequestId).toMatch(/^wd_req_/)
    expect(response.body.reservationLedgerTransactionId).toMatch(/^txn_/)
    expect(balance.body.spendableBalanceMinor).toBe('4000')
    expect(balance.body.lockedBalanceMinor).toBe('1000')
    expect(await transactionCount(harness, 'withdrawal_reserve')).toBe(1)
  })

  it('rejects insufficient funds without persisting a withdrawal reservation', async () => {
    harness = await createTestApplication()
    await fundPlayer(harness, 'withdrawal-player-1', '500')

    const response = await createWithdrawal(harness)
    const balance = await playerBalance(harness, 'withdrawal-player-1')

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('INSUFFICIENT_FUNDS')
    expect(balance.body.spendableBalanceMinor).toBe('500')
    expect(await transactionCount(harness, 'withdrawal_reserve')).toBe(0)
  })

  it('replays duplicate create requests without double reserving', async () => {
    harness = await createTestApplication()
    await fundPlayer(harness, 'withdrawal-player-1', '5000')

    const first = await createWithdrawal(harness)
    const replay = await createWithdrawal(harness)
    const balance = await playerBalance(harness, 'withdrawal-player-1')

    expect(first.status).toBe(201)
    expect(replay.status).toBe(201)
    expect(replay.body).toEqual(first.body)
    expect(balance.body.spendableBalanceMinor).toBe('4000')
    expect(balance.body.lockedBalanceMinor).toBe('1000')
    expect(await transactionCount(harness, 'withdrawal_reserve')).toBe(1)
  })

  it('cancels a withdrawal and releases its reservation exactly once', async () => {
    harness = await createTestApplication()
    await fundPlayer(harness, 'withdrawal-player-1', '5000')
    const created = await createWithdrawal(harness)

    const cancelled = await request(harness.app)
      .post(
        `/withdrawal-requests/${created.body.withdrawalRequestId}/cancel`,
      )
      .set(playerHeaders('withdrawal-player-1', 'withdrawal-cancel-key'))
      .send({ reason: 'Player changed their mind' })
    const replay = await request(harness.app)
      .post(
        `/withdrawal-requests/${created.body.withdrawalRequestId}/cancel`,
      )
      .set(playerHeaders('withdrawal-player-1', 'withdrawal-cancel-key'))
      .send({ reason: 'Player changed their mind' })
    const balance = await playerBalance(harness, 'withdrawal-player-1')

    expect(cancelled.status).toBe(200)
    expect(cancelled.body.status).toBe('cancelled')
    expect(cancelled.body.releaseLedgerTransactionId).toMatch(/^txn_/)
    expect(replay.body).toEqual(cancelled.body)
    expect(balance.body.spendableBalanceMinor).toBe('5000')
    expect(balance.body.lockedBalanceMinor).toBe('0')
    expect(await transactionCount(harness, 'withdrawal_reversal')).toBe(1)
  })

  it('lets operators reject withdrawals and releases reservation exactly once with audit', async () => {
    harness = await createTestApplication()
    await fundPlayer(harness, 'withdrawal-player-1', '5000')
    const created = await createWithdrawal(harness)

    const rejected = await request(harness.app)
      .post(
        `/withdrawal-requests/${created.body.withdrawalRequestId}/reject`,
      )
      .set(operatorHeaders('withdrawal-reject-key'))
      .send({
        reasonCode: 'DESTINATION_UNSAFE',
        reason: 'Destination could not be approved by treasury',
      })
    const replay = await request(harness.app)
      .post(
        `/withdrawal-requests/${created.body.withdrawalRequestId}/reject`,
      )
      .set(operatorHeaders('withdrawal-reject-key'))
      .send({
        reasonCode: 'DESTINATION_UNSAFE',
        reason: 'Destination could not be approved by treasury',
      })
    const audit = await auditEventsFor(
      harness,
      'financial.withdrawal.request_rejected',
    )

    expect(rejected.status).toBe(200)
    expect(rejected.body.status).toBe('rejected')
    expect(replay.body).toEqual(rejected.body)
    expect(await transactionCount(harness, 'withdrawal_reversal')).toBe(1)
    expect(audit[0]?.payload).toMatchObject({
      action: 'reject',
      operatorRole: 'treasury_operator',
      previousStatus: 'reserved',
      newStatus: 'rejected',
      withdrawalRequestId: created.body.withdrawalRequestId,
      releaseLedgerTransactionId: rejected.body.releaseLedgerTransactionId,
    })
  })

  it('requires elevated treasury role for approval and does not submit externally', async () => {
    harness = await createTestApplication()
    await fundPlayer(harness, 'withdrawal-player-1', '5000')
    const created = await createWithdrawal(harness)

    const insufficientRole = await request(harness.app)
      .post(
        `/withdrawal-requests/${created.body.withdrawalRequestId}/approve`,
      )
      .set(operatorHeaders('withdrawal-approve-low', 'treasury_operator'))
      .send({ reason: 'Approve' })
    const approved = await request(harness.app)
      .post(
        `/withdrawal-requests/${created.body.withdrawalRequestId}/approve`,
      )
      .set(operatorHeaders('withdrawal-approve-admin', 'treasury_admin'))
      .send({ reason: 'Treasury approved for later submission' })
    const audit = await auditEventsFor(
      harness,
      'financial.withdrawal.request_approved',
    )

    expect(insufficientRole.status).toBe(403)
    expect(insufficientRole.body.error.code).toBe(
      'OPERATOR_ROLE_INSUFFICIENT',
    )
    expect(approved.status).toBe(200)
    expect(approved.body.status).toBe('submission_pending')
    expect(approved.body.releaseLedgerTransactionId).toBeNull()
    expect(await transactionCount(harness, 'withdrawal_complete')).toBe(0)
    expect(audit[0]?.payload).toMatchObject({
      action: 'approve',
      operatorRole: 'treasury_admin',
      externalSubmission: false,
      previousStatus: 'reserved',
      newStatus: 'submission_pending',
    })
  })

  it('does not let a player cancel after approval', async () => {
    harness = await createTestApplication()
    await fundPlayer(harness, 'withdrawal-player-1', '5000')
    const created = await createWithdrawal(harness)
    await request(harness.app)
      .post(
        `/withdrawal-requests/${created.body.withdrawalRequestId}/approve`,
      )
      .set(operatorHeaders('withdrawal-approve-before-cancel', 'financial_admin'))
      .send({ reason: 'Approve' })

    const cancelled = await request(harness.app)
      .post(
        `/withdrawal-requests/${created.body.withdrawalRequestId}/cancel`,
      )
      .set(playerHeaders('withdrawal-player-1', 'withdrawal-cancel-approved'))
      .send({ reason: 'Too late' })

    expect(cancelled.status).toBe(409)
    expect(cancelled.body.error.code).toBe(
      'WITHDRAWAL_REQUEST_NOT_CANCELLABLE',
    )
  })

  it('requires elevated treasury role for simulated provider submission', async () => {
    harness = await createTestApplication()
    await fundPlayer(harness, 'withdrawal-player-1', '5000')
    const created = await createWithdrawal(harness)
    await approveWithdrawal(
      harness,
      created.body.withdrawalRequestId,
      'withdrawal-approve-before-submit-rbac',
    )

    const missingRole = await request(harness.app)
      .post(`/withdrawal-requests/${created.body.withdrawalRequestId}/submit`)
      .set({
        'x-nines-authenticated-user-id': 'operator-withdrawals',
        ...stateChangingHeaders(
          'withdrawal-submit-missing-role',
          'corr_withdrawal_submit_missing_role',
          'cause_withdrawal_submit_missing_role',
        ),
      })
      .send({ submissionNote: 'Submit' })
    const insufficientRole = await submitWithdrawal(
      harness,
      created.body.withdrawalRequestId,
      'withdrawal-submit-low-role',
      'treasury_operator',
    )

    expect(missingRole.status).toBe(403)
    expect(missingRole.body.error.code).toBe('MISSING_OPERATOR_ROLE')
    expect(insufficientRole.status).toBe(403)
    expect(insufficientRole.body.error.code).toBe(
      'OPERATOR_ROLE_INSUFFICIENT',
    )
    expect(await providerSubmissionCount(harness)).toBe(0)
  })

  it('rejects provider submission before approval', async () => {
    harness = await createTestApplication()
    await fundPlayer(harness, 'withdrawal-player-1', '5000')
    const created = await createWithdrawal(harness)

    const submitted = await submitWithdrawal(
      harness,
      created.body.withdrawalRequestId,
      'withdrawal-submit-before-approval',
    )

    expect(submitted.status).toBe(409)
    expect(submitted.body.error.code).toBe('WITHDRAWAL_REQUEST_NOT_SUBMITTABLE')
    expect(await providerSubmissionCount(harness)).toBe(0)
  })

  it('submits an approved withdrawal to the simulated provider exactly once', async () => {
    harness = await createTestApplication()
    await fundPlayer(harness, 'withdrawal-player-1', '5000')
    const created = await createWithdrawal(harness)
    await approveWithdrawal(
      harness,
      created.body.withdrawalRequestId,
      'withdrawal-approve-submit-once',
    )

    const submitted = await submitWithdrawal(
      harness,
      created.body.withdrawalRequestId,
      'withdrawal-submit-once',
    )
    const replay = await submitWithdrawal(
      harness,
      created.body.withdrawalRequestId,
      'withdrawal-submit-once',
    )
    const balance = await playerBalance(harness, 'withdrawal-player-1')
    const audit = await auditEventsFor(
      harness,
      'financial.withdrawal.provider_submitted',
    )

    expect(submitted.status).toBe(200)
    expect(submitted.body.status).toBe('provider_pending')
    expect(submitted.body.providerSubmission).toMatchObject({
      provider: 'simulated',
      providerStatus: 'accepted',
      submissionAttemptCount: 1,
    })
    expect(submitted.body.providerSubmission.externalWithdrawalId).toMatch(
      /^sim_wd_/,
    )
    expect(submitted.body.providerSubmission.externalTransactionId).toMatch(
      /^sim_tx_/,
    )
    expect(replay.body).toEqual(submitted.body)
    expect(balance.body.spendableBalanceMinor).toBe('4000')
    expect(balance.body.lockedBalanceMinor).toBe('1000')
    expect(await providerSubmissionCount(harness)).toBe(1)
    expect(await transactionCount(harness, 'withdrawal_reversal')).toBe(0)
    expect(audit[0]?.payload).toMatchObject({
      action: 'submit',
      operatorRole: 'treasury_admin',
      previousStatus: 'submission_pending',
      newStatus: 'provider_pending',
      externalSubmission: 'simulated',
    })
  })

  it('returns the existing simulated provider submission on duplicate submit commands', async () => {
    harness = await createTestApplication()
    await fundPlayer(harness, 'withdrawal-player-1', '5000')
    const created = await createWithdrawal(harness)
    await approveWithdrawal(
      harness,
      created.body.withdrawalRequestId,
      'withdrawal-approve-duplicate-submit',
    )

    const first = await submitWithdrawal(
      harness,
      created.body.withdrawalRequestId,
      'withdrawal-submit-first-key',
    )
    const duplicateCommand = await submitWithdrawal(
      harness,
      created.body.withdrawalRequestId,
      'withdrawal-submit-second-key',
    )

    expect(first.status).toBe(200)
    expect(duplicateCommand.status).toBe(200)
    expect(duplicateCommand.body.providerSubmission).toEqual(
      first.body.providerSubmission,
    )
    expect(duplicateCommand.body.status).toBe('provider_pending')
    expect(await providerSubmissionCount(harness)).toBe(1)
  })

  it('routes ambiguous and rejected provider submit responses without releasing funds', async () => {
    harness = await createTestApplication()
    await fundPlayer(harness, 'withdrawal-player-unknown', '5000')
    await fundPlayer(harness, 'withdrawal-player-rejected', '5000')
    const unknownCreated = await createWithdrawal(
      harness,
      {
        idempotencyKey: 'withdrawal-create-provider-unknown',
        destinationReference: 'unknown:provider-ambiguous',
      },
      'withdrawal-player-unknown',
    )
    const rejectedCreated = await createWithdrawal(
      harness,
      {
        idempotencyKey: 'withdrawal-create-provider-rejected',
        destinationReference: 'rejected:provider-declined',
      },
      'withdrawal-player-rejected',
    )
    await approveWithdrawal(
      harness,
      unknownCreated.body.withdrawalRequestId,
      'withdrawal-approve-provider-unknown',
    )
    await approveWithdrawal(
      harness,
      rejectedCreated.body.withdrawalRequestId,
      'withdrawal-approve-provider-rejected',
    )

    const unknown = await submitWithdrawal(
      harness,
      unknownCreated.body.withdrawalRequestId,
      'withdrawal-submit-provider-unknown',
    )
    const rejected = await submitWithdrawal(
      harness,
      rejectedCreated.body.withdrawalRequestId,
      'withdrawal-submit-provider-rejected',
    )
    const unknownBalance = await playerBalance(
      harness,
      'withdrawal-player-unknown',
    )
    const rejectedBalance = await playerBalance(
      harness,
      'withdrawal-player-rejected',
    )

    expect(unknown.body.status).toBe('provider_unknown')
    expect(unknown.body.reviewReasonCode).toBe(
      'WITHDRAWAL_PROVIDER_STATUS_UNKNOWN',
    )
    expect(rejected.body.status).toBe('provider_rejected')
    expect(rejected.body.reviewReasonCode).toBe('WITHDRAWAL_PROVIDER_REJECTED')
    expect(unknownBalance.body.lockedBalanceMinor).toBe('1000')
    expect(rejectedBalance.body.lockedBalanceMinor).toBe('1000')
    expect(await transactionCount(harness, 'withdrawal_reversal')).toBe(0)
  })

  it('syncs simulated provider status without completing or releasing funds', async () => {
    harness = await createTestApplication()
    await fundPlayer(harness, 'withdrawal-player-1', '5000')
    const created = await createWithdrawal(harness)
    await approveWithdrawal(
      harness,
      created.body.withdrawalRequestId,
      'withdrawal-approve-before-sync',
    )
    await submitWithdrawal(
      harness,
      created.body.withdrawalRequestId,
      'withdrawal-submit-before-sync',
    )

    const missingRole = await request(harness.app)
      .post(
        `/withdrawal-requests/${created.body.withdrawalRequestId}/sync-provider-status`,
      )
      .set({
        'x-nines-authenticated-user-id': 'operator-withdrawals',
        ...stateChangingHeaders(
          'withdrawal-sync-missing-role',
          'corr_withdrawal_sync_missing_role',
          'cause_withdrawal_sync_missing_role',
        ),
      })
      .send({ simulatedProviderStatus: 'confirmed' })
    const pending = await syncWithdrawalProviderStatus(
      harness,
      created.body.withdrawalRequestId,
      'withdrawal-sync-pending',
      'pending',
    )
    const confirmed = await syncWithdrawalProviderStatus(
      harness,
      created.body.withdrawalRequestId,
      'withdrawal-sync-confirmed',
      'confirmed',
    )
    const balance = await playerBalance(harness, 'withdrawal-player-1')
    const audit = await auditEventsFor(
      harness,
      'financial.withdrawal.provider_status_synced',
    )

    expect(missingRole.status).toBe(403)
    expect(missingRole.body.error.code).toBe('MISSING_OPERATOR_ROLE')
    expect(pending.status).toBe(200)
    expect(pending.body.status).toBe('provider_pending')
    expect(confirmed.body.status).toBe('provider_confirmed')
    expect(confirmed.body.providerSubmission.providerStatus).toBe('confirmed')
    expect(balance.body.lockedBalanceMinor).toBe('1000')
    expect(await transactionCount(harness, 'withdrawal_complete')).toBe(0)
    expect(await transactionCount(harness, 'withdrawal_reversal')).toBe(0)
    expect(audit).toHaveLength(2)
    expect(audit[1]?.payload).toMatchObject({
      action: 'sync_provider_status',
      providerStatus: 'confirmed',
      completed: false,
      releasedReservation: false,
    })
  })

  it('syncs failed provider status to reviewable state without releasing funds', async () => {
    harness = await createTestApplication()
    await fundPlayer(harness, 'withdrawal-player-1', '5000')
    const created = await createWithdrawal(harness)
    await approveWithdrawal(
      harness,
      created.body.withdrawalRequestId,
      'withdrawal-approve-before-sync-failed',
    )
    await submitWithdrawal(
      harness,
      created.body.withdrawalRequestId,
      'withdrawal-submit-before-sync-failed',
    )

    const failed = await syncWithdrawalProviderStatus(
      harness,
      created.body.withdrawalRequestId,
      'withdrawal-sync-failed',
      'failed',
    )
    const balance = await playerBalance(harness, 'withdrawal-player-1')

    expect(failed.status).toBe(200)
    expect(failed.body.status).toBe('provider_failed')
    expect(failed.body.failureReasonCode).toBe('WITHDRAWAL_PROVIDER_FAILED')
    expect(balance.body.lockedBalanceMinor).toBe('1000')
    expect(await transactionCount(harness, 'withdrawal_reversal')).toBe(0)
  })

  it('rejects withdrawal provider webhook replay and signature failures before mutation', async () => {
    harness = await createTestApplication()
    await fundPlayer(harness, 'withdrawal-player-webhook-security', '5000')
    const created = await createWithdrawal(
      harness,
      { idempotencyKey: 'withdrawal-webhook-security-create' },
      'withdrawal-player-webhook-security',
    )
    await approveWithdrawal(
      harness,
      created.body.withdrawalRequestId,
      'withdrawal-webhook-security-approve',
    )
    const submitted = await submitWithdrawal(
      harness,
      created.body.withdrawalRequestId,
      'withdrawal-webhook-security-submit',
    )
    const body = {
      withdrawalRequestId: created.body.withdrawalRequestId,
      externalWithdrawalId:
        submitted.body.providerSubmission.externalWithdrawalId,
      externalTransactionId:
        submitted.body.providerSubmission.externalTransactionId,
      providerStatus: 'confirmed',
      amountMinorUnits: '1000',
      currency: 'USDC',
    }

    const missingTimestamp = await request(harness.app)
      .post('/provider-events/withdrawals/webhook/simulated')
      .set({
        'x-nines-provider-nonce': 'withdrawal-webhook-missing-timestamp',
        'x-nines-provider-signature': signWithdrawalWebhook(
          body,
          '2026-04-22T12:00:00.000Z',
          'withdrawal-webhook-missing-timestamp',
        ),
      })
      .send(body)
    const malformedTimestamp = await signedWithdrawalWebhook(harness, body, {
      timestamp: 'not-a-date',
      nonce: 'withdrawal-webhook-malformed-timestamp',
    })
    const oldTimestamp = await signedWithdrawalWebhook(harness, body, {
      timestamp: '2026-04-22T11:00:00.000Z',
      nonce: 'withdrawal-webhook-old-timestamp',
    })
    const futureTimestamp = await signedWithdrawalWebhook(harness, body, {
      timestamp: '2026-04-22T13:00:00.000Z',
      nonce: 'withdrawal-webhook-future-timestamp',
    })
    const missingNonce = await request(harness.app)
      .post('/provider-events/withdrawals/webhook/simulated')
      .set({
        'x-nines-provider-timestamp': '2026-04-22T12:00:00.000Z',
        'x-nines-provider-signature': signWithdrawalWebhook(
          body,
          '2026-04-22T12:00:00.000Z',
          'withdrawal-webhook-missing-nonce',
        ),
      })
      .send(body)
    const invalidSignature = await signedWithdrawalWebhook(harness, body, {
      nonce: 'withdrawal-webhook-invalid-signature',
      signature: 'invalid-signature',
    })
    const malformedPayload = await signedWithdrawalWebhook(
      harness,
      { ...body, externalWithdrawalId: '' },
      { nonce: 'withdrawal-webhook-malformed-payload' },
    )

    expect(missingTimestamp.body.error.code).toBe(
      'WITHDRAWAL_WEBHOOK_TIMESTAMP_MISSING',
    )
    expect(malformedTimestamp.body.error.code).toBe(
      'WITHDRAWAL_WEBHOOK_TIMESTAMP_MALFORMED',
    )
    expect(oldTimestamp.body.error.code).toBe(
      'WITHDRAWAL_WEBHOOK_TIMESTAMP_TOO_OLD',
    )
    expect(futureTimestamp.body.error.code).toBe(
      'WITHDRAWAL_WEBHOOK_TIMESTAMP_TOO_FAR_IN_FUTURE',
    )
    expect(missingNonce.body.error.code).toBe('WITHDRAWAL_WEBHOOK_NONCE_MISSING')
    expect(invalidSignature.body.error.code).toBe(
      'WITHDRAWAL_WEBHOOK_SIGNATURE_INVALID',
    )
    expect(malformedPayload.body.error.code).toBe(
      'WITHDRAWAL_WEBHOOK_PAYLOAD_MALFORMED',
    )
    expect(await withdrawalWebhookReceiptCount(harness)).toBe(0)
    expect(await withdrawalProviderEventCount(harness)).toBe(0)
    expect(await transactionCount(harness, 'withdrawal_finalized')).toBe(0)
  })

  it('accepts signed withdrawal provider webhooks once and rejects duplicate nonces without mutation', async () => {
    harness = await createTestApplication()
    await fundPlayer(harness, 'withdrawal-player-webhook-confirmed', '5000')
    const created = await createWithdrawal(
      harness,
      { idempotencyKey: 'withdrawal-webhook-confirmed-create' },
      'withdrawal-player-webhook-confirmed',
    )
    await approveWithdrawal(
      harness,
      created.body.withdrawalRequestId,
      'withdrawal-webhook-confirmed-approve',
    )
    const submitted = await submitWithdrawal(
      harness,
      created.body.withdrawalRequestId,
      'withdrawal-webhook-confirmed-submit',
    )
    const body = {
      withdrawalRequestId: created.body.withdrawalRequestId,
      externalWithdrawalId:
        submitted.body.providerSubmission.externalWithdrawalId,
      externalTransactionId:
        submitted.body.providerSubmission.externalTransactionId,
      providerStatus: 'confirmed',
      amountMinorUnits: '1000',
      currency: 'USDC',
    }

    const accepted = await signedWithdrawalWebhook(harness, body, {
      nonce: 'withdrawal-webhook-confirmed-nonce',
    })
    const duplicate = await signedWithdrawalWebhook(
      harness,
      { ...body, providerStatus: 'failed' },
      { nonce: 'withdrawal-webhook-confirmed-nonce' },
    )
    const fetched = await request(harness.app)
      .get(`/withdrawal-requests/${created.body.withdrawalRequestId}`)
      .set({ 'x-nines-authenticated-user-id': 'withdrawal-player-webhook-confirmed' })
    const audit = await auditEventsFor(
      harness,
      'financial.withdrawal.provider_webhook_status_updated',
    )

    expect(accepted.status).toBe(202)
    expect(accepted.body).toMatchObject({
      provider: 'simulated',
      providerStatus: 'confirmed',
      withdrawalStatus: 'provider_confirmed',
      eventStatus: 'applied',
    })
    expect(duplicate.status).toBe(403)
    expect(duplicate.body.error.code).toBe('WITHDRAWAL_WEBHOOK_NONCE_REPLAYED')
    expect(fetched.body.status).toBe('provider_confirmed')
    expect(fetched.body.finalizationLedgerTransactionId).toBeNull()
    expect(await transactionCount(harness, 'withdrawal_finalized')).toBe(0)
    expect(await withdrawalWebhookReceiptCount(harness, 'accepted')).toBe(1)
    expect(await withdrawalWebhookReceiptCount(harness, 'rejected')).toBe(1)
    expect(await withdrawalProviderEventCount(harness)).toBe(1)
    expect(audit[0]?.payload).toMatchObject({
      actorType: 'provider',
      previousStatus: 'provider_pending',
      newStatus: 'provider_confirmed',
      finalized: false,
      releasedReservation: false,
    })
  })

  it('routes unmatched and mismatched withdrawal provider events to review', async () => {
    harness = await createTestApplication()
    await fundPlayer(harness, 'withdrawal-player-webhook-review', '5000')
    const created = await createWithdrawal(
      harness,
      { idempotencyKey: 'withdrawal-webhook-review-create' },
      'withdrawal-player-webhook-review',
    )
    await approveWithdrawal(
      harness,
      created.body.withdrawalRequestId,
      'withdrawal-webhook-review-approve',
    )
    const submitted = await submitWithdrawal(
      harness,
      created.body.withdrawalRequestId,
      'withdrawal-webhook-review-submit',
    )

    const unmatched = await signedWithdrawalWebhook(
      harness,
      {
        externalWithdrawalId: 'unmatched-provider-withdrawal',
        externalTransactionId: 'unmatched-provider-transaction',
        providerStatus: 'confirmed',
      },
      { nonce: 'withdrawal-webhook-unmatched' },
    )
    const mismatched = await signedWithdrawalWebhook(
      harness,
      {
        withdrawalRequestId: created.body.withdrawalRequestId,
        externalWithdrawalId: 'wrong-external-withdrawal-id',
        externalTransactionId:
          submitted.body.providerSubmission.externalTransactionId,
        providerStatus: 'confirmed',
      },
      { nonce: 'withdrawal-webhook-mismatched' },
    )
    const fetched = await request(harness.app)
      .get(`/withdrawal-requests/${created.body.withdrawalRequestId}`)
      .set({ 'x-nines-authenticated-user-id': 'withdrawal-player-webhook-review' })

    expect(unmatched.status).toBe(202)
    expect(unmatched.body).toMatchObject({
      eventStatus: 'review_required',
      withdrawalRequestId: null,
      withdrawalStatus: null,
    })
    expect(mismatched.status).toBe(202)
    expect(mismatched.body).toMatchObject({
      eventStatus: 'review_required',
      withdrawalStatus: 'review_required',
    })
    expect(fetched.body.status).toBe('review_required')
    expect(fetched.body.reviewReasonCode).toBe(
      'WITHDRAWAL_PROVIDER_EVENT_REFERENCE_MISMATCH',
    )
    expect(await transactionCount(harness, 'withdrawal_finalized')).toBe(0)
  })

  it('routes failed, rejected, and unknown withdrawal provider callbacks conservatively', async () => {
    harness = await createTestApplication()
    const failed = await createSubmittedWithdrawal(
      harness,
      'withdrawal-player-webhook-failed',
      'withdrawal-webhook-failed',
      'pending',
    )
    const rejected = await createSubmittedWithdrawal(
      harness,
      'withdrawal-player-webhook-rejected',
      'withdrawal-webhook-rejected',
      'pending',
    )
    const unknown = await createSubmittedWithdrawal(
      harness,
      'withdrawal-player-webhook-unknown',
      'withdrawal-webhook-unknown',
      'pending',
    )

    const failedWebhook = await signedWithdrawalWebhook(
      harness,
      {
        withdrawalRequestId: failed.body.withdrawalRequestId,
        externalWithdrawalId:
          failed.body.providerSubmission.externalWithdrawalId,
        externalTransactionId:
          failed.body.providerSubmission.externalTransactionId,
        providerStatus: 'failed',
      },
      { nonce: 'withdrawal-webhook-failed-status' },
    )
    const rejectedWebhook = await signedWithdrawalWebhook(
      harness,
      {
        withdrawalRequestId: rejected.body.withdrawalRequestId,
        externalWithdrawalId:
          rejected.body.providerSubmission.externalWithdrawalId,
        externalTransactionId:
          rejected.body.providerSubmission.externalTransactionId,
        providerStatus: 'rejected',
      },
      { nonce: 'withdrawal-webhook-rejected-status' },
    )
    const unknownWebhook = await signedWithdrawalWebhook(
      harness,
      {
        withdrawalRequestId: unknown.body.withdrawalRequestId,
        externalWithdrawalId:
          unknown.body.providerSubmission.externalWithdrawalId,
        externalTransactionId:
          unknown.body.providerSubmission.externalTransactionId,
        providerStatus: 'sent',
      },
      { nonce: 'withdrawal-webhook-unknown-status' },
    )

    expect(failedWebhook.body.withdrawalStatus).toBe('provider_failed')
    expect(rejectedWebhook.body.withdrawalStatus).toBe('provider_rejected')
    expect(unknownWebhook.body.withdrawalStatus).toBe('provider_unknown')
    expect(await transactionCount(harness, 'withdrawal_reversal')).toBe(0)
    expect(await transactionCount(
      harness,
      'withdrawal_provider_failure_release',
    )).toBe(0)
  })

  it('retries withdrawal provider webhooks safely after transactional interruptions', async () => {
    for (const faultPoint of [
      'withdrawal.after_webhook_receipt_before_provider_event',
      'withdrawal.after_provider_webhook_status_update_before_audit',
    ] as const) {
      harness = await createTestApplication(undefined, {
        faultInjector: new OneShotFaultInjector(faultPoint),
      })
      await fundPlayer(harness, `player-${faultPoint}`, '5000')
      const created = await createWithdrawal(
        harness,
        { idempotencyKey: `${faultPoint}-create` },
        `player-${faultPoint}`,
      )
      await approveWithdrawal(
        harness,
        created.body.withdrawalRequestId,
        `${faultPoint}-approve`,
      )
      const submitted = await submitWithdrawal(
        harness,
        created.body.withdrawalRequestId,
        `${faultPoint}-submit`,
      )
      const body = {
        withdrawalRequestId: created.body.withdrawalRequestId,
        externalWithdrawalId:
          submitted.body.providerSubmission.externalWithdrawalId,
        externalTransactionId:
          submitted.body.providerSubmission.externalTransactionId,
        providerStatus: 'confirmed',
      }

      const interrupted = await signedWithdrawalWebhook(harness, body, {
        nonce: `${faultPoint}-nonce`,
      })
      const retry = await signedWithdrawalWebhook(harness, body, {
        nonce: `${faultPoint}-nonce`,
      })

      expect(interrupted.status).toBe(500)
      expect(interrupted.body.error.code).toBe('SIMULATED_WITHDRAWAL_INTERRUPT')
      expect([202, 403]).toContain(retry.status)
      if (retry.status === 403) {
        expect(retry.body.error.code).toBe('WITHDRAWAL_WEBHOOK_NONCE_REPLAYED')
      } else {
        expect(retry.body.withdrawalStatus).toBe('provider_confirmed')
      }
      expect(await withdrawalWebhookReceiptCount(harness, 'accepted')).toBeLessThanOrEqual(1)
      expect(await withdrawalProviderEventCount(harness)).toBeLessThanOrEqual(1)
      expect(await transactionCount(harness, 'withdrawal_finalized')).toBe(0)

      await harness.close()
      harness = undefined
    }
  })

  it('recovers submit retry after provider submission was persisted', async () => {
    harness = await createTestApplication(undefined, {
      faultInjector: new OneShotFaultInjector(
        'withdrawal.after_provider_submission_persisted_before_state_update',
      ),
    })
    await fundPlayer(harness, 'withdrawal-player-1', '5000')
    const created = await createWithdrawal(harness)
    await approveWithdrawal(
      harness,
      created.body.withdrawalRequestId,
      'withdrawal-approve-submit-recovery',
    )

    const interrupted = await submitWithdrawal(
      harness,
      created.body.withdrawalRequestId,
      'withdrawal-submit-recovery-first',
    )
    const retry = await submitWithdrawal(
      harness,
      created.body.withdrawalRequestId,
      'withdrawal-submit-recovery-second',
    )

    expect(interrupted.status).toBe(500)
    expect(interrupted.body.error.code).toBe('SIMULATED_WITHDRAWAL_INTERRUPT')
    expect(retry.status).toBe(200)
    expect(retry.body.status).toBe('provider_pending')
    expect(await providerSubmissionCount(harness)).toBe(1)
  })

  it('finalizes a provider-confirmed withdrawal through the ledger exactly once', async () => {
    harness = await createTestApplication()
    const confirmed = await createSubmittedWithdrawal(
      harness,
      'withdrawal-player-finalize',
      'withdrawal-finalize',
      'confirmed',
    )

    const lowRole = await finalizeWithdrawal(
      harness,
      confirmed.body.withdrawalRequestId,
      'withdrawal-finalize-low-role',
      'treasury_operator',
    )
    const missingReason = await request(harness.app)
      .post(`/withdrawal-requests/${confirmed.body.withdrawalRequestId}/finalize`)
      .set(operatorHeaders('withdrawal-finalize-missing-reason', 'treasury_admin'))
      .send({})
    const finalized = await finalizeWithdrawal(
      harness,
      confirmed.body.withdrawalRequestId,
      'withdrawal-finalize-success',
    )
    const replay = await finalizeWithdrawal(
      harness,
      confirmed.body.withdrawalRequestId,
      'withdrawal-finalize-success',
    )
    const duplicateCommand = await finalizeWithdrawal(
      harness,
      confirmed.body.withdrawalRequestId,
      'withdrawal-finalize-second-command',
    )
    const balance = await playerBalance(harness, 'withdrawal-player-finalize')
    const audit = await auditEventsFor(
      harness,
      'financial.withdrawal.finalized',
    )

    expect(lowRole.status).toBe(403)
    expect(missingReason.status).toBe(400)
    expect(finalized.status).toBe(200)
    expect(finalized.body.status).toBe('completed')
    expect(finalized.body.finalizationLedgerTransactionId).toMatch(/^txn_/)
    expect(replay.body).toEqual(finalized.body)
    expect(duplicateCommand.body.finalizationLedgerTransactionId).toBe(
      finalized.body.finalizationLedgerTransactionId,
    )
    expect(balance.body.spendableBalanceMinor).toBe('4000')
    expect(balance.body.lockedBalanceMinor).toBe('0')
    expect(await transactionCount(harness, 'withdrawal_finalized')).toBe(1)
    expect(await transactionCount(harness, 'withdrawal_reversal')).toBe(0)
    expect(audit[0]?.payload).toMatchObject({
      action: 'finalize',
      operatorRole: 'treasury_admin',
      previousStatus: 'provider_confirmed',
      newStatus: 'completed',
      withdrawalRequestId: confirmed.body.withdrawalRequestId,
      finalizationLedgerTransactionId:
        finalized.body.finalizationLedgerTransactionId,
    })
  })

  it('rejects finalization for unsafe provider states', async () => {
    harness = await createTestApplication()
    const pending = await createSubmittedWithdrawal(
      harness,
      'withdrawal-player-finalize-pending',
      'withdrawal-finalize-pending',
      'pending',
    )
    const failed = await createSubmittedWithdrawal(
      harness,
      'withdrawal-player-finalize-failed',
      'withdrawal-finalize-failed',
      'failed',
    )
    const rejected = await createSubmittedWithdrawal(
      harness,
      'withdrawal-player-finalize-rejected',
      'withdrawal-finalize-rejected',
      'rejected',
    )
    const unknown = await createSubmittedWithdrawal(
      harness,
      'withdrawal-player-finalize-unknown',
      'withdrawal-finalize-unknown',
      'unknown',
    )

    for (const candidate of [pending, failed, rejected, unknown]) {
      const response = await finalizeWithdrawal(
        harness,
        candidate.body.withdrawalRequestId,
        `withdrawal-finalize-invalid-${candidate.body.status}`,
      )

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe(
        'WITHDRAWAL_REQUEST_NOT_FINALIZABLE',
      )
    }

    expect(await transactionCount(harness, 'withdrawal_finalized')).toBe(0)
  })

  it('does not double-post finalization under concurrent commands or crash retry', async () => {
    harness = await createTestApplication(undefined, {
      faultInjector: new OneShotFaultInjector(
        'withdrawal.after_finalization_ledger_posted_before_state_update',
      ),
    })
    const confirmed = await createSubmittedWithdrawal(
      harness,
      'withdrawal-player-finalize-retry',
      'withdrawal-finalize-retry',
      'confirmed',
    )

    const interrupted = await finalizeWithdrawal(
      harness,
      confirmed.body.withdrawalRequestId,
      'withdrawal-finalize-interrupted',
    )
    const retry = await finalizeWithdrawal(
      harness,
      confirmed.body.withdrawalRequestId,
      'withdrawal-finalize-retry-command',
    )
    const concurrent = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        finalizeWithdrawal(
          harness!,
          confirmed.body.withdrawalRequestId,
          `withdrawal-finalize-concurrent-${index}`,
        ),
      ),
    )

    expect(interrupted.status).toBe(500)
    expect(interrupted.body.error.code).toBe('SIMULATED_WITHDRAWAL_INTERRUPT')
    expect(retry.status).toBe(200)
    expect(retry.body.status).toBe('completed')
    expect(concurrent.every((response) => response.status === 200)).toBe(true)
    expect(await transactionCount(harness, 'withdrawal_finalized')).toBe(1)
  })

  it('releases provider failed and rejected withdrawals through explicit ledger-backed resolution', async () => {
    harness = await createTestApplication()
    const failed = await createSubmittedWithdrawal(
      harness,
      'withdrawal-player-failure-release-failed',
      'withdrawal-failure-release-failed',
      'failed',
    )
    const rejected = await createSubmittedWithdrawal(
      harness,
      'withdrawal-player-failure-release-rejected',
      'withdrawal-failure-release-rejected',
      'rejected',
    )

    const failedRelease = await releaseAfterProviderFailure(
      harness,
      failed.body.withdrawalRequestId,
      'withdrawal-failed-release',
    )
    const rejectedRelease = await releaseAfterProviderFailure(
      harness,
      rejected.body.withdrawalRequestId,
      'withdrawal-rejected-release',
    )
    const duplicate = await releaseAfterProviderFailure(
      harness,
      failed.body.withdrawalRequestId,
      'withdrawal-failed-release-duplicate',
    )
    const failedBalance = await playerBalance(
      harness,
      'withdrawal-player-failure-release-failed',
    )
    const audit = await auditEventsFor(
      harness,
      'financial.withdrawal.provider_failure_released',
    )

    expect(failedRelease.status).toBe(200)
    expect(failedRelease.body.status).toBe('provider_failure_released')
    expect(failedRelease.body.releaseLedgerTransactionId).toMatch(/^txn_/)
    expect(rejectedRelease.status).toBe(200)
    expect(rejectedRelease.body.status).toBe('provider_failure_released')
    expect(duplicate.body.releaseLedgerTransactionId).toBe(
      failedRelease.body.releaseLedgerTransactionId,
    )
    expect(failedBalance.body.spendableBalanceMinor).toBe('5000')
    expect(failedBalance.body.lockedBalanceMinor).toBe('0')
    expect(await transactionCount(
      harness,
      'withdrawal_provider_failure_release',
    )).toBe(2)
    expect(audit[0]?.payload).toMatchObject({
      action: 'release_after_provider_failure',
      previousStatus: 'provider_failed',
      newStatus: 'provider_failure_released',
    })
  })

  it('keeps provider unknown from releasing and allows audited unknown review', async () => {
    harness = await createTestApplication()
    const unknown = await createSubmittedWithdrawal(
      harness,
      'withdrawal-player-unknown-resolution',
      'withdrawal-unknown-resolution',
      'unknown',
    )

    const release = await releaseAfterProviderFailure(
      harness,
      unknown.body.withdrawalRequestId,
      'withdrawal-unknown-release',
    )
    const reviewed = await markProviderUnknownReviewed(
      harness,
      unknown.body.withdrawalRequestId,
      'withdrawal-unknown-reviewed',
    )
    const balance = await playerBalance(
      harness,
      'withdrawal-player-unknown-resolution',
    )
    const audit = await auditEventsFor(
      harness,
      'financial.withdrawal.provider_unknown_reviewed',
    )

    expect(release.status).toBe(409)
    expect(release.body.error.code).toBe(
      'WITHDRAWAL_PROVIDER_UNKNOWN_RELEASE_FORBIDDEN',
    )
    expect(reviewed.status).toBe(200)
    expect(reviewed.body.status).toBe('provider_unknown_reviewed')
    expect(reviewed.body.releaseLedgerTransactionId).toBeNull()
    expect(balance.body.lockedBalanceMinor).toBe('1000')
    expect(audit[0]?.payload).toMatchObject({
      action: 'mark_provider_unknown_reviewed',
      releasedReservation: false,
    })
  })

  it('marks provider failure terminal without releasing reservation', async () => {
    harness = await createTestApplication()
    const failed = await createSubmittedWithdrawal(
      harness,
      'withdrawal-player-failure-terminal',
      'withdrawal-failure-terminal',
      'failed',
    )

    const terminal = await markProviderFailureTerminal(
      harness,
      failed.body.withdrawalRequestId,
      'withdrawal-failure-terminal-command',
    )
    const balance = await playerBalance(
      harness,
      'withdrawal-player-failure-terminal',
    )
    const audit = await auditEventsFor(
      harness,
      'financial.withdrawal.provider_failure_marked_terminal',
    )

    expect(terminal.status).toBe(200)
    expect(terminal.body.status).toBe('provider_failed_terminal')
    expect(terminal.body.releaseLedgerTransactionId).toBeNull()
    expect(balance.body.lockedBalanceMinor).toBe('1000')
    expect(audit[0]?.payload).toMatchObject({
      action: 'mark_provider_failure_terminal',
      releasedReservation: false,
    })
  })

  it('prevents completed withdrawals from cancellation, rejection, or failure release', async () => {
    harness = await createTestApplication()
    const confirmed = await createSubmittedWithdrawal(
      harness,
      'withdrawal-player-completed-guards',
      'withdrawal-completed-guards',
      'confirmed',
    )
    const finalized = await finalizeWithdrawal(
      harness,
      confirmed.body.withdrawalRequestId,
      'withdrawal-completed-guards-finalize',
    )

    const cancel = await request(harness.app)
      .post(`/withdrawal-requests/${finalized.body.withdrawalRequestId}/cancel`)
      .set(playerHeaders(
        'withdrawal-player-completed-guards',
        'withdrawal-completed-guards-cancel',
      ))
      .send({ reason: 'Too late' })
    const reject = await request(harness.app)
      .post(`/withdrawal-requests/${finalized.body.withdrawalRequestId}/reject`)
      .set(operatorHeaders('withdrawal-completed-guards-reject'))
      .send({
        reasonCode: 'PROVIDER_ALREADY_FINALIZED',
        reason: 'Cannot reject completed withdrawal',
      })
    const release = await releaseAfterProviderFailure(
      harness,
      finalized.body.withdrawalRequestId,
      'withdrawal-completed-guards-release',
    )

    expect(finalized.body.status).toBe('completed')
    expect(cancel.status).toBe(409)
    expect(reject.status).toBe(409)
    expect(release.status).toBe(409)
    expect(await transactionCount(harness, 'withdrawal_finalized')).toBe(1)
    expect(await transactionCount(
      harness,
      'withdrawal_provider_failure_release',
    )).toBe(0)
  })

  it('recovers provider failure release retry after ledger posting', async () => {
    harness = await createTestApplication(undefined, {
      faultInjector: new OneShotFaultInjector(
        'withdrawal.after_provider_failure_release_posted_before_state_update',
      ),
    })
    const failed = await createSubmittedWithdrawal(
      harness,
      'withdrawal-player-failure-release-retry',
      'withdrawal-failure-release-retry',
      'failed',
    )

    const interrupted = await releaseAfterProviderFailure(
      harness,
      failed.body.withdrawalRequestId,
      'withdrawal-failure-release-interrupted',
    )
    const retry = await releaseAfterProviderFailure(
      harness,
      failed.body.withdrawalRequestId,
      'withdrawal-failure-release-retry-command',
    )

    expect(interrupted.status).toBe(500)
    expect(interrupted.body.error.code).toBe('SIMULATED_WITHDRAWAL_INTERRUPT')
    expect(retry.status).toBe(200)
    expect(retry.body.status).toBe('provider_failure_released')
    expect(await transactionCount(
      harness,
      'withdrawal_provider_failure_release',
    )).toBe(1)
  })

  it('rejects invalid destinations before entering the withdrawal domain', async () => {
    harness = await createTestApplication()
    await fundPlayer(harness, 'withdrawal-player-1', '5000')

    const response = await createWithdrawal(harness, {
      idempotencyKey: 'withdrawal-invalid-destination',
      destinationKind: 'real_blockchain_address',
    })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_WITHDRAWAL_REQUEST')
    expect(await transactionCount(harness, 'withdrawal_reserve')).toBe(0)
  })

  it('routes explicit manual-review destinations to review after reserving funds', async () => {
    harness = await createTestApplication()
    await fundPlayer(harness, 'withdrawal-player-1', '5000')

    const created = await createWithdrawal(harness, {
      idempotencyKey: 'withdrawal-manual-review',
      destinationKind: 'manual_review',
      destinationReference: 'manual-review-destination',
    })
    const review = await request(harness.app)
      .get('/withdrawal-requests/review')
      .set(operatorHeaders('withdrawal-review-list'))

    expect(created.status).toBe(201)
    expect(created.body.status).toBe('review_required')
    expect(review.body.reviewItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          withdrawalRequestId: created.body.withdrawalRequestId,
          reasonCode: 'DESTINATION_REQUIRES_MANUAL_REVIEW',
        }),
      ]),
    )
  })

  it('retries safely after interruption before reservation', async () => {
    harness = await createTestApplication(undefined, {
      faultInjector: new OneShotFaultInjector(
        'withdrawal.after_request_record_before_reservation',
      ),
    })
    await fundPlayer(harness, 'withdrawal-player-1', '5000')

    const interrupted = await createWithdrawal(harness, {
      idempotencyKey: 'withdrawal-interrupt-before-reserve',
    })
    const retry = await createWithdrawal(harness, {
      idempotencyKey: 'withdrawal-interrupt-before-reserve-retry',
    })

    expect(interrupted.status).toBe(500)
    expect(interrupted.body.error.code).toBe('SIMULATED_WITHDRAWAL_INTERRUPT')
    expect(retry.status).toBe(201)
    expect(retry.body.status).toBe('reserved')
    expect(await transactionCount(harness, 'withdrawal_reserve')).toBe(1)
  })

  it('rolls back interruption after reservation posting and retries without double reserve', async () => {
    harness = await createTestApplication(undefined, {
      faultInjector: new OneShotFaultInjector(
        'withdrawal.after_reservation_posting_before_state_finalization',
      ),
    })
    await fundPlayer(harness, 'withdrawal-player-1', '5000')

    const interrupted = await createWithdrawal(harness, {
      idempotencyKey: 'withdrawal-interrupt-after-reserve',
    })
    const reserveCountAfterFailure = await transactionCount(
      harness,
      'withdrawal_reserve',
    )
    const retry = await createWithdrawal(harness, {
      idempotencyKey: 'withdrawal-interrupt-after-reserve',
    })

    expect(interrupted.status).toBe(500)
    expect(interrupted.body.error.code).toBe('SIMULATED_WITHDRAWAL_INTERRUPT')
    expect(reserveCountAfterFailure).toBe(1)
    expect(retry.status).toBe(201)
    expect(await transactionCount(harness, 'withdrawal_reserve')).toBe(1)
  })

  it('detects withdrawal reconciliation states', async () => {
    harness = await createTestApplication()
    const playerAccount = await fundPlayer(
      harness,
      'withdrawal-player-reconcile',
      '5000',
    )

    const reserveSource = await createWithdrawal(
      harness,
      {
        idempotencyKey: 'withdrawal-reconcile-source',
      },
      'withdrawal-player-reconcile',
    )

    await harness.database.query(
      `
        INSERT INTO withdrawal_requests (
          withdrawal_request_id,
          player_id,
          player_account_id,
          currency,
          amount_minor_units,
          destination_kind,
          destination_reference,
          provider,
          status,
          idempotency_key,
          correlation_id,
          causation_id,
          created_at,
          updated_at,
          requested_at
        )
        VALUES (
          'wd_req_unreserved_reconcile',
          'withdrawal-player-reconcile',
          $1,
          'USDC',
          1000,
          'simulated_external_account',
          'destination-reconcile',
          'simulated',
          'reservation_pending',
          'manual-withdrawal-unreserved',
          'corr_manual_withdrawal_unreserved',
          'cause_manual_withdrawal_unreserved',
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z'
        )
      `,
      [playerAccount.playerAccountId],
    )
    await harness.database.query(
      `
        INSERT INTO withdrawal_requests (
          withdrawal_request_id,
          player_id,
          player_account_id,
          currency,
          amount_minor_units,
          destination_kind,
          destination_reference,
          provider,
          status,
          idempotency_key,
          correlation_id,
          causation_id,
          reservation_ledger_transaction_id,
          created_at,
          updated_at,
          requested_at,
          reserved_at,
          approved_at
        )
        VALUES (
          'wd_req_approved_reconcile',
          'withdrawal-player-reconcile',
          $1,
          'USDC',
          1000,
          'simulated_external_account',
          'destination-reconcile-approved',
          'simulated',
          'submission_pending',
          'manual-withdrawal-approved',
          'corr_manual_withdrawal_approved',
          'cause_manual_withdrawal_approved',
          $2,
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z'
        )
      `,
      [
        playerAccount.playerAccountId,
        reserveSource.body.reservationLedgerTransactionId,
      ],
    )
    await harness.database.query(
      `
        INSERT INTO withdrawal_requests (
          withdrawal_request_id,
          player_id,
          player_account_id,
          currency,
          amount_minor_units,
          destination_kind,
          destination_reference,
          provider,
          status,
          idempotency_key,
          correlation_id,
          causation_id,
          reservation_ledger_transaction_id,
          review_reason_code,
          review_reason_text,
          created_at,
          updated_at,
          requested_at,
          reserved_at,
          approved_at
        )
        VALUES (
          'wd_req_provider_unknown_reconcile',
          'withdrawal-player-reconcile',
          $1,
          'USDC',
          1000,
          'simulated_external_account',
          'destination-reconcile-provider-unknown',
          'simulated',
          'provider_unknown',
          'manual-withdrawal-provider-unknown',
          'corr_manual_withdrawal_provider_unknown',
          'cause_manual_withdrawal_provider_unknown',
          $2,
          'WITHDRAWAL_PROVIDER_STATUS_UNKNOWN',
          'Simulated provider returned unknown status',
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z'
        )
      `,
      [
        playerAccount.playerAccountId,
        reserveSource.body.reservationLedgerTransactionId,
      ],
    )
    await harness.database.query(
      `
        INSERT INTO withdrawal_requests (
          withdrawal_request_id,
          player_id,
          player_account_id,
          currency,
          amount_minor_units,
          destination_kind,
          destination_reference,
          provider,
          status,
          idempotency_key,
          correlation_id,
          causation_id,
          reservation_ledger_transaction_id,
          created_at,
          updated_at,
          requested_at,
          reserved_at,
          cancelled_at
        )
        VALUES (
          'wd_req_cancelled_unreleased_reconcile',
          'withdrawal-player-reconcile',
          $1,
          'USDC',
          1000,
          'simulated_external_account',
          'destination-reconcile-cancelled',
          'simulated',
          'cancelled',
          'manual-withdrawal-cancelled',
          'corr_manual_withdrawal_cancelled',
          'cause_manual_withdrawal_cancelled',
          $2,
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z'
        )
      `,
      [
        playerAccount.playerAccountId,
        reserveSource.body.reservationLedgerTransactionId,
      ],
    )
    await harness.database.query(
      `
        INSERT INTO withdrawal_requests (
          withdrawal_request_id,
          player_id,
          player_account_id,
          currency,
          amount_minor_units,
          destination_kind,
          destination_reference,
          provider,
          status,
          idempotency_key,
          correlation_id,
          causation_id,
          reservation_ledger_transaction_id,
          created_at,
          updated_at,
          requested_at,
          reserved_at,
          approved_at
        )
        VALUES (
          'wd_req_completed_missing_finalization_reconcile',
          'withdrawal-player-reconcile',
          $1,
          'USDC',
          1000,
          'simulated_external_account',
          'destination-reconcile-completed-missing-finalization',
          'simulated',
          'completed',
          'manual-withdrawal-completed-missing-finalization',
          'corr_manual_withdrawal_completed_missing_finalization',
          'cause_manual_withdrawal_completed_missing_finalization',
          $2,
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z'
        )
      `,
      [
        playerAccount.playerAccountId,
        reserveSource.body.reservationLedgerTransactionId,
      ],
    )
    await harness.database.query(
      `
        INSERT INTO withdrawal_requests (
          withdrawal_request_id,
          player_id,
          player_account_id,
          currency,
          amount_minor_units,
          destination_kind,
          destination_reference,
          provider,
          status,
          idempotency_key,
          correlation_id,
          causation_id,
          reservation_ledger_transaction_id,
          created_at,
          updated_at,
          requested_at,
          reserved_at,
          approved_at
        )
        VALUES (
          'wd_req_submitting_reconcile',
          'withdrawal-player-reconcile',
          $1,
          'USDC',
          1000,
          'simulated_external_account',
          'destination-reconcile-submitting',
          'simulated',
          'submitting',
          'manual-withdrawal-submitting',
          'corr_manual_withdrawal_submitting',
          'cause_manual_withdrawal_submitting',
          $2,
          '2026-04-22T10:00:00.000Z',
          '2026-04-22T10:00:00.000Z',
          '2026-04-22T10:00:00.000Z',
          '2026-04-22T10:00:00.000Z',
          '2026-04-22T10:00:00.000Z'
        )
      `,
      [
        playerAccount.playerAccountId,
        reserveSource.body.reservationLedgerTransactionId,
      ],
    )
    await harness.database.query(
      `
        INSERT INTO withdrawal_requests (
          withdrawal_request_id,
          player_id,
          player_account_id,
          currency,
          amount_minor_units,
          destination_kind,
          destination_reference,
          provider,
          status,
          idempotency_key,
          correlation_id,
          causation_id,
          reservation_ledger_transaction_id,
          review_reason_code,
          review_reason_text,
          created_at,
          updated_at,
          requested_at,
          reserved_at,
          approved_at
        )
        VALUES (
          'wd_req_provider_rejected_reconcile',
          'withdrawal-player-reconcile',
          $1,
          'USDC',
          1000,
          'simulated_external_account',
          'destination-reconcile-provider-rejected',
          'simulated',
          'provider_rejected',
          'manual-withdrawal-provider-rejected',
          'corr_manual_withdrawal_provider_rejected',
          'cause_manual_withdrawal_provider_rejected',
          $2,
          'WITHDRAWAL_PROVIDER_REJECTED',
          'Simulated provider rejected withdrawal',
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z'
        )
      `,
      [
        playerAccount.playerAccountId,
        reserveSource.body.reservationLedgerTransactionId,
      ],
    )
    await harness.database.query(
      `
        INSERT INTO withdrawal_requests (
          withdrawal_request_id,
          player_id,
          player_account_id,
          currency,
          amount_minor_units,
          destination_kind,
          destination_reference,
          provider,
          status,
          idempotency_key,
          correlation_id,
          causation_id,
          reservation_ledger_transaction_id,
          created_at,
          updated_at,
          requested_at,
          reserved_at,
          approved_at
        )
        VALUES (
          'wd_req_provider_pending_reconcile',
          'withdrawal-player-reconcile',
          $1,
          'USDC',
          1000,
          'simulated_external_account',
          'destination-reconcile-provider-pending',
          'simulated',
          'provider_pending',
          'manual-withdrawal-provider-pending',
          'corr_manual_withdrawal_provider_pending',
          'cause_manual_withdrawal_provider_pending',
          $2,
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z'
        )
      `,
      [
        playerAccount.playerAccountId,
        reserveSource.body.reservationLedgerTransactionId,
      ],
    )
    await harness.database.query(
      `
        INSERT INTO withdrawal_requests (
          withdrawal_request_id,
          player_id,
          player_account_id,
          currency,
          amount_minor_units,
          destination_kind,
          destination_reference,
          provider,
          status,
          idempotency_key,
          correlation_id,
          causation_id,
          reservation_ledger_transaction_id,
          created_at,
          updated_at,
          requested_at,
          reserved_at,
          approved_at
        )
        VALUES (
          'wd_req_provider_confirmed_reconcile',
          'withdrawal-player-reconcile',
          $1,
          'USDC',
          1000,
          'simulated_external_account',
          'destination-reconcile-provider-confirmed',
          'simulated',
          'provider_confirmed',
          'manual-withdrawal-provider-confirmed',
          'corr_manual_withdrawal_provider_confirmed',
          'cause_manual_withdrawal_provider_confirmed',
          $2,
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z'
        )
      `,
      [
        playerAccount.playerAccountId,
        reserveSource.body.reservationLedgerTransactionId,
      ],
    )
    await harness.database.query(
      `
        INSERT INTO withdrawal_provider_submissions (
          withdrawal_request_id,
          provider,
          external_withdrawal_id,
          external_transaction_id,
          provider_status,
          submission_attempt_count,
          last_submitted_at,
          last_status_synced_at,
          raw_provider_payload,
          provider_idempotency_key,
          created_at,
          updated_at
        )
        VALUES
          (
            'wd_req_provider_pending_reconcile',
            'simulated',
            'sim_wd_reconcile_pending',
            'sim_tx_reconcile_pending',
            'pending',
            1,
            '2026-04-22T12:00:00.000Z',
            NULL,
            '{"simulated":true}'::jsonb,
            'reconcile-pending-submit',
            '2026-04-22T12:00:00.000Z',
            '2026-04-22T12:00:00.000Z'
          ),
          (
            'wd_req_provider_confirmed_reconcile',
            'simulated',
            'sim_wd_reconcile_confirmed',
            'sim_tx_reconcile_confirmed',
            'confirmed',
            1,
            '2026-04-22T12:00:00.000Z',
            '2026-04-22T12:00:00.000Z',
            '{"simulated":true}'::jsonb,
            'reconcile-confirmed-submit',
            '2026-04-22T12:00:00.000Z',
            '2026-04-22T12:00:00.000Z'
          )
      `,
    )
    await harness.database.query(
      `
        INSERT INTO withdrawal_provider_webhook_receipts (
          withdrawal_provider_webhook_receipt_id,
          provider,
          nonce,
          provider_timestamp,
          received_at,
          request_hash,
          signature_version,
          external_withdrawal_id,
          external_transaction_id,
          withdrawal_request_id,
          status,
          rejection_reason
        )
        VALUES
          (
            'wd_wh_reconcile_missing_event',
            'simulated',
            'nonce-reconcile-missing-event',
            '2026-04-22T12:00:00.000Z',
            '2026-04-22T12:00:00.000Z',
            'hash-reconcile-missing-event',
            'hmac-sha256-v1',
            'sim_wd_reconcile_missing_event',
            'sim_tx_reconcile_missing_event',
            NULL,
            'accepted',
            NULL
          ),
          (
            'wd_wh_reconcile_replay',
            'simulated',
            'nonce-reconcile-replay',
            '2026-04-22T12:00:00.000Z',
            '2026-04-22T12:00:00.000Z',
            'hash-reconcile-replay',
            'hmac-sha256-v1',
            'sim_wd_reconcile_replay',
            'sim_tx_reconcile_replay',
            NULL,
            'rejected',
            'duplicate_nonce'
          )
      `,
    )
    await harness.database.query(
      `
        INSERT INTO withdrawal_provider_events (
          withdrawal_provider_event_id,
          provider,
          external_withdrawal_id,
          external_transaction_id,
          withdrawal_request_id,
          provider_status,
          status,
          review_reason_code,
          review_reason_text,
          raw_payload,
          webhook_receipt_id,
          received_at,
          updated_at
        )
        VALUES
          (
            'wd_evt_reconcile_unmatched',
            'simulated',
            'sim_wd_reconcile_unmatched',
            'sim_tx_reconcile_unmatched',
            NULL,
            'confirmed',
            'review_required',
            'WITHDRAWAL_PROVIDER_EVENT_UNMATCHED',
            'Unmatched provider callback',
            '{"simulated":true}'::jsonb,
            NULL,
            '2026-04-22T12:00:00.000Z',
            '2026-04-22T12:00:00.000Z'
          ),
          (
            'wd_evt_reconcile_confirmed_drift',
            'simulated',
            'sim_wd_reconcile_pending',
            'sim_tx_reconcile_pending',
            'wd_req_provider_pending_reconcile',
            'confirmed',
            'applied',
            NULL,
            NULL,
            '{"simulated":true}'::jsonb,
            NULL,
            '2026-04-22T12:00:00.000Z',
            '2026-04-22T12:00:00.000Z'
          ),
          (
            'wd_evt_reconcile_mismatch',
            'simulated',
            'sim_wd_reconcile_mismatch',
            'sim_tx_reconcile_mismatch',
            'wd_req_provider_pending_reconcile',
            'confirmed',
            'review_required',
            'WITHDRAWAL_PROVIDER_EVENT_REFERENCE_MISMATCH',
            'Reference mismatch',
            '{"simulated":true}'::jsonb,
            NULL,
            '2026-04-22T12:00:00.000Z',
            '2026-04-22T12:00:00.000Z'
          ),
          (
            'wd_evt_reconcile_terminal_callback',
            'simulated',
            'sim_wd_reconcile_terminal',
            'sim_tx_reconcile_terminal',
            'wd_req_completed_missing_finalization_reconcile',
            'confirmed',
            'review_required',
            'WITHDRAWAL_PROVIDER_EVENT_FOR_TERMINAL_REQUEST',
            'Terminal callback',
            '{"simulated":true}'::jsonb,
            NULL,
            '2026-04-22T12:00:00.000Z',
            '2026-04-22T12:00:00.000Z'
          )
      `,
    )

    const response = await request(harness.app)
      .get('/admin/operations/withdrawals/reconciliation')
      .set(operatorHeaders('withdrawal-reconcile'))
    const codes = response.body.reconciliation.issues.map(
      (issue: { code: string }) => issue.code,
    )

    expect(response.status).toBe(200)
    expect(codes).toEqual(
      expect.arrayContaining([
        'requested_without_reservation',
        'approved_awaiting_provider_submission',
        'cancelled_with_unreleased_reservation',
        'submitting_withdrawal_stuck',
        'provider_pending_not_recently_synced',
        'provider_confirmed_not_finalized',
        'provider_failure_holding_reservation',
        'provider_unknown_requires_review',
        'completed_missing_finalization_ledger',
        'provider_webhook_receipt_missing_event',
        'provider_webhook_replay_rejected',
        'unmatched_withdrawal_provider_event',
        'provider_webhook_confirmed_status_drift',
        'provider_event_submission_mismatch',
        'provider_callback_for_terminal_withdrawal',
      ]),
    )
  })
})
