import { createHash } from 'node:crypto'

import { Router, type Request, type RequestHandler, type Response } from 'express'
import { ZodError } from 'zod'

import type {
  ApproveWithdrawalRequestHandler,
  CancelWithdrawalRequestHandler,
  CreateWithdrawalRequestHandler,
  DetectWithdrawalReconciliationHandler,
  FinalizeWithdrawalRequestHandler,
  GetWithdrawalRequestHandler,
  IngestWithdrawalProviderWebhookHandler,
  ListWithdrawalReviewItemsHandler,
  MarkWithdrawalProviderFailureTerminalHandler,
  MarkWithdrawalProviderUnknownReviewedHandler,
  RejectWithdrawalRequestHandler,
  ReleaseWithdrawalProviderFailureHandler,
  SubmitWithdrawalRequestHandler,
  SyncWithdrawalProviderStatusHandler,
} from '../../domains/withdrawals/handlers/WithdrawalHandlers.js'
import type { WithdrawalProviderAdapter } from '../../domains/withdrawals/providers/WithdrawalProviderAdapter.js'
import { AppError, isAppError } from '../../shared/types/AppError.js'
import {
  requireOperatorRole,
  type AuthenticatedOperator,
} from './operatorAuth.js'
import { mirrorCorrelationHeaders } from './requestContext.js'

type AsyncRouteHandler = RequestHandler

export interface WithdrawalRouteHandlers {
  createWithdrawalRequestHandler: CreateWithdrawalRequestHandler
  getWithdrawalRequestHandler: GetWithdrawalRequestHandler
  listWithdrawalReviewItemsHandler: ListWithdrawalReviewItemsHandler
  detectWithdrawalReconciliationHandler: DetectWithdrawalReconciliationHandler
  approveWithdrawalRequestHandler: ApproveWithdrawalRequestHandler
  rejectWithdrawalRequestHandler: RejectWithdrawalRequestHandler
  cancelWithdrawalRequestHandler: CancelWithdrawalRequestHandler
  submitWithdrawalRequestHandler: SubmitWithdrawalRequestHandler
  syncWithdrawalProviderStatusHandler: SyncWithdrawalProviderStatusHandler
  ingestWithdrawalProviderWebhookHandler: IngestWithdrawalProviderWebhookHandler
  finalizeWithdrawalRequestHandler: FinalizeWithdrawalRequestHandler
  releaseWithdrawalProviderFailureHandler: ReleaseWithdrawalProviderFailureHandler
  markWithdrawalProviderFailureTerminalHandler: MarkWithdrawalProviderFailureTerminalHandler
  markWithdrawalProviderUnknownReviewedHandler: MarkWithdrawalProviderUnknownReviewedHandler
}

const withdrawalOperatorRoles = [
  'treasury_operator',
  'treasury_admin',
  'financial_admin',
] as const
const withdrawalAdminRoles = ['treasury_admin', 'financial_admin'] as const

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
      code: 'INVALID_WITHDRAWAL_REQUEST',
      message: 'Withdrawal request validation failed',
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

function normalizedCreatePayload(
  request: Request,
  playerId: string,
): Record<string, unknown> {
  const payload = commandPayload(request)

  return {
    ...payload,
    playerId,
    amountMinorUnits:
      payload.amountMinorUnits ?? payload.amountMinor ?? undefined,
  }
}

function operatorResolutionPayload(
  request: Request,
  operator: AuthenticatedOperator,
): Record<string, unknown> {
  return {
    ...commandPayload(request),
    withdrawalRequestId: routeParam(request.params.withdrawalRequestId),
    operatorId: operator.operatorId,
    operatorRole: operator.operatorRole,
  }
}

function playerResolutionPayload(
  request: Request,
  playerId: string,
): Record<string, unknown> {
  return {
    ...commandPayload(request),
    withdrawalRequestId: routeParam(request.params.withdrawalRequestId),
    playerId,
  }
}

