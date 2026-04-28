import type { ErrorRequestHandler } from 'express'

import { AppError, isAppError } from '../../shared/types/AppError.js'

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  const correlationId = request.header('x-correlation-id')?.trim() ?? null
  const causationId = request.header('x-causation-id')?.trim() ?? null

  if (isAppError(error)) {
    response.status(error.statusCode).json({
      ...error.toResponseBody(),
      correlationId,
      causationId,
    })
    return
  }

  const internalError = new AppError({
    category: 'internal_error',
    code: 'UNEXPECTED_INTERNAL_ERROR',
    message: 'Unexpected internal error',
  })

  response.status(internalError.statusCode).json({
    ...internalError.toResponseBody(),
    correlationId,
    causationId,
  })
}