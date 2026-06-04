import { afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createHmac } from 'node:crypto'

import { toUserId } from '../../src/domains/account/types/identifiers.js'
import { toOwnerId } from '../../src/domains/accounting/types/identifiers.js'
import type {
  FaultInjector,
  FaultPoint,
} from '../../src/shared/faults/FaultInjector.js'
import { toIdempotencyKey } from '../../src/shared/idempotency/types.js'
import { AppError } from '../../src/shared/types/AppError.js'
import {
  createRealPostgresRestartedApplication,
  createRealPostgresTestApplication,
  realPostgresDrillsEnabled,
  type RealPostgresTestApplicationHarness,
} from '../support/realPostgresTestApp.js'

type DrillHarness = RealPostgresTestApplicationHarness

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
      code: 'SIMULATED_PROCESS_INTERRUPT',
      message: 'Simulated process interruption for real PostgreSQL drills',
      retryable: true,
      details: { point },
    })
  }
}

function operatorHeaders(operatorId = 'operator-real-pg') {
  return {
    'x-nines-authenticated-user-id': operatorId,
    'x-nines-operator-role': 'settlement_operator',
  }
}

function stateHeaders(idempotencyKey: string) {
  return {
    'idempotency-key': idempotencyKey,
    'x-correlation-id': `corr_${idempotencyKey}`,
    'x-causation-id': `cause_${idempotencyKey}`,
  }
}

function depositPlayerHeaders(userId: string, idempotencyKey: string) {
  return {
    'x-nines-authenticated-user-id': userId,
    ...stateHeaders(idempotencyKey),
  }
}

function depositOperatorHeaders(
  idempotencyKey: string,
  operatorId = 'operator-real-pg-deposit',
) {
  return {
    'x-nines-authenticated-user-id': operatorId,
    'x-nines-operator-role': 'treasury_operator',
    ...stateHeaders(idempotencyKey),
  }
}

function withdrawalOperatorHeaders(
  idempotencyKey: string,
  role = 'treasury_operator',
  operatorId = 'operator-real-pg-withdrawal',
) {
  return {
    'x-nines-authenticated-user-id': operatorId,
    'x-nines-operator-role': role,
    ...stateHeaders(idempotencyKey),
  }
}

function operationsOperatorHeaders(
  idempotencyKey: string,
  role = 'financial_admin',
  operatorId = 'operator-real-pg-operations',
) {
  return {
    'x-nines-authenticated-user-id': operatorId,
    'x-nines-operator-role': role,
    ...stateHeaders(idempotencyKey),
  }
}

function signDepositWebhook(
  body: Record<string, unknown>,
  timestamp: string,
  nonce: string,
): string {
  return createHmac('sha256', 'test-deposit-webhook-secret')
    .update(`${timestamp}.${nonce}.${JSON.stringify(body)}`)
    .digest('hex')
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

async function createRealPgDepositIntent(
  harness: DrillHarness,
  userId: string,
  idempotencyKey: string,
  expectedAmountMinor = '1000',
) {
  return request(harness.app)
    .post('/deposit-intents')
    .set(depositPlayerHeaders(userId, idempotencyKey))
    .send({
      expectedAmountMinor,
      provider: 'simulated',
    })
}

async function postSignedDepositWebhook(
  harness: DrillHarness,
  body: Record<string, unknown>,
  idempotencyKey: string,
) {
  const timestamp = '2026-04-22T12:00:00.000Z'
  const nonce = `nonce-${idempotencyKey}`

  return request(harness.app)
    .post('/provider-events/deposits/webhook/simulated')
    .set({
      ...stateHeaders(idempotencyKey),
      'x-nines-provider-timestamp': timestamp,
      'x-nines-provider-nonce': nonce,
      'x-nines-provider-signature': signDepositWebhook(
        body,
        timestamp,
        nonce,
      ),
    })
    .send(body)
}

async function depositCreditCount(harness: DrillHarness) {
  const result = await harness.database.query<{ count: number }>(
    `
      SELECT count(*)::int AS count
      FROM ledger_transactions
      WHERE transaction_type = 'deposit_confirmed_credit'
    `,
  )

  return result.rows[0]?.count ?? 0
}

async function fundPlayer(
  harness: DrillHarness,
  userId: string,
  amountMinor = '5000',
) {
  const playerAccount =
    await harness.container.services.playerAccountProvisioningService.provisionIfNeeded(
      {
        idempotencyKey: toIdempotencyKey(`real-pg-provision-${userId}`),
        userId: toUserId(userId),
        currency: 'USDC',
        correlationId: `corr_real_pg_provision_${userId}`,
        causationId: `cause_real_pg_provision_${userId}`,
      },
    )
  const depositSource = await harness.container.services.accountService.createAccount({
    accountType: 'deposit_clearing',
    ownerType: 'platform',
    ownerId: toOwnerId(`real-pg-deposit-source-${userId}`),
    currency: 'USDC',
    correlationId: `corr_real_pg_deposit_source_${userId}`,
    causationId: `cause_real_pg_deposit_source_${userId}`,
    idempotencyKey: toIdempotencyKey(`real-pg-deposit-source-${userId}`),
  })

  await harness.container.services.postingEngineService.postTransfer({
    idempotencyKey: toIdempotencyKey(`real-pg-fund-player-${userId}`),
    transactionType: 'deposit_confirmed_credit',
    referenceType: 'deposit',
    referenceId: `real-pg-deposit-${userId}`,
    debitAccountId: depositSource.accountId,
    creditAccountId: playerAccount.availableAccountId,
    amountMinor,
    currency: 'USDC',
    correlationId: `corr_real_pg_fund_${userId}`,
    causationId: `cause_real_pg_fund_${userId}`,
  })
}

async function provisionPlayerAccount(harness: DrillHarness, userId: string) {
  return harness.container.services.playerAccountProvisioningService.provisionIfNeeded(
    {
      idempotencyKey: toIdempotencyKey(`real-pg-ops-provision-${userId}`),
      userId: toUserId(userId),
      currency: 'USDC',
      correlationId: `corr_real_pg_ops_provision_${userId}`,
      causationId: `cause_real_pg_ops_provision_${userId}`,
    },
  )
}

async function insertOperationalUnreservedWithdrawal(
  harness: DrillHarness,
  input: {
    withdrawalRequestId: string
    playerId: string
    playerAccountId: string
  },
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
        $2,
        $3,
        'USDC',
        1000,
        'simulated_external_account',
        $1 || '-destination',
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
    [input.withdrawalRequestId, input.playerId, input.playerAccountId],
  )
}

async function operationalDiscrepancyCount(
  harness: DrillHarness,
  category: string,
) {
  const result = await harness.database.query<{ count: number }>(
    `
      SELECT count(*)::int AS count
      FROM operational_discrepancies
      WHERE category = $1
    `,
    [category],
  )

  return result.rows[0]?.count ?? 0
}

async function createRealPgWithdrawal(
  harness: DrillHarness,
  userId: string,
  idempotencyKey: string,
  amountMinorUnits = '1000',
) {
  return request(harness.app)
    .post('/withdrawal-requests')
    .set({
      'x-nines-authenticated-user-id': userId,
      ...stateHeaders(idempotencyKey),
    })
    .send({
      amountMinorUnits,
      currency: 'USDC',
      destinationKind: 'simulated_external_account',
      destinationReference: `real-pg-withdrawal-destination-${idempotencyKey}`,
      provider: 'simulated',
    })
}

