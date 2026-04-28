import { Router, type Request, type RequestHandler } from 'express'
import { ZodError } from 'zod'

import type {
  ApplyHouseTakeHandler,
  ReleaseReservationHandler,
  ReserveStakeHandler,
  SettleBetHandler,
} from '../../domains/financial-commands/handlers/FinancialCommandHandlers.js'
import { AppError, isAppError } from '../../shared/types/AppError.js'
import { mirrorCorrelationHeaders } from './requestContext.js'

type AsyncRouteHandler = RequestHandler

export interface FinancialCommandRouteHandlers {
  reserveStakeHandler: ReserveStakeHandler
  releaseReservationHandler: ReleaseReservationHandler
  settleBetHandler: SettleBetHandler
  applyHouseTakeHandler: ApplyHouseTakeHandler
}

function asyncHandler(handler: AsyncRouteHandler): AsyncRouteHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch((error) => {
      next(normalizeRouteError(error))
    })
  }
}

function commandPayload(request: Request): Record<string, unknown> {
  const body =
    typeof request.body === 'object' && request.body !== null
      ? (request.body as Record<string, unknown>)
      : {}

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

function normalizeRouteError(error: unknown): unknown {
  if (isAppError(error)) {
    return error
  }

  if (error instanceof ZodError) {
    return new AppError({
      category: 'validation_error',
      code: 'INVALID_COMMAND_REQUEST',
      message: 'Command request validation failed',
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

export function createFinancialCommandRouter(
  handlers: FinancialCommandRouteHandlers,
): Router {
  const router = Router()

  router.post(
    '/reserve-stake',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)

      const result = await handlers.reserveStakeHandler.handle(
        commandPayload(request) as never,
      )

      response.status(201).json(result)
    }),
  )

  router.post(
    '/release-reservation',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)

      const result = await handlers.releaseReservationHandler.handle(
        commandPayload(request) as never,
      )

      response.status(200).json(result)
    }),
  )

  router.post(
    '/settle-bet',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)

      const result = await handlers.settleBetHandler.handle(
        commandPayload(request) as never,
      )

      response.status(200).json(result)
    }),
  )

  router.post(
    '/apply-house-take',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)

      const result = await handlers.applyHouseTakeHandler.handle(
        commandPayload(request) as never,
      )

      response.status(200).json(result)
    }),
  )

  return router
}
