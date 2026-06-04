import express from 'express'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { AdminOpsReadService } from '../../src/domains/admin/services/AdminOpsReadService.js'
import { createAdminReadOnlyRouter } from '../../src/handlers/http/adminReadOnlyRoutes.js'
import { toUserId } from '../../src/domains/account/types/identifiers.js'
import { toOwnerId } from '../../src/domains/accounting/types/identifiers.js'
import { toIdempotencyKey } from '../../src/shared/idempotency/types.js'
import type { Database } from '../../src/shared/db/Database.js'
import {
  createTestApplication,
  stateChangingHeaders,
  type TestApplicationHarness,
} from '../support/testApp.js'

const fixedNow = new Date('2026-04-22T12:00:00.000Z')

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
      idempotencyKey: toIdempotencyKey(`admin-read-provision-${userId}`),
      userId: toUserId(userId),
      currency: 'USDC',
      correlationId: `corr_admin_read_provision_${userId}`,
      causationId: `cause_admin_read_provision_${userId}`,
    },
  )
}

async function fundPlayer(
  harness: TestApplicationHarness,
  userId: string,
  amountMinor = '5000',
) {
  const playerAccount = await provisionPlayerAccount(harness, userId)
  const depositSource = await harness.container.services.accountService.createAccount({
    accountType: 'deposit_clearing',
    ownerType: 'platform',
    ownerId: toOwnerId(`admin-read-deposit-source-${userId}`),
    currency: 'USDC',
    correlationId: `corr_admin_read_deposit_source_${userId}`,
    causationId: `cause_admin_read_deposit_source_${userId}`,
    idempotencyKey: toIdempotencyKey(`admin-read-deposit-source-${userId}`),
  })

  await harness.container.services.postingEngineService.postTransfer({
    idempotencyKey: toIdempotencyKey(`admin-read-fund-${userId}`),
    transactionType: 'deposit_confirmed_credit',
    referenceType: 'deposit',
    referenceId: `admin-read-deposit-${userId}`,
    debitAccountId: depositSource.accountId,
    creditAccountId: playerAccount.availableAccountId,
    amountMinor,
    currency: 'USDC',
    correlationId: `corr_admin_read_fund_${userId}`,
    causationId: `cause_admin_read_fund_${userId}`,
  })

  return playerAccount
}

async function createPendingDeposit(
  harness: TestApplicationHarness,
  playerAccountId: string,
) {
  await harness.database.query(
    `
      INSERT INTO deposit_intents (
        deposit_intent_id,
        player_account_id,
        user_id,
        currency,
        expected_amount_minor,
        provider,
        provider_kind,
        destination_reference,
        status,
        created_at,
        updated_at,
        idempotency_key,
        correlation_id,
        causation_id
      )
      VALUES (
        'dep_intent_admin_read_pending',
        $1,
        'admin-read-player',
        'USDC',
        1000,
        'simulated',
        'simulated',
        'admin-read-destination',
        'awaiting_external_payment',
        '2026-04-22T11:50:00.000Z',
        '2026-04-22T11:50:00.000Z',
        'admin-read-deposit-idem',
        'admin-read-deposit-corr',
        'admin-read-deposit-cause'
      )
    `,
    [playerAccountId],
  )
}

async function createPendingWithdrawal(
  harness: TestApplicationHarness,
  userId: string,
) {
  return request(harness.app)
    .post('/withdrawal-requests')
    .set(playerHeaders(userId, 'admin-read-withdrawal'))
    .send({
      amountMinorUnits: '1200',
      currency: 'USDC',
      destinationKind: 'simulated_external_account',
      destinationReference: 'admin-read-withdrawal-destination',
      provider: 'simulated',
    })
}

