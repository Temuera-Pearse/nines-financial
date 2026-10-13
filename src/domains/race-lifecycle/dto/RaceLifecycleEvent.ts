import { z } from 'zod'

import { hashCanonicalJson } from '../../../shared/contracts/canonicalJson.js'
import type { JsonValue } from '../../../shared/types/Json.js'

export const NINES_RACE_LIFECYCLE_PATH = '/internal/v1/race-lifecycle-events'
export const NINES_RACE_LIFECYCLE_SCHEMA_VERSION = 'nines-race-lifecycle-event.v1'
export const NINES_RACE_LIFECYCLE_ACK_SCHEMA_VERSION = 'nines-race-lifecycle-ack.v1'

const identitySchema = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9:_-]+$/)
const isoTimestampSchema = z.string().datetime({ offset: true })

export const raceLifecycleSelectionV1Schema = z.object({
  runnerId: identitySchema,
  selectionId: identitySchema,
  displayName: z.string().trim().min(1).max(200),
}).strict().superRefine((value, context) => {
  if (value.runnerId !== value.selectionId) {
    context.addIssue({ code: z.ZodIssueCode.custom,
      message: 'selectionId must equal its authoritative runnerId', path: ['selectionId'] })
  }
})

export const raceEconomicPolicyV1Schema = z.object({
  policyId: z.literal('nines-parimutuel.v1'),
  policyVersion: z.literal(1),
  houseTakeBps: z.number().int().min(0).max(10_000),
  carryoverPolicyId: z.literal('nines-carryover.v1'),
  carryoverPolicyVersion: z.literal(1),
  settlementAllocationPolicyId: z.literal('nines-proportional-allocation.v1'),
  settlementAllocationPolicyVersion: z.literal(1),
  roundingPolicyId: z.literal('nines-largest-remainder.v1'),
  roundingPolicyVersion: z.literal(1),
}).strict()

export const ninesRaceLifecycleEventV1Schema = z.object({
  schemaVersion: z.literal(NINES_RACE_LIFECYCLE_SCHEMA_VERSION),
  eventType: z.enum(['nines_race_opened.v1', 'nines_race_betting_closed.v1']),
  issuer: z.literal('nines-back-end'),
  audience: z.literal('nines-financial'),
  environment: z.enum(['development', 'test', 'production']),
  raceId: z.string().regex(/^race-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  raceRef: z.string().regex(/^N9-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/),
  lifecycleEventId: z.string().uuid(),
  lifecycleSequence: z.union([z.literal(1), z.literal(2)]),
  bettingOpensAt: isoTimestampSchema,
  bettingClosesAt: isoTimestampSchema,
  selections: z.array(raceLifecycleSelectionV1Schema).min(2).max(64),
  currency: z.literal('NINES'),
  economicPolicy: raceEconomicPolicyV1Schema,
  correlationId: identitySchema,
  causationId: identitySchema,
  occurredAt: isoTimestampSchema,
  evidenceHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict().superRefine((value, context) => {
  const opensAt = Date.parse(value.bettingOpensAt)
  const closesAt = Date.parse(value.bettingClosesAt)
  if (closesAt <= opensAt) context.addIssue({ code: z.ZodIssueCode.custom,
    message: 'bettingClosesAt must be after bettingOpensAt', path: ['bettingClosesAt'] })
  const expectedSequence = value.eventType === 'nines_race_opened.v1' ? 1 : 2
  if (value.lifecycleSequence !== expectedSequence) context.addIssue({ code: z.ZodIssueCode.custom,
    message: 'Lifecycle sequence does not match event type', path: ['lifecycleSequence'] })
  const expectedOccurredAt = expectedSequence === 1 ? value.bettingOpensAt : value.bettingClosesAt
  if (value.occurredAt !== expectedOccurredAt) context.addIssue({ code: z.ZodIssueCode.custom,
    message: 'Event timestamp does not match its authoritative lifecycle boundary', path: ['occurredAt'] })
  const sorted = [...value.selections].sort((a, b) => a.selectionId.localeCompare(b.selectionId))
  if (new Set(sorted.map((selection) => selection.selectionId)).size !== sorted.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Selections must be unique', path: ['selections'] })
  }
  if (sorted.some((selection, index) => selection.selectionId !== value.selections[index]?.selectionId)) {
    context.addIssue({ code: z.ZodIssueCode.custom,
      message: 'Selections must be canonically ordered by selectionId', path: ['selections'] })
  }
})

export type NinesRaceLifecycleEventV1 = z.infer<typeof ninesRaceLifecycleEventV1Schema>
export type RaceLifecycleSelectionV1 = z.infer<typeof raceLifecycleSelectionV1Schema>
export type RaceEconomicPolicyV1 = z.infer<typeof raceEconomicPolicyV1Schema>

export interface NinesRaceLifecycleAckV1 {
  schemaVersion: typeof NINES_RACE_LIFECYCLE_ACK_SCHEMA_VERSION
  resultType: 'nines_race_lifecycle_ack'
  result: 'projected' | 'replayed'
  raceId: string
  raceRef: string
  lifecycleEventId: string
  lifecycleSequence: number
  eventType: NinesRaceLifecycleEventV1['eventType']
  poolStatus: 'open' | 'frozen'
  effectiveAt: string
  correlationId: string
}

export function raceLifecycleEvidenceHash(
  event: Omit<NinesRaceLifecycleEventV1, 'evidenceHash'>,
): string {
  return hashCanonicalJson(event as unknown as JsonValue)
}

export function raceLifecycleSelectionSetHash(
  selections: readonly RaceLifecycleSelectionV1[],
): string {
  return hashCanonicalJson(selections as unknown as JsonValue)
}

export function raceLifecyclePolicyHash(policy: RaceEconomicPolicyV1): string {
  return hashCanonicalJson(policy as unknown as JsonValue)
}
