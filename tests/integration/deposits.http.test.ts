import { afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createHmac } from 'node:crypto'

import type {
  FaultInjector,
  FaultPoint,
} from '../../src/shared/faults/FaultInjector.js'
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
      code: 'SIMULATED_DEPOSIT_INTERRUPT',
      message: 'Simulated process interruption for deposit retry coverage',
      retryable: true,
      details: { point },
    })
  }
}

function playerHeaders(
  userId = 'player-deposit-1',
  idempotencyKey = 'deposit-intent-key',
) {
  return {
    'x-nines-authenticated-user-id': userId,
    ...stateChangingHeaders(
      idempotencyKey,
      `corr_${idempotencyKey}`,
      `cause_${idempotencyKey}`,
    ),
  }
}

function operatorHeaders(
  idempotencyKey = 'provider-event-key',
  role = 'treasury_operator',
) {
  return {
    'x-nines-authenticated-user-id': 'operator-deposits',
    'x-nines-operator-role': role,
    ...stateChangingHeaders(
      idempotencyKey,
      `corr_${idempotencyKey}`,
      `cause_${idempotencyKey}`,
    ),
  }
}

async function createDepositIntent(
  harness: TestApplicationHarness,
  overrides: Record<string, unknown> = {},
  userId = 'player-deposit-1',
) {
  return request(harness.app)
    .post('/deposit-intents')
    .set(playerHeaders(userId, String(overrides.idempotencyKey ?? 'intent-key')))
    .send({
      expectedAmountMinor: '1000',
      provider: 'simulated',
      ...overrides,
    })
}

async function ingestProviderEvent(
  harness: TestApplicationHarness,
  overrides: Record<string, unknown> = {},
) {
  return request(harness.app)
    .post('/provider-events/deposits')
    .set(operatorHeaders(String(overrides.idempotencyKey ?? 'event-key')))
    .send({
      providerEventId: 'provider-event-1',
      provider: 'simulated',
      externalTransactionId: 'external-tx-1',
      amountMinor: '1000',
      currency: 'USDC',
      confirmed: true,
      ...overrides,
    })
}

async function playerBalance(harness: TestApplicationHarness, userId: string) {
  return request(harness.app)
    .get('/player/accounts/USDC/balance')
    .set({ 'x-nines-authenticated-user-id': userId })
}

async function depositLedgerCount(harness: TestApplicationHarness) {
  const result = await harness.database.query<{ count: number }>(
    `
      SELECT count(*)::int AS count
      FROM ledger_transactions
      WHERE transaction_type = 'deposit_confirmed_credit'
    `,
  )

  return result.rows[0]?.count ?? 0
}

async function providerEventCount(harness: TestApplicationHarness) {
  const result = await harness.database.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM provider_deposit_events',
  )

  return result.rows[0]?.count ?? 0
}

async function webhookReceiptCount(harness: TestApplicationHarness) {
  const result = await harness.database.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM provider_webhook_receipts',
  )

  return result.rows[0]?.count ?? 0
}

async function auditEventsFor(
  harness: TestApplicationHarness,
  eventType: string,
) {
  const result = await harness.database.query<{
    event_type: string
    payload: Record<string, unknown>
  }>(
    `
      SELECT event_type, payload
      FROM audit_events
      WHERE event_type = $1
      ORDER BY created_at ASC
    `,
    [eventType],
  )

  return result.rows
}

function signDepositWebhook(
  body: Record<string, unknown>,
  timestamp: string,
  nonce: string,
): string {
  const rawBody = JSON.stringify(body)
  return createHmac('sha256', 'test-deposit-webhook-secret')
    .update(`${timestamp}.${nonce}.${rawBody}`)
    .digest('hex')
}

async function signedWebhook(
  harness: TestApplicationHarness,
  body: Record<string, unknown>,
  options: {
    timestamp?: string
    nonce?: string
    signature?: string
  } = {},
) {
  const timestamp = options.timestamp ?? '2026-04-22T12:00:00.000Z'
  const nonce = options.nonce ?? `nonce-${body.providerEventId}`
  const signature =
    options.signature ?? signDepositWebhook(body, timestamp, nonce)

  return request(harness.app)
    .post('/provider-events/deposits/webhook/simulated')
    .set({
      'x-nines-provider-signature': signature,
      'x-nines-provider-timestamp': timestamp,
      'x-nines-provider-nonce': nonce,
      ...stateChangingHeaders(
        String(body.idempotencyKey ?? `webhook-${body.providerEventId}`),
        `corr_webhook_${body.providerEventId}`,
        `cause_webhook_${body.providerEventId}`,
      ),
    })
    .send(body)
}

