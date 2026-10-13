import { z } from 'zod'

import { hashCanonicalJson } from '../../../shared/contracts/canonicalJson.js'
import type { JsonObject } from '../../../shared/types/Json.js'

export const NINES_PLACE_BET_PATH = '/internal/v1/wagers/place-bet'
export const NINES_PLACE_BET_SCHEMA_VERSION = 'nines-place-bet-command.v1'
export const NINES_PLAYER_ASSERTION_SCHEMA_VERSION =
  'nines-player-identity-assertion.v1'
export const NINES_PLACE_BET_RESULT_SCHEMA_VERSION =
  'nines-place-bet-result.v1'

const uuid = z.string().uuid()
const identity = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9:_-]+$/)
const raceReference = z.string().regex(/^N9-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/)
const timestamp = z.string().datetime({ offset: true })
const MAX_PLAYER_ASSERTION_LIFETIME_MS = 5 * 60_000

export const ninesPlayerIdentityAssertionV1Schema = z.object({
  schemaVersion: z.literal(NINES_PLAYER_ASSERTION_SCHEMA_VERSION),
  assertionId: uuid,
  subjectPlayerId: uuid,
  assertedBy: z.literal('nines-back-end'),
  authenticationMethod: z.literal('upstream_access_token'),
  authenticatedAt: timestamp,
  expiresAt: timestamp,
}).strict()

const commandWithoutEvidenceHashSchema = z.object({
  schemaVersion: z.literal(NINES_PLACE_BET_SCHEMA_VERSION),
  commandType: z.literal('nines_place_bet'),
  issuer: z.literal('nines-back-end'),
  audience: z.literal('nines-financial'),
  environment: z.enum(['development', 'test', 'production']),
  betId: uuid,
  playerId: uuid,
  raceId: identity,
  raceRef: raceReference,
  selectionId: identity,
  stake: z.object({
    currency: z.literal('NINES'),
    scale: z.literal(6),
    minorUnits: z.string().regex(/^[1-9][0-9]*$/).max(20),
  }).strict(),
  idempotencyKey: z.string().trim().min(1).max(200),
  requestedAt: timestamp,
  correlationId: identity,
  causationId: identity,
  playerIdentity: ninesPlayerIdentityAssertionV1Schema,
}).strict()

export const ninesPlaceBetCommandV1Schema = commandWithoutEvidenceHashSchema
  .extend({ evidenceHash: z.string().regex(/^[0-9a-f]{64}$/) })
  .strict()
  .superRefine((command, context) => {
    if (command.playerIdentity.subjectPlayerId !== command.playerId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['playerIdentity', 'subjectPlayerId'],
        message: 'Player assertion subject must equal command playerId',
      })
    }
    const requestedAt = Date.parse(command.requestedAt)
    const authenticatedAt = Date.parse(command.playerIdentity.authenticatedAt)
    const expiresAt = Date.parse(command.playerIdentity.expiresAt)
    if (authenticatedAt > requestedAt || expiresAt < requestedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['playerIdentity'],
        message: 'Player assertion must be valid when the wager is requested',
      })
    }
    if (expiresAt - authenticatedAt > MAX_PLAYER_ASSERTION_LIFETIME_MS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['playerIdentity', 'expiresAt'],
        message: 'Player assertion lifetime must not exceed five minutes',
      })
    }
  })

export type NinesPlaceBetCommandV1 = z.infer<typeof ninesPlaceBetCommandV1Schema>
export type NinesPlaceBetCommandV1WithoutEvidenceHash = z.infer<
  typeof commandWithoutEvidenceHashSchema
>

export function ninesPlaceBetEvidenceHash(
  command: NinesPlaceBetCommandV1WithoutEvidenceHash,
): string {
  return hashCanonicalJson(command as unknown as JsonObject)
}

export const ninesPlaceBetResultV1Schema = z.object({
  schemaVersion: z.literal(NINES_PLACE_BET_RESULT_SCHEMA_VERSION),
  resultType: z.literal('nines_place_bet_result'),
  result: z.enum(['accepted', 'replayed', 'rejected']),
  betId: uuid,
  playerId: uuid,
  raceId: identity,
  raceRef: raceReference,
  selectionId: identity,
  stake: z.object({
    currency: z.literal('NINES'),
    scale: z.literal(6),
    minorUnits: z.string().regex(/^[1-9][0-9]*$/).max(20),
  }).strict(),
  reservationTransactionId: z.string().min(1).nullable(),
  rejectionCode: z.string().min(1).nullable(),
  effectiveAt: timestamp,
  correlationId: identity,
}).strict()

export type NinesPlaceBetResultV1 = z.infer<typeof ninesPlaceBetResultV1Schema>
