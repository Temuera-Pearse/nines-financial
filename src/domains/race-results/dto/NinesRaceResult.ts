import { z } from 'zod'

import { hashCanonicalJson } from '../../../shared/contracts/canonicalJson.js'
import type { JsonValue } from '../../../shared/types/Json.js'

export const NINES_RACE_RESULT_PATH = '/internal/v1/race-results'
export const NINES_RACE_RESULT_SCHEMA_VERSION = 'nines-race-result.v1'
export const NINES_RACE_RESULT_ACK_SCHEMA_VERSION = 'nines-race-result-ack.v1'

const identitySchema = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9:_-]+$/)

export const ninesRaceResultV1Schema = z.object({
  schemaVersion: z.literal(NINES_RACE_RESULT_SCHEMA_VERSION),
  eventType: z.literal('nines_race_completed.v1'),
  issuer: z.literal('nines-back-end'),
  audience: z.literal('nines-financial'),
  environment: z.enum(['development', 'test', 'production']),
  raceId: z.string().regex(/^race-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  raceRef: z.string().regex(/^N9-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/),
  resultId: z.string().uuid(),
  resultVersion: z.literal(1),
  completedAt: z.string().datetime({ offset: true }),
  winningRunnerId: identitySchema,
  winningSelectionId: identitySchema,
  finishOrder: z.array(identitySchema).min(2).max(64),
  raceChecksum: z.string().regex(/^[0-9a-f]{64}$/),
  closeLifecycleEventId: z.string().uuid(),
  closeLifecycleEvidenceHash: z.string().regex(/^[0-9a-f]{64}$/),
  correlationId: identitySchema,
  causationId: identitySchema,
  evidenceHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict().superRefine((value, context) => {
  if (value.winningRunnerId !== value.winningSelectionId) context.addIssue({
    code: z.ZodIssueCode.custom, message: 'winning selection must equal authoritative runner',
    path: ['winningSelectionId'],
  })
  if (value.finishOrder[0] !== value.winningRunnerId) context.addIssue({
    code: z.ZodIssueCode.custom, message: 'winning runner must be first in finish order',
    path: ['finishOrder'],
  })
  if (new Set(value.finishOrder).size !== value.finishOrder.length) context.addIssue({
    code: z.ZodIssueCode.custom, message: 'finish order must contain unique runners',
    path: ['finishOrder'],
  })
  if (value.causationId !== value.closeLifecycleEventId) context.addIssue({
    code: z.ZodIssueCode.custom, message: 'result causation must be the authoritative close event',
    path: ['causationId'],
  })
})

export type NinesRaceResultV1 = z.infer<typeof ninesRaceResultV1Schema>

export interface NinesRaceResultAckV1 {
  schemaVersion: typeof NINES_RACE_RESULT_ACK_SCHEMA_VERSION
  resultType: 'nines_race_result_ack'
  result: 'settled' | 'replayed'
  raceId: string
  raceRef: string
  resultId: string
  resultVersion: 1
  settlementRunId: string
  poolStatus: 'settled'
  totalPoolMinor: string
  acceptedStakeMinor: string
  appliedCarryoverMinor: string
  houseTakeMinor: string
  netPoolMinor: string
  roundingResidualMinor: string
  carryoverMinor: string
  settledAt: string
  correlationId: string
}

export function raceResultEvidenceHash(
  event: Omit<NinesRaceResultV1, 'evidenceHash'>,
): string {
  return hashCanonicalJson(event as unknown as JsonValue)
}