describe('deposit HTTP routes', () => {
  let harness: TestApplicationHarness | undefined

  afterEach(async () => {
    if (harness) {
      await harness.close()
      harness = undefined
    }
  })

  it('creates a deposit intent for the authenticated player', async () => {
    harness = await createTestApplication()

    const response = await createDepositIntent(harness)

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      userId: 'player-deposit-1',
      currency: 'USDC',
      expectedAmountMinor: '1000',
      provider: 'simulated',
      providerKind: 'simulated',
      status: 'awaiting_external_payment',
      creditedLedgerTransactionId: null,
    })
    expect(response.body.depositIntentId).toMatch(/^dep_intent_/)
    expect(response.body.destinationReference).toContain(
      response.body.depositIntentId,
    )
  })

  it('replays duplicate create intent requests with the same logical result', async () => {
    harness = await createTestApplication()

    const first = await createDepositIntent(harness)
    const replay = await createDepositIntent(harness)

    expect(first.status).toBe(201)
    expect(replay.status).toBe(201)
    expect(replay.body).toEqual(first.body)
  })

  it('receives an unconfirmed provider event without crediting the player', async () => {
    harness = await createTestApplication()
    const intent = await createDepositIntent(harness)

    const event = await ingestProviderEvent(harness, {
      idempotencyKey: 'event-unconfirmed',
      providerEventId: 'provider-event-unconfirmed',
      externalTransactionId: 'external-tx-unconfirmed',
      depositIntentId: intent.body.depositIntentId,
      destinationReference: intent.body.destinationReference,
      confirmed: false,
      confirmationCount: 0,
    })
    const balance = await playerBalance(harness, 'player-deposit-1')

    expect(event.status).toBe(200)
    expect(event.body).toMatchObject({
      credited: false,
      reviewRequired: false,
      providerEvent: {
        status: 'awaiting_confirmation',
        ledgerTransactionId: null,
      },
      depositIntent: {
        status: 'detected',
      },
    })
    expect(balance.body.spendableBalanceMinor).toBe('0')
    expect(await depositLedgerCount(harness)).toBe(0)
  })

  it('credits a confirmed matched provider event through Accounting Core exactly once', async () => {
    harness = await createTestApplication()
    const intent = await createDepositIntent(harness)

    const event = await ingestProviderEvent(harness, {
      depositIntentId: intent.body.depositIntentId,
      destinationReference: intent.body.destinationReference,
    })
    const balance = await playerBalance(harness, 'player-deposit-1')
    const ledgerEntries = await harness.database.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM ledger_entries le
        JOIN ledger_transactions lt
          ON lt.transaction_id = le.transaction_id
        WHERE lt.reference_type = 'deposit'
          AND lt.reference_id = $1
      `,
      [intent.body.depositIntentId],
    )

    expect(event.status).toBe(201)
    expect(event.body).toMatchObject({
      credited: true,
      reviewRequired: false,
      providerEvent: {
        status: 'credited',
        amountMinor: '1000',
      },
      depositIntent: {
        status: 'credited',
      },
    })
    expect(event.body.providerEvent.ledgerTransactionId).toMatch(/^txn_/)
    expect(balance.body.spendableBalanceMinor).toBe('1000')
    expect(await depositLedgerCount(harness)).toBe(1)
    expect(ledgerEntries.rows[0]?.count).toBe(2)
  })

  it('accepts valid signed provider webhooks through the provider adapter boundary', async () => {
    harness = await createTestApplication()
    const intent = await createDepositIntent(harness)
    const body = {
      providerEventId: 'signed-provider-event',
      externalTransactionId: 'signed-external-tx',
      depositIntentId: intent.body.depositIntentId,
      destinationReference: intent.body.destinationReference,
      amountMinor: '1000',
      currency: 'USDC',
      confirmed: true,
      confirmationCount: 12,
    }

    const response = await signedWebhook(harness, body)
    const balance = await playerBalance(harness, 'player-deposit-1')

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      credited: true,
      providerEvent: {
        provider: 'simulated',
        providerEventId: 'signed-provider-event',
        status: 'credited',
      },
    })
    expect(balance.body.spendableBalanceMinor).toBe('1000')
    expect(await depositLedgerCount(harness)).toBe(1)
    expect(await webhookReceiptCount(harness)).toBe(1)
  })

  it('rejects timestamp and nonce replay failures before persistence or credit', async () => {
    harness = await createTestApplication()
    const intent = await createDepositIntent(harness)
    const body = {
      providerEventId: 'replay-provider-event',
      externalTransactionId: 'replay-external-tx',
      depositIntentId: intent.body.depositIntentId,
      destinationReference: intent.body.destinationReference,
      amountMinor: '1000',
      currency: 'USDC',
      confirmed: true,
    }

    const missingTimestamp = await request(harness.app)
      .post('/provider-events/deposits/webhook/simulated')
      .set({
        'x-nines-provider-nonce': 'missing-timestamp-nonce',
        'x-nines-provider-signature': signDepositWebhook(
          body,
          '2026-04-22T12:00:00.000Z',
          'missing-timestamp-nonce',
        ),
      })
      .send(body)
    const malformedTimestamp = await signedWebhook(harness, body, {
      timestamp: 'not-a-timestamp',
      nonce: 'malformed-timestamp-nonce',
    })
    const oldTimestamp = await signedWebhook(harness, body, {
      timestamp: '2026-04-22T11:54:59.000Z',
      nonce: 'old-timestamp-nonce',
    })
    const futureTimestamp = await signedWebhook(harness, body, {
      timestamp: '2026-04-22T12:05:01.000Z',
      nonce: 'future-timestamp-nonce',
    })
    const missingNonce = await request(harness.app)
      .post('/provider-events/deposits/webhook/simulated')
      .set({
        'x-nines-provider-timestamp': '2026-04-22T12:00:00.000Z',
        'x-nines-provider-signature': signDepositWebhook(
          body,
          '2026-04-22T12:00:00.000Z',
          'missing-nonce',
        ),
      })
      .send(body)

    expect(missingTimestamp.body.error.code).toBe(
      'DEPOSIT_WEBHOOK_TIMESTAMP_MISSING',
    )
    expect(malformedTimestamp.body.error.code).toBe(
      'DEPOSIT_WEBHOOK_TIMESTAMP_MALFORMED',
    )
    expect(oldTimestamp.body.error.code).toBe(
      'DEPOSIT_WEBHOOK_TIMESTAMP_TOO_OLD',
    )
    expect(futureTimestamp.body.error.code).toBe(
      'DEPOSIT_WEBHOOK_TIMESTAMP_TOO_FAR_IN_FUTURE',
    )
    expect(missingNonce.body.error.code).toBe(
      'DEPOSIT_WEBHOOK_NONCE_MISSING',
    )
    expect(await providerEventCount(harness)).toBe(0)
    expect(await depositLedgerCount(harness)).toBe(0)
    expect(await webhookReceiptCount(harness)).toBe(0)
  })

  it('rejects duplicate provider-scoped webhook nonces without persisting a second event or credit', async () => {
    harness = await createTestApplication()
    const intent = await createDepositIntent(harness)
    const body = {
      providerEventId: 'nonce-provider-event',
      externalTransactionId: 'nonce-external-tx',
      depositIntentId: intent.body.depositIntentId,
      destinationReference: intent.body.destinationReference,
      amountMinor: '1000',
      currency: 'USDC',
      confirmed: true,
    }
    const replayBody = {
      ...body,
      providerEventId: 'nonce-provider-event-replay',
      externalTransactionId: 'nonce-external-tx-replay',
    }

    const first = await signedWebhook(harness, body, {
      nonce: 'duplicate-nonce',
    })
    const replay = await signedWebhook(harness, replayBody, {
      nonce: 'duplicate-nonce',
    })

    expect(first.status).toBe(201)
    expect(replay.status).toBe(403)
    expect(replay.body.error.code).toBe('DEPOSIT_WEBHOOK_NONCE_REPLAYED')
    expect(await providerEventCount(harness)).toBe(1)
    expect(await depositLedgerCount(harness)).toBe(1)
    expect(await webhookReceiptCount(harness)).toBe(1)
  })

  it('rejects unsigned, invalidly signed, and malformed provider webhooks without persistence or credit', async () => {
    harness = await createTestApplication()
    const intent = await createDepositIntent(harness)
    const body = {
      providerEventId: 'signed-provider-event-rejected',
      externalTransactionId: 'signed-external-tx-rejected',
      depositIntentId: intent.body.depositIntentId,
      destinationReference: intent.body.destinationReference,
      amountMinor: '1000',
      currency: 'USDC',
      confirmed: true,
    }

    const missingSignature = await request(harness.app)
      .post('/provider-events/deposits/webhook/simulated')
      .set({
        'x-nines-provider-timestamp': '2026-04-22T12:00:00.000Z',
        'x-nines-provider-nonce': 'missing-signature-nonce',
      })
      .send(body)
    const invalidSignature = await signedWebhook(harness, body, {
      signature: 'bad-signature',
    })
    const malformedBody = {
      providerEventId: 'malformed-provider-event',
      externalTransactionId: 'malformed-external-tx',
      amountMinor: 'not-minor-units',
      currency: 'USDC',
      confirmed: true,
    }
    const malformed = await signedWebhook(harness, malformedBody)
    const balance = await playerBalance(harness, 'player-deposit-1')

    expect(missingSignature.status).toBe(403)
    expect(missingSignature.body.error.code).toBe(
      'DEPOSIT_WEBHOOK_SIGNATURE_MISSING',
    )
    expect(invalidSignature.status).toBe(403)
    expect(invalidSignature.body.error.code).toBe(
      'DEPOSIT_WEBHOOK_SIGNATURE_INVALID',
    )
    expect(malformed.status).toBe(400)
    expect(malformed.body.error.code).toBe(
      'DEPOSIT_WEBHOOK_PAYLOAD_MALFORMED',
    )
    expect(await providerEventCount(harness)).toBe(0)
    expect(await depositLedgerCount(harness)).toBe(0)
    expect(balance.body.spendableBalanceMinor).toBe('0')
  })

  it('ignores duplicate provider callbacks without double crediting', async () => {
    harness = await createTestApplication()
    const intent = await createDepositIntent(harness)
    const body = {
      providerEventId: 'provider-event-duplicate',
      externalTransactionId: 'external-tx-duplicate',
      depositIntentId: intent.body.depositIntentId,
      destinationReference: intent.body.destinationReference,
    }

    const first = await ingestProviderEvent(harness, {
      ...body,
      idempotencyKey: 'event-duplicate-first',
    })
    const duplicate = await ingestProviderEvent(harness, {
      ...body,
      idempotencyKey: 'event-duplicate-second',
    })
    const balance = await playerBalance(harness, 'player-deposit-1')

    expect(first.status).toBe(201)
    expect(duplicate.status).toBe(201)
    expect(duplicate.body).toEqual(first.body)
    expect(balance.body.spendableBalanceMinor).toBe('1000')
    expect(await depositLedgerCount(harness)).toBe(1)
  })

  it('does not credit the same external transaction twice', async () => {
    harness = await createTestApplication()
    const firstIntent = await createDepositIntent(harness, {
      idempotencyKey: 'intent-external-first',
    })
    const secondIntent = await createDepositIntent(
      harness,
      {
        idempotencyKey: 'intent-external-second',
      },
      'player-deposit-2',
    )

    await ingestProviderEvent(harness, {
      idempotencyKey: 'event-external-first',
      providerEventId: 'provider-event-external-first',
      externalTransactionId: 'external-tx-shared',
      depositIntentId: firstIntent.body.depositIntentId,
      destinationReference: firstIntent.body.destinationReference,
    })
    const duplicateExternal = await ingestProviderEvent(harness, {
      idempotencyKey: 'event-external-second',
      providerEventId: 'provider-event-external-second',
      externalTransactionId: 'external-tx-shared',
      depositIntentId: secondIntent.body.depositIntentId,
      destinationReference: secondIntent.body.destinationReference,
    })
    const firstBalance = await playerBalance(harness, 'player-deposit-1')
    const secondBalance = await playerBalance(harness, 'player-deposit-2')

    expect(duplicateExternal.status).toBe(200)
    expect(duplicateExternal.body).toMatchObject({
      credited: false,
      reviewRequired: true,
      providerEvent: {
        status: 'review_required',
        reviewReasonCode: 'DUPLICATE_EXTERNAL_TRANSACTION',
      },
    })
    expect(firstBalance.body.spendableBalanceMinor).toBe('1000')
    expect(secondBalance.body.spendableBalanceMinor).toBe('0')
    expect(await depositLedgerCount(harness)).toBe(1)
  })

  it('routes unmatched confirmed provider events to review without crediting', async () => {
    harness = await createTestApplication()

    const event = await ingestProviderEvent(harness, {
      idempotencyKey: 'event-unmatched',
      providerEventId: 'provider-event-unmatched',
      externalTransactionId: 'external-tx-unmatched',
      destinationReference: 'unknown-destination',
    })
    const review = await request(harness.app)
      .get('/deposits/review')
      .set(operatorHeaders('review-unmatched'))

    expect(event.status).toBe(200)
    expect(event.body).toMatchObject({
      credited: false,
      reviewRequired: true,
      providerEvent: {
        status: 'review_required',
        reviewReasonCode: 'NO_MATCHING_DEPOSIT_INTENT',
      },
    })
    expect(review.body.reviewItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemType: 'provider_deposit_event',
          reasonCode: 'NO_MATCHING_DEPOSIT_INTENT',
        }),
      ]),
    )
    expect(await depositLedgerCount(harness)).toBe(0)
  })

  it('lets operators mark review events no-credit without allowing later credit', async () => {
    harness = await createTestApplication()
    const event = await ingestProviderEvent(harness, {
      idempotencyKey: 'event-no-credit',
      providerEventId: 'provider-event-no-credit',
      externalTransactionId: 'external-tx-no-credit',
      destinationReference: 'unknown-no-credit-destination',
    })

    const marked = await request(harness.app)
      .post(
        `/deposits/provider-events/${event.body.providerEvent.depositEventId}/mark-reviewed-no-credit`,
      )
      .set(operatorHeaders('mark-no-credit'))
      .send({
        reasonCode: 'OPERATOR_CONFIRMED_NO_CREDIT',
        reasonText: 'Provider event should not credit a player account',
      })
    const approve = await request(harness.app)
      .post(
        `/deposits/provider-events/${event.body.providerEvent.depositEventId}/approve-credit`,
      )
      .set(operatorHeaders('approve-no-credit', 'treasury_admin'))
      .send({})
    const audit = await auditEventsFor(
      harness,
      'financial.deposit.provider_event_reviewed_no_credit',
    )

    expect(marked.status).toBe(200)
    expect(marked.body.providerEvent.status).toBe('reviewed_no_credit')
    expect(approve.status).toBe(409)
    expect(approve.body.error.code).toBe('DEPOSIT_PROVIDER_EVENT_TERMINAL')
    expect(audit).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          action: 'mark_reviewed_no_credit',
          operatorUserId: 'operator-deposits',
          operatorRole: 'treasury_operator',
          previousStatus: 'review_required',
          newStatus: 'reviewed_no_credit',
          depositEventId: event.body.providerEvent.depositEventId,
          reason: 'Provider event should not credit a player account',
        }),
      }),
    ])
    expect(await depositLedgerCount(harness)).toBe(0)
  })

  it('lets operators reject review events without allowing later credit', async () => {
    harness = await createTestApplication()
    const event = await ingestProviderEvent(harness, {
      idempotencyKey: 'event-reject',
      providerEventId: 'provider-event-reject',
      externalTransactionId: 'external-tx-reject',
      destinationReference: 'unknown-reject-destination',
    })

    const rejected = await request(harness.app)
      .post(
        `/deposits/provider-events/${event.body.providerEvent.depositEventId}/reject`,
      )
      .set(operatorHeaders('reject-event'))
      .send({
        reasonCode: 'OPERATOR_REJECTED',
        reasonText: 'Provider event was rejected after investigation',
      })
    const approve = await request(harness.app)
      .post(
        `/deposits/provider-events/${event.body.providerEvent.depositEventId}/approve-credit`,
      )
      .set(operatorHeaders('approve-rejected', 'treasury_admin'))
      .send({})
    const audit = await auditEventsFor(
      harness,
      'financial.deposit.provider_event_rejected',
    )

    expect(rejected.status).toBe(200)
    expect(rejected.body.providerEvent.status).toBe('rejected')
    expect(approve.status).toBe(409)
    expect(approve.body.error.code).toBe('DEPOSIT_PROVIDER_EVENT_TERMINAL')
    expect(audit[0]?.payload).toMatchObject({
      action: 'reject',
      operatorUserId: 'operator-deposits',
      operatorRole: 'treasury_operator',
      previousStatus: 'review_required',
      newStatus: 'rejected',
      depositEventId: event.body.providerEvent.depositEventId,
      reason: 'Provider event was rejected after investigation',
    })
    expect(await depositLedgerCount(harness)).toBe(0)
  })

  it('rejects missing and insufficient deposit review operator roles', async () => {
    harness = await createTestApplication()
    const event = await ingestProviderEvent(harness, {
      idempotencyKey: 'event-role-boundary',
      providerEventId: 'provider-event-role-boundary',
      externalTransactionId: 'external-tx-role-boundary',
      destinationReference: 'unknown-role-boundary',
    })

    const missingRole = await request(harness.app)
      .post(
        `/deposits/provider-events/${event.body.providerEvent.depositEventId}/mark-reviewed-no-credit`,
      )
      .set({
        'x-nines-authenticated-user-id': 'operator-deposits',
        ...stateChangingHeaders(
          'missing-role-no-credit',
          'corr_missing_role',
          'cause_missing_role',
        ),
      })
      .send({
        reasonCode: 'OPERATOR_CONFIRMED_NO_CREDIT',
        reasonText: 'Missing role should be rejected',
      })
    const insufficientRole = await request(harness.app)
      .post(
        `/deposits/provider-events/${event.body.providerEvent.depositEventId}/mark-reviewed-no-credit`,
      )
      .set(operatorHeaders('insufficient-role-no-credit', 'operator'))
      .send({
        reasonCode: 'OPERATOR_CONFIRMED_NO_CREDIT',
        reasonText: 'Insufficient role should be rejected',
      })
    const validRole = await request(harness.app)
      .post(
        `/deposits/provider-events/${event.body.providerEvent.depositEventId}/mark-reviewed-no-credit`,
      )
      .set(operatorHeaders('valid-role-no-credit', 'treasury_operator'))
      .send({
        reasonCode: 'OPERATOR_CONFIRMED_NO_CREDIT',
        reasonText: 'Treasury operator may mark no-credit',
      })

    expect(missingRole.status).toBe(403)
    expect(missingRole.body.error.code).toBe('MISSING_OPERATOR_ROLE')
    expect(insufficientRole.status).toBe(403)
    expect(insufficientRole.body.error.code).toBe('OPERATOR_ROLE_INSUFFICIENT')
    expect(validRole.status).toBe(200)
    expect(validRole.body.providerEvent.status).toBe('reviewed_no_credit')
  })

  it('lets operators manually link and approve a reviewed provider event', async () => {
    harness = await createTestApplication()
    const intent = await createDepositIntent(harness, {
      idempotencyKey: 'intent-manual-link',
    })
    const event = await ingestProviderEvent(harness, {
      idempotencyKey: 'event-manual-link',
      providerEventId: 'provider-event-manual-link',
      externalTransactionId: 'external-tx-manual-link',
      destinationReference: 'unknown-manual-link-destination',
    })

    const linked = await request(harness.app)
      .post(
        `/deposits/provider-events/${event.body.providerEvent.depositEventId}/link-intent`,
      )
      .set(operatorHeaders('link-event'))
      .send({
        depositIntentId: intent.body.depositIntentId,
      })
    const approved = await request(harness.app)
      .post(
        `/deposits/provider-events/${event.body.providerEvent.depositEventId}/approve-credit`,
      )
      .set(operatorHeaders('approve-linked', 'treasury_admin'))
      .send({})
    const replay = await request(harness.app)
      .post(
        `/deposits/provider-events/${event.body.providerEvent.depositEventId}/retry-credit`,
      )
      .set(operatorHeaders('approve-linked'))
      .send({})
    const balance = await playerBalance(harness, 'player-deposit-1')
    const linkAudit = await auditEventsFor(
      harness,
      'financial.deposit.provider_event_manually_linked',
    )
    const approveAudit = await auditEventsFor(
      harness,
      'financial.deposit.provider_event_credit_approved',
    )
    const retryAudit = await auditEventsFor(
      harness,
      'financial.deposit.provider_event_credit_retry',
    )

    expect(linked.status).toBe(200)
    expect(linked.body.providerEvent).toMatchObject({
      status: 'review_required',
      depositIntentId: intent.body.depositIntentId,
    })
    expect(approved.status).toBe(201)
    expect(approved.body.credited).toBe(true)
    expect(replay.status).toBe(201)
    expect(replay.body).toEqual(approved.body)
    expect(linkAudit[0]?.payload).toMatchObject({
      action: 'manual_link',
      operatorRole: 'treasury_operator',
      previousStatus: 'review_required',
      newStatus: 'review_required',
      depositEventId: event.body.providerEvent.depositEventId,
      depositIntentId: intent.body.depositIntentId,
    })
    expect(approveAudit[0]?.payload).toMatchObject({
      action: 'approve_credit',
      operatorRole: 'treasury_admin',
      previousStatus: 'review_required',
      newStatus: 'credited',
      ledgerTransactionId: approved.body.providerEvent.ledgerTransactionId,
    })
    expect(retryAudit[0]?.payload).toMatchObject({
      action: 'retry_credit',
      operatorRole: 'treasury_operator',
      previousStatus: 'credited',
      newStatus: 'credited',
      ledgerTransactionId: approved.body.providerEvent.ledgerTransactionId,
    })
    expect(balance.body.spendableBalanceMinor).toBe('1000')
    expect(await depositLedgerCount(harness)).toBe(1)
  })

  it('requires override reasons for risky manual link or approval', async () => {
    harness = await createTestApplication()
    const intent = await createDepositIntent(harness, {
      idempotencyKey: 'intent-risky-link',
      expectedAmountMinor: '1000',
    })
    const event = await ingestProviderEvent(harness, {
      idempotencyKey: 'event-risky-link',
      providerEventId: 'provider-event-risky-link',
      externalTransactionId: 'external-tx-risky-link',
      destinationReference: 'unknown-risky-link-destination',
      amountMinor: '900',
    })

    const rejectedLink = await request(harness.app)
      .post(
        `/deposits/provider-events/${event.body.providerEvent.depositEventId}/link-intent`,
      )
      .set(operatorHeaders('risky-link-missing-override'))
      .send({
        depositIntentId: intent.body.depositIntentId,
      })
    const linked = await request(harness.app)
      .post(
        `/deposits/provider-events/${event.body.providerEvent.depositEventId}/link-intent`,
      )
      .set(operatorHeaders('risky-link-with-override', 'treasury_admin'))
      .send({
        depositIntentId: intent.body.depositIntentId,
        overrideReason: 'Operator verified provider amount manually',
      })
    const rejectedApproval = await request(harness.app)
      .post(
        `/deposits/provider-events/${event.body.providerEvent.depositEventId}/approve-credit`,
      )
      .set(operatorHeaders('risky-approve-missing-override', 'treasury_admin'))
      .send({})
    const insufficientOverrideRole = await request(harness.app)
      .post(
        `/deposits/provider-events/${event.body.providerEvent.depositEventId}/link-intent`,
      )
      .set(operatorHeaders('risky-link-insufficient-role', 'treasury_operator'))
      .send({
        depositIntentId: intent.body.depositIntentId,
        overrideReason: 'Operator verified provider amount manually',
      })
    const insufficientApproveRole = await request(harness.app)
      .post(
        `/deposits/provider-events/${event.body.providerEvent.depositEventId}/approve-credit`,
      )
      .set(operatorHeaders('approve-insufficient-role', 'treasury_operator'))
      .send({
        overrideReason: 'Operator verified provider amount manually',
      })

    expect(rejectedLink.status).toBe(400)
    expect(rejectedLink.body.error.code).toBe(
      'DEPOSIT_REVIEW_OVERRIDE_REASON_REQUIRED',
    )
    expect(linked.status).toBe(200)
    expect(rejectedApproval.status).toBe(400)
    expect(rejectedApproval.body.error.code).toBe(
      'DEPOSIT_REVIEW_OVERRIDE_REASON_REQUIRED',
    )
    expect(insufficientOverrideRole.status).toBe(403)
    expect(insufficientOverrideRole.body.error.code).toBe(
      'OPERATOR_ROLE_INSUFFICIENT',
    )
    expect(insufficientApproveRole.status).toBe(403)
    expect(insufficientApproveRole.body.error.code).toBe(
      'OPERATOR_ROLE_INSUFFICIENT',
    )
    expect(await depositLedgerCount(harness)).toBe(0)
  })

  it('routes amount, currency, and expired-intent mismatches to review', async () => {
    harness = await createTestApplication()
    const amountIntent = await createDepositIntent(harness, {
      idempotencyKey: 'intent-amount-mismatch',
      expectedAmountMinor: '1000',
    })
    const currencyIntent = await createDepositIntent(
      harness,
      {
        idempotencyKey: 'intent-currency-mismatch',
      },
      'player-deposit-currency',
    )
    const expiredIntent = await createDepositIntent(
      harness,
      {
        idempotencyKey: 'intent-expired',
        expiresAt: '2026-04-22T11:59:00.000Z',
      },
      'player-deposit-expired',
    )

    const amount = await ingestProviderEvent(harness, {
      idempotencyKey: 'event-amount-mismatch',
      providerEventId: 'provider-event-amount-mismatch',
      externalTransactionId: 'external-tx-amount-mismatch',
      depositIntentId: amountIntent.body.depositIntentId,
      destinationReference: amountIntent.body.destinationReference,
      amountMinor: '999',
    })
    const currency = await ingestProviderEvent(harness, {
      idempotencyKey: 'event-currency-mismatch',
      providerEventId: 'provider-event-currency-mismatch',
      externalTransactionId: 'external-tx-currency-mismatch',
      depositIntentId: currencyIntent.body.depositIntentId,
      destinationReference: currencyIntent.body.destinationReference,
      currency: 'EUR',
    })
    const expired = await ingestProviderEvent(harness, {
      idempotencyKey: 'event-expired',
      providerEventId: 'provider-event-expired',
      externalTransactionId: 'external-tx-expired',
      depositIntentId: expiredIntent.body.depositIntentId,
      destinationReference: expiredIntent.body.destinationReference,
    })

    expect(amount.body.providerEvent.reviewReasonCode).toBe('AMOUNT_MISMATCH')
    expect(currency.body.providerEvent.reviewReasonCode).toBe(
      'CURRENCY_MISMATCH',
    )
    expect(expired.body.providerEvent.reviewReasonCode).toBe(
      'DEPOSIT_INTENT_EXPIRED',
    )
    expect(amount.body.depositIntent.status).toBe('review_required')
    expect(currency.body.depositIntent.status).toBe('review_required')
    expect(expired.body.depositIntent.status).toBe('review_required')
    expect(await depositLedgerCount(harness)).toBe(0)
  })

  it('retries safely after an interruption during deposit crediting', async () => {
    harness = await createTestApplication(undefined, {
      faultInjector: new OneShotFaultInjector(
        'deposit.after_event_record_before_credit',
      ),
    })
    const intent = await createDepositIntent(harness)
    const body = {
      idempotencyKey: 'event-interrupted',
      providerEventId: 'provider-event-interrupted',
      externalTransactionId: 'external-tx-interrupted',
      depositIntentId: intent.body.depositIntentId,
      destinationReference: intent.body.destinationReference,
    }

    const interrupted = await ingestProviderEvent(harness, body)
    const ledgerCountAfterFailure = await depositLedgerCount(harness)
    const retry = await ingestProviderEvent(harness, {
      ...body,
      idempotencyKey: 'event-interrupted-retry',
    })
    const balance = await playerBalance(harness, 'player-deposit-1')

    expect(interrupted.status).toBe(500)
    expect(interrupted.body.error.code).toBe('SIMULATED_DEPOSIT_INTERRUPT')
    expect(ledgerCountAfterFailure).toBe(0)
    expect(retry.status).toBe(201)
    expect(retry.body.credited).toBe(true)
    expect(balance.body.spendableBalanceMinor).toBe('1000')
    expect(await depositLedgerCount(harness)).toBe(1)
  })

  it('detects confirmed provider events that were received but not credited', async () => {
    harness = await createTestApplication()
    const intent = await createDepositIntent(harness)

    await harness.database.query(
      `
        INSERT INTO provider_deposit_events (
          deposit_event_id,
          provider_event_id,
          provider,
          external_transaction_id,
          deposit_intent_id,
          destination_reference,
          amount_minor,
          currency,
          confirmation_count,
          confirmed,
          status,
          raw_payload,
          received_at,
          updated_at,
          idempotency_key,
          correlation_id,
          causation_id
        )
        VALUES (
          'dep_event_uncredited',
          'provider-event-uncredited',
          'simulated',
          'external-tx-uncredited',
          $1,
          $2,
          1000,
          'USDC',
          3,
          TRUE,
          'received',
          '{}'::jsonb,
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z',
          'manual-uncredited',
          'corr_manual_uncredited',
          'cause_manual_uncredited'
        )
      `,
      [intent.body.depositIntentId, intent.body.destinationReference],
    )

    const response = await request(harness.app)
      .get('/admin/operations/deposits/reconciliation')
      .set(operatorHeaders('reconcile-deposits'))

    expect(response.status).toBe(200)
    expect(response.body.reconciliation).toMatchObject({
      issueCount: 1,
      incidentCount: 1,
    })
    expect(response.body.reconciliation.issues).toEqual([
      expect.objectContaining({
        code: 'confirmed_uncredited',
        entityId: 'dep_event_uncredited',
      }),
    ])
  })

  it('categorizes duplicate, replay, rejected, and no-credit deposit states distinctly', async () => {
    harness = await createTestApplication()

    await harness.database.query(
      `
        INSERT INTO provider_deposit_events (
          deposit_event_id,
          provider_event_id,
          provider,
          external_transaction_id,
          amount_minor,
          currency,
          confirmation_count,
          confirmed,
          status,
          review_reason_code,
          review_reason_text,
          raw_payload,
          received_at,
          updated_at,
          idempotency_key,
          correlation_id,
          causation_id
        )
        VALUES
          (
            'dep_event_duplicate_reconcile',
            'provider-event-duplicate-reconcile',
            'simulated',
            'external-tx-duplicate-reconcile',
            1000,
            'USDC',
            3,
            TRUE,
            'duplicate',
            'DUPLICATE_EXTERNAL_TRANSACTION',
            'External transaction already credited',
            '{}'::jsonb,
            '2026-04-22T12:00:00.000Z',
            '2026-04-22T12:00:00.000Z',
            'manual-duplicate-reconcile',
            'corr_manual_duplicate_reconcile',
            'cause_manual_duplicate_reconcile'
          ),
          (
            'dep_event_rejected_reconcile',
            'provider-event-rejected-reconcile',
            'simulated',
            'external-tx-rejected-reconcile',
            1000,
            'USDC',
            3,
            TRUE,
            'rejected',
            'OPERATOR_REJECTED',
            'Rejected after review',
            '{}'::jsonb,
            '2026-04-22T12:00:00.000Z',
            '2026-04-22T12:00:00.000Z',
            'manual-rejected-reconcile',
            'corr_manual_rejected_reconcile',
            'cause_manual_rejected_reconcile'
          ),
          (
            'dep_event_no_credit_reconcile',
            'provider-event-no-credit-reconcile',
            'simulated',
            'external-tx-no-credit-reconcile',
            1000,
            'USDC',
            3,
            TRUE,
            'reviewed_no_credit',
            'OPERATOR_CONFIRMED_NO_CREDIT',
            'Closed without credit',
            '{}'::jsonb,
            '2026-04-22T12:00:00.000Z',
            '2026-04-22T12:00:00.000Z',
            'manual-no-credit-reconcile',
            'corr_manual_no_credit_reconcile',
            'cause_manual_no_credit_reconcile'
          )
      `,
    )
    await harness.database.query(
      `
        INSERT INTO provider_webhook_rejections (
          provider,
          nonce,
          provider_timestamp,
          received_at,
          request_hash,
          rejected_reason
        )
        VALUES (
          'simulated',
          'reconcile-replay-nonce',
          '2026-04-22T12:00:00.000Z',
          '2026-04-22T12:00:00.000Z',
          'request-hash-reconcile',
          'duplicate_nonce'
        )
      `,
    )

    const response = await request(harness.app)
      .get('/admin/operations/deposits/reconciliation')
      .set(operatorHeaders('reconcile-deposit-security-states'))
    const codes = response.body.reconciliation.issues.map(
      (issue: { code: string }) => issue.code,
    )

    expect(response.status).toBe(200)
    expect(codes).toEqual(
      expect.arrayContaining([
        'duplicate_external_transaction',
        'rejected_terminal',
        'reviewed_no_credit_terminal',
        'replay_rejected',
      ]),
    )
  })
})
