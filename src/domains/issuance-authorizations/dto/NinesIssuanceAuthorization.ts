import { z } from 'zod'
import { hashCanonicalJson } from '../../../shared/contracts/canonicalJson.js'
import type { JsonObject } from '../../../shared/types/Json.js'

const uuid = z.string().uuid()
const hash = z.string().regex(/^[0-9a-f]{64}$/)
const timestamp = z.string().datetime({ offset: true })
const identity = z.string().trim().min(1).max(256)
const positiveInteger = z.string().regex(/^[1-9][0-9]*$/).max(20)

export const ninesIssuanceAuthorizationV1Schema = z.object({
  schemaVersion: z.literal(1),
  eventType: z.literal('nines_issuance_authorized'),
  authorizationId: uuid,
  issuer: z.literal('nines-api'),
  audience: z.literal('nines-financial'),
  environment: z.enum(['development', 'test', 'production']),
  playerId: uuid,
  funding: z.object({
    intentId: uuid,
    confirmationEventId: uuid,
    evidenceIdentity: identity,
    requestHash: hash,
    confirmationPayloadHash: hash,
    provider: z.string().trim().min(1).max(64),
    paymentReference: identity,
  }).strict(),
  valuation: z.object({
    workflowId: uuid,
    completedValuationId: uuid,
    completionKey: z.string().trim().min(1).max(128),
    evidenceFingerprint: hash,
    valuedAt: timestamp,
    profileVersion: z.literal('funding-nzd-valuation-profile-v1'),
    finalNzdAmount: z.string().regex(/^(0|[1-9][0-9]*)\.[0-9]{2}$/),
    finalNzdMinorUnits: z.string().regex(/^[1-9][0-9]*$/).max(96),
    calculationPolicyVersion: z.literal('nzd-valuation-calculation-v1'),
    roundingPolicyVersion: z.literal('nzd-valuation-rounding-v1'),
  }).strict(),
  issuance: z.object({
    policyVersion: z.literal('nzd-valuation-to-nines-par-v1'),
    currency: z.literal('NINES'),
    scale: z.literal(6),
    minorUnits: positiveInteger,
  }).strict(),
  authorizedAt: timestamp,
  correlationId: identity,
  causationId: identity,
}).strict()

export type NinesIssuanceAuthorizationV1 = z.infer<typeof ninesIssuanceAuthorizationV1Schema>

export interface NinesIssuanceAcknowledgementV1 {
  schemaVersion: 1
  eventType: 'nines_issuance_consumed'
  issuer: 'nines-financial'
  audience: 'nines-api'
  environment: 'development' | 'test' | 'production'
  authorizationId: string
  authorizationPayloadHash: string
  financialConsumptionId: string
  ledgerTransactionId: string
  playerId: string
  issuance: { currency: 'NINES'; scale: 6; minorUnits: string }
  processedAt: string
  result: 'accepted' | 'already_consumed'
  correlationId: string
  causationId: string
}

export function hashNinesIssuanceAuthorization(value: NinesIssuanceAuthorizationV1): string {
  return hashCanonicalJson(value as unknown as JsonObject)
}
