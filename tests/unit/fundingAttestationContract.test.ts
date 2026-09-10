import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { confirmedFundingAttestationV1Schema } from '../../src/domains/funding-attestations/dto/ConfirmedFundingAttestation.js'
import { applyNinesIssuancePolicy, usdcToNinesParV1 } from '../../src/domains/funding-attestations/policies/NinesIssuancePolicy.js'
import { loadEnv } from '../../src/config/env.js'

describe('ConfirmedFundingAttestation contract', () => {
  it('locks the cross-repository schema fixture', () => {
    const fixture = readFileSync('contracts/confirmed-funding-attestation-v1.schema.json')
    expect(createHash('sha256').update(fixture).digest('hex'))
      .toBe('e9e46c6f68ba73314ee8eef0f0b9eead1ec3c6b3caebe5afcd2a5d8d7c3278e1')
  })
  it('does not permit Financial command or NINES output fields', () => {
    const result = confirmedFundingAttestationV1Schema.safeParse({ schemaVersion: 1,
      eventType: 'external_funding_confirmed', fundingAttestationId: randomUUID(),
      issuer: 'nines-api', audience: 'nines-financial', environment: 'test',
      playerId: randomUUID(), fundingIntentId: randomUUID(),
      provider: { name: 'fake', paymentReference: 'payment', confirmationEventId: 'event' },
      externalPayment: { asset: 'USDC', atomicUnits: '100000000', scale: 6 },
      confirmedAt: '2026-09-01T00:00:00.000Z', issuedAt: '2026-09-01T00:00:00.000Z',
      automaticProcessingUntil: '2026-09-02T00:00:00.000Z',
      purchaseEligibility: { decisionId: randomUUID(), policyVersion: 'eligibility-v1',
        evaluatedAt: '2026-09-01T00:00:00.000Z' }, correlationId: 'corr', causationId: 'cause',
      ninesAmount: '100000000' })
    expect(result.success).toBe(false)
  })
  it('defines the versioned integer 1:1 scale-6 policy inside Financial', () => {
    expect(usdcToNinesParV1).toMatchObject({ inputAsset: 'USDC', inputScale: 6,
      outputCurrency: 'NINES', outputScale: 6, policyVersion: 'usdc-to-nines-par-v1' })
    expect(applyNinesIssuancePolicy({ asset: 'USDC', scale: 6,
      atomicUnits: '100000000' })).toMatchObject({ currency: 'NINES', scale: 6,
      minorUnits: '100000000' })
  })
  it('prevents dual external-funding authority and development HMAC in production', () => {
    const base = { NODE_ENV: 'production', NINES_API_FUNDING_ATTESTATIONS_ENABLED: 'true',
      NINES_SERVICE_AUTH_HMAC_SECRET: 'a'.repeat(32) }
    expect(() => loadEnv({ ...base, NINES_LEGACY_DEPOSIT_PROVIDER_ENABLED: 'true' }))
      .toThrow('cannot both be enabled')
    expect(() => loadEnv({ ...base, NINES_LEGACY_DEPOSIT_PROVIDER_ENABLED: 'false' }))
      .toThrow('production service authenticator')
    expect(loadEnv({ NODE_ENV: 'production' }).NINES_LEGACY_DEPOSIT_PROVIDER_ENABLED).toBe(false)
  })
})
