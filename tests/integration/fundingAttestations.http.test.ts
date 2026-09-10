import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { createApp } from '../../src/app.js'
import { hashFundingAttestation, type ConfirmedFundingAttestationV1 } from '../../src/domains/funding-attestations/dto/ConfirmedFundingAttestation.js'
import { signServiceMessage } from '../../src/shared/security/ServiceMessageAuthentication.js'
import { createTestApplication, type TestApplicationHarness } from '../support/testApp.js'
import type { Clock } from '../../src/shared/time/Clock.js'

const secret = 'financial-attestation-test-secret-at-least-32'
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

function signedHeaders(body: ConfirmedFundingAttestationV1, requestId = randomUUID()) {
  const sentAt = new Date().toISOString(); const contentHash = hashFundingAttestation(body)
  const serviceId = 'nines-api'; const keyId = 'development-hmac-v1'
  return { 'x-nines-service-id': serviceId, 'x-nines-key-id': keyId,
    'x-nines-request-id': requestId, 'x-nines-sent-at': sentAt,
    'x-nines-content-sha256': contentHash,
    'x-nines-signature': signServiceMessage({ method: 'POST', path: '/internal/v1/funding-attestations',
      environment: 'test', serviceId, keyId, requestId, sentAt, contentHash, secret }) }
}

describe('API funding attestation to NINES issuance', () => {
  let harness: TestApplicationHarness | undefined
  afterEach(async () => { await harness?.close(); harness = undefined })

  it('recovers a lost acknowledgement by returning the original result without another issuance', async () => {
    harness = await createTestApplication(now)
    const app = createApp({ ...harness.container.services, ...harness.container.handlers }, {
      database: harness.database, environment: 'test', fundingAttestationsEnabled: true,
      legacyDepositProviderEnabled: false, serviceAuthHmacSecret: secret,
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

  it('routes attestations beyond the automatic window to review without a ledger posting', async () => {
    harness = await createTestApplication(now)
    const app = createApp({ ...harness.container.services, ...harness.container.handlers }, {
      database: harness.database, environment: 'test', fundingAttestationsEnabled: true,
      serviceAuthHmacSecret: secret })
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
      serviceAuthHmacSecret: secret })
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
      serviceAuthHmacSecret: secret })
    const body = attestation(); const headers = signedHeaders(body)
    expect((await request(app).post('/internal/v1/funding-attestations')
      .set({ ...signedHeaders(body), 'x-nines-service-id': 'nines-financial' }).send(body)).status).toBe(403)
    expect((await request(app).post('/internal/v1/funding-attestations')
      .set({ ...signedHeaders(body), 'x-nines-signature': '0'.repeat(64) }).send(body)).status).toBe(403)
    expect((await request(app).post('/internal/v1/funding-attestations')
      .set({ ...signedHeaders(body), 'x-nines-key-id': 'other-key' }).send(body)).status).toBe(403)
    expect((await request(app).post('/internal/v1/funding-attestations').set(headers)
      .send({ ...body, correlationId: 'tampered' })).status).toBe(403)
    expect((await request(app).post('/internal/v1/funding-attestations').set(headers).send(body)).status).toBe(201)
    expect((await request(app).post('/internal/v1/funding-attestations').set(headers).send(body)).status).toBe(409)

    const clean = attestation()
    expect((await request(app).post('/internal/v1/funding-attestations').set(signedHeaders(clean)).send(clean)).status).toBe(201)
    const conflict = { ...clean, externalPayment: { ...clean.externalPayment, atomicUnits: '2' } }
    const response = await request(app).post('/internal/v1/funding-attestations').set(signedHeaders(conflict)).send(conflict)
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('FUNDING_ATTESTATION_PAYLOAD_CONFLICT')
  })

  it('rejects unsupported assets, scales, and cross-environment attestations', async () => {
    harness = await createTestApplication(now)
    const app = createApp({ ...harness.container.services, ...harness.container.handlers }, {
      database: harness.database, environment: 'test', fundingAttestationsEnabled: true,
      serviceAuthHmacSecret: secret })
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
      serviceAuthHmacSecret: secret })
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
