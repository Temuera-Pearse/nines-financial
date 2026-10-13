import { createHash } from 'node:crypto'
import { Router, type Request } from 'express'

import {
  NINES_PLACE_BET_PATH,
  NINES_PLACE_BET_RESULT_SCHEMA_VERSION,
  ninesPlaceBetCommandV1Schema,
  ninesPlaceBetEvidenceHash,
  type NinesPlaceBetCommandV1,
  type NinesPlaceBetResultV1,
} from '../../domains/betting/dto/NinesPlaceBetCommand.js'
import type { BettingIntakeService } from '../../domains/betting/services/BettingIntakeService.js'
import { canonicalizeJson, hashCanonicalJson } from '../../shared/contracts/canonicalJson.js'
import type { Database } from '../../shared/db/Database.js'
import { isValidServiceRequestId, verifyServiceMessage } from '../../shared/security/ServiceMessageAuthentication.js'
import { AppError } from '../../shared/types/AppError.js'
import type { JsonValue } from '../../shared/types/Json.js'

export interface NinesPlaceBetRouteOptions {
  service: BettingIntakeService
  database: Database
  environment: 'development' | 'test' | 'production'
  credentials: Readonly<Record<string, Readonly<Record<string, string>>>>
  replayWindowSeconds?: number
  clock?: () => Date
}

function requiredHeader(request: Request, name: string): string {
  const value = request.header(name)?.trim()
  if (!value) throw new AppError({ category: 'forbidden', code: 'SERVICE_AUTH_MISSING',
    message: `Missing required service authentication header ${name}` })
  return value
}

function databaseCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code) : undefined
}

async function recordTransportNonce(options: NinesPlaceBetRouteOptions, input: {
  serviceId: string
  requestId: string
  sentAt: Date
  receivedAt: Date
}): Promise<void> {
  try {
    await options.database.query(`INSERT INTO service_request_nonces
      (service_id,request_id,sent_at,received_at) VALUES ($1,$2,$3,$4)`,
    [input.serviceId, input.requestId, input.sentAt, input.receivedAt])
  } catch (error) {
    if (databaseCode(error) === '23505') throw new AppError({ category: 'conflict',
      code: 'SERVICE_REQUEST_REPLAY', message: 'This authenticated request was already received' })
    throw error
  }
}

function responseFor(command: NinesPlaceBetCommandV1,
  execution: Awaited<ReturnType<BettingIntakeService['placeBetForAuthenticatedBoundary']>>,
): NinesPlaceBetResultV1 {
  const { bet } = execution.result
  return {
    schemaVersion: NINES_PLACE_BET_RESULT_SCHEMA_VERSION,
    resultType: 'nines_place_bet_result',
    result: execution.replayed ? 'replayed' : execution.result.accepted ? 'accepted' : 'rejected',
    betId: command.betId,
    playerId: command.playerId,
    raceId: command.raceId,
    raceRef: command.raceRef,
    selectionId: command.selectionId,
    stake: command.stake,
    reservationTransactionId: execution.result.reservationId ?? null,
    rejectionCode: bet.rejectionCode,
    effectiveAt: bet.acceptedAt ?? bet.rejectedAt ?? bet.createdAt,
    correlationId: command.correlationId,
  }
}

