import { createHash } from 'node:crypto'
import { Router, type Request } from 'express'

import {
  NINES_RACE_LIFECYCLE_PATH,
  ninesRaceLifecycleEventV1Schema,
  raceLifecycleEvidenceHash,
} from '../../domains/race-lifecycle/dto/RaceLifecycleEvent.js'
import type { RaceLifecycleProjectionService } from '../../domains/race-lifecycle/services/RaceLifecycleProjectionService.js'
import { canonicalizeJson, hashCanonicalJson } from '../../shared/contracts/canonicalJson.js'
import type { Database } from '../../shared/db/Database.js'
import { isValidServiceRequestId, verifyServiceMessage } from '../../shared/security/ServiceMessageAuthentication.js'
import { AppError } from '../../shared/types/AppError.js'
import type { JsonValue } from '../../shared/types/Json.js'

export interface RaceLifecycleRouteOptions {
  service: RaceLifecycleProjectionService
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

async function recordTransportNonce(options: RaceLifecycleRouteOptions, input: {
  serviceId: string; requestId: string; sentAt: Date; receivedAt: Date
}): Promise<void> {
  try {
    await options.database.query(`insert into service_request_nonces
      (service_id,request_id,sent_at,received_at) values ($1,$2,$3,$4)`,
    [input.serviceId, input.requestId, input.sentAt, input.receivedAt])
  } catch (error) {
    if (databaseCode(error) === '23505') throw new AppError({ category: 'conflict',
      code: 'SERVICE_REQUEST_REPLAY', message: 'This authenticated request was already received' })
    throw error
  }
}

export function createRaceLifecycleRouter(options: RaceLifecycleRouteOptions): Router {
  const expectedServiceId = 'nines-back-end'
  const expectedCredentials = options.credentials[expectedServiceId]
  if (!expectedCredentials || Object.keys(expectedCredentials).length === 0) {
    throw new Error(`No service authentication credentials configured for ${expectedServiceId}`)
  }
  const router = Router()
  const clock = options.clock ?? (() => new Date())
  const replayWindowMs = (options.replayWindowSeconds ?? 300) * 1000
  router.post(NINES_RACE_LIFECYCLE_PATH, async (request, response, next) => {
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
      const secret = expectedCredentials[keyId]
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
        path: NINES_RACE_LIFECYCLE_PATH, environment: options.environment, serviceId, keyId,
        requestId, sentAt, contentHash, signature, secret })) {
        throw new AppError({ category: 'forbidden', code: 'SERVICE_AUTH_INVALID_SIGNATURE',
          message: 'Service authentication failed' })
      }
      const parsed = ninesRaceLifecycleEventV1Schema.safeParse(request.body)
      if (!parsed.success) throw new AppError({ category: 'validation_error',
        code: 'INVALID_RACE_LIFECYCLE_EVENT', message: 'Race lifecycle event failed schema validation',
        details: { issuesHash: createHash('sha256').update(canonicalizeJson(
          parsed.error.issues as unknown as JsonValue)).digest('hex') } })
      const event = parsed.data
      if (event.environment !== options.environment) throw new AppError({ category: 'forbidden',
        code: 'RACE_LIFECYCLE_ENVIRONMENT_MISMATCH',
        message: 'Race lifecycle environment does not match receiver' })
      if (Date.parse(event.occurredAt) > receivedAt.getTime() + 1_000) {
        throw new AppError({ category: 'conflict', code: 'RACE_LIFECYCLE_EVENT_NOT_EFFECTIVE',
          message: 'Race lifecycle event is not yet effective according to Financial server time' })
      }
      const { evidenceHash: _evidenceHash, ...evidence } = event
      if (event.evidenceHash !== raceLifecycleEvidenceHash(evidence)) {
        throw new AppError({ category: 'validation_error', code: 'RACE_LIFECYCLE_HASH_MISMATCH',
          message: 'Race lifecycle evidence hash does not match its canonical payload' })
      }
      await recordTransportNonce(options, { serviceId, requestId,
        sentAt: new Date(parsedSentAt), receivedAt })
      const ack = await options.service.ingest(event)
      response.status(ack.result === 'projected' ? 201 : 200).json(ack)
    } catch (error) { next(error) }
  })
  return router
}
