import { AppError } from '../types/AppError.js'

export interface CorrelationMetadata {
  correlationId: string
  causationId: string
}

export function requireCorrelationMetadata(input: Partial<CorrelationMetadata>): CorrelationMetadata {
  if (!input.correlationId || !input.correlationId.trim()) {
    throw new AppError({
      category: 'validation_error',
      code: 'MISSING_CORRELATION_ID',
      message: 'correlationId is required for all state-changing accounting actions',
    })
  }

  if (!input.causationId || !input.causationId.trim()) {
    throw new AppError({
      category: 'validation_error',
      code: 'MISSING_CAUSATION_ID',
      message: 'causationId is required for all state-changing accounting actions',
    })
  }

  return {
    correlationId: input.correlationId.trim(),
    causationId: input.causationId.trim(),
  }
}