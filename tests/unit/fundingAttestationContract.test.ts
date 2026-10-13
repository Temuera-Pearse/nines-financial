import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { confirmedFundingAttestationV1Schema } from '../../src/domains/funding-attestations/dto/ConfirmedFundingAttestation.js'
import { applyNinesIssuancePolicy, usdcToNinesParV1 } from '../../src/domains/funding-attestations/policies/NinesIssuancePolicy.js'
import { loadEnv, loadServerEnv } from '../../src/config/env.js'

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
  it('prevents dual external-funding authority and supports isolated production HMAC', () => {
    const base = { NODE_ENV: 'production', NINES_API_FUNDING_ATTESTATIONS_ENABLED: 'true',
      NINES_API_AUTH_HMAC_SECRET: 'a'.repeat(32), NINES_API_AUTH_KEY_ID: 'api-financial-v1' }
    expect(() => loadEnv({ ...base, NINES_LEGACY_DEPOSIT_PROVIDER_ENABLED: 'true' }))
      .toThrow('cannot both be enabled')
    expect(loadEnv({ ...base, NINES_LEGACY_DEPOSIT_PROVIDER_ENABLED: 'false' }).apiAuthHmacKeys)
      .toEqual({ 'api-financial-v1': 'a'.repeat(32) })
    expect(() => loadEnv({ NODE_ENV: 'production',
      NINES_API_FUNDING_ATTESTATIONS_ENABLED: 'true',
      NINES_LEGACY_DEPOSIT_PROVIDER_ENABLED: 'false', NINES_API_AUTH_KEY_ID: 'missing-secret' }))
      .toThrow('configured together')
    expect(() => loadEnv({ NODE_ENV: 'production',
      NINES_API_FUNDING_ATTESTATIONS_ENABLED: 'true',
      NINES_LEGACY_DEPOSIT_PROVIDER_ENABLED: 'false', NINES_API_AUTH_HMAC_SECRET: 'a'.repeat(32) }))
      .toThrow('configured together')
    expect(() => loadEnv({ NODE_ENV: 'production',
      NINES_API_FUNDING_ATTESTATIONS_ENABLED: 'true',
      NINES_LEGACY_DEPOSIT_PROVIDER_ENABLED: 'false',
      NINES_SERVICE_AUTH_HMAC_SECRET: 'a'.repeat(32) })).toThrow('NINES_API_AUTH_HMAC_SECRET')
    expect(loadEnv({ NODE_ENV: 'production' }).NINES_LEGACY_DEPOSIT_PROVIDER_ENABLED).toBe(false)
    expect(() => loadEnv({ NODE_ENV: 'production',
      NINES_SECURITY_EVIDENCE_DELIVERY_ENABLED: 'true',
      NINES_SECURITY_SERVICE_BASE_URL: 'https://security.example',
      NINES_SECURITY_AUTH_KEY_ID: 'missing-secret' })).toThrow('configured together')
    expect(() => loadEnv({ NODE_ENV: 'production',
      NINES_SECURITY_EVIDENCE_DELIVERY_ENABLED: 'true',
      NINES_SECURITY_SERVICE_BASE_URL: 'https://security.example',
      NINES_SECURITY_AUTH_HMAC_SECRET: 'c'.repeat(32) })).toThrow('configured together')
  })

  it('supports receiver key overlap and isolated Financial to Security credentials', () => {
    const env = loadEnv({ NODE_ENV: 'production',
      NINES_API_FUNDING_ATTESTATIONS_ENABLED: 'true',
      NINES_LEGACY_DEPOSIT_PROVIDER_ENABLED: 'false',
      NINES_API_AUTH_HMAC_SECRET: 'a'.repeat(32), NINES_API_AUTH_KEY_ID: 'api-financial-v2',
      NINES_API_AUTH_HMAC_ADDITIONAL_KEYS: JSON.stringify({ 'api-financial-v1': 'b'.repeat(32) }),
      NINES_SECURITY_EVIDENCE_DELIVERY_ENABLED: 'true',
      NINES_SECURITY_SERVICE_BASE_URL: 'https://security.example',
      NINES_SECURITY_AUTH_HMAC_SECRET: 'c'.repeat(32),
      NINES_SECURITY_AUTH_KEY_ID: 'financial-security-v1' })
    expect(env.apiAuthHmacKeys).toEqual({
      'api-financial-v1': 'b'.repeat(32), 'api-financial-v2': 'a'.repeat(32) })
    expect(env.securityAuthHmacSecret).toBe('c'.repeat(32))
    expect(env.securityAuthKeyId).toBe('financial-security-v1')
    expect(() => loadEnv({ NODE_ENV: 'production',
      NINES_API_FUNDING_ATTESTATIONS_ENABLED: 'true',
      NINES_LEGACY_DEPOSIT_PROVIDER_ENABLED: 'false',
      NINES_API_AUTH_HMAC_SECRET: 'x'.repeat(32), NINES_API_AUTH_KEY_ID: 'api-financial-v1',
      NINES_SECURITY_EVIDENCE_DELIVERY_ENABLED: 'true',
      NINES_SECURITY_SERVICE_BASE_URL: 'https://security.example',
      NINES_SECURITY_AUTH_HMAC_SECRET: 'x'.repeat(32),
      NINES_SECURITY_AUTH_KEY_ID: 'financial-security-v1' })).toThrow('different HMAC secrets')
  })

  it('requires HTTPS and explicit outbound Security credentials in production', () => {
    const base = { NODE_ENV: 'production',
      NINES_SECURITY_EVIDENCE_DELIVERY_ENABLED: 'true',
      NINES_SECURITY_AUTH_HMAC_SECRET: 'c'.repeat(32),
      NINES_SECURITY_AUTH_KEY_ID: 'financial-security-v1' }
    expect(() => loadEnv({ ...base,
      NINES_SECURITY_SERVICE_BASE_URL: 'http://security.example' }))
      .toThrow('NINES_SECURITY_SERVICE_BASE_URL must use HTTPS')
    expect(loadEnv({ ...base,
      NINES_SECURITY_SERVICE_BASE_URL: 'https://security.example' }))
      .toMatchObject({ securityAuthHmacSecret: 'c'.repeat(32),
        securityAuthKeyId: 'financial-security-v1' })
    expect(() => loadEnv({ NODE_ENV: 'production',
      NINES_SECURITY_EVIDENCE_DELIVERY_ENABLED: 'true',
      NINES_SECURITY_SERVICE_BASE_URL: 'https://security.example',
      NINES_SERVICE_AUTH_HMAC_SECRET: 'legacy-secret'.padEnd(32, '-') }))
      .toThrow('NINES_SECURITY_AUTH_HMAC_SECRET')
  })

  it('requires an explicit valid environment at the deployed server boundary', () => {
    expect(() => loadServerEnv({})).toThrow(
      'NODE_ENV must be explicitly set',
    )
    expect(() => loadServerEnv({ NODE_ENV: '' })).toThrow(
      'NODE_ENV must be explicitly set',
    )
    expect(() => loadServerEnv({ NODE_ENV: 'staging' })).toThrow()
    expect(loadServerEnv({ NODE_ENV: 'development' }).NODE_ENV).toBe(
      'development',
    )
  })

  it('cannot activate production funding through development compatibility credentials', () => {
    expect(() => loadServerEnv({
      NODE_ENV: 'production',
      NINES_API_FUNDING_ATTESTATIONS_ENABLED: 'true',
      NINES_SERVICE_AUTH_HMAC_SECRET: 'legacy-secret'.padEnd(32, '-'),
    })).toThrow('NINES_API_AUTH_HMAC_SECRET')
    expect(() => loadServerEnv({
      NODE_ENV: 'production',
      NINES_API_FUNDING_ATTESTATIONS_ENABLED: 'true',
    })).toThrow('NINES_API_AUTH_HMAC_SECRET')
    expect(() => loadServerEnv({
      NODE_ENV: 'production',
      NINES_LEGACY_DEPOSIT_PROVIDER_ENABLED: 'true',
    })).toThrow('not available in the production funding-only HTTP profile')
  })
})
