import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { createApp } from '../../src/app.js'
import { hashFundingAttestation, type ConfirmedFundingAttestationV1 } from '../../src/domains/funding-attestations/dto/ConfirmedFundingAttestation.js'
import { signServiceMessage } from '../../src/shared/security/ServiceMessageAuthentication.js'
import {
  createTestApplication,
  stateChangingHeaders,
  type TestApplicationHarness,
} from '../support/testApp.js'
import type { Clock } from '../../src/shared/time/Clock.js'

const secret = 'financial-attestation-test-secret-at-least-32'
const credentials = { 'nines-api': { 'development-hmac-v1': secret } }
const now = new Date('2026-04-22T12:00:00.000Z')

function attestation(overrides: Partial<ConfirmedFundingAttestationV1> = {}): ConfirmedFundingAttestationV1 {
  return { schemaVersion: 1, eventType: 'external_funding_confirmed',
    fundingAttestationId: randomUUID(), issuer: 'nines-api', audience: 'nines-financial',
    environment: 'test', playerId: randomUUID(), fundingIntentId: randomUUID(),
    provider: { name: 'fake', paymentReference: `payment-${randomUUID()}`,
      confirmationEventId: `confirmation-${randomUUID()}` },
    externalPayment: { asset: 'USDC', atomicUnits: '1250000', scale: 6 },
    confirmedAt: '2026-04-22T11:55:00.000Z', issuedAt: '2026-04-22T11:56:00.000Z',
    automaticProcessingUntil: '2026-04-23T11:56:00.000Z',
    purchaseEligibility: { decisionId: randomUUID(), policyVersion: 'eligibility-v1',
      evaluatedAt: '2026-04-22T11:50:00.000Z' },
    correlationId: `corr-${randomUUID()}`, causationId: `cause-${randomUUID()}`, ...overrides }
}

function signedHeaders(body: ConfirmedFundingAttestationV1, requestId = randomUUID(), options: {
  serviceId?: string; keyId?: string; secret?: string; environment?: string;
  method?: string; path?: string; sentAt?: string; contentHash?: string
} = {}) {
  const sentAt = options.sentAt ?? new Date().toISOString()
  const contentHash = options.contentHash ?? hashFundingAttestation(body)
  const serviceId = options.serviceId ?? 'nines-api'
  const keyId = options.keyId ?? 'development-hmac-v1'
  return { 'x-nines-service-id': serviceId, 'x-nines-key-id': keyId,
    'x-nines-request-id': requestId, 'x-nines-sent-at': sentAt,
    'x-nines-content-sha256': contentHash,
    'x-nines-signature': signServiceMessage({ method: options.method ?? 'POST',
      path: options.path ?? '/internal/v1/funding-attestations',
      environment: options.environment ?? 'test', serviceId, keyId, requestId, sentAt,
      contentHash, secret: options.secret ?? secret }) }
}

