import { z } from 'zod'

import type { PlayerAccount } from '../entities/PlayerAccount.js'
import type { PlayerAccountEffectiveStatus } from '../state/playerAccountEffectiveStatus.js'

const currencyCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{3,12}$/)

export const playerAccountCurrencyParamsSchema = z.object({
  currency: currencyCodeSchema,
})

export interface PlayerAccountSummaryDto {
  playerAccountId: string
  currency: string
  effectiveStatus: PlayerAccountEffectiveStatus
  displayBalanceMinor: string
  spendableBalanceMinor: string
  asOf: string
}

export interface PlayerAccountSummaryResponseDto {
  account: PlayerAccountSummaryDto
}

export interface PlayerBalanceDto {
  playerAccountId: string
  currency: string
  effectiveStatus: PlayerAccountEffectiveStatus
  spendableBalanceMinor: string
  reservedBalanceMinor: string
  restrictedBalanceMinor: string
  displayBalanceMinor: string
  asOf: string
}

export interface PlayerBalanceResponseDto {
  balance: PlayerBalanceDto
}

export interface PlayerAccountSummaryDtoInput {
  playerAccount: PlayerAccount
  effectiveStatus: PlayerAccountEffectiveStatus
  displayBalanceMinor: bigint | number | string
  spendableBalanceMinor: bigint | number | string
  asOf: Date
}

export interface PlayerBalanceDtoInput {
  playerAccount: PlayerAccount
  effectiveStatus: PlayerAccountEffectiveStatus
  spendableBalanceMinor: bigint | number | string
  reservedBalanceMinor: bigint | number | string
  restrictedBalanceMinor: bigint | number | string
  displayBalanceMinor: bigint | number | string
  asOf: Date
}

export function toPlayerAccountSummaryResponseDto(
  input: PlayerAccountSummaryDtoInput,
): PlayerAccountSummaryResponseDto {
  return {
    account: {
      playerAccountId: input.playerAccount.playerAccountId,
      currency: input.playerAccount.currency,
      effectiveStatus: input.effectiveStatus,
      displayBalanceMinor: toMinorUnitString(input.displayBalanceMinor),
      spendableBalanceMinor: toMinorUnitString(input.spendableBalanceMinor),
      asOf: input.asOf.toISOString(),
    },
  }
}

export function toPlayerBalanceResponseDto(
  input: PlayerBalanceDtoInput,
): PlayerBalanceResponseDto {
  return {
    balance: {
      playerAccountId: input.playerAccount.playerAccountId,
      currency: input.playerAccount.currency,
      effectiveStatus: input.effectiveStatus,
      spendableBalanceMinor: toMinorUnitString(input.spendableBalanceMinor),
      reservedBalanceMinor: toMinorUnitString(input.reservedBalanceMinor),
      restrictedBalanceMinor: toMinorUnitString(input.restrictedBalanceMinor),
      displayBalanceMinor: toMinorUnitString(input.displayBalanceMinor),
      asOf: input.asOf.toISOString(),
    },
  }
}

function toMinorUnitString(value: bigint | number | string): string {
  return value.toString()
}
