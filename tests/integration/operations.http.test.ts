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

function operatorHeaders(key: string, role = 'finance_operator') {
  return {
    'x-nines-authenticated-user-id': 'operator-phase-6',
    'x-nines-operator-role': role,
    ...stateChangingHeaders(key, `corr_${key}`, `cause_${key}`),
  }
}

function playerHeaders(userId: string, key: string) {
  return {
    'x-nines-authenticated-user-id': userId,
    ...stateChangingHeaders(key, `corr_${key}`, `cause_${key}`),
  }
}

async function provisionPlayerAccount(
  harness: TestApplicationHarness,
  userId: string,
) {
  return harness.container.services.playerAccountProvisioningService.provisionIfNeeded(
    {
      idempotencyKey: toIdempotencyKey(`phase-6-provision-${userId}`),
      userId: toUserId(userId),
      currency: 'USDC',
      correlationId: `corr_phase_6_provision_${userId}`,
      causationId: `cause_phase_6_provision_${userId}`,
    },
  )
}

async function fundPlayer(
  harness: TestApplicationHarness,
  userId: string,
  amountMinor = '5000',
) {
  const playerAccount = await provisionPlayerAccount(harness, userId)
  const source = await harness.container.services.accountService.createAccount({
    accountType: 'deposit_clearing',
    ownerType: 'platform',
    ownerId: toOwnerId(`phase-6-source-${userId}`),
    currency: 'USDC',
    correlationId: `corr_phase_6_source_${userId}`,
    causationId: `cause_phase_6_source_${userId}`,
    idempotencyKey: toIdempotencyKey(`phase-6-source-${userId}`),
  })

  await harness.container.services.postingEngineService.postTransfer({
    idempotencyKey: toIdempotencyKey(`phase-6-fund-${userId}`),
    transactionType: 'deposit_confirmed_credit',
    referenceType: 'deposit',
    referenceId: `phase-6-fund-${userId}`,
    debitAccountId: source.accountId,
    creditAccountId: playerAccount.availableAccountId,
    amountMinor,
    currency: 'USDC',
    correlationId: `corr_phase_6_fund_${userId}`,
    causationId: `cause_phase_6_fund_${userId}`,
  })

  return playerAccount
}

async function createWithdrawal(
  harness: TestApplicationHarness,
  userId: string,
  key: string,
) {
  return request(harness.app)
    .post('/withdrawal-requests')
    .set(playerHeaders(userId, key))
    .send({
      amountMinorUnits: '1000',
      currency: 'USDC',
      destinationKind: 'simulated_external_account',
      destinationReference: `phase-6-destination-${key}`,
      provider: 'simulated',
    })
}