describe('API funding attestation to NINES issuance', () => {
  let harness: TestApplicationHarness | undefined
  afterEach(async () => { await harness?.close(); harness = undefined })

  it('does not expose the internal endpoint when the integration is disabled', async () => {
    harness = await createTestApplication(now)
    const app = createApp({ ...harness.container.services, ...harness.container.handlers }, {
      database: harness.database, environment: 'test', fundingAttestationsEnabled: false })
    expect((await request(app).post('/internal/v1/funding-attestations').send(attestation())).status)
      .toBe(404)
  })

  it('recovers a lost acknowledgement by returning the original result without another issuance', async () => {
    harness = await createTestApplication(now)
    const app = createApp({ ...harness.container.services, ...harness.container.handlers }, {
      database: harness.database, environment: 'test', fundingAttestationsEnabled: true,
      legacyDepositProviderEnabled: false, serviceAuthCredentials: credentials,
      readinessCheck: async () => ({ checkedAt: now, latestAvailableMigration: null,
        latestAppliedMigration: null, pendingMigrations: [] }) })
    const body = attestation()
    const accepted = await request(app).post('/internal/v1/funding-attestations')
      .set(signedHeaders(body)).send(body)
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201)
    expect(accepted.body).toMatchObject({ outcome: 'accepted', issuedCurrency: 'NINES',
      issuedMinorUnits: '1250000', issuancePolicyVersion: 'usdc-to-nines-par-v1' })

    const duplicate = await request(app).post('/internal/v1/funding-attestations')
      .set(signedHeaders(body)).send(body)
    expect(duplicate.status).toBe(200)
    expect(duplicate.body).toMatchObject({ outcome: 'duplicate',
      ledgerTransactionId: accepted.body.ledgerTransactionId })

    const ledger = await harness.database.query(`SELECT count(*)::int AS count FROM ledger_transactions
      WHERE transaction_type='token_purchase_issuance' AND reference_id=$1`, [body.fundingAttestationId])
    expect(Number(ledger.rows[0]?.count)).toBe(1)
    const nines = await harness.database.query(`SELECT balance_minor FROM account_balances b JOIN accounts a USING(account_id)
      WHERE a.owner_id=$1 AND a.account_type='user_available' AND a.currency='NINES'`, [body.playerId])
    expect(String(nines.rows[0]?.balance_minor)).toBe('1250000')
    const usdc = await harness.database.query(`SELECT count(*)::int AS count FROM accounts WHERE owner_id=$1 AND currency='USDC'`, [body.playerId])
    expect(Number(usdc.rows[0]?.count)).toBe(0)
  })

  it('makes the funded NINES user_available account spendable by wagering', async () => {
    harness = await createTestApplication(now)
    const app = createApp(
      { ...harness.container.services, ...harness.container.handlers },
      {
        database: harness.database,
        environment: 'test',
        fundingAttestationsEnabled: true,
        legacyDepositProviderEnabled: false,
        serviceAuthCredentials: credentials,
      },
    )
    const body = attestation()
    const funding = await request(app)
      .post('/internal/v1/funding-attestations')
      .set(signedHeaders(body))
      .send(body)

    expect(funding.status).toBe(201)
    await request(app).post('/commands/create-race-pool').send({
      raceId: 'race-funded-nines',
      currency: 'NINES',
      idempotencyKey: 'pool-funded-nines',
      correlationId: 'corr_pool_funded_nines',
      causationId: 'cause_pool_funded_nines',
    })
    await request(app).post('/commands/register-pool-selection').send({
      raceId: 'race-funded-nines',
      selectionId: 'horse-funded-nines',
      currency: 'NINES',
      idempotencyKey: 'selection-funded-nines',
      correlationId: 'corr_selection_funded_nines',
      causationId: 'cause_selection_funded_nines',
    })
    const wager = await request(app)
      .post('/commands/place-bet')
      .set(
        stateChangingHeaders(
          'bet-funded-nines',
          'corr_bet_funded_nines',
          'cause_bet_funded_nines',
        ),
      )
      .send({
        betId: 'bet-funded-nines',
        userId: body.playerId,
        raceId: 'race-funded-nines',
        selectionId: 'horse-funded-nines',
        stakeMinor: '250000',
        currency: 'NINES',
      })
    const accountAndReservation = await harness.database.query<{
      available_account_id: string
      debited_account_id: string
      currency: string
    }>(
      `
        SELECT
          pa.available_account_id,
          le.account_id AS debited_account_id,
          le.currency
        FROM player_accounts pa
        JOIN ledger_transactions lt
          ON lt.reference_type = 'bet'
          AND lt.reference_id = 'bet-funded-nines'
          AND lt.transaction_type = 'bet_reserve'
        JOIN ledger_entries le
          ON le.transaction_id = lt.transaction_id
          AND le.direction = 'debit'
        WHERE pa.user_id = $1
          AND pa.currency = 'NINES'
      `,
      [body.playerId],
    )

    expect(wager.status).toBe(201)
    expect(wager.body).toMatchObject({
      accepted: true,
      bet: { currency: 'NINES', stakeMinor: '250000' },
    })
    expect(accountAndReservation.rows[0]).toMatchObject({
      currency: 'NINES',
      debited_account_id: accountAndReservation.rows[0]?.available_account_id,
    })
  })

  it('routes attestations beyond the automatic window to review without a ledger posting', async () => {
    harness = await createTestApplication(now)
    const app = createApp({ ...harness.container.services, ...harness.container.handlers }, {
      database: harness.database, environment: 'test', fundingAttestationsEnabled: true,
      serviceAuthCredentials: credentials })
    const body = attestation({ automaticProcessingUntil: '2026-04-22T11:59:59.000Z' })
    const result = await request(app).post('/internal/v1/funding-attestations')
      .set(signedHeaders(body)).send(body)
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ outcome: 'review_required',
      reasonCode: 'AUTOMATIC_PROCESSING_WINDOW_EXPIRED', ledgerTransactionId: null })
    const ledger = await harness.database.query(`SELECT count(*)::int AS count FROM ledger_transactions
      WHERE reference_id=$1`, [body.fundingAttestationId])
    expect(Number(ledger.rows[0]?.count)).toBe(0)
  })

  it('rechecks the deadline after serialization and routes a crossing request to review', async () => {
    class MutableClock implements Clock {
      constructor(public current: Date) {}
      now() { return new Date(this.current) }
    }
    const clock = new MutableClock(now)
    harness = await createTestApplication(now, { clock })
    const repository = harness.container.repositories.fundingAttestationRepository
    const originalLock = repository.lock.bind(repository)
    repository.lock = async (id, transaction) => {
      await originalLock(id, transaction)
      clock.current = new Date('2026-04-22T12:00:01.000Z')
    }
    const app = createApp({ ...harness.container.services, ...harness.container.handlers }, {
      database: harness.database, environment: 'test', fundingAttestationsEnabled: true,
      serviceAuthCredentials: credentials })
    const body = attestation({ automaticProcessingUntil: '2026-04-22T12:00:01.000Z' })
    const result = await request(app).post('/internal/v1/funding-attestations')
      .set(signedHeaders(body)).send(body)
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ outcome: 'review_required',
      reasonCode: 'AUTOMATIC_PROCESSING_WINDOW_EXPIRED', ledgerTransactionId: null })
  })

  it('rejects tampering, replayed request nonces, and conflicting attestation reuse', async () => {
    harness = await createTestApplication(now)
    const app = createApp({ ...harness.container.services, ...harness.container.handlers }, {
      database: harness.database, environment: 'test', fundingAttestationsEnabled: true,
      serviceAuthCredentials: credentials })
    const body = attestation(); const headers = signedHeaders(body)
    expect((await request(app).post('/internal/v1/funding-attestations')
      .set({ ...signedHeaders(body), 'x-nines-service-id': 'nines-financial' }).send(body)).status).toBe(403)
    expect((await request(app).post('/internal/v1/funding-attestations')
      .set({ ...signedHeaders(body), 'x-nines-signature': '0'.repeat(64) }).send(body)).status).toBe(403)
    expect((await request(app).post('/internal/v1/funding-attestations')
      .set({ ...signedHeaders(body), 'x-nines-signature': 'not-hex' }).send(body)).status).toBe(403)
    expect((await request(app).post('/internal/v1/funding-attestations')
      .set({ ...signedHeaders(body), 'x-nines-key-id': 'other-key' }).send(body)).status).toBe(403)
    for (const keyId of ['__proto__', 'constructor', 'toString']) {
      const inheritedKey = await request(app)
        .post('/internal/v1/funding-attestations')
        .set(signedHeaders(body, randomUUID(), { keyId }))
        .send(body)
      expect(inheritedKey.status, keyId).toBe(403)
      expect(inheritedKey.body.error.code, keyId).toBe(
        'SERVICE_AUTH_UNTRUSTED_KEY',
      )
    }
    expect((await request(app).post('/internal/v1/funding-attestations').set(headers)
      .send({ ...body, correlationId: 'tampered' })).status).toBe(403)
    expect((await request(app).post('/internal/v1/funding-attestations')
      .set(signedHeaders(body, randomUUID(), { method: 'PUT' })).send(body)).status).toBe(403)
    expect((await request(app).post('/internal/v1/funding-attestations')
      .set(signedHeaders(body, randomUUID(), { path: '/internal/v1/evidence' })).send(body)).status).toBe(403)
    expect((await request(app).post('/internal/v1/funding-attestations')
      .set(signedHeaders(body, randomUUID(), { environment: 'production' })).send(body)).status).toBe(403)
    expect((await request(app).post('/internal/v1/funding-attestations')
      .set(signedHeaders(body, randomUUID(), { contentHash: '0'.repeat(64) })).send(body)).status).toBe(403)
    expect((await request(app).post('/internal/v1/funding-attestations')
      .set(signedHeaders(body, randomUUID(), { sentAt: new Date(Date.now() - 301_000).toISOString() }))
      .send(body)).status).toBe(403)
    expect((await request(app).post('/internal/v1/funding-attestations')
      .set(signedHeaders(body, randomUUID(), { sentAt: new Date(Date.now() + 301_000).toISOString() }))
      .send(body)).status).toBe(403)
    expect((await request(app).post('/internal/v1/funding-attestations')
      .set(signedHeaders(body, randomUUID(), { sentAt: 'not-a-timestamp' })).send(body)).status).toBe(403)
    expect((await request(app).post('/internal/v1/funding-attestations')
      .set(signedHeaders(body, randomUUID(), { secret: 'api-security-secret-isolated-at-least-32' }))
      .send(body)).status).toBe(403)
    expect((await request(app).post('/internal/v1/funding-attestations')
      .set(signedHeaders(body, randomUUID(), { secret: 'financial-security-secret-at-least-32' }))
      .send(body)).status).toBe(403)
    expect((await request(app).post('/internal/v1/funding-attestations')
      .set(signedHeaders(body, randomUUID(), { serviceId: 'nines-financial' })).send(body)).status).toBe(403)
    for (const missing of ['x-nines-service-id','x-nines-key-id','x-nines-signature'] as const) {
      const incomplete: Record<string, string> = { ...signedHeaders(body) }
      delete incomplete[missing]
      expect((await request(app).post('/internal/v1/funding-attestations')
        .set(incomplete).send(body)).status).toBe(403)
    }
    expect((await request(app).post('/internal/v1/funding-attestations').set(headers).send(body)).status).toBe(201)
    expect((await request(app).post('/internal/v1/funding-attestations').set(headers).send(body)).status).toBe(409)

    const clean = attestation()
    expect((await request(app).post('/internal/v1/funding-attestations').set(signedHeaders(clean)).send(clean)).status).toBe(201)
    const conflict = { ...clean, externalPayment: { ...clean.externalPayment, atomicUnits: '2' } }
    const response = await request(app).post('/internal/v1/funding-attestations').set(signedHeaders(conflict)).send(conflict)
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('FUNDING_ATTESTATION_PAYLOAD_CONFLICT')
  })

  it('rejects empty and malformed request IDs before database-backed processing', async () => {
    harness = await createTestApplication(now)
    const app = createApp({ ...harness.container.services, ...harness.container.handlers }, {
      database: harness.database, environment: 'test', fundingAttestationsEnabled: true,
      serviceAuthCredentials: credentials })
    const body = attestation()

    const emptyHeaders: Record<string, string> = { ...signedHeaders(body) }
    emptyHeaders['x-nines-request-id'] = ''
    const empty = await request(app).post('/internal/v1/funding-attestations')
      .set(emptyHeaders).send(body)
    expect(empty.status).toBe(403)
    expect(empty.body.error.code).toBe('SERVICE_AUTH_MISSING')

    const malformedRequestId = 'authenticated-but-not-a-uuid'
    const malformed = await request(app).post('/internal/v1/funding-attestations')
      .set(signedHeaders(body, malformedRequestId)).send(body)
    expect(malformed.status).toBe(403)
    expect(malformed.body.error.code).toBe('SERVICE_AUTH_INVALID_REQUEST_ID')
    expect(malformed.text).not.toMatch(/invalid input syntax|postgres|uuid input/i)

    const nonceCount = await harness.database.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM service_request_nonces')
    expect(Number(nonceCount.rows[0]?.count)).toBe(0)
    const consumptionCount = await harness.database.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM funding_attestation_consumptions')
    expect(Number(consumptionCount.rows[0]?.count)).toBe(0)
  })

  it('accepts overlapping API keys and rejects the old key after rotation', async () => {
    harness = await createTestApplication(now)
    const oldSecret = 'api-financial-old-secret-at-least-32-characters'
    const newSecret = 'api-financial-new-secret-at-least-32-characters'
    const services = { ...harness.container.services, ...harness.container.handlers }
    const overlap = createApp(services, { database: harness.database, environment: 'test',
      fundingAttestationsEnabled: true, serviceAuthCredentials: { 'nines-api': {
        'api-financial-v1': oldSecret, 'api-financial-v2': newSecret } } })
    const oldBody = attestation()
    expect((await request(overlap).post('/internal/v1/funding-attestations')
      .set(signedHeaders(oldBody, randomUUID(), { keyId: 'api-financial-v1', secret: oldSecret }))
      .send(oldBody)).status).toBe(201)
    const newBody = attestation()
    expect((await request(overlap).post('/internal/v1/funding-attestations')
      .set(signedHeaders(newBody, randomUUID(), { keyId: 'api-financial-v2', secret: newSecret }))
      .send(newBody)).status).toBe(201)

    const afterRemoval = createApp(services, { database: harness.database, environment: 'test',
      fundingAttestationsEnabled: true,
      serviceAuthCredentials: { 'nines-api': { 'api-financial-v2': newSecret } } })
    const retiredBody = attestation()
    expect((await request(afterRemoval).post('/internal/v1/funding-attestations')
      .set(signedHeaders(retiredBody, randomUUID(), { keyId: 'api-financial-v1', secret: oldSecret }))
      .send(retiredBody)).status).toBe(403)
    const currentBody = attestation()
    expect((await request(afterRemoval).post('/internal/v1/funding-attestations')
      .set(signedHeaders(currentBody, randomUUID(), { keyId: 'api-financial-v2', secret: newSecret }))
      .send(currentBody)).status).toBe(201)
  })

  it('rejects unsupported assets, scales, and cross-environment attestations', async () => {
    harness = await createTestApplication(now)
    const app = createApp({ ...harness.container.services, ...harness.container.handlers }, {
      database: harness.database, environment: 'test', fundingAttestationsEnabled: true,
      serviceAuthCredentials: credentials })
    for (const body of [
      attestation({ externalPayment: { asset: 'BTC', atomicUnits: '1', scale: 8 } }),
      attestation({ externalPayment: { asset: 'USDC', atomicUnits: '1', scale: 5 } }),
      attestation({ environment: 'development' }),
      attestation({ confirmedAt: '2026-04-22T12:06:00.001Z',
        issuedAt: '2026-04-22T12:06:00.001Z',
        automaticProcessingUntil: '2026-04-23T12:06:00.001Z' }),
      { ...attestation(), schemaVersion: 2 },
      { ...attestation(), audience: 'another-service' },
      { ...attestation(), playerId: 'not-a-canonical-player-id' },
    ]) {
      const response = await request(app).post('/internal/v1/funding-attestations')
        .set(signedHeaders(body as ConfirmedFundingAttestationV1)).send(body)
      expect(response.status).toBe(400)
    }
    const ledger = await harness.database.query(`SELECT count(*)::int AS count FROM ledger_transactions
      WHERE transaction_type='token_purchase_issuance'`)
    expect(Number(ledger.rows[0]?.count)).toBe(0)
  })

  it('rejects duplicate provider sources and duplicate funding-intent economic effects', async () => {
    harness = await createTestApplication(now)
    const app = createApp({ ...harness.container.services, ...harness.container.handlers }, {
      database: harness.database, environment: 'test', fundingAttestationsEnabled: true,
      serviceAuthCredentials: credentials })
    const first = attestation()
    expect((await request(app).post('/internal/v1/funding-attestations')
      .set(signedHeaders(first)).send(first)).status).toBe(201)
    for (const duplicateSource of [
      attestation({ provider: { ...first.provider,
        confirmationEventId: `confirmation-${randomUUID()}` } }),
      attestation({ fundingIntentId: randomUUID(), provider: { ...first.provider,
        confirmationEventId: `confirmation-${randomUUID()}` } }),
      attestation({ fundingAttestationId: randomUUID(), provider: { ...first.provider,
        confirmationEventId: `confirmation-${randomUUID()}` } }),
    ]) {
      const sourceResponse = await request(app).post('/internal/v1/funding-attestations')
        .set(signedHeaders(duplicateSource)).send(duplicateSource)
      expect(sourceResponse.status).toBe(409)
      expect(sourceResponse.body.error.code).toBe('FUNDING_SOURCE_ALREADY_CONSUMED')
    }
    const duplicateIntent = attestation({ fundingIntentId: first.fundingIntentId })
    const intentResponse = await request(app).post('/internal/v1/funding-attestations')
      .set(signedHeaders(duplicateIntent)).send(duplicateIntent)
    expect(intentResponse.status).toBe(409)
    expect(intentResponse.body.error.code).toBe('FUNDING_INTENT_ALREADY_CONSUMED')
    const ledger = await harness.database.query(`SELECT count(*)::int AS count FROM ledger_transactions
      WHERE transaction_type='token_purchase_issuance'`)
    expect(Number(ledger.rows[0]?.count)).toBe(1)
  })
})
