import { createHash } from 'node:crypto'
import { Router, type Request } from 'express'
import { canonicalizeJson, hashCanonicalJson } from '../../shared/contracts/canonicalJson.js'
import { isValidServiceRequestId, verifyServiceMessage } from '../../shared/security/ServiceMessageAuthentication.js'
import { AppError } from '../../shared/types/AppError.js'
import type { JsonValue } from '../../shared/types/Json.js'
import { ninesIssuanceAuthorizationV1Schema } from '../../domains/issuance-authorizations/dto/NinesIssuanceAuthorization.js'
import type { NinesIssuanceAuthorizationService } from '../../domains/issuance-authorizations/services/NinesIssuanceAuthorizationService.js'

const PATH = '/internal/v1/nines-issuance-authorizations'

export interface NinesIssuanceAuthorizationRouteOptions {
  service: NinesIssuanceAuthorizationService
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

export function createNinesIssuanceAuthorizationRouter(
  options: NinesIssuanceAuthorizationRouteOptions): Router {
  const expectedServiceId = options.expectedServiceId ?? 'nines-api'
  const expectedCredentials = options.credentials[expectedServiceId]
  if (!expectedCredentials || Object.keys(expectedCredentials).length === 0) {
    throw new Error(`No service authentication credentials configured for ${expectedServiceId}`)
  }
  const router = Router()
  const clock = options.clock ?? (() => new Date())
  const replayWindowMs = (options.replayWindowSeconds ?? 300) * 1000
  router.post(PATH, async (request, response, next) => {
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
        path: PATH, environment: options.environment, serviceId, keyId, requestId, sentAt,
        contentHash, signature, secret })) throw new AppError({ category: 'forbidden',
        code: 'SERVICE_AUTH_INVALID_SIGNATURE', message: 'Service authentication failed' })
      const parsed = ninesIssuanceAuthorizationV1Schema.safeParse(request.body)
      if (!parsed.success) throw new AppError({ category: 'validation_error',
        code: 'INVALID_NINES_ISSUANCE_AUTHORIZATION',
        message: 'NINES issuance authorization failed schema validation',
        details: { issuesHash: createHash('sha256').update(canonicalizeJson(
          parsed.error.issues as unknown as JsonValue)).digest('hex') } })
      const result = await options.service.consume(parsed.data, { serviceId, requestId,
        sentAt: new Date(parsedSentAt), receivedAt })
      response.status(result.result === 'accepted' ? 201 : 200).json(result)
    } catch (error) { next(error) }
  })
  return router
}
