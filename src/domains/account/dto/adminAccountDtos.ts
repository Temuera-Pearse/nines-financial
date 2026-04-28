import type { AccountStatus } from '../../accounting/types/accountingTypes.js'
import type { PlayerAccount } from '../entities/PlayerAccount.js'
import type { PlayerAccountEffectiveStatus } from '../state/playerAccountEffectiveStatus.js'
import type { PlayerAccountClass } from '../types/accountDomainTypes.js'
import type {
  AccountFreezeDto,
  AccountRestrictionDto,
  AccountSuspensionDto,
} from './accountControlDtos.js'

export interface AdminAccountInspectionDto {
  playerAccountId: string
  userId: string
  currency: string
  accountClass: PlayerAccountClass
  effectiveStatus: PlayerAccountEffectiveStatus
  availableAccountId: string
  reservedAccountId: string
  availableAccountStatus: AccountStatus
  reservedAccountStatus: AccountStatus
  availableLedgerBalanceMinor: string
  reservedBalanceMinor: string
  restrictedBalanceMinor: string
  spendableBalanceMinor: string
  displayBalanceMinor: string
  activeRestrictionCount: number
  hasActiveSuspension: boolean
  hasActiveFreeze: boolean
  createdAt: string
  updatedAt: string
  statusChangedAt: string
  asOf: string
}

export interface AdminAccountInspectionControlsDto {
  restrictions: readonly AccountRestrictionDto[]
  suspension: AccountSuspensionDto | null
  freeze: AccountFreezeDto | null
}

export interface AdminAccountInspectionResponseDto {
  account: AdminAccountInspectionDto
  controls: AdminAccountInspectionControlsDto
}

export interface AdminAccountInspectionDtoInput {
  playerAccount: PlayerAccount
  effectiveStatus: PlayerAccountEffectiveStatus
  availableAccountStatus: AccountStatus
  reservedAccountStatus: AccountStatus
  availableLedgerBalanceMinor: bigint | number | string
  reservedBalanceMinor: bigint | number | string
  restrictedBalanceMinor: bigint | number | string
  spendableBalanceMinor: bigint | number | string
  displayBalanceMinor: bigint | number | string
  activeRestrictionCount: number
  hasActiveSuspension: boolean
  hasActiveFreeze: boolean
  restrictions: readonly AccountRestrictionDto[]
  suspension: AccountSuspensionDto | null
  freeze: AccountFreezeDto | null
  asOf: Date
}

export function toAdminAccountInspectionResponseDto(
  input: AdminAccountInspectionDtoInput,
): AdminAccountInspectionResponseDto {
  return {
    account: {
      playerAccountId: input.playerAccount.playerAccountId,
      userId: input.playerAccount.userId,
      currency: input.playerAccount.currency,
      accountClass: input.playerAccount.accountClass,
      effectiveStatus: input.effectiveStatus,
      availableAccountId: input.playerAccount.availableAccountId,
      reservedAccountId: input.playerAccount.reservedAccountId,
      availableAccountStatus: input.availableAccountStatus,
      reservedAccountStatus: input.reservedAccountStatus,
      availableLedgerBalanceMinor: toMinorUnitString(
        input.availableLedgerBalanceMinor,
      ),
      reservedBalanceMinor: toMinorUnitString(input.reservedBalanceMinor),
      restrictedBalanceMinor: toMinorUnitString(input.restrictedBalanceMinor),
      spendableBalanceMinor: toMinorUnitString(input.spendableBalanceMinor),
      displayBalanceMinor: toMinorUnitString(input.displayBalanceMinor),
      activeRestrictionCount: input.activeRestrictionCount,
      hasActiveSuspension: input.hasActiveSuspension,
      hasActiveFreeze: input.hasActiveFreeze,
      createdAt: input.playerAccount.createdAt.toISOString(),
      updatedAt: input.playerAccount.updatedAt.toISOString(),
      statusChangedAt: input.playerAccount.statusChangedAt.toISOString(),
      asOf: input.asOf.toISOString(),
    },
    controls: {
      restrictions: input.restrictions,
      suspension: input.suspension,
      freeze: input.freeze,
    },
  }
}

function toMinorUnitString(value: bigint | number | string): string {
  return value.toString()
}