export function createNinesPlaceBetRouter(options: NinesPlaceBetRouteOptions): Router {
  const expectedServiceId = 'nines-back-end'
  const expectedCredentials = options.credentials[expectedServiceId]
  if (!expectedCredentials || Object.keys(expectedCredentials).length === 0) {
    throw new Error(`No service authentication credentials configured for ${expectedServiceId}`)
  }
  const router = Router()
  const clock = options.clock ?? (() => new Date())
  const replayWindowMs = (options.replayWindowSeconds ?? 300) * 1000

  router.post(NINES_PLACE_BET_PATH, async (request, response, next) => {
    try {
      const serviceId = requiredHeader(request, 'x-nines-service-id')
      const requestId = requiredHeader(request, 'x-nines-request-id')
      const sentAt = requiredHeader(request, 'x-nines-sent-at')
      const contentHash = requiredHeader(request, 'x-nines-content-sha256')
      const signature = requiredHeader(request, 'x-nines-signature')
      const keyId = requiredHeader(request, 'x-nines-key-id')
      if (!isValidServiceRequestId(requestId)) throw new AppError({ category: 'forbidden',
        code: 'SERVICE_AUTH_INVALID_REQUEST_ID', message: 'Service request ID is invalid' })
      if (serviceId !== expectedServiceId) throw new AppError({ category: 'forbidden',
        code: 'SERVICE_AUTH_UNTRUSTED_ISSUER', message: 'Untrusted calling service' })
      const secret = options.credentials[serviceId]?.[keyId]
      if (typeof secret !== 'string' || secret.length < 32) throw new AppError({ category: 'forbidden',
        code: 'SERVICE_AUTH_UNTRUSTED_KEY', message: 'Untrusted service authentication key' })
      const receivedAt = clock()
      const parsedSentAt = Date.parse(sentAt)
      if (!Number.isFinite(parsedSentAt) || Math.abs(receivedAt.getTime() - parsedSentAt) > replayWindowMs) {
        throw new AppError({ category: 'forbidden', code: 'SERVICE_AUTH_TIMESTAMP_OUTSIDE_WINDOW',
          message: 'Service request timestamp is outside the replay window' })
      }
      const canonicalHash = hashCanonicalJson(request.body as JsonValue)
      if (canonicalHash !== contentHash || !verifyServiceMessage({ method: request.method,
        path: NINES_PLACE_BET_PATH, environment: options.environment, serviceId, keyId,
        requestId, sentAt, contentHash, signature, secret })) {
        throw new AppError({ category: 'forbidden', code: 'SERVICE_AUTH_INVALID_SIGNATURE',
          message: 'Service authentication failed' })
      }
      const parsed = ninesPlaceBetCommandV1Schema.safeParse(request.body)
      if (!parsed.success) throw new AppError({ category: 'validation_error',
        code: 'INVALID_NINES_PLACE_BET_COMMAND', message: 'NINES wager command failed schema validation',
        details: { issuesHash: createHash('sha256').update(canonicalizeJson(
          parsed.error.issues as unknown as JsonValue)).digest('hex') } })
      const command = parsed.data
      if (command.environment !== options.environment) throw new AppError({ category: 'forbidden',
        code: 'WAGER_ENVIRONMENT_MISMATCH', message: 'Wager command environment does not match receiver' })
      const { evidenceHash: _evidenceHash, ...evidence } = command
      if (command.evidenceHash !== ninesPlaceBetEvidenceHash(evidence)) {
        throw new AppError({ category: 'validation_error', code: 'WAGER_EVIDENCE_HASH_MISMATCH',
          message: 'Wager command evidence hash does not match its canonical payload' })
      }
      if (Date.parse(command.playerIdentity.expiresAt) < receivedAt.getTime() ||
          Date.parse(command.playerIdentity.authenticatedAt) > receivedAt.getTime()) {
        throw new AppError({ category: 'forbidden', code: 'PLAYER_ASSERTION_NOT_CURRENT',
          message: 'Trusted player assertion is not valid at receipt time' })
      }
      await recordTransportNonce(options, { serviceId, requestId,
        sentAt: new Date(parsedSentAt), receivedAt })
      const execution = await options.service.placeBetForAuthenticatedBoundary({
        betId: command.betId,
        userId: command.playerId,
        raceId: command.raceId,
        selectionId: command.selectionId,
        stakeMinor: command.stake.minorUnits,
        currency: command.stake.currency,
        idempotencyKey: command.idempotencyKey,
        correlationId: command.correlationId,
        causationId: command.causationId,
      })
      const result = responseFor(command, execution)
      response.status(result.result === 'accepted' ? 201 : 200).json(result)
    } catch (error) { next(error) }
  })
  return router
}
