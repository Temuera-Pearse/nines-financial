import { describe, expect, it } from 'vitest'

import { AppError } from '../../src/shared/types/AppError.js'
import { Money } from '../../src/shared/money/Money.js'

describe('Money', () => {
  it('performs arithmetic using integer minor units only', () => {
    const initial = Money.fromMinorUnits('105', 'USD')
    const increment = Money.fromMinorUnits('95', 'USD')

    expect(initial.add(increment).amountMinor).toBe(200n)
    expect(initial.subtract(increment).amountMinor).toBe(10n)
  })

  it('rejects invalid floating-point style input', () => {
    expect(() => Money.fromMinorUnits('10.25', 'USD')).toThrowError(AppError)
  })

  it('rejects mixed-currency arithmetic', () => {
    const usd = Money.fromMinorUnits('100', 'USD')
    const eur = Money.fromMinorUnits('100', 'EUR')

    expect(() => usd.add(eur)).toThrowError(AppError)
  })
})