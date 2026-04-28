import { Router, type RequestHandler, type Response } from 'express'
import { ZodError } from 'zod'

import type { ApplyFreezeHandler } from '../../domains/account/handlers/ApplyFreezeHandler.js'
import type { ApplyRestrictionHandler } from '../../domains/account/handlers/ApplyRestrictionHandler.js'
import type { ApplySuspensionHandler } from '../../domains/account/handlers/ApplySuspensionHandler.js'
import type { GetAdminAccountInspectionHandler } from '../../domains/account/handlers/GetAdminAccountInspectionHandler.js'
import type { LiftFreezeHandler } from '../../domains/account/handlers/LiftFreezeHandler.js'
import type { LiftRestrictionHandler } from '../../domains/account/handlers/LiftRestrictionHandler.js'
import type { LiftSuspensionHandler } from '../../domains/account/handlers/LiftSuspensionHandler.js'
import { AppError, isAppError } from '../../shared/types/AppError.js'
import {
  mirrorCorrelationHeaders,
  readStateChangingRequestContext,
  writeCorrelationHeaders,
} from './requestContext.js'

type AsyncRouteHandler = RequestHandler

interface AdminAccountsRouteHandlers {
  getAdminAccountInspectionHandler: GetAdminAccountInspectionHandler
  applyRestrictionHandler: ApplyRestrictionHandler
  liftRestrictionHandler: LiftRestrictionHandler
  applySuspensionHandler: ApplySuspensionHandler
  liftSuspensionHandler: LiftSuspensionHandler
  applyFreezeHandler: ApplyFreezeHandler
  liftFreezeHandler: LiftFreezeHandler
}

const adminAccountRouteSource = 'http_admin_accounts'

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

function requireAuthenticatedAdminActorId(response: Response): string {
  const locals = response.locals as { authenticatedUserId?: unknown }
  const authenticatedUserId =
    typeof locals.authenticatedUserId === 'string'
      ? locals.authenticatedUserId.trim()
      : ''

  if (!authenticatedUserId) {
    throw new AppError({
      category: 'forbidden',
      code: 'MISSING_AUTHENTICATED_ADMIN_ID',
      message:
        'Authenticated admin identity must be provided upstream before admin account routes execute',
    })
  }

  return authenticatedUserId
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

export function createAdminAccountsRouter(
  handlers: AdminAccountsRouteHandlers,
): Router {
  const router = Router()

  router.get(
    '/admin/accounts/:playerAccountId',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)

      const payload = await handlers.getAdminAccountInspectionHandler.handle({
        playerAccountId: requirePathParam(
          request.params.playerAccountId,
          'playerAccountId',
        ),
      })

      response.status(200).json(payload)
    }),
  )

  router.post(
    '/admin/accounts/:playerAccountId/restrictions',
    asyncHandler(async (request, response) => {
      const requestContext = readStateChangingRequestContext(request)
      writeCorrelationHeaders(response, requestContext)

      const payload = await handlers.applyRestrictionHandler.handle({
        playerAccountId: requirePathParam(
          request.params.playerAccountId,
          'playerAccountId',
        ),
        actorType: 'admin_user',
        actorId: requireAuthenticatedAdminActorId(response),
        source: adminAccountRouteSource,
        request: {
          ...(request.body ?? {}),
          idempotencyKey: `${requestContext.idempotencyKey}`,
          correlationId: requestContext.correlationId,
          causationId: requestContext.causationId,
        },
      })

      response.status(201).json(payload)
    }),
  )

  router.post(
    '/admin/accounts/:playerAccountId/restrictions/:restrictionId/lift',
    asyncHandler(async (request, response) => {
      const requestContext = readStateChangingRequestContext(request)
      writeCorrelationHeaders(response, requestContext)

      const payload = await handlers.liftRestrictionHandler.handle({
        playerAccountId: requirePathParam(
          request.params.playerAccountId,
          'playerAccountId',
        ),
        restrictionId: requirePathParam(
          request.params.restrictionId,
          'restrictionId',
        ),
        actorType: 'admin_user',
        actorId: requireAuthenticatedAdminActorId(response),
        source: adminAccountRouteSource,
        request: {
          ...(request.body ?? {}),
          idempotencyKey: `${requestContext.idempotencyKey}`,
          correlationId: requestContext.correlationId,
          causationId: requestContext.causationId,
        },
      })

      response.status(200).json(payload)
    }),
  )

  router.post(
    '/admin/accounts/:playerAccountId/suspension',
    asyncHandler(async (request, response) => {
      const requestContext = readStateChangingRequestContext(request)
      writeCorrelationHeaders(response, requestContext)

      const payload = await handlers.applySuspensionHandler.handle({
        playerAccountId: requirePathParam(
          request.params.playerAccountId,
          'playerAccountId',
        ),
        actorType: 'admin_user',
        actorId: requireAuthenticatedAdminActorId(response),
        source: adminAccountRouteSource,
        request: {
          ...(request.body ?? {}),
          idempotencyKey: `${requestContext.idempotencyKey}`,
          correlationId: requestContext.correlationId,
          causationId: requestContext.causationId,
        },
      })

      response.status(201).json(payload)
    }),
  )

  router.post(
    '/admin/accounts/:playerAccountId/suspension/lift',
    asyncHandler(async (request, response) => {
      const requestContext = readStateChangingRequestContext(request)
      writeCorrelationHeaders(response, requestContext)

      const payload = await handlers.liftSuspensionHandler.handle({
        playerAccountId: requirePathParam(
          request.params.playerAccountId,
          'playerAccountId',
        ),
        actorType: 'admin_user',
        actorId: requireAuthenticatedAdminActorId(response),
        source: adminAccountRouteSource,
        request: {
          ...(request.body ?? {}),
          idempotencyKey: `${requestContext.idempotencyKey}`,
          correlationId: requestContext.correlationId,
          causationId: requestContext.causationId,
        },
      })

      response.status(200).json(payload)
    }),
  )

  router.post(
    '/admin/accounts/:playerAccountId/freeze',
    asyncHandler(async (request, response) => {
      const requestContext = readStateChangingRequestContext(request)
      writeCorrelationHeaders(response, requestContext)

      const payload = await handlers.applyFreezeHandler.handle({
        playerAccountId: requirePathParam(
          request.params.playerAccountId,
          'playerAccountId',
        ),
        actorType: 'admin_user',
        actorId: requireAuthenticatedAdminActorId(response),
        source: adminAccountRouteSource,
        request: {
          ...(request.body ?? {}),
          idempotencyKey: `${requestContext.idempotencyKey}`,
          correlationId: requestContext.correlationId,
          causationId: requestContext.causationId,
        },
      })

      response.status(201).json(payload)
    }),
  )

  router.post(
    '/admin/accounts/:playerAccountId/freeze/lift',
    asyncHandler(async (request, response) => {
      const requestContext = readStateChangingRequestContext(request)
      writeCorrelationHeaders(response, requestContext)

      const payload = await handlers.liftFreezeHandler.handle({
        playerAccountId: requirePathParam(
          request.params.playerAccountId,
          'playerAccountId',
        ),
        actorType: 'admin_user',
        actorId: requireAuthenticatedAdminActorId(response),
        source: adminAccountRouteSource,
        request: {
          ...(request.body ?? {}),
          idempotencyKey: `${requestContext.idempotencyKey}`,
          correlationId: requestContext.correlationId,
          causationId: requestContext.causationId,
        },
      })

      response.status(200).json(payload)
    }),
  )

  return router
}
