import type { JsonObject } from './Json.js'

export type ErrorCategory =
  | 'validation_error'
  | 'not_found'
  | 'conflict'
  | 'idempotency_conflict'
  | 'invariant_violation'
  | 'forbidden'
  | 'internal_error'

export interface AppErrorOptions {
  category: ErrorCategory
  code: string
  message: string
  details?: JsonObject
  retryable?: boolean
  cause?: unknown
}

const defaultStatusByCategory: Record<ErrorCategory, number> = {
  validation_error: 400,
  not_found: 404,
  conflict: 409,
  idempotency_conflict: 409,
  invariant_violation: 422,
  forbidden: 403,
  internal_error: 500,
}

export class AppError extends Error {
  readonly category: ErrorCategory

  readonly code: string

  readonly details: JsonObject | undefined

  readonly retryable: boolean

  readonly statusCode: number

  constructor(options: AppErrorOptions) {
    super(options.message, { cause: options.cause })
    this.name = 'AppError'
    this.category = options.category
    this.code = options.code
    this.details = options.details
    this.retryable = options.retryable ?? false
    this.statusCode = defaultStatusByCategory[options.category]
  }

  toResponseBody() {
    return {
      error: {
        category: this.category,
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        details: this.details ?? null,
      },
    }
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}