function normalizedProviderWebhookPayload(
  request: Request,
  provider: string,
  adapter: WithdrawalProviderAdapter,
): Record<string, unknown> {
  const rawBody = (request as Request & { rawBody?: Buffer }).rawBody
  const body = requestBody(request)
  const headers = {
    'x-nines-provider-timestamp':
      request.header('x-nines-provider-timestamp') ?? undefined,
    'x-nines-provider-signature':
      request.header('x-nines-provider-signature') ?? undefined,
    'x-nines-provider-nonce':
      request.header('x-nines-provider-nonce') ?? undefined,
  }

  adapter.parseWithdrawalWebhook({
    provider,
    body,
    rawBody,
    headers,
  })

  const requestHash = createHash('sha256')
    .update(rawBody ?? Buffer.from(JSON.stringify(body)))
    .digest('hex')

  return {
    provider,
    body,
    rawBody,
    headers,
    providerWebhookNonce: request.header('x-nines-provider-nonce')?.trim(),
    providerWebhookTimestamp:
      request.header('x-nines-provider-timestamp')?.trim(),
    providerWebhookRequestHash: requestHash,
    correlationId:
      request.header('x-correlation-id') ??
      `corr_withdrawal_provider_webhook_${request.header('x-nines-provider-nonce') ?? 'missing_nonce'}`,
    causationId:
      request.header('x-causation-id') ??
      `cause_withdrawal_provider_webhook_${request.header('x-nines-provider-nonce') ?? 'missing_nonce'}`,
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
        'Authenticated user identity must be provided before withdrawal routes execute',
    })
  }

  return authenticatedUserId
}

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