async function insertUnreservedWithdrawal(
  harness: TestApplicationHarness,
  playerAccountId: string,
  id = 'wd_req_phase_6_unreserved',
) {
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
        $1,
        'phase-6-player',
        $2,
        'USDC',
        1000,
        'simulated_external_account',
        'phase-6-unreserved',
        'simulated',
        'reservation_pending',
        $1 || '-idem',
        $1 || '-corr',
        $1 || '-cause',
        '2026-04-22T12:00:00.000Z',
        '2026-04-22T12:00:00.000Z',
        '2026-04-22T12:00:00.000Z'
      )
    `,
    [id, playerAccountId],
  )
}

async function discrepancyCount(harness: TestApplicationHarness) {
  const result = await harness.database.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM operational_discrepancies',
  )
  return result.rows[0]?.count ?? 0
}

async function auditCount(harness: TestApplicationHarness, eventType: string) {
  const result = await harness.database.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM audit_events WHERE event_type = $1',
    [eventType],
  )
  return result.rows[0]?.count ?? 0
}

describe('Phase 6 operational hardening HTTP routes', () => {
  let harness: TestApplicationHarness | undefined

  afterEach(async () => {
    if (harness) {
      await harness.close()
      harness = undefined
    }
  })

  it('materializes reconciliation discrepancies idempotently and reopens persistent issues', async () => {
    harness = await createTestApplication()
    const account = await provisionPlayerAccount(harness, 'phase-6-player')
    await insertUnreservedWithdrawal(harness, account.playerAccountId)

    const first = await request(harness.app)
      .post('/admin/operations/reconciliation/run')
      .set(operatorHeaders('phase-6-reconcile-run'))
      .send({})
    const second = await request(harness.app)
      .post('/admin/operations/reconciliation/run')
      .set(operatorHeaders('phase-6-reconcile-run-repeat'))
      .send({})
    const list = await request(harness.app)
      .get('/admin/operations/discrepancies')
      .set(operatorHeaders('phase-6-list'))
    const discrepancyId = list.body.discrepancies[0].discrepancyId
    const resolved = await request(harness.app)
      .post(`/admin/operations/discrepancies/${discrepancyId}/resolve`)
      .set(operatorHeaders('phase-6-resolve'))
      .send({ reason: 'Investigated and waiting for next scan' })
    const reopenedScan = await request(harness.app)
      .post('/admin/operations/reconciliation/run')
      .set(operatorHeaders('phase-6-reconcile-reopen'))
      .send({})
    const reopened = await request(harness.app)
      .get(`/admin/operations/discrepancies/${discrepancyId}`)
      .set(operatorHeaders('phase-6-get-reopened'))

    expect(first.status).toBe(201)
    expect(first.body.reconciliation.openedCount).toBeGreaterThanOrEqual(1)
    expect(second.body.reconciliation.openedCount).toBe(0)
    expect(await discrepancyCount(harness)).toBe(
      first.body.reconciliation.openedCount,
    )
    expect(resolved.body.discrepancy.status).toBe('resolved')
    expect(reopenedScan.body.reconciliation.reopenedCount).toBeGreaterThanOrEqual(1)
    expect(reopened.body.discrepancy.status).toBe('open')
  })

  it('supports audited discrepancy workflow transitions and RBAC', async () => {
    harness = await createTestApplication()
    const account = await provisionPlayerAccount(harness, 'phase-6-player')
    await insertUnreservedWithdrawal(
      harness,
      account.playerAccountId,
      'wd_req_phase_6_workflow',
    )
    await request(harness.app)
      .post('/admin/operations/reconciliation/run')
      .set(operatorHeaders('phase-6-workflow-run'))
      .send({})
    const list = await request(harness.app)
      .get('/admin/operations/discrepancies')
      .set(operatorHeaders('phase-6-workflow-list'))
    const discrepancyId = list.body.discrepancies[0].discrepancyId

    const acknowledged = await request(harness.app)
      .post(`/admin/operations/discrepancies/${discrepancyId}/acknowledge`)
      .set(operatorHeaders('phase-6-ack'))
      .send({})
    const assigned = await request(harness.app)
      .post(`/admin/operations/discrepancies/${discrepancyId}/assign`)
      .set(operatorHeaders('phase-6-assign'))
      .send({ assignedToOperatorId: 'operator-owner' })
    const lowSuppress = await request(harness.app)
      .post(`/admin/operations/discrepancies/${discrepancyId}/suppress`)
      .set(operatorHeaders('phase-6-low-suppress', 'treasury_operator'))
      .send({ reason: 'Cannot suppress without elevated role' })
    const suppressed = await request(harness.app)
      .post(`/admin/operations/discrepancies/${discrepancyId}/suppress`)
      .set(operatorHeaders('phase-6-suppress', 'financial_admin'))
      .send({ reason: 'Known benign test drift' })
    const invalidResolve = await request(harness.app)
      .post(`/admin/operations/discrepancies/${discrepancyId}/resolve`)
      .set(operatorHeaders('phase-6-invalid-resolve'))
      .send({ reason: 'Already suppressed' })
    const reopened = await request(harness.app)
      .post(`/admin/operations/discrepancies/${discrepancyId}/reopen`)
      .set(operatorHeaders('phase-6-reopen'))
      .send({ reason: 'Needs investigation again' })

    expect(acknowledged.body.discrepancy.status).toBe('acknowledged')
    expect(assigned.body.discrepancy.status).toBe('in_progress')
    expect(assigned.body.discrepancy.assignedToOperatorId).toBe('operator-owner')
    expect(lowSuppress.status).toBe(403)
    expect(suppressed.body.discrepancy.status).toBe('suppressed')
    expect(invalidResolve.status).toBe(409)
    expect(reopened.body.discrepancy.status).toBe('open')
    expect(
      await auditCount(harness, 'financial.operations.discrepancy_workflow'),
    ).toBeGreaterThanOrEqual(4)
  })

  it('freezes and unfreezes player withdrawal creation through risk controls', async () => {
    harness = await createTestApplication()
    await fundPlayer(harness, 'phase-6-risk-player', '5000')

    const frozen = await request(harness.app)
      .post('/admin/risk/accounts/phase-6-risk-player/freeze')
      .set(operatorHeaders('phase-6-risk-freeze', 'treasury_admin'))
      .send({ reason: 'Manual withdrawal review required', scope: 'withdrawals' })
    const blocked = await createWithdrawal(
      harness,
      'phase-6-risk-player',
      'phase-6-risk-blocked',
    )
    const unfrozen = await request(harness.app)
      .post('/admin/risk/accounts/phase-6-risk-player/unfreeze')
      .set(operatorHeaders('phase-6-risk-unfreeze', 'treasury_admin'))
      .send({ reason: 'Risk review cleared' })
    const allowed = await createWithdrawal(
      harness,
      'phase-6-risk-player',
      'phase-6-risk-allowed',
    )

    expect(frozen.body.riskAccount.withdrawalFrozen).toBe(true)
    expect(blocked.status).toBe(403)
    expect(unfrozen.body.riskAccount.withdrawalFrozen).toBe(false)
    expect(allowed.status).toBe(201)
    expect(
      await auditCount(harness, 'financial.operations.risk_account_frozen'),
    ).toBe(1)
    expect(
      await auditCount(harness, 'financial.operations.risk_account_unfrozen'),
    ).toBe(1)
  })

  it('returns financial health summaries and supports guarded balance rebuild', async () => {
    harness = await createTestApplication()

    const ledger = await request(harness.app)
      .get('/admin/operations/health/ledger-balance-check')
      .set(operatorHeaders('phase-6-health-ledger'))
    const integrity = await request(harness.app)
      .get('/admin/operations/health/accounting-integrity')
      .set(operatorHeaders('phase-6-health-integrity'))
    const treasury = await request(harness.app)
      .get('/admin/operations/health/treasury-summary')
      .set(operatorHeaders('phase-6-health-treasury'))
    const lowRebuild = await request(harness.app)
      .post('/admin/operations/balances/rebuild')
      .set(operatorHeaders('phase-6-rebuild-low'))
      .send({ reason: 'Verify guarded rebuild' })
    const rebuild = await request(harness.app)
      .post('/admin/operations/balances/rebuild')
      .set(operatorHeaders('phase-6-rebuild', 'financial_admin'))
      .send({ reason: 'Operator requested read-model rebuild' })

    expect(ledger.status).toBe(200)
    expect(ledger.body.ledgerBalanceCheck).toHaveProperty('mismatchCount')
    expect(integrity.status).toBe(200)
    expect(integrity.body.accountingIntegrity).toHaveProperty(
      'negativeForbiddenBalanceCount',
    )
    expect(treasury.status).toBe(200)
    expect(Array.isArray(treasury.body.treasurySummary.buckets)).toBe(true)
    expect(lowRebuild.status).toBe(403)
    expect(rebuild.status).toBe(200)
  })

  it('aggregates operational financial timelines', async () => {
    harness = await createTestApplication()
    await fundPlayer(harness, 'phase-6-timeline-player', '5000')
    const withdrawal = await createWithdrawal(
      harness,
      'phase-6-timeline-player',
      'phase-6-timeline-withdrawal',
    )

    const playerTimeline = await request(harness.app)
      .get('/admin/operations/players/phase-6-timeline-player/financial-timeline')
      .set(operatorHeaders('phase-6-player-timeline'))
    const withdrawalTimeline = await request(harness.app)
      .get(
        `/admin/operations/withdrawals/${withdrawal.body.withdrawalRequestId}/timeline`,
      )
      .set(operatorHeaders('phase-6-withdrawal-timeline'))

    expect(playerTimeline.status).toBe(200)
    expect(playerTimeline.body.timeline.items.length).toBeGreaterThan(0)
    expect(withdrawalTimeline.status).toBe(200)
    expect(
      withdrawalTimeline.body.timeline.items.some(
        (item: { itemType: string }) => item.itemType === 'ledger_transaction',
      ),
    ).toBe(true)
  })
})
