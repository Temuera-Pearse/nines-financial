import { Router, type Request, type RequestHandler, type Response } from 'express'
import { ZodError } from 'zod'

import type { GetPlayerAccountSummaryHandler } from '../../domains/account/handlers/GetPlayerAccountSummaryHandler.js'
import type { GetPlayerBalanceHandler } from '../../domains/account/handlers/GetPlayerBalanceHandler.js'
import { AppError, isAppError } from '../../shared/types/AppError.js'
import { mirrorCorrelationHeaders } from './requestContext.js'

type AsyncRouteHandler = RequestHandler

interface PlayerAccountsRouteHandlers {
  getPlayerAccountSummaryHandler: GetPlayerAccountSummaryHandler
  getPlayerBalanceHandler: GetPlayerBalanceHandler
}

function asyncHandler(handler: AsyncRouteHandler): AsyncRouteHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch((error) => {
      next(normalizeRouteError(error))
    })
  }
}

function requirePathParam(
  value: string | string[] | undefined,
  paramName: string,
): string {
  const normalizedValue = Array.isArray(value) ? value[0] : value

  if (!normalizedValue?.trim()) {
    throw new AppError({
      category: 'validation_error',
      code: 'MISSING_PATH_PARAMETER',
      message: `${paramName} path parameter is required`,
      details: { paramName },
    })
  }

  return normalizedValue.trim()
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
        'Authenticated user identity must be provided upstream before player account routes execute',
    })
  }

  return authenticatedUserId
}

function resolvePlayerUserId(request: Request, response: Response): string {
  const pathUserId = Array.isArray(request.params.userId)
    ? request.params.userId[0]
    : request.params.userId

  if (pathUserId?.trim()) {
    return pathUserId.trim()
  }

  return requireAuthenticatedUserId(response)
}

function normalizeRouteError(error: unknown): unknown {
  if (isAppError(error)) {
    return error
  }

  if (error instanceof ZodError) {
    return new AppError({
      category: 'validation_error',
      code: 'INVALID_REQUEST',
      message: 'Request validation failed',
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

export function createPlayerAccountsRouter(
  handlers: PlayerAccountsRouteHandlers,
): Router {
  const router = Router()

  const summaryHandler = asyncHandler(async (request, response) => {
    mirrorCorrelationHeaders(request, response)

    const userId = resolvePlayerUserId(request, response)
    const payload = await handlers.getPlayerAccountSummaryHandler.handle({
      userId,
      currency: requirePathParam(request.params.currency, 'currency'),
    })

    response.status(200).json({
      playerAccountId: payload.account.playerAccountId,
      userId,
      currency: payload.account.currency,
      effectiveStatus: payload.account.effectiveStatus,
      displayBalanceMinor: payload.account.displayBalanceMinor,
      spendableBalanceMinor: payload.account.spendableBalanceMinor,
      asOf: payload.account.asOf,
    })
  })

  const balanceHandler = asyncHandler(async (request, response) => {
    mirrorCorrelationHeaders(request, response)

    const payload = await handlers.getPlayerBalanceHandler.handle({
      userId: resolvePlayerUserId(request, response),
      currency: requirePathParam(request.params.currency, 'currency'),
    })

    response.status(200).json({
      playerAccountId: payload.balance.playerAccountId,
      currency: payload.balance.currency,
      spendableBalanceMinor: payload.balance.spendableBalanceMinor,
      lockedBalanceMinor: payload.balance.reservedBalanceMinor,
      restrictedBalanceMinor: payload.balance.restrictedBalanceMinor,
      displayBalanceMinor: payload.balance.displayBalanceMinor,
      asOf: payload.balance.asOf,
    })
  })

  router.get('/player/accounts/:userId/:currency/balance', balanceHandler)
  router.get('/player/accounts/:currency/balance', balanceHandler)
  router.get('/player/accounts/:userId/:currency', summaryHandler)
  router.get('/player/accounts/:currency', summaryHandler)

  return router
}