export function createWithdrawalRouter(
  handlers: WithdrawalRouteHandlers,
  withdrawalProviderAdapter?: WithdrawalProviderAdapter,
): Router {
  const router = Router()

  router.post(
    '/provider-events/withdrawals/webhook/:provider',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)

      if (!withdrawalProviderAdapter) {
        throw new AppError({
          category: 'internal_error',
          code: 'WITHDRAWAL_PROVIDER_ADAPTER_MISSING',
          message: 'Withdrawal provider adapter is not available',
        })
      }

      const webhook =
        await handlers.ingestWithdrawalProviderWebhookHandler.handle(
          normalizedProviderWebhookPayload(
            request,
            routeParam(request.params.provider),
            withdrawalProviderAdapter,
          ) as never,
        )

      response.status(202).json(webhook)
    }),
  )

  router.post(
    '/withdrawal-requests',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      const playerId = requireAuthenticatedUserId(response)

      const withdrawalRequest =
        await handlers.createWithdrawalRequestHandler.handle(
          normalizedCreatePayload(request, playerId) as never,
        )

      response.status(201).json(withdrawalRequest)
    }),
  )

  router.get(
    '/withdrawal-requests/review',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      requireOperatorRole(
        request,
        response,
        withdrawalOperatorRoles,
        'withdrawal.review',
      )

      const reviewItems =
        await handlers.listWithdrawalReviewItemsHandler.handle()

      response.status(200).json({ reviewItems })
    }),
  )

  router.get(
    '/admin/operations/withdrawals/reconciliation',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      requireOperatorRole(
        request,
        response,
        withdrawalOperatorRoles,
        'withdrawal.reconciliation',
      )

      const reconciliation =
        await handlers.detectWithdrawalReconciliationHandler.handle()

      response.status(200).json({ reconciliation })
    }),
  )

  router.get(
    '/withdrawal-requests/:withdrawalRequestId',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      const playerId = requireAuthenticatedUserId(response)

      const withdrawalRequest =
        await handlers.getWithdrawalRequestHandler.handle({
          withdrawalRequestId: routeParam(
            request.params.withdrawalRequestId,
          ),
          playerId,
        })

      response.status(200).json(withdrawalRequest)
    }),
  )

  router.post(
    '/withdrawal-requests/:withdrawalRequestId/approve',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      const operator = requireOperatorRole(
        request,
        response,
        withdrawalAdminRoles,
        'withdrawal.approve',
      )

      const withdrawalRequest =
        await handlers.approveWithdrawalRequestHandler.handle(
          operatorResolutionPayload(request, operator) as never,
        )

      response.status(200).json(withdrawalRequest)
    }),
  )

  router.post(
    '/withdrawal-requests/:withdrawalRequestId/reject',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      const operator = requireOperatorRole(
        request,
        response,
        withdrawalOperatorRoles,
        'withdrawal.reject',
      )

      const withdrawalRequest =
        await handlers.rejectWithdrawalRequestHandler.handle(
          operatorResolutionPayload(request, operator) as never,
        )

      response.status(200).json(withdrawalRequest)
    }),
  )

  router.post(
    '/withdrawal-requests/:withdrawalRequestId/submit',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      const operator = requireOperatorRole(
        request,
        response,
        withdrawalAdminRoles,
        'withdrawal.submit',
      )

      const withdrawalRequest =
        await handlers.submitWithdrawalRequestHandler.handle(
          operatorResolutionPayload(request, operator) as never,
        )

      response.status(200).json(withdrawalRequest)
    }),
  )

  router.post(
    '/withdrawal-requests/:withdrawalRequestId/sync-provider-status',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      const operator = requireOperatorRole(
        request,
        response,
        withdrawalOperatorRoles,
        'withdrawal.sync_provider_status',
      )

      const withdrawalRequest =
        await handlers.syncWithdrawalProviderStatusHandler.handle(
          operatorResolutionPayload(request, operator) as never,
        )

      response.status(200).json(withdrawalRequest)
    }),
  )

  router.post(
    '/withdrawal-requests/:withdrawalRequestId/finalize',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      const operator = requireOperatorRole(
        request,
        response,
        withdrawalAdminRoles,
        'withdrawal.finalize',
      )

      const withdrawalRequest =
        await handlers.finalizeWithdrawalRequestHandler.handle(
          operatorResolutionPayload(request, operator) as never,
        )

      response.status(200).json(withdrawalRequest)
    }),
  )

  router.post(
    '/withdrawal-requests/:withdrawalRequestId/release-after-provider-failure',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      const operator = requireOperatorRole(
        request,
        response,
        withdrawalAdminRoles,
        'withdrawal.release_after_provider_failure',
      )

      const withdrawalRequest =
        await handlers.releaseWithdrawalProviderFailureHandler.handle(
          operatorResolutionPayload(request, operator) as never,
        )

      response.status(200).json(withdrawalRequest)
    }),
  )

  router.post(
    '/withdrawal-requests/:withdrawalRequestId/mark-provider-failure-terminal',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      const operator = requireOperatorRole(
        request,
        response,
        withdrawalAdminRoles,
        'withdrawal.mark_provider_failure_terminal',
      )

      const withdrawalRequest =
        await handlers.markWithdrawalProviderFailureTerminalHandler.handle(
          operatorResolutionPayload(request, operator) as never,
        )

      response.status(200).json(withdrawalRequest)
    }),
  )

  router.post(
    '/withdrawal-requests/:withdrawalRequestId/mark-provider-unknown-reviewed',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      const operator = requireOperatorRole(
        request,
        response,
        withdrawalAdminRoles,
        'withdrawal.mark_provider_unknown_reviewed',
      )

      const withdrawalRequest =
        await handlers.markWithdrawalProviderUnknownReviewedHandler.handle(
          operatorResolutionPayload(request, operator) as never,
        )

      response.status(200).json(withdrawalRequest)
    }),
  )

  router.post(
    '/withdrawal-requests/:withdrawalRequestId/cancel',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      const playerId = requireAuthenticatedUserId(response)

      const withdrawalRequest =
        await handlers.cancelWithdrawalRequestHandler.handle(
          playerResolutionPayload(request, playerId) as never,
        )

      response.status(200).json(withdrawalRequest)
    }),
  )

  return router
}