async function createSettlementSummaryRows(harness: TestApplicationHarness) {
  await harness.database.query(
    `
      INSERT INTO race_pools (
        race_id,
        currency,
        status,
        created_at,
        updated_at,
        frozen_at
      )
      VALUES (
        'race-admin-read-1',
        'USDC',
        'settled',
        '2026-04-22T11:00:00.000Z',
        '2026-04-22T11:20:00.000Z',
        '2026-04-22T11:05:00.000Z'
      )
    `,
  )
  await harness.database.query(
    `
      INSERT INTO settlement_runs (
        settlement_run_id,
        race_id,
        currency,
        status,
        winning_selection_id,
        house_take_bps,
        idempotency_key,
        command_fingerprint,
        total_pool_minor,
        house_take_minor,
        net_pool_minor,
        created_at,
        updated_at,
        started_at,
        completed_at
      )
      VALUES (
        'settle_run_admin_read_1',
        'race-admin-read-1',
        'USDC',
        'completed',
        'horse-winner',
        500,
        'settle-admin-read-1',
        'fingerprint-admin-read-1',
        10000,
        500,
        9500,
        '2026-04-22T11:10:00.000Z',
        '2026-04-22T11:20:00.000Z',
        '2026-04-22T11:10:00.000Z',
        '2026-04-22T11:20:00.000Z'
      )
    `,
  )
  await harness.database.query(
    `
      INSERT INTO financial_bets (
        bet_id,
        user_id,
        race_id,
        selection_id,
        stake_minor,
        currency,
        status,
        settlement_run_id,
        idempotency_key,
        correlation_id,
        causation_id,
        created_at,
        updated_at
      )
      VALUES
        (
          'bet-admin-read-win',
          'settlement-player-1',
          'race-admin-read-1',
          'horse-winner',
          2500,
          'USDC',
          'settled_win',
          'settle_run_admin_read_1',
          'bet-admin-read-win-idem',
          'bet-admin-read-win-corr',
          'bet-admin-read-win-cause',
          '2026-04-22T11:01:00.000Z',
          '2026-04-22T11:20:00.000Z'
        ),
        (
          'bet-admin-read-loss',
          'settlement-player-2',
          'race-admin-read-1',
          'horse-loser',
          7500,
          'USDC',
          'settled_loss',
          'settle_run_admin_read_1',
          'bet-admin-read-loss-idem',
          'bet-admin-read-loss-corr',
          'bet-admin-read-loss-cause',
          '2026-04-22T11:02:00.000Z',
          '2026-04-22T11:20:00.000Z'
        )
    `,
  )
}

async function createOpenDiscrepancies(harness: TestApplicationHarness) {
  await harness.database.query(
    `
      INSERT INTO operational_discrepancies (
        discrepancy_id,
        dedupe_key,
        category,
        severity,
        status,
        entity_type,
        entity_id,
        summary,
        first_detected_at,
        last_detected_at,
        detected_at,
        updated_at
      )
      VALUES
        (
          'disc_admin_read_incident',
          'admin-read-incident',
          'withdrawal.provider_pending_stale',
          'incident',
          'open',
          'withdrawal',
          'withdrawal-admin-read',
          'Admin read incident',
          '2026-04-22T11:30:00.000Z',
          '2026-04-22T11:45:00.000Z',
          '2026-04-22T11:45:00.000Z',
          '2026-04-22T11:45:00.000Z'
        ),
        (
          'disc_admin_read_warning',
          'admin-read-warning',
          'deposit.review_required',
          'warning',
          'acknowledged',
          'deposit',
          'deposit-admin-read',
          'Admin read warning',
          '2026-04-22T11:35:00.000Z',
          '2026-04-22T11:40:00.000Z',
          '2026-04-22T11:40:00.000Z',
          '2026-04-22T11:40:00.000Z'
        )
    `,
  )
}

function failingAdminApp() {
  const failingDatabase: Database = {
    async query() {
      throw new Error('database offline')
    },
    async tx() {
      throw new Error('database offline')
    },
    async close() {},
  }
  const clock = { now: () => fixedNow }
  const app = express()
  app.use(createAdminReadOnlyRouter(new AdminOpsReadService(failingDatabase, clock)))
  return app
}

describe('financial admin read-only HTTP routes', () => {
  let harness: TestApplicationHarness | undefined

  afterEach(async () => {
    if (harness) {
      await harness.close()
      harness = undefined
    }
  })

  it('returns safe empty/default responses for an empty database', async () => {
    harness = await createTestApplication(fixedNow)

    const health = await request(harness.app).get('/admin/health')
    const treasury = await request(harness.app).get('/admin/treasury/summary')
    const deposits = await request(harness.app).get('/admin/deposits/pending')
    const withdrawals = await request(harness.app).get('/admin/withdrawals/pending')
    const reconciliation = await request(harness.app).get('/admin/reconciliation/summary')

    expect(health.status).toBe(200)
    expect(health.body).toMatchObject({
      serviceName: 'nines-financial',
      status: 'ok',
      database: { status: 'ok', checked: true },
      ledger: { status: 'ok', checked: true },
      degradedFlags: [],
    })
    expect(treasury.body).toMatchObject({
      currency: 'USDC',
      totalPlayerAvailableBalanceMinorUnits: '0',
      totalPlayerReservedBalanceMinorUnits: '0',
      totalPlayerDisplayBalanceMinorUnits: '0',
      pendingDepositCount: 0,
      pendingWithdrawalCount: 0,
      degraded: false,
    })
    expect(deposits.body).toMatchObject({
      count: 0,
      totalAmountMinorUnits: '0',
      oldestCreatedAt: null,
      notImplemented: false,
    })
    expect(withdrawals.body).toMatchObject({
      count: 0,
      totalAmountMinorUnits: '0',
      oldestCreatedAt: null,
      notImplemented: false,
    })
    expect(reconciliation.body).toMatchObject({
      openDiscrepancies: 0,
      criticalDiscrepancies: 0,
      warningDiscrepancies: 0,
      lastRunAt: null,
      notImplemented: false,
    })
  })

  it('returns treasury, pending workflow, settlement, and reconciliation aggregates without player details', async () => {
    harness = await createTestApplication(fixedNow)
    const playerAccount = await fundPlayer(harness, 'admin-read-player')
    await createPendingDeposit(harness, playerAccount.playerAccountId)
    const withdrawal = await createPendingWithdrawal(harness, 'admin-read-player')
    await createSettlementSummaryRows(harness)
    await createOpenDiscrepancies(harness)

    expect(withdrawal.status).toBe(201)

    const treasury = await request(harness.app).get('/admin/treasury/summary')
    const deposits = await request(harness.app).get('/admin/deposits/pending')
    const withdrawals = await request(harness.app).get('/admin/withdrawals/pending')
    const settlements = await request(harness.app).get('/admin/settlements/recent')
    const reconciliation = await request(harness.app).get('/admin/reconciliation/summary')

    expect(treasury.status).toBe(200)
    expect(treasury.body).toMatchObject({
      totalPlayerAvailableBalanceMinorUnits: '3800',
      totalPlayerReservedBalanceMinorUnits: '1200',
      totalPlayerDisplayBalanceMinorUnits: '5000',
      pendingDepositCount: 1,
      pendingDepositAmountMinorUnits: '1000',
      pendingWithdrawalCount: 1,
      pendingWithdrawalAmountMinorUnits: '1200',
      degraded: false,
    })
    expect(deposits.body).toMatchObject({
      count: 1,
      totalAmountMinorUnits: '1000',
      oldestCreatedAt: '2026-04-22T11:50:00.000Z',
    })
    expect(withdrawals.body).toMatchObject({
      count: 1,
      totalAmountMinorUnits: '1200',
    })
    expect(settlements.body.settlements[0]).toMatchObject({
      raceId: 'race-admin-read-1',
      status: 'completed',
      grossPool: '10000',
      houseTake: '500',
      netPool: '9500',
      totalWinningStake: '2500',
      settledAt: '2026-04-22T11:20:00.000Z',
    })
    expect(reconciliation.body).toMatchObject({
      openDiscrepancies: 2,
      criticalDiscrepancies: 1,
      warningDiscrepancies: 1,
      lastRunAt: '2026-04-22T11:45:00.000Z',
    })

    const responseText = JSON.stringify({
      treasury: treasury.body,
      deposits: deposits.body,
      withdrawals: withdrawals.body,
      settlements: settlements.body,
      reconciliation: reconciliation.body,
    })
    expect(responseText).not.toContain('admin-read-player')
    expect(responseText).not.toContain(playerAccount.playerAccountId)
    expect(responseText).not.toContain(playerAccount.availableAccountId)
    expect(responseText).not.toContain(playerAccount.reservedAccountId)
  })

  it('keeps admin phase 4 endpoints read-only', async () => {
    harness = await createTestApplication(fixedNow)
    const endpoints = [
      '/admin/health',
      '/admin/treasury/summary',
      '/admin/settlements/recent',
      '/admin/deposits/pending',
      '/admin/withdrawals/pending',
      '/admin/reconciliation/summary',
    ]

    for (const endpoint of endpoints) {
      expect((await request(harness.app).post(endpoint).send({})).status).toBe(404)
      expect((await request(harness.app).put(endpoint).send({})).status).toBe(404)
      expect((await request(harness.app).patch(endpoint).send({})).status).toBe(404)
      expect((await request(harness.app).delete(endpoint)).status).toBe(404)
    }
  })

  it('returns degraded fallbacks instead of failing when dependencies are unavailable', async () => {
    const app = failingAdminApp()

    const health = await request(app).get('/admin/health')
    const treasury = await request(app).get('/admin/treasury/summary')
    const settlements = await request(app).get('/admin/settlements/recent')
    const deposits = await request(app).get('/admin/deposits/pending')
    const withdrawals = await request(app).get('/admin/withdrawals/pending')
    const reconciliation = await request(app).get('/admin/reconciliation/summary')

    expect(health.status).toBe(200)
    expect(health.body.status).toBe('degraded')
    expect(health.body.degradedFlags).toEqual(
      expect.arrayContaining([
        expect.stringContaining('database_unavailable'),
        expect.stringContaining('ledger_unavailable'),
      ]),
    )
    expect(treasury.body.degraded).toBe(true)
    expect(treasury.body.totalPlayerAvailableBalanceMinorUnits).toBe('0')
    expect(settlements.body).toMatchObject({
      degraded: true,
      notImplemented: true,
      settlements: [],
    })
    expect(deposits.body).toMatchObject({
      degraded: true,
      notImplemented: true,
      count: 0,
      totalAmountMinorUnits: '0',
    })
    expect(withdrawals.body).toMatchObject({
      degraded: true,
      notImplemented: true,
      count: 0,
      totalAmountMinorUnits: '0',
    })
    expect(reconciliation.body).toMatchObject({
      degraded: true,
      notImplemented: true,
      openDiscrepancies: 0,
      criticalDiscrepancies: 0,
      warningDiscrepancies: 0,
    })
  })
})
