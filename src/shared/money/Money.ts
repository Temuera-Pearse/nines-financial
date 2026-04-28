import { AppError } from '../types/AppError.js'

export type CurrencyCode = string & { readonly __currencyCode: unique symbol }

function assertCurrencyCode(currency: string): CurrencyCode {
  const normalizedCurrency = currency.trim().toUpperCase()

  if (!/^[A-Z]{3,12}$/.test(normalizedCurrency)) {
    throw new AppError({
      category: 'validation_error',
      code: 'INVALID_CURRENCY',
      message: 'Currency must be an uppercase code between 3 and 12 letters',
      details: { currency },
    })
  }

  return normalizedCurrency as CurrencyCode
}

export function toCurrencyCode(currency: string): CurrencyCode {
  return assertCurrencyCode(currency)
}

function parseMinorUnits(amountMinor: bigint | number | string): bigint {
  if (typeof amountMinor === 'bigint') {
    return amountMinor
  }

  if (typeof amountMinor === 'number') {
    if (!Number.isSafeInteger(amountMinor)) {
      throw new AppError({
        category: 'validation_error',
        code: 'INVALID_MINOR_UNITS',
        message: 'Money minor units supplied as number must be a safe integer',
        details: { amountMinor },
      })
    }

    return BigInt(amountMinor)
  }

  if (!/^-?\d+$/.test(amountMinor)) {
    throw new AppError({
      category: 'validation_error',
      code: 'INVALID_MINOR_UNITS',
      message: 'Money minor units supplied as string must be an integer string',
      details: { amountMinor },
    })
  }

  return BigInt(amountMinor)
}

export class Money {
  private constructor(
    readonly amountMinor: bigint,
    readonly currency: CurrencyCode,
  ) {}

  static fromMinorUnits(amountMinor: bigint | number | string, currency: string): Money {
    return new Money(parseMinorUnits(amountMinor), assertCurrencyCode(currency))
  }

  static zero(currency: string): Money {
    return Money.fromMinorUnits(0n, currency)
  }

  add(other: Money): Money {
    this.assertSameCurrency(other)
    return new Money(this.amountMinor + other.amountMinor, this.currency)
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other)
    return new Money(this.amountMinor - other.amountMinor, this.currency)
  }

  negate(): Money {
    return new Money(-this.amountMinor, this.currency)
  }

  abs(): Money {
    return new Money(this.amountMinor < 0n ? -this.amountMinor : this.amountMinor, this.currency)
  }

  isZero(): boolean {
    return this.amountMinor === 0n
  }

  isPositive(): boolean {
    return this.amountMinor > 0n
  }

  isNegative(): boolean {
    return this.amountMinor < 0n
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amountMinor === other.amountMinor
  }

  compare(other: Money): number {
    this.assertSameCurrency(other)

    if (this.amountMinor === other.amountMinor) {
      return 0
    }

    return this.amountMinor > other.amountMinor ? 1 : -1
  }

  toJSON() {
    return {
      amountMinor: this.amountMinor.toString(),
      currency: this.currency,
    }
  }

  private assertSameCurrency(other: Money) {
    if (this.currency !== other.currency) {
      throw new AppError({
        category: 'invariant_violation',
        code: 'MIXED_CURRENCY',
        message: 'Mixed-currency arithmetic is not allowed in Phase 1 accounting postings',
        details: {
          leftCurrency: this.currency,
          rightCurrency: other.currency,
        },
      })
    }
  }
}