import type { Request, Response } from 'express'

import { toIdempotencyKey } from '../../shared/idempotency/types.js'
import { AppError } from '../../shared/types/AppError.js'

export interface CorrelationHeaders {
  correlationId: string
  causationId: string
}

export interface StateChangingRequestContext extends CorrelationHeaders {
  idempotencyKey: ReturnType<typeof toIdempotencyKey>
}

function requireHeader(request: Request, headerName: string): string {
  const value = request.header(headerName)?.trim()

  if (!value) {
    throw new AppError({
      category: 'validation_error',
      code: 'MISSING_REQUIRED_HEADER',
      message: `${headerName} header is required`,
      details: { headerName },
    })
  }

  return value
}

export function readCorrelatedRequestContext(
  request: Request,
): CorrelationHeaders {
  return {
    correlationId: requireHeader(request, 'x-correlation-id'),
    causationId: requireHeader(request, 'x-causation-id'),
  }
}

export function readStateChangingRequestContext(
  request: Request,
): StateChangingRequestContext {
  return {
    ...readCorrelatedRequestContext(request),
    idempotencyKey: toIdempotencyKey(requireHeader(request, 'idempotency-key')),
  }
}

export function mirrorCorrelationHeaders(
  request: Request,
  response: Response,
): void {
  const correlationId = request.header('x-correlation-id')?.trim()
  const causationId = request.header('x-causation-id')?.trim()

  if (correlationId) {
    response.setHeader('x-correlation-id', correlationId)
  }

  if (causationId) {
    response.setHeader('x-causation-id', causationId)
  }
}

export function writeCorrelationHeaders(
  response: Response,
  correlationHeaders: CorrelationHeaders,
): void {
  response.setHeader('x-correlation-id', correlationHeaders.correlationId)
  response.setHeader('x-causation-id', correlationHeaders.causationId)
}
