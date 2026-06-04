import { Router, type Request, type RequestHandler, type Response } from 'express'
import { createHash } from 'node:crypto'
import { ZodError } from 'zod'

import type {
  CreateDepositIntentHandler,
  ApproveProviderDepositCreditHandler,
  DetectDepositReconciliationHandler,
  GetDepositIntentHandler,
  IngestProviderDepositEventHandler,
  LinkProviderDepositEventHandler,
  ListDepositReviewItemsHandler,
  MarkDepositReviewedNoCreditHandler,
  RejectProviderDepositEventHandler,
  RetryProviderDepositCreditHandler,
} from '../../domains/deposits/handlers/DepositHandlers.js'
import type { DepositProviderAdapter } from '../../domains/deposits/providers/DepositProviderAdapter.js'
import { AppError, isAppError } from '../../shared/types/AppError.js'
import { mirrorCorrelationHeaders } from './requestContext.js'
import {
  requireAuthenticatedOperatorId,
  requireOperatorRole,
  type AuthenticatedOperator,
} from './operatorAuth.js'

type AsyncRouteHandler = RequestHandler

export interface DepositRouteHandlers {
  createDepositIntentHandler: CreateDepositIntentHandler
  getDepositIntentHandler: GetDepositIntentHandler
  ingestProviderDepositEventHandler: IngestProviderDepositEventHandler
  listDepositReviewItemsHandler: ListDepositReviewItemsHandler
  detectDepositReconciliationHandler: DetectDepositReconciliationHandler
  markDepositReviewedNoCreditHandler: MarkDepositReviewedNoCreditHandler
  rejectProviderDepositEventHandler: RejectProviderDepositEventHandler
  linkProviderDepositEventHandler: LinkProviderDepositEventHandler
  approveProviderDepositCreditHandler: ApproveProviderDepositCreditHandler
  retryProviderDepositCreditHandler: RetryProviderDepositCreditHandler
  depositProviderAdapter: DepositProviderAdapter
}

const depositReviewOperatorRoles = [
  'treasury_operator',
  'treasury_admin',
  'financial_admin',
] as const
const depositReviewAdminRoles = [
  'treasury_admin',
  'financial_admin',
] as const

function asyncHandler(handler: AsyncRouteHandler): AsyncRouteHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch((error) => {
      next(normalizeRouteError(error))
    })
  }
}

function normalizeRouteError(error: unknown): unknown {
  if (isAppError(error)) {
    return error
  }

  if (error instanceof ZodError) {
    return new AppError({
      category: 'validation_error',
      code: 'INVALID_DEPOSIT_REQUEST',
      message: 'Deposit request validation failed',
      details: {
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        })),
      },
    })
  }

  return error
}

function requestBody(request: Request): Record<string, unknown> {
  return typeof request.body === 'object' && request.body !== null
    ? (request.body as Record<string, unknown>)
    : {}
}

function commandPayload(request: Request): Record<string, unknown> {
  const body = requestBody(request)

  return {
    ...body,
    idempotencyKey:
      body.idempotencyKey ?? request.header('idempotency-key') ?? undefined,
    correlationId:
      body.correlationId ?? request.header('x-correlation-id') ?? undefined,
    causationId:
      body.causationId ?? request.header('x-causation-id') ?? undefined,
  }
}

function normalizedDepositIntentPayload(
  request: Request,
  userId: string,
): Record<string, unknown> {
  const payload = commandPayload(request)

  return {
    ...payload,
    userId,
    expectedAmountMinor:
      payload.expectedAmountMinor ?? payload.expectedAmountMinorUnits ?? null,
  }
}

function normalizedProviderEventPayload(
  request: Request,
  operatorId: string,
): Record<string, unknown> {
  const payload = commandPayload(request)

  return {
    ...payload,
    operatorId,
    amountMinor: payload.amountMinor ?? payload.amountMinorUnits,
  }
}

function normalizedProviderWebhookPayload(
  request: Request,
  provider: string,
  adapter: DepositProviderAdapter,
): Record<string, unknown> {
  const rawBody = (request as Request & { rawBody?: Buffer }).rawBody
  const normalized = adapter.parseDepositWebhook({
    provider,
    body: requestBody(request),
    rawBody,
    headers: {
      'x-nines-provider-timestamp':
        request.header('x-nines-provider-timestamp') ?? undefined,
      'x-nines-provider-signature':
        request.header('x-nines-provider-signature') ?? undefined,
      'x-nines-provider-nonce':
        request.header('x-nines-provider-nonce') ?? undefined,
    },
  })
  const payload = commandPayload(request)
  const providerWebhookNonce = request
    .header('x-nines-provider-nonce')
    ?.trim()
  const providerWebhookTimestamp = request
    .header('x-nines-provider-timestamp')
    ?.trim()
  const providerWebhookRequestHash = createHash('sha256')
    .update(rawBody ?? Buffer.from(JSON.stringify(requestBody(request))))
    .digest('hex')

  return {
    ...normalized,
    providerWebhookNonce,
    providerWebhookTimestamp,
    providerWebhookRequestHash,
    idempotencyKey:
      payload.idempotencyKey ??
      `provider-webhook-${normalized.provider}-${normalized.providerEventId}`,
    correlationId:
      payload.correlationId ??
      `corr_provider_webhook_${normalized.providerEventId}`,
    causationId:
      payload.causationId ??
      `cause_provider_webhook_${normalized.providerEventId}`,
    operatorId: `provider:${provider}`,
  }
}