async function withdrawalTransactionCount(
  harness: DrillHarness,
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

async function withdrawalProviderSubmissionCount(harness: DrillHarness) {
  const result = await harness.database.query<{ count: number }>(
    `
      SELECT count(*)::int AS count
      FROM withdrawal_provider_submissions
    `,
  )

  return result.rows[0]?.count ?? 0
}

async function withdrawalWebhookReceiptCount(harness: DrillHarness) {
  const result = await harness.database.query<{ count: number }>(
    `
      SELECT count(*)::int AS count
      FROM withdrawal_provider_webhook_receipts
    `,
  )

  return result.rows[0]?.count ?? 0
}

async function createPool(
  harness: DrillHarness,
  raceId: string,
  selectionIds: string[],
  bettingOpensAt = '2026-04-22T12:00:00.000Z',
) {
  await request(harness.app)
    .post('/commands/create-race-pool')
    .send({
      idempotencyKey: `real-pg-pool-${raceId}`,
      correlationId: `corr_real_pg_pool_${raceId}`,
      causationId: `cause_real_pg_pool_${raceId}`,
      raceId,
      currency: 'USDC',
      bettingOpensAt,
    })

  for (const selectionId of selectionIds) {
    await request(harness.app)
      .post('/commands/register-pool-selection')
      .send({
        idempotencyKey: `real-pg-selection-${raceId}-${selectionId}`,
        correlationId: `corr_real_pg_selection_${raceId}_${selectionId}`,
        causationId: `cause_real_pg_selection_${raceId}_${selectionId}`,
        raceId,
        selectionId,
        currency: 'USDC',
      })
  }
}

async function placeBet(
  harness: DrillHarness,
  input: {
    raceId: string
    betId: string
    userId: string
    selectionId: string
    stakeMinor: string
  },
) {
  await fundPlayer(harness, input.userId, input.stakeMinor)

  await request(harness.app)
    .post('/commands/place-bet')
    .send({
      idempotencyKey: `real-pg-place-${input.betId}`,
      correlationId: `corr_real_pg_place_${input.betId}`,
      causationId: `cause_real_pg_place_${input.betId}`,
      betId: input.betId,
      userId: input.userId,
      raceId: input.raceId,
      selectionId: input.selectionId,
      stakeMinor: input.stakeMinor,
      currency: 'USDC',
    })
}

async function freezePool(harness: DrillHarness, raceId: string) {
  await request(harness.app)
    .post('/commands/freeze-pool')
    .send({
      idempotencyKey: `real-pg-freeze-${raceId}`,
      correlationId: `corr_real_pg_freeze_${raceId}`,
      causationId: `cause_real_pg_freeze_${raceId}`,
      raceId,
      currency: 'USDC',
      reasonCode: 'race_finished',
    })
}

async function setupSettlementRace(harness: DrillHarness, raceId: string) {
  await createPool(harness, raceId, ['horse-1', 'horse-2'])
  await placeBet(harness, {
    raceId,
    betId: `${raceId}-winner`,
    userId: `${raceId}-player-winner`,
    selectionId: 'horse-1',
    stakeMinor: '1000',
  })
  await placeBet(harness, {
    raceId,
    betId: `${raceId}-loser`,
    userId: `${raceId}-player-loser`,
    selectionId: 'horse-2',
    stakeMinor: '1000',
  })
  await freezePool(harness, raceId)
}

async function createPendingCarryover(harness: DrillHarness, sourceRaceId: string) {
  await createPool(
    harness,
    sourceRaceId,
    ['horse-loser', 'horse-winner'],
    '2026-04-22T11:59:00.000Z',
  )
  await placeBet(harness, {
    raceId: sourceRaceId,
    betId: `${sourceRaceId}-loser`,
    userId: `${sourceRaceId}-player-loser`,
    selectionId: 'horse-loser',
    stakeMinor: '1000',
  })
  await freezePool(harness, sourceRaceId)

  await request(harness.app)
    .post('/commands/settle-bet')
    .send({
      idempotencyKey: `real-pg-settle-${sourceRaceId}`,
      correlationId: `corr_real_pg_settle_${sourceRaceId}`,
      causationId: `cause_real_pg_settle_${sourceRaceId}`,
      raceId: sourceRaceId,
      winningSelectionId: 'horse-winner',
      houseTakeBps: 1000,
      currency: 'USDC',
    })
}

function expectSafeConcurrentStatuses(responses: Array<{ status: number }>) {
  expect(
    responses.every(
      (response) =>
        response.status === 200 ||
        response.status === 201 ||
        response.status === 409,
    ),
  ).toBe(true)
}

describe.skipIf(!realPostgresDrillsEnabled())(
  'real PostgreSQL production drills',
  () => {
    let harness: DrillHarness | undefined

    afterEach(async () => {
      if (harness) {
        await harness.close()
        harness = undefined
      }
    })

    it('credits one deposit under concurrent identical signed callbacks', async () => {
      harness = await createRealPostgresTestApplication()
      const intent = await createRealPgDepositIntent(
        harness,
        'real-pg-deposit-player',
        'real-pg-deposit-intent-identical',
      )
      const body = {
        providerEventId: 'real-pg-provider-event-identical',
        externalTransactionId: 'real-pg-external-tx-identical',
        depositIntentId: intent.body.depositIntentId,
        destinationReference: intent.body.destinationReference,
        amountMinor: '1000',
        currency: 'USDC',
        confirmed: true,
        confirmationCount: 6,
      }

      const responses = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          postSignedDepositWebhook(
            harness!,
            body,
            `real-pg-deposit-identical-${index}`,
          ),
        ),
      )
      const creditedEvents = await harness.database.query<{ count: number }>(
        `
          SELECT count(*)::int AS count
          FROM provider_deposit_events
          WHERE external_transaction_id = 'real-pg-external-tx-identical'
            AND status = 'credited'
        `,
      )

      expectSafeConcurrentStatuses(responses)
      expect(responses.some((response) => response.body.credited === true)).toBe(
        true,
      )
      expect(creditedEvents.rows[0]?.count).toBe(1)
      expect(await depositCreditCount(harness)).toBe(1)
    })

    it('credits one deposit when concurrent provider event IDs share an external transaction', async () => {
      harness = await createRealPostgresTestApplication()
      const firstIntent = await createRealPgDepositIntent(
        harness,
        'real-pg-deposit-player-shared-1',
        'real-pg-deposit-intent-shared-1',
      )
      const secondIntent = await createRealPgDepositIntent(
        harness,
        'real-pg-deposit-player-shared-2',
        'real-pg-deposit-intent-shared-2',
      )
      const bodies = [
        {
          providerEventId: 'real-pg-provider-event-shared-1',
          externalTransactionId: 'real-pg-external-tx-shared',
          depositIntentId: firstIntent.body.depositIntentId,
          destinationReference: firstIntent.body.destinationReference,
          amountMinor: '1000',
          currency: 'USDC',
          confirmed: true,
          confirmationCount: 6,
        },
        {
          providerEventId: 'real-pg-provider-event-shared-2',
          externalTransactionId: 'real-pg-external-tx-shared',
          depositIntentId: secondIntent.body.depositIntentId,
          destinationReference: secondIntent.body.destinationReference,
          amountMinor: '1000',
          currency: 'USDC',
          confirmed: true,
          confirmationCount: 6,
        },
      ]

      const responses = await Promise.all(
        bodies.map((body, index) =>
          postSignedDepositWebhook(
            harness!,
            body,
            `real-pg-deposit-shared-${index}`,
          ),
        ),
      )
      const creditedEvents = await harness.database.query<{ count: number }>(
        `
          SELECT count(*)::int AS count
          FROM provider_deposit_events
          WHERE external_transaction_id = 'real-pg-external-tx-shared'
            AND status = 'credited'
        `,
      )

      expectSafeConcurrentStatuses(responses)
      expect(creditedEvents.rows[0]?.count).toBe(1)
      expect(await depositCreditCount(harness)).toBe(1)
    })

    it('retries deposit credit after interruption before ledger posting', async () => {
      harness = await createRealPostgresTestApplication({
        faultInjector: new OneShotFaultInjector(
          'deposit.after_event_record_before_credit',
        ),
      })
      const intent = await createRealPgDepositIntent(
        harness,
        'real-pg-deposit-player-before-ledger',
        'real-pg-deposit-intent-before-ledger',
      )
      const body = {
        providerEventId: 'real-pg-provider-event-before-ledger',
        externalTransactionId: 'real-pg-external-tx-before-ledger',
        depositIntentId: intent.body.depositIntentId,
        destinationReference: intent.body.destinationReference,
        amountMinor: '1000',
        currency: 'USDC',
        confirmed: true,
      }

      const interrupted = await postSignedDepositWebhook(
        harness,
        body,
        'real-pg-deposit-before-ledger',
      )
      const retry = await postSignedDepositWebhook(
        harness,
        body,
        'real-pg-deposit-before-ledger-retry',
      )

      expect(interrupted.status).toBe(500)
      expect(interrupted.body.error.code).toBe('SIMULATED_PROCESS_INTERRUPT')
      expect(retry.status).toBe(201)
      expect(retry.body.credited).toBe(true)
      expect(await depositCreditCount(harness)).toBe(1)
    })

    it('rolls back deposit ledger posting interruption and retries without double credit', async () => {
      harness = await createRealPostgresTestApplication({
        faultInjector: new OneShotFaultInjector(
          'deposit.after_ledger_posting_before_state_finalization',
        ),
      })
      const intent = await createRealPgDepositIntent(
        harness,
        'real-pg-deposit-player-after-ledger',
        'real-pg-deposit-intent-after-ledger',
      )
      const body = {
        providerEventId: 'real-pg-provider-event-after-ledger',
        externalTransactionId: 'real-pg-external-tx-after-ledger',
        depositIntentId: intent.body.depositIntentId,
        destinationReference: intent.body.destinationReference,
        amountMinor: '1000',
        currency: 'USDC',
        confirmed: true,
      }

      const interrupted = await postSignedDepositWebhook(
        harness,
        body,
        'real-pg-deposit-after-ledger',
      )
      const rolledBackPostings = await depositCreditCount(harness)
      const retry = await postSignedDepositWebhook(
        harness,
        body,
        'real-pg-deposit-after-ledger-retry',
      )
      const replay = await postSignedDepositWebhook(
        harness,
        body,
        'real-pg-deposit-after-ledger-replay',
      )

      expect(interrupted.status).toBe(500)
      expect(interrupted.body.error.code).toBe('SIMULATED_PROCESS_INTERRUPT')
      expect(rolledBackPostings).toBe(0)
      expect(retry.status).toBe(201)
      expect(replay.status).toBe(201)
      expect(await depositCreditCount(harness)).toBe(1)
    })

    it('keeps operator retry credit idempotent under concurrent calls', async () => {
      harness = await createRealPostgresTestApplication()
      const intent = await createRealPgDepositIntent(
        harness,
        'real-pg-deposit-player-operator-retry',
        'real-pg-deposit-intent-operator-retry',
      )
      const review = await request(harness.app)
        .post('/provider-events/deposits')
        .set(depositOperatorHeaders('real-pg-review-event-operator-retry'))
        .send({
          providerEventId: 'real-pg-provider-event-operator-retry',
          provider: 'simulated',
          externalTransactionId: 'real-pg-external-tx-operator-retry',
          destinationReference: 'real-pg-unknown-operator-retry',
          amountMinor: '1000',
          currency: 'USDC',
          confirmed: true,
        })
      await request(harness.app)
        .post(
          `/deposits/provider-events/${review.body.providerEvent.depositEventId}/link-intent`,
        )
        .set(depositOperatorHeaders('real-pg-link-operator-retry'))
        .send({
          depositIntentId: intent.body.depositIntentId,
        })

      const responses = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          request(harness!.app)
            .post(
              `/deposits/provider-events/${review.body.providerEvent.depositEventId}/retry-credit`,
            )
            .set(depositOperatorHeaders(`real-pg-retry-credit-${index}`))
            .send({}),
        ),
      )

      expectSafeConcurrentStatuses(responses)
      expect(responses.some((response) => response.body.credited === true)).toBe(
        true,
      )
      expect(await depositCreditCount(harness)).toBe(1)
    })

    it('reserves one withdrawal under concurrent duplicate create requests', async () => {
      harness = await createRealPostgresTestApplication()
      await fundPlayer(harness, 'real-pg-withdrawal-player-duplicate', '5000')

      const responses = await Promise.all(
        Array.from({ length: 6 }, () =>
          createRealPgWithdrawal(
            harness!,
            'real-pg-withdrawal-player-duplicate',
            'real-pg-withdrawal-create-duplicate',
          ),
        ),
      )

      expectSafeConcurrentStatuses(responses)
      expect(
        responses.some((response) => response.body.status === 'reserved'),
      ).toBe(true)
      expect(await withdrawalTransactionCount(harness, 'withdrawal_reserve')).toBe(
        1,
      )
    })

    it('releases one withdrawal reservation under concurrent cancel calls', async () => {
      harness = await createRealPostgresTestApplication()
      await fundPlayer(harness, 'real-pg-withdrawal-player-cancel', '5000')
      const created = await createRealPgWithdrawal(
        harness,
        'real-pg-withdrawal-player-cancel',
        'real-pg-withdrawal-create-cancel',
      )

      const responses = await Promise.all(
        Array.from({ length: 6 }, () =>
          request(harness!.app)
            .post(
              `/withdrawal-requests/${created.body.withdrawalRequestId}/cancel`,
            )
            .set({
              'x-nines-authenticated-user-id':
                'real-pg-withdrawal-player-cancel',
              ...stateHeaders('real-pg-withdrawal-cancel-concurrent'),
            })
            .send({ reason: 'Concurrent cancel drill' }),
        ),
      )

      expectSafeConcurrentStatuses(responses)
      expect(await withdrawalTransactionCount(harness, 'withdrawal_reversal')).toBe(
        1,
      )
    })

    it('keeps concurrent withdrawal approvals idempotent without external submission', async () => {
      harness = await createRealPostgresTestApplication()
      await fundPlayer(harness, 'real-pg-withdrawal-player-approve', '5000')
      const created = await createRealPgWithdrawal(
        harness,
        'real-pg-withdrawal-player-approve',
        'real-pg-withdrawal-create-approve',
      )

      const responses = await Promise.all(
        Array.from({ length: 6 }, () =>
          request(harness!.app)
            .post(
              `/withdrawal-requests/${created.body.withdrawalRequestId}/approve`,
            )
            .set(
              withdrawalOperatorHeaders(
                'real-pg-withdrawal-approve-concurrent',
                'treasury_admin',
              ),
            )
            .send({ reason: 'Concurrent approval drill' }),
        ),
      )

      expectSafeConcurrentStatuses(responses)
      expect(
        responses.some(
          (response) => response.body.status === 'submission_pending',
        ),
      ).toBe(true)
      expect(await withdrawalTransactionCount(harness, 'withdrawal_complete')).toBe(
        0,
      )
    })

    it('creates one simulated provider submission under concurrent submit attempts', async () => {
      harness = await createRealPostgresTestApplication()
      await fundPlayer(harness, 'real-pg-withdrawal-player-submit', '5000')
      const created = await createRealPgWithdrawal(
        harness,
        'real-pg-withdrawal-player-submit',
        'real-pg-withdrawal-create-submit',
      )
      await request(harness.app)
        .post(`/withdrawal-requests/${created.body.withdrawalRequestId}/approve`)
        .set(
          withdrawalOperatorHeaders(
            'real-pg-withdrawal-approve-submit',
            'treasury_admin',
          ),
        )
        .send({ reason: 'Approve for concurrent submit drill' })

      const responses = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          request(harness!.app)
            .post(`/withdrawal-requests/${created.body.withdrawalRequestId}/submit`)
            .set(
              withdrawalOperatorHeaders(
                `real-pg-withdrawal-submit-concurrent-${index}`,
                'treasury_admin',
              ),
            )
            .send({ submissionNote: 'Concurrent simulated submit drill' }),
        ),
      )

      expectSafeConcurrentStatuses(responses)
      expect(
        responses.some(
          (response) => response.body.status === 'provider_pending',
        ),
      ).toBe(true)
      expect(await withdrawalProviderSubmissionCount(harness)).toBe(1)
      expect(await withdrawalTransactionCount(harness, 'withdrawal_complete')).toBe(
        0,
      )
    })

    it('keeps provider status sync retry idempotent without finalizing funds', async () => {
      harness = await createRealPostgresTestApplication()
      await fundPlayer(harness, 'real-pg-withdrawal-player-sync', '5000')
      const created = await createRealPgWithdrawal(
        harness,
        'real-pg-withdrawal-player-sync',
        'real-pg-withdrawal-create-sync',
      )
      await request(harness.app)
        .post(`/withdrawal-requests/${created.body.withdrawalRequestId}/approve`)
        .set(
          withdrawalOperatorHeaders(
            'real-pg-withdrawal-approve-sync',
            'treasury_admin',
          ),
        )
        .send({ reason: 'Approve for sync drill' })
      await request(harness.app)
        .post(`/withdrawal-requests/${created.body.withdrawalRequestId}/submit`)
        .set(
          withdrawalOperatorHeaders(
            'real-pg-withdrawal-submit-sync',
            'treasury_admin',
          ),
        )
        .send({ submissionNote: 'Submit before sync drill' })

      const responses = await Promise.all(
        Array.from({ length: 6 }, () =>
          request(harness!.app)
            .post(
              `/withdrawal-requests/${created.body.withdrawalRequestId}/sync-provider-status`,
            )
            .set(
              withdrawalOperatorHeaders(
                'real-pg-withdrawal-sync-concurrent',
                'treasury_operator',
              ),
            )
            .send({
              reason: 'Concurrent simulated status sync drill',
              simulatedProviderStatus: 'confirmed',
            }),
        ),
      )

      expectSafeConcurrentStatuses(responses)
      expect(
        responses.some(
          (response) => response.body.status === 'provider_confirmed',
        ),
      ).toBe(true)
      expect(await withdrawalProviderSubmissionCount(harness)).toBe(1)
      expect(await withdrawalTransactionCount(harness, 'withdrawal_complete')).toBe(
        0,
      )
    })

    it('accepts concurrent withdrawal provider callbacks once per nonce without finalizing funds', async () => {
      harness = await createRealPostgresTestApplication()
      await fundPlayer(harness, 'real-pg-withdrawal-player-webhook', '5000')
      const created = await createRealPgWithdrawal(
        harness,
        'real-pg-withdrawal-player-webhook',
        'real-pg-withdrawal-create-webhook',
      )
      await request(harness.app)
        .post(`/withdrawal-requests/${created.body.withdrawalRequestId}/approve`)
        .set(
          withdrawalOperatorHeaders(
            'real-pg-withdrawal-approve-webhook',
            'treasury_admin',
          ),
        )
        .send({ reason: 'Approve for provider webhook drill' })
      const submitted = await request(harness.app)
        .post(`/withdrawal-requests/${created.body.withdrawalRequestId}/submit`)
        .set(
          withdrawalOperatorHeaders(
            'real-pg-withdrawal-submit-webhook',
            'treasury_admin',
          ),
        )
        .send({ submissionNote: 'Submit before provider webhook drill' })
      const body = {
        withdrawalRequestId: created.body.withdrawalRequestId,
        externalWithdrawalId:
          submitted.body.providerSubmission.externalWithdrawalId,
        externalTransactionId:
          submitted.body.providerSubmission.externalTransactionId,
        providerStatus: 'confirmed',
      }
      const timestamp = '2026-04-22T12:00:00.000Z'
      const nonce = 'real-pg-withdrawal-webhook-concurrent'
      const signature = signWithdrawalWebhook(body, timestamp, nonce)

      const responses = await Promise.all(
        Array.from({ length: 6 }, () =>
          request(harness!.app)
            .post('/provider-events/withdrawals/webhook/simulated')
            .set({
              'x-nines-provider-timestamp': timestamp,
              'x-nines-provider-nonce': nonce,
              'x-nines-provider-signature': signature,
            })
            .send(body),
        ),
      )

      expect(
        responses.filter((response) => response.status === 202),
      ).toHaveLength(1)
      expect(
        responses.filter((response) => response.status === 403).length,
      ).toBeGreaterThanOrEqual(1)
      expect(await withdrawalWebhookReceiptCount(harness)).toBeGreaterThanOrEqual(1)
      expect(await withdrawalTransactionCount(harness, 'withdrawal_finalized')).toBe(
        0,
      )
    })

    it('detects withdrawal provider event drift from webhooks', async () => {
      harness = await createRealPostgresTestApplication()

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
          VALUES (
            'wd_wh_real_pg_drift',
            'simulated',
            'real-pg-drift-nonce',
            '2026-04-22T12:00:00.000Z',
            '2026-04-22T12:00:00.000Z',
            'real-pg-drift-hash',
            'hmac-sha256-v1',
            'sim_wd_real_pg_drift',
            'sim_tx_real_pg_drift',
            NULL,
            'accepted',
            NULL
          )
        `,
      )

      const response = await request(harness.app)
        .get('/admin/operations/withdrawals/reconciliation')
        .set(withdrawalOperatorHeaders('real-pg-withdrawal-webhook-reconcile'))
      const codes = response.body.reconciliation.issues.map(
        (issue: { code: string }) => issue.code,
      )

      expect(response.status).toBe(200)
      expect(codes).toContain('provider_webhook_receipt_missing_event')
    })

    it('retries simulated provider submission after interruption without duplicate provider references', async () => {
      harness = await createRealPostgresTestApplication({
        faultInjector: new OneShotFaultInjector(
          'withdrawal.after_provider_submission_persisted_before_state_update',
        ),
      })
      await fundPlayer(harness, 'real-pg-withdrawal-player-submit-retry', '5000')
      const created = await createRealPgWithdrawal(
        harness,
        'real-pg-withdrawal-player-submit-retry',
        'real-pg-withdrawal-create-submit-retry',
      )
      await request(harness.app)
        .post(`/withdrawal-requests/${created.body.withdrawalRequestId}/approve`)
        .set(
          withdrawalOperatorHeaders(
            'real-pg-withdrawal-approve-submit-retry',
            'treasury_admin',
          ),
        )
        .send({ reason: 'Approve for submit retry drill' })

      const interrupted = await request(harness.app)
        .post(`/withdrawal-requests/${created.body.withdrawalRequestId}/submit`)
        .set(
          withdrawalOperatorHeaders(
            'real-pg-withdrawal-submit-retry-first',
            'treasury_admin',
          ),
        )
        .send({ submissionNote: 'Interrupted simulated submit drill' })
      const retry = await request(harness.app)
        .post(`/withdrawal-requests/${created.body.withdrawalRequestId}/submit`)
        .set(
          withdrawalOperatorHeaders(
            'real-pg-withdrawal-submit-retry-second',
            'treasury_admin',
          ),
        )
        .send({ submissionNote: 'Retry simulated submit drill' })

      expect(interrupted.status).toBe(500)
      expect(interrupted.body.error.code).toBe('SIMULATED_PROCESS_INTERRUPT')
      expect(retry.status).toBe(200)
      expect(retry.body.status).toBe('provider_pending')
      expect(await withdrawalProviderSubmissionCount(harness)).toBe(1)
    })

    it('detects stuck submitting and provider pending withdrawal states', async () => {
      harness = await createRealPostgresTestApplication()
      await fundPlayer(harness, 'real-pg-withdrawal-player-reconcile', '5000')
      const created = await createRealPgWithdrawal(
        harness,
        'real-pg-withdrawal-player-reconcile',
        'real-pg-withdrawal-create-reconcile',
      )
      await request(harness.app)
        .post(`/withdrawal-requests/${created.body.withdrawalRequestId}/approve`)
        .set(
          withdrawalOperatorHeaders(
            'real-pg-withdrawal-approve-reconcile',
            'treasury_admin',
          ),
        )
        .send({ reason: 'Approve for reconciliation drill' })
      await request(harness.app)
        .post(`/withdrawal-requests/${created.body.withdrawalRequestId}/submit`)
        .set(
          withdrawalOperatorHeaders(
            'real-pg-withdrawal-submit-reconcile',
            'treasury_admin',
          ),
        )
        .send({ submissionNote: 'Submit before reconciliation drill' })
      await harness.database.query(
        `
          UPDATE withdrawal_requests
          SET updated_at = '2026-04-22T10:00:00.000Z'
          WHERE withdrawal_request_id = $1
        `,
        [created.body.withdrawalRequestId],
      )
      const stuckSubmitting = await createRealPgWithdrawal(
        harness,
        'real-pg-withdrawal-player-reconcile',
        'real-pg-withdrawal-create-reconcile-submitting',
      )
      await request(harness.app)
        .post(`/withdrawal-requests/${stuckSubmitting.body.withdrawalRequestId}/approve`)
        .set(
          withdrawalOperatorHeaders(
            'real-pg-withdrawal-approve-reconcile-submitting',
            'treasury_admin',
          ),
        )
        .send({ reason: 'Approve for stuck submitting reconciliation drill' })
      await harness.database.query(
        `
          UPDATE withdrawal_requests
          SET status = 'submitting',
              updated_at = '2026-04-22T10:00:00.000Z'
          WHERE withdrawal_request_id = $1
        `,
        [stuckSubmitting.body.withdrawalRequestId],
      )

      const response = await request(harness.app)
        .get('/admin/operations/withdrawals/reconciliation')
        .set(withdrawalOperatorHeaders('real-pg-withdrawal-reconcile'))
      const codes = response.body.reconciliation.issues.map(
        (issue: { code: string }) => issue.code,
      )

      expect(response.status).toBe(200)
      expect(codes).toContain('submitting_withdrawal_stuck')
      expect(codes).toContain('provider_pending_not_recently_synced')
    })

    it('finalizes one confirmed withdrawal under concurrent finalize attempts', async () => {
      harness = await createRealPostgresTestApplication()
      await fundPlayer(harness, 'real-pg-withdrawal-player-finalize', '5000')
      const created = await createRealPgWithdrawal(
        harness,
        'real-pg-withdrawal-player-finalize',
        'real-pg-withdrawal-create-finalize',
      )
      await request(harness.app)
        .post(`/withdrawal-requests/${created.body.withdrawalRequestId}/approve`)
        .set(
          withdrawalOperatorHeaders(
            'real-pg-withdrawal-approve-finalize',
            'treasury_admin',
          ),
        )
        .send({ reason: 'Approve for finalization drill' })
      await request(harness.app)
        .post(`/withdrawal-requests/${created.body.withdrawalRequestId}/submit`)
        .set(
          withdrawalOperatorHeaders(
            'real-pg-withdrawal-submit-finalize',
            'treasury_admin',
          ),
        )
        .send({ submissionNote: 'Submit before finalization drill' })
      await request(harness.app)
        .post(
          `/withdrawal-requests/${created.body.withdrawalRequestId}/sync-provider-status`,
        )
        .set(withdrawalOperatorHeaders('real-pg-withdrawal-sync-finalize'))
        .send({
          reason: 'Confirm simulated provider status',
          simulatedProviderStatus: 'confirmed',
        })

      const responses = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          request(harness!.app)
            .post(`/withdrawal-requests/${created.body.withdrawalRequestId}/finalize`)
            .set(
              withdrawalOperatorHeaders(
                `real-pg-withdrawal-finalize-concurrent-${index}`,
                'treasury_admin',
              ),
            )
            .send({ reason: 'Concurrent finalization drill' }),
        ),
      )

      expectSafeConcurrentStatuses(responses)
      expect(
        responses.some((response) => response.body.status === 'completed'),
      ).toBe(true)
      expect(await withdrawalTransactionCount(harness, 'withdrawal_finalized')).toBe(
        1,
      )
    })

    it('retries finalization after interruption without double posting', async () => {
      harness = await createRealPostgresTestApplication({
        faultInjector: new OneShotFaultInjector(
          'withdrawal.after_finalization_ledger_posted_before_state_update',
        ),
      })
      await fundPlayer(harness, 'real-pg-withdrawal-player-finalize-retry', '5000')
      const created = await createRealPgWithdrawal(
        harness,
        'real-pg-withdrawal-player-finalize-retry',
        'real-pg-withdrawal-create-finalize-retry',
      )
      await request(harness.app)
        .post(`/withdrawal-requests/${created.body.withdrawalRequestId}/approve`)
        .set(
          withdrawalOperatorHeaders(
            'real-pg-withdrawal-approve-finalize-retry',
            'treasury_admin',
          ),
        )
        .send({ reason: 'Approve for finalization retry drill' })
      await request(harness.app)
        .post(`/withdrawal-requests/${created.body.withdrawalRequestId}/submit`)
        .set(
          withdrawalOperatorHeaders(
            'real-pg-withdrawal-submit-finalize-retry',
            'treasury_admin',
          ),
        )
        .send({ submissionNote: 'Submit before finalization retry drill' })
      await request(harness.app)
        .post(
          `/withdrawal-requests/${created.body.withdrawalRequestId}/sync-provider-status`,
        )
        .set(withdrawalOperatorHeaders('real-pg-withdrawal-sync-finalize-retry'))
        .send({
          reason: 'Confirm simulated provider status',
          simulatedProviderStatus: 'confirmed',
        })

      const interrupted = await request(harness.app)
        .post(`/withdrawal-requests/${created.body.withdrawalRequestId}/finalize`)
        .set(
          withdrawalOperatorHeaders(
            'real-pg-withdrawal-finalize-retry-first',
            'treasury_admin',
          ),
        )
        .send({ reason: 'Interrupted finalization drill' })
      const retry = await request(harness.app)
        .post(`/withdrawal-requests/${created.body.withdrawalRequestId}/finalize`)
        .set(
          withdrawalOperatorHeaders(
            'real-pg-withdrawal-finalize-retry-second',
            'treasury_admin',
          ),
        )
        .send({ reason: 'Retry finalization drill' })

      expect(interrupted.status).toBe(500)
      expect(interrupted.body.error.code).toBe('SIMULATED_PROCESS_INTERRUPT')
      expect(retry.status).toBe(200)
      expect(retry.body.status).toBe('completed')
      expect(await withdrawalTransactionCount(harness, 'withdrawal_finalized')).toBe(
        1,
      )
    })

    it('releases one provider failure under concurrent resolution attempts', async () => {
      harness = await createRealPostgresTestApplication()
      await fundPlayer(harness, 'real-pg-withdrawal-player-failure-release', '5000')
      const created = await createRealPgWithdrawal(
        harness,
        'real-pg-withdrawal-player-failure-release',
        'real-pg-withdrawal-create-failure-release',
      )
      await request(harness.app)
        .post(`/withdrawal-requests/${created.body.withdrawalRequestId}/approve`)
        .set(
          withdrawalOperatorHeaders(
            'real-pg-withdrawal-approve-failure-release',
            'treasury_admin',
          ),
        )
        .send({ reason: 'Approve for failure release drill' })
      await request(harness.app)
        .post(`/withdrawal-requests/${created.body.withdrawalRequestId}/submit`)
        .set(
          withdrawalOperatorHeaders(
            'real-pg-withdrawal-submit-failure-release',
            'treasury_admin',
          ),
        )
        .send({ submissionNote: 'Submit before failure release drill' })
      await request(harness.app)
        .post(
          `/withdrawal-requests/${created.body.withdrawalRequestId}/sync-provider-status`,
        )
        .set(withdrawalOperatorHeaders('real-pg-withdrawal-sync-failure-release'))
        .send({
          reason: 'Fail simulated provider status',
          simulatedProviderStatus: 'failed',
        })

      const responses = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          request(harness!.app)
            .post(
              `/withdrawal-requests/${created.body.withdrawalRequestId}/release-after-provider-failure`,
            )
            .set(
              withdrawalOperatorHeaders(
                `real-pg-withdrawal-failure-release-concurrent-${index}`,
                'treasury_admin',
              ),
            )
            .send({ reason: 'Concurrent failure release drill' }),
        ),
      )

      expectSafeConcurrentStatuses(responses)
      expect(
        responses.some(
          (response) => response.body.status === 'provider_failure_released',
        ),
      ).toBe(true)
      expect(await withdrawalTransactionCount(
        harness,
        'withdrawal_provider_failure_release',
      )).toBe(1)
    })

    it('retries provider failure release after interruption without double posting', async () => {
      harness = await createRealPostgresTestApplication({
        faultInjector: new OneShotFaultInjector(
          'withdrawal.after_provider_failure_release_posted_before_state_update',
        ),
      })
      await fundPlayer(harness, 'real-pg-withdrawal-player-failure-release-retry', '5000')
      const created = await createRealPgWithdrawal(
        harness,
        'real-pg-withdrawal-player-failure-release-retry',
        'real-pg-withdrawal-create-failure-release-retry',
      )
      await request(harness.app)
        .post(`/withdrawal-requests/${created.body.withdrawalRequestId}/approve`)
        .set(
          withdrawalOperatorHeaders(
            'real-pg-withdrawal-approve-failure-release-retry',
            'treasury_admin',
          ),
        )
        .send({ reason: 'Approve for failure release retry drill' })
      await request(harness.app)
        .post(`/withdrawal-requests/${created.body.withdrawalRequestId}/submit`)
        .set(
          withdrawalOperatorHeaders(
            'real-pg-withdrawal-submit-failure-release-retry',
            'treasury_admin',
          ),
        )
        .send({ submissionNote: 'Submit before failure release retry drill' })
      await request(harness.app)
        .post(
          `/withdrawal-requests/${created.body.withdrawalRequestId}/sync-provider-status`,
        )
        .set(
          withdrawalOperatorHeaders(
            'real-pg-withdrawal-sync-failure-release-retry',
          ),
        )
        .send({
          reason: 'Fail simulated provider status',
          simulatedProviderStatus: 'failed',
        })

      const interrupted = await request(harness.app)
        .post(
          `/withdrawal-requests/${created.body.withdrawalRequestId}/release-after-provider-failure`,
        )
        .set(
          withdrawalOperatorHeaders(
            'real-pg-withdrawal-failure-release-retry-first',
            'treasury_admin',
          ),
        )
        .send({ reason: 'Interrupted failure release drill' })
      const retry = await request(harness.app)
        .post(
          `/withdrawal-requests/${created.body.withdrawalRequestId}/release-after-provider-failure`,
        )
        .set(
          withdrawalOperatorHeaders(
            'real-pg-withdrawal-failure-release-retry-second',
            'treasury_admin',
          ),
        )
        .send({ reason: 'Retry failure release drill' })

      expect(interrupted.status).toBe(500)
      expect(interrupted.body.error.code).toBe('SIMULATED_PROCESS_INTERRUPT')
      expect(retry.status).toBe(200)
      expect(retry.body.status).toBe('provider_failure_released')
      expect(await withdrawalTransactionCount(
        harness,
        'withdrawal_provider_failure_release',
      )).toBe(1)
    })

    it('materializes one operational discrepancy under concurrent reconciliation scans', async () => {
      harness = await createRealPostgresTestApplication()
      const playerAccount = await provisionPlayerAccount(
        harness,
        'real-pg-ops-player-reconcile',
      )
      await insertOperationalUnreservedWithdrawal(harness, {
        withdrawalRequestId: 'wd_req_real_pg_ops_unreserved',
        playerId: 'real-pg-ops-player-reconcile',
        playerAccountId: playerAccount.playerAccountId,
      })

      const responses = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          request(harness!.app)
            .post('/admin/operations/reconciliation/run')
            .set(
              operationsOperatorHeaders(
                `real-pg-ops-reconcile-concurrent-${index}`,
              ),
            )
            .send({}),
        ),
      )

      expectSafeConcurrentStatuses(responses)
      expect(
        responses.some((response) => response.body.reconciliation.openedCount >= 1),
      ).toBe(true)
      expect(
        await operationalDiscrepancyCount(
          harness,
          'withdrawal.requested_without_reservation',
        ),
      ).toBe(1)
    })

    it('serializes concurrent discrepancy workflow actions on one issue', async () => {
      harness = await createRealPostgresTestApplication()
      const playerAccount = await provisionPlayerAccount(
        harness,
        'real-pg-ops-player-workflow',
      )
      await insertOperationalUnreservedWithdrawal(harness, {
        withdrawalRequestId: 'wd_req_real_pg_ops_workflow',
        playerId: 'real-pg-ops-player-workflow',
        playerAccountId: playerAccount.playerAccountId,
      })
      await request(harness.app)
        .post('/admin/operations/reconciliation/run')
        .set(operationsOperatorHeaders('real-pg-ops-workflow-run'))
        .send({})
      const list = await request(harness.app)
        .get('/admin/operations/discrepancies')
        .set(operationsOperatorHeaders('real-pg-ops-workflow-list'))
      const discrepancyId = list.body.discrepancies[0].discrepancyId

      const responses = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          request(harness!.app)
            .post(`/admin/operations/discrepancies/${discrepancyId}/acknowledge`)
            .set(
              operationsOperatorHeaders(
                `real-pg-ops-ack-concurrent-${index}`,
                'finance_operator',
              ),
            )
            .send({}),
        ),
      )
      const history = await harness.database.query<{ count: number }>(
        `
          SELECT count(*)::int AS count
          FROM operational_discrepancy_history
          WHERE discrepancy_id = $1
            AND action = 'acknowledge'
        `,
        [discrepancyId],
      )

      expectSafeConcurrentStatuses(responses)
      expect(responses.filter((response) => response.status === 200)).toHaveLength(1)
      expect(history.rows[0]?.count).toBe(1)
    })

    it('keeps risk freeze and unfreeze races guarded and audited', async () => {
      harness = await createRealPostgresTestApplication()
      await fundPlayer(harness, 'real-pg-ops-risk-player', '5000')

      const freezeResponses = await Promise.all(
        Array.from({ length: 4 }, (_, index) =>
          request(harness!.app)
            .post('/admin/risk/accounts/real-pg-ops-risk-player/freeze')
            .set(
              operationsOperatorHeaders(
                `real-pg-ops-risk-freeze-${index}`,
                'treasury_admin',
              ),
            )
            .send({ reason: 'Concurrent risk freeze drill', scope: 'withdrawals' }),
        ),
      )
      const unfreezeResponses = await Promise.all(
        Array.from({ length: 4 }, (_, index) =>
          request(harness!.app)
            .post('/admin/risk/accounts/real-pg-ops-risk-player/unfreeze')
            .set(
              operationsOperatorHeaders(
                `real-pg-ops-risk-unfreeze-${index}`,
                'treasury_admin',
              ),
            )
            .send({ reason: 'Concurrent risk unfreeze drill' }),
        ),
      )
      const activeControls = await request(harness.app)
        .get('/admin/risk/accounts/real-pg-ops-risk-player')
        .set(operationsOperatorHeaders('real-pg-ops-risk-get'))

      expectSafeConcurrentStatuses(freezeResponses)
      expectSafeConcurrentStatuses(unfreezeResponses)
      expect(activeControls.status).toBe(200)
      expect(activeControls.body.riskAccount.withdrawalFrozen).toBe(false)
    })

    it('enforces one completed settlement under concurrent same-race workers', async () => {
      harness = await createRealPostgresTestApplication()
      await setupSettlementRace(harness, 'race-real-pg-settlement')
      const commands = [
        ...Array.from({ length: 5 }, () => ({
          idempotencyKey: 'real-pg-settle-shared',
          correlationId: 'corr_real_pg_settle_shared',
          causationId: 'cause_real_pg_settle_shared',
          raceId: 'race-real-pg-settlement',
          winningSelectionId: 'horse-1',
          houseTakeBps: 0,
          currency: 'USDC',
        })),
        ...Array.from({ length: 5 }, (_, index) => ({
          idempotencyKey: `real-pg-settle-competitor-${index}`,
          correlationId: `corr_real_pg_settle_competitor_${index}`,
          causationId: `cause_real_pg_settle_competitor_${index}`,
          raceId: 'race-real-pg-settlement',
          winningSelectionId: 'horse-1',
          houseTakeBps: 0,
          currency: 'USDC',
        })),
      ]

      const responses = await Promise.all(
        commands.map((command) =>
          request(harness!.app).post('/commands/settle-bet').send(command),
        ),
      )
      const completedRuns = await harness.database.query<{ count: number }>(
        `
          SELECT count(*)::int AS count
          FROM settlement_runs
          WHERE race_id = 'race-real-pg-settlement'
            AND status = 'completed'
        `,
      )
      const postings = await harness.database.query<{
        transaction_type: string
        count: number
      }>(
        `
          SELECT transaction_type, count(*)::int AS count
          FROM ledger_transactions
          WHERE transaction_type IN ('bet_capture', 'settlement_payout')
          GROUP BY transaction_type
        `,
      )
      const nonTerminalBets = await harness.database.query<{ count: number }>(
        `
          SELECT count(*)::int AS count
          FROM financial_bets
          WHERE race_id = 'race-real-pg-settlement'
            AND status IN ('accepted', 'settlement_pending')
        `,
      )

      expectSafeConcurrentStatuses(responses)
      expect(responses.some((response) => response.status === 200)).toBe(true)
      expect(completedRuns.rows[0]?.count).toBe(1)
      expect(Object.fromEntries(
        postings.rows.map((row) => [row.transaction_type, row.count]),
      )).toMatchObject({
        bet_capture: 2,
        settlement_payout: 1,
      })
      expect(nonTerminalBets.rows[0]?.count).toBe(0)
    })

    it('applies carryovers once under concurrent duplicate workers', async () => {
      harness = await createRealPostgresTestApplication()
      await createPendingCarryover(harness, 'race-real-pg-carryover-source')
      await createPool(
        harness,
        'race-real-pg-carryover-target',
        ['horse-1'],
        '2026-04-22T12:01:00.000Z',
      )
      const commands = [
        ...Array.from({ length: 5 }, () => ({
          idempotencyKey: 'real-pg-apply-carryover-shared',
          correlationId: 'corr_real_pg_apply_carryover_shared',
          causationId: 'cause_real_pg_apply_carryover_shared',
          targetRaceId: 'race-real-pg-carryover-target',
          currency: 'USDC',
        })),
        ...Array.from({ length: 5 }, (_, index) => ({
          idempotencyKey: `real-pg-apply-carryover-competitor-${index}`,
          correlationId: `corr_real_pg_apply_carryover_competitor_${index}`,
          causationId: `cause_real_pg_apply_carryover_competitor_${index}`,
          targetRaceId: 'race-real-pg-carryover-target',
          currency: 'USDC',
        })),
      ]

      const responses = await Promise.all(
        commands.map((command) =>
          request(harness!.app)
            .post('/commands/apply-carryovers-to-race')
            .send(command),
        ),
      )
      const applyPostings = await harness.database.query<{ count: number }>(
        `
          SELECT count(*)::int AS count
          FROM ledger_transactions
          WHERE transaction_type = 'settlement_carryover_apply'
        `,
      )
      const appliedCarryovers = await harness.database.query<{ count: number }>(
        `
          SELECT count(*)::int AS count
          FROM settlement_carryovers
          WHERE applied_to_race_id = 'race-real-pg-carryover-target'
            AND status = 'applied'
        `,
      )

      expectSafeConcurrentStatuses(responses)
      expect(responses.filter((response) => response.body.totalAppliedMinor === '900')).toHaveLength(1)
      expect(applyPostings.rows[0]?.count).toBe(1)
      expect(appliedCarryovers.rows[0]?.count).toBe(1)
    })

    it('keeps manual-review remediation explicit under concurrent operators', async () => {
      harness = await createRealPostgresTestApplication()
      await createPool(harness, 'race-real-pg-review', ['horse-1'])
      await freezePool(harness, 'race-real-pg-review')
      const markCommands = Array.from({ length: 6 }, (_, index) => ({
        idempotencyKey: `real-pg-mark-review-${index}`,
        correlationId: `corr_real_pg_mark_review_${index}`,
        causationId: `cause_real_pg_mark_review_${index}`,
        raceId: 'race-real-pg-review',
        currency: 'USDC',
        operatorId: `operator-${index}`,
        reasonCode: 'CONCURRENT_REVIEW_DRILL',
        reasonText: `operator ${index}`,
      }))

      const markResponses = await Promise.all(
        markCommands.map((command, index) =>
          request(harness!.app)
            .post('/commands/mark-settlement-manual-review')
            .set(operatorHeaders(`operator-${index}`))
            .send(command),
        ),
      )
      const manualRuns = await harness.database.query<{ count: number }>(
        `
          SELECT count(*)::int AS count
          FROM settlement_runs
          WHERE race_id = 'race-real-pg-review'
            AND status = 'manual_review'
        `,
      )
      const resolveCommands = Array.from({ length: 6 }, (_, index) => ({
        idempotencyKey: `real-pg-resolve-review-${index}`,
        correlationId: `corr_real_pg_resolve_review_${index}`,
        causationId: `cause_real_pg_resolve_review_${index}`,
        raceId: 'race-real-pg-review',
        currency: 'USDC',
        operatorId: `resolver-${index}`,
        resolutionCode: 'RETRY_ALLOWED',
      }))
      const resolveResponses = await Promise.all(
        resolveCommands.map((command, index) =>
          request(harness!.app)
            .post('/commands/resolve-settlement-manual-review')
            .set(operatorHeaders(`resolver-${index}`))
            .send(command),
        ),
      )
      const pool = await request(harness.app).get('/races/race-real-pg-review/pool')

      expectSafeConcurrentStatuses(markResponses)
      expect(markResponses.some((response) => response.status === 200)).toBe(true)
      expect(manualRuns.rows[0]?.count).toBe(1)
      expectSafeConcurrentStatuses(resolveResponses)
      expect(resolveResponses.filter((response) => response.status === 200)).toHaveLength(1)
      expect(pool.body.pool.status).toBe('frozen')
    })

    it('deduplicates concurrent reconciliation run creation and keeps it detection-only', async () => {
      harness = await createRealPostgresTestApplication()
      await createPool(harness, 'race-real-pg-reconciliation', ['horse-1'])
      const headers = {
        ...operatorHeaders('operator-reconciliation'),
        'idempotency-key': 'real-pg-reconciliation-shared',
        'x-correlation-id': 'corr_real_pg_reconciliation_shared',
        'x-causation-id': 'cause_real_pg_reconciliation_shared',
      }

      const responses = await Promise.all(
        Array.from({ length: 8 }, () =>
          request(harness!.app)
            .post(
              '/admin/operations/reconciliation/races/race-real-pg-reconciliation/runs',
            )
            .set(headers)
            .send({}),
        ),
      )
      const runs = await harness.database.query<{ count: number }>(
        `
          SELECT count(*)::int AS count
          FROM settlement_reconciliation_runs
          WHERE idempotency_key = 'real-pg-reconciliation-shared'
        `,
      )
      const ledgerMutations = await harness.database.query<{ count: number }>(
        `
          SELECT count(*)::int AS count
          FROM ledger_transactions
          WHERE transaction_type LIKE 'settlement_%'
        `,
      )
      const replay = await request(harness.app)
        .post(
          '/admin/operations/reconciliation/races/race-real-pg-reconciliation/runs',
        )
        .set(headers)
        .send({})

      expectSafeConcurrentStatuses(responses)
      expect(responses.some((response) => response.status === 201)).toBe(true)
      expect(runs.rows[0]?.count).toBe(1)
      expect(ledgerMutations.rows[0]?.count).toBe(0)
      expect(replay.status).toBe(201)
    })

    it('rolls back settlement postings on simulated process interruption and retries safely', async () => {
      harness = await createRealPostgresTestApplication({
        faultInjector: new OneShotFaultInjector(
          'settlement.after_ledger_posting_before_state_finalization',
        ),
      })
      await setupSettlementRace(harness, 'race-real-pg-interrupt-settlement')
      const command = {
        idempotencyKey: 'real-pg-settle-interrupted',
        correlationId: 'corr_real_pg_settle_interrupted',
        causationId: 'cause_real_pg_settle_interrupted',
        raceId: 'race-real-pg-interrupt-settlement',
        winningSelectionId: 'horse-1',
        houseTakeBps: 0,
        currency: 'USDC',
      }

      const interrupted = await request(harness.app)
        .post('/commands/settle-bet')
        .send(command)
      const rolledBackPostings = await harness.database.query<{ count: number }>(
        `
          SELECT count(*)::int AS count
          FROM ledger_transactions
          WHERE transaction_type IN ('bet_capture', 'settlement_payout')
        `,
      )
      const retry = await request(harness.app)
        .post('/commands/settle-bet')
        .send(command)
      const replay = await request(harness.app)
        .post('/commands/settle-bet')
        .send(command)

      expect(interrupted.status).toBe(500)
      expect(interrupted.body.error.code).toBe('SIMULATED_PROCESS_INTERRUPT')
      expect(rolledBackPostings.rows[0]?.count).toBe(0)
      expect(retry.status).toBe(200)
      expect(replay.status).toBe(200)
      expect(replay.body).toEqual(retry.body)
    })

    it('rolls back carryover application on simulated interruption and applies once after retry', async () => {
      harness = await createRealPostgresTestApplication({
        faultInjector: new OneShotFaultInjector(
          'carryover.after_ledger_posting_before_state_finalization',
        ),
      })
      await createPendingCarryover(harness, 'race-real-pg-interrupt-carryover-src')
      await createPool(
        harness,
        'race-real-pg-interrupt-carryover-target',
        ['horse-1'],
        '2026-04-22T12:01:00.000Z',
      )
      const command = {
        idempotencyKey: 'real-pg-apply-interrupted-carryover',
        correlationId: 'corr_real_pg_apply_interrupted_carryover',
        causationId: 'cause_real_pg_apply_interrupted_carryover',
        targetRaceId: 'race-real-pg-interrupt-carryover-target',
        currency: 'USDC',
      }

      const interrupted = await request(harness.app)
        .post('/commands/apply-carryovers-to-race')
        .send(command)
      const rolledBackPostings = await harness.database.query<{ count: number }>(
        `
          SELECT count(*)::int AS count
          FROM ledger_transactions
          WHERE transaction_type = 'settlement_carryover_apply'
        `,
      )
      const retry = await request(harness.app)
        .post('/commands/apply-carryovers-to-race')
        .send(command)
      const replay = await request(harness.app)
        .post('/commands/apply-carryovers-to-race')
        .send(command)

      expect(interrupted.status).toBe(500)
      expect(interrupted.body.error.code).toBe('SIMULATED_PROCESS_INTERRUPT')
      expect(rolledBackPostings.rows[0]?.count).toBe(0)
      expect(retry.status).toBe(200)
      expect(retry.body.totalAppliedMinor).toBe('900')
      expect(replay.body).toEqual(retry.body)
    })

    it('rolls back reconciliation run persistence on simulated interruption and retries safely', async () => {
      harness = await createRealPostgresTestApplication({
        faultInjector: new OneShotFaultInjector(
          'reconciliation.after_run_persist_before_response',
        ),
      })
      await createPool(harness, 'race-real-pg-interrupt-reconciliation', ['horse-1'])
      const headers = {
        ...operatorHeaders('operator-reconciliation-interrupt'),
        'idempotency-key': 'real-pg-reconciliation-interrupted',
        'x-correlation-id': 'corr_real_pg_reconciliation_interrupted',
        'x-causation-id': 'cause_real_pg_reconciliation_interrupted',
      }

      const interrupted = await request(harness.app)
        .post(
          '/admin/operations/reconciliation/races/race-real-pg-interrupt-reconciliation/runs',
        )
        .set(headers)
        .send({})
      const rolledBackRuns = await harness.database.query<{ count: number }>(
        `
          SELECT count(*)::int AS count
          FROM settlement_reconciliation_runs
          WHERE idempotency_key = 'real-pg-reconciliation-interrupted'
        `,
      )
      const retry = await request(harness.app)
        .post(
          '/admin/operations/reconciliation/races/race-real-pg-interrupt-reconciliation/runs',
        )
        .set(headers)
        .send({})

      expect(interrupted.status).toBe(500)
      expect(interrupted.body.error.code).toBe('SIMULATED_PROCESS_INTERRUPT')
      expect(rolledBackRuns.rows[0]?.count).toBe(0)
      expect(retry.status).toBe(201)
    })

    it('replays durable settlement state after application restart', async () => {
      harness = await createRealPostgresTestApplication()
      await setupSettlementRace(harness, 'race-real-pg-restart')
      const command = {
        idempotencyKey: 'real-pg-settle-restart',
        correlationId: 'corr_real_pg_settle_restart',
        causationId: 'cause_real_pg_settle_restart',
        raceId: 'race-real-pg-restart',
        winningSelectionId: 'horse-1',
        houseTakeBps: 0,
        currency: 'USDC',
      }

      const first = await request(harness.app)
        .post('/commands/settle-bet')
        .send(command)
      const restarted = createRealPostgresRestartedApplication(harness)
      const replay = await request(restarted.app)
        .post('/commands/settle-bet')
        .send(command)
      const pool = await request(restarted.app).get('/races/race-real-pg-restart/pool')

      expect(first.status).toBe(200)
      expect(replay.status).toBe(200)
      expect(replay.body).toEqual(first.body)
      expect(pool.body.pool.status).toBe('settled')
    })
  },
)
