import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  hashNinesIssuanceAuthorization,
  ninesIssuanceAuthorizationV1Schema,
} from '../../src/domains/issuance-authorizations/dto/NinesIssuanceAuthorization.js'

const fixture = JSON.parse(readFileSync(
  new URL('../../contracts/nines-issuance-authorization-v1.fixtures.json', import.meta.url), 'utf8'))

describe('NINES issuance cross-repository fixture', () => {
  it('accepts the canonical authorization and locks its canonical hash', () => {
    const authorization = ninesIssuanceAuthorizationV1Schema.parse(fixture.authorization)
    expect(hashNinesIssuanceAuthorization(authorization)).toBe(fixture.authorizationPayloadHash)
    expect(fixture.acceptedAcknowledgement.authorizationPayloadHash)
      .toBe(fixture.authorizationPayloadHash)
    expect(fixture.alreadyConsumedAcknowledgement.financialConsumptionId)
      .toBe(fixture.acceptedAcknowledgement.financialConsumptionId)
    expect(fixture.alreadyConsumedAcknowledgement.ledgerTransactionId)
      .toBe(fixture.acceptedAcknowledgement.ledgerTransactionId)
  })

  it.each([
    ['policy', { issuance: { ...fixture.authorization.issuance, policyVersion: 'other' } }],
    ['currency', { issuance: { ...fixture.authorization.issuance, currency: 'NZD' } }],
    ['scale', { issuance: { ...fixture.authorization.issuance, scale: 2 } }],
    ['audience', { audience: 'other' }],
    ['issuer', { issuer: 'other' }],
    ['environment', { environment: 'other' }],
  ])('rejects unsupported %s contract evidence', (_name, override) => {
    expect(ninesIssuanceAuthorizationV1Schema.safeParse({
      ...fixture.authorization, ...override,
    }).success).toBe(false)
  })
})
