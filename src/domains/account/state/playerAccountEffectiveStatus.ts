import { AccountDomainValidationError } from '../errors/AccountDomainErrors.js'

export const playerAccountEffectiveStatuses = [
  'active',
  'restricted',
  'suspended',
  'frozen',
] as const

export type PlayerAccountEffectiveStatus =
  (typeof playerAccountEffectiveStatuses)[number]

export const playerAccountEffectiveStatusPrecedence: readonly PlayerAccountEffectiveStatus[] =
  ['frozen', 'suspended', 'restricted', 'active'] as const

export interface PlayerAccountControlStateSummary {
  restrictionCount: number
  hasSuspension: boolean
  hasFreeze: boolean
}

export function normalizePlayerAccountControlStateSummary(
  input: PlayerAccountControlStateSummary,
): PlayerAccountControlStateSummary {
  if (!Number.isInteger(input.restrictionCount) || input.restrictionCount < 0) {
    throw new AccountDomainValidationError(
      'INVALID_RESTRICTION_COUNT',
      'restrictionCount must be a non-negative integer',
      { restrictionCount: input.restrictionCount },
    )
  }

  return {
    restrictionCount: input.restrictionCount,
    hasSuspension: input.hasSuspension,
    hasFreeze: input.hasFreeze,
  }
}

export function derivePlayerAccountEffectiveStatus(
  input: PlayerAccountControlStateSummary,
): PlayerAccountEffectiveStatus {
  const controlState = normalizePlayerAccountControlStateSummary(input)

  if (controlState.hasFreeze) {
    return 'frozen'
  }

  if (controlState.hasSuspension) {
    return 'suspended'
  }

  if (controlState.restrictionCount > 0) {
    return 'restricted'
  }

  return 'active'
}

export function isFinanciallyStopped(
  effectiveStatus: PlayerAccountEffectiveStatus,
): boolean {
  return effectiveStatus === 'frozen'
}

export function hasSuspensionAccessBlock(
  input: PlayerAccountControlStateSummary,
): boolean {
  return normalizePlayerAccountControlStateSummary(input).hasSuspension
}

export function createEmptyPlayerAccountControlStateSummary(): PlayerAccountControlStateSummary {
  return {
    restrictionCount: 0,
    hasSuspension: false,
    hasFreeze: false,
  }
}
