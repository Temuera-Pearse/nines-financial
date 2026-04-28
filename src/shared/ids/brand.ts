import { AppError } from '../types/AppError.js'

export type Brand<Value, Name extends string> = Value & { readonly __brand: Name }

export function brandString<Name extends string>(value: string, fieldName: string): Brand<string, Name> {
  const trimmedValue = value.trim()

  if (trimmedValue.length === 0) {
    throw new AppError({
      category: 'validation_error',
      code: 'INVALID_IDENTIFIER',
      message: `${fieldName} must be a non-empty string`,
      details: { fieldName },
    })
  }

  return trimmedValue as Brand<string, Name>
}