import { z } from 'zod'

import type { JsonObject } from '../../../shared/types/Json.js'
import { hashCanonicalJson } from '../../../shared/contracts/canonicalJson.js'

const uuid = z.string().uuid()
const timestamp = z.string().datetime({ offset: true })

export const confirmedFundingAttestationV1Schema = z.object({
  schemaVersion: z.literal(1),
  eventType: z.literal('external_funding_confirmed'),
  fundingAttestationId: uuid,
  issuer: z.literal('nines-api'),
  audience: z.literal('nines-financial'),
  environment: z.enum(['development', 'test', 'production']),
  playerId: uuid,
  fundingIntentId: uuid,
  provider: z.object({
    name: z.string().trim().min(1).max(64),
    paymentReference: z.string().trim().min(1).max(256),
    confirmationEventId: z.string().trim().min(1).max(128),
  }).strict(),
  externalPayment: z.object({
    asset: z.string().regex(/^[A-Z][A-Z0-9]{1,11}$/),
    atomicUnits: z.string().regex(/^[1-9][0-9]*$/).max(96),
    scale: z.number().int().min(0).max(30),
  }).strict(),
  confirmedAt: timestamp,
  issuedAt: timestamp,
  automaticProcessingUntil: timestamp,
  purchaseEligibility: z.object({
    decisionId: uuid,
    policyVersion: z.string().trim().min(1).max(128),
    evaluatedAt: timestamp,
  }).strict(),
  correlationId: z.string().trim().min(1).max(256),
  causationId: z.string().trim().min(1).max(256),
}).strict()

export type ConfirmedFundingAttestationV1 = z.infer<typeof confirmedFundingAttestationV1Schema>

export function hashFundingAttestation(attestation: ConfirmedFundingAttestationV1): string {
  return hashCanonicalJson(attestation as JsonObject)
}

export interface FundingAttestationResponseDto {
  fundingAttestationId: string
  attestationPayloadHash: string
  outcome: 'accepted' | 'duplicate' | 'review_required'
  financialConsumptionId: string
  issuancePolicyVersion: string | null
  issuedCurrency: 'NINES' | null
  issuedMinorUnits: string | null
  ledgerTransactionId: string | null
  processedAt: string
  reasonCode: string | null
}