function operatorResolutionPayload(
  request: Request,
  operator: AuthenticatedOperator,
): Record<string, unknown> {
  return {
    ...commandPayload(request),
    depositEventId: routeParam(request.params.depositEventId),
    operatorId: operator.operatorId,
    operatorRole: operator.operatorRole,
  }
}

function requireAuthenticatedUserId(response: Response): string {
  const locals = response.locals as { authenticatedUserId?: unknown }
  const authenticatedUserId =
    typeof locals.authenticatedUserId === 'string'
      ? locals.authenticatedUserId.trim()
      : ''

  if (!authenticatedUserId) {
    throw new AppError({
      category: 'forbidden',
      code: 'MISSING_AUTHENTICATED_USER_ID',
      message:
        'Authenticated user identity must be provided before deposit routes execute',
    })
  }

  return authenticatedUserId
}

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

export function createDepositRouter(handlers: DepositRouteHandlers): Router {
  const router = Router()

  router.post(
    '/deposit-intents',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      const userId = requireAuthenticatedUserId(response)

      const intent = await handlers.createDepositIntentHandler.handle(
        normalizedDepositIntentPayload(request, userId) as never,
      )

      response.status(201).json(intent)
    }),
  )

  router.get(
    '/deposit-intents/:depositIntentId',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      const userId = requireAuthenticatedUserId(response)

      const intent = await handlers.getDepositIntentHandler.handle({
        depositIntentId: routeParam(request.params.depositIntentId),
        userId,
      })

      response.status(200).json(intent)
    }),
  )

  router.post(
    '/provider-events/deposits',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      const operatorId = requireAuthenticatedOperatorId(request, response)

      const result = await handlers.ingestProviderDepositEventHandler.handle(
        normalizedProviderEventPayload(request, operatorId) as never,
      )

      response.status(result.credited ? 201 : 200).json(result)
    }),
  )

  router.post(
    '/provider-events/deposits/webhook/:provider',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      const provider = routeParam(request.params.provider) || 'simulated'

      const result = await handlers.ingestProviderDepositEventHandler.handle(
        normalizedProviderWebhookPayload(
          request,
          provider,
          handlers.depositProviderAdapter,
        ) as never,
      )

      response.status(result.credited ? 201 : 200).json(result)
    }),
  )

  router.post(
    '/deposits/provider-events/:depositEventId/mark-reviewed-no-credit',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      const operator = requireOperatorRole(
        request,
        response,
        depositReviewOperatorRoles,
        'deposit.mark_reviewed_no_credit',
      )

      const result =
        await handlers.markDepositReviewedNoCreditHandler.handle(
          operatorResolutionPayload(request, operator) as never,
        )

      response.status(200).json(result)
    }),
  )

  router.post(
    '/deposits/provider-events/:depositEventId/reject',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      const operator = requireOperatorRole(
        request,
        response,
        depositReviewOperatorRoles,
        'deposit.reject',
      )

      const result = await handlers.rejectProviderDepositEventHandler.handle(
        operatorResolutionPayload(request, operator) as never,
      )

      response.status(200).json(result)
    }),
  )

  router.post(
    '/deposits/provider-events/:depositEventId/link-intent',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      const requiresElevatedRole = Boolean(
        requestBody(request).overrideReason,
      )
      const operator = requireOperatorRole(
        request,
        response,
        requiresElevatedRole ? depositReviewAdminRoles : depositReviewOperatorRoles,
        'deposit.link_intent',
      )

      const result = await handlers.linkProviderDepositEventHandler.handle(
        operatorResolutionPayload(request, operator) as never,
      )

      response.status(200).json(result)
    }),
  )

  router.post(
    '/deposits/provider-events/:depositEventId/approve-credit',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      const operator = requireOperatorRole(
        request,
        response,
        depositReviewAdminRoles,
        'deposit.approve_credit',
      )

      const result = await handlers.approveProviderDepositCreditHandler.handle(
        operatorResolutionPayload(request, operator) as never,
      )

      response.status(result.credited ? 201 : 200).json(result)
    }),
  )

  router.post(
    '/deposits/provider-events/:depositEventId/retry-credit',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      const operator = requireOperatorRole(
        request,
        response,
        depositReviewOperatorRoles,
        'deposit.retry_credit',
      )

      const result = await handlers.retryProviderDepositCreditHandler.handle(
        operatorResolutionPayload(request, operator) as never,
      )

      response.status(result.credited ? 201 : 200).json(result)
    }),
  )

  router.get(
    '/deposits/review',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      requireAuthenticatedOperatorId(request, response)

      const reviewItems =
        await handlers.listDepositReviewItemsHandler.handle()

      response.status(200).json({ reviewItems })
    }),
  )

  router.get(
    '/admin/operations/deposits/reconciliation',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      requireAuthenticatedOperatorId(request, response)

      const reconciliation =
        await handlers.detectDepositReconciliationHandler.handle()

      response.status(200).json({ reconciliation })
    }),
  )

  return router
}
