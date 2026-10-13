import { createHash } from 'node:crypto'
import { Router, type Request } from 'express'

import type { Database } from '../../shared/db/Database.js'
import { canonicalizeJson, hashCanonicalJson } from '../../shared/contracts/canonicalJson.js'
import {
  isValidServiceRequestId,
  verifyServiceMessage,
} from '../../shared/security/ServiceMessageAuthentication.js'
import { AppError } from '../../shared/types/AppError.js'
import type { JsonValue } from '../../shared/types/Json.js'
import { confirmedFundingAttestationV1Schema } from '../../domains/funding-attestations/dto/ConfirmedFundingAttestation.js'
import type { FundingAttestationService } from '../../domains/funding-attestations/services/FundingAttestationService.js'

const PATH = '/internal/v1/funding-attestations'

export interface FundingAttestationRouteOptions {
  database: Database
  service: FundingAttestationService
  environment: 'development' | 'test' | 'production'
  credentials: Readonly<Record<string, Readonly<Record<string, string>>>>
  expectedServiceId?: string
  replayWindowSeconds?: number
  clock?: () => Date
}

function requiredHeader(request: Request, name: string): string {
  const value = request.header(name)?.trim()
  if (!value) throw new AppError({ category: 'forbidden', code: 'SERVICE_AUTH_MISSING',
    message: `Missing required service authentication header ${name}` })
  return value
}

export function createFundingAttestationRouter(options: FundingAttestationRouteOptions): Router {
  const expectedServiceId = options.expectedServiceId ?? 'nines-api'
  const expectedCredentials = Object.hasOwn(options.credentials, expectedServiceId)
    ? options.credentials[expectedServiceId]
    : undefined
  if (!expectedCredentials || Object.keys(expectedCredentials).length === 0) {
    throw new Error(`No service authentication credentials configured for ${expectedServiceId}`)
  }
  for (const keys of Object.values(options.credentials)) {
    for (const secret of Object.values(keys)) {
      if (typeof secret !== 'string' || secret.length < 32) {
        throw new Error('Financial service authentication secret must contain at least 32 characters')
      }
    }
  }
  const router = Router()
  const clock = options.clock ?? (() => new Date())
  const replayWindowMs = (options.replayWindowSeconds ?? 300) * 1000

  router.post(PATH, async (request, response, next) => {
    try {
      const serviceId = requiredHeader(request, 'x-nines-service-id')
      const requestId = requiredHeader(request, 'x-nines-request-id')
      if (!isValidServiceRequestId(requestId)) throw new AppError({
        category: 'forbidden', code: 'SERVICE_AUTH_INVALID_REQUEST_ID',
        message: 'Service authentication request ID is invalid' })
      const sentAt = requiredHeader(request, 'x-nines-sent-at')
      const contentHash = requiredHeader(request, 'x-nines-content-sha256')
      const signature = requiredHeader(request, 'x-nines-signature')
      const keyId = requiredHeader(request, 'x-nines-key-id')
      if (serviceId !== expectedServiceId) throw new AppError({
        category: 'forbidden', code: 'SERVICE_AUTH_UNTRUSTED_ISSUER', message: 'Untrusted calling service' })
      const serviceCredentials = Object.hasOwn(options.credentials, serviceId)
        ? options.credentials[serviceId]
        : undefined
      const secret = serviceCredentials && Object.hasOwn(serviceCredentials, keyId)
        ? serviceCredentials[keyId]
        : undefined
      if (typeof secret !== 'string') throw new AppError({
        category: 'forbidden', code: 'SERVICE_AUTH_UNTRUSTED_KEY', message: 'Untrusted service authentication key' })
      const receivedAt = clock()
      const parsedSentAt = Date.parse(sentAt)
      if (!Number.isFinite(parsedSentAt) || Math.abs(receivedAt.getTime() - parsedSentAt) > replayWindowMs) {
        throw new AppError({ category: 'forbidden', code: 'SERVICE_AUTH_TIMESTAMP_OUTSIDE_WINDOW',
          message: 'Service request timestamp is outside the replay window' })
      }
      const canonicalHash = hashCanonicalJson(request.body as JsonValue)
      if (canonicalHash !== contentHash || !verifyServiceMessage({ method: request.method,
        path: PATH, environment: options.environment, serviceId, keyId, requestId, sentAt, contentHash,
        signature, secret })) {
        throw new AppError({ category: 'forbidden', code: 'SERVICE_AUTH_INVALID_SIGNATURE',
          message: 'Service request authentication failed' })
      }
      const parsed = confirmedFundingAttestationV1Schema.safeParse(request.body)
      if (!parsed.success) throw new AppError({ category: 'validation_error',
        code: 'INVALID_FUNDING_ATTESTATION', message: 'Funding attestation failed schema validation',
        details: { issuesHash: createHash('sha256').update(canonicalizeJson(parsed.error.issues as unknown as JsonValue)).digest('hex') } })
      const result = await options.service.consume(parsed.data, { serviceId, requestId,
        sentAt: new Date(parsedSentAt), receivedAt })
      response.status(result.outcome === 'accepted' ? 201 : 200).json(result)
    } catch (error) { next(error) }
  })
  return router
}
