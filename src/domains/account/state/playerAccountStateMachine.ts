import {
  DuplicateActiveControlError,
  InvalidPlayerAccountTransitionError,
} from '../errors/AccountDomainErrors.js'
import type { PlayerAccountId } from '../types/identifiers.js'
import {
  derivePlayerAccountEffectiveStatus,
  normalizePlayerAccountControlStateSummary,
  type PlayerAccountControlStateSummary,
  type PlayerAccountEffectiveStatus,
} from './playerAccountEffectiveStatus.js'

export const playerAccountTransitionTypes = [
  'apply_restriction',
  'lift_restriction',
  'apply_suspension',
  'lift_suspension',
  'apply_freeze',
  'lift_freeze',
] as const

export type PlayerAccountTransitionType =
  (typeof playerAccountTransitionTypes)[number]

export interface PlayerAccountStateTransitionInput {
  playerAccountId: PlayerAccountId
  current: PlayerAccountControlStateSummary
  transition: PlayerAccountTransitionType
}

export interface PlayerAccountStateTransitionResult {
  previousControls: PlayerAccountControlStateSummary
  nextControls: PlayerAccountControlStateSummary
  effectiveStatusBefore: PlayerAccountEffectiveStatus
  effectiveStatusAfter: PlayerAccountEffectiveStatus
  statusChanged: boolean
}

export function applyPlayerAccountTransition(
  input: PlayerAccountStateTransitionInput,
): PlayerAccountStateTransitionResult {
  const previousControls = normalizePlayerAccountControlStateSummary(
    input.current,
  )
  const nextControls = { ...previousControls }
  const effectiveStatusBefore =
    derivePlayerAccountEffectiveStatus(previousControls)

  switch (input.transition) {
    case 'apply_restriction':
      nextControls.restrictionCount += 1
      break
    case 'lift_restriction':
      if (nextControls.restrictionCount === 0) {
        throw new InvalidPlayerAccountTransitionError(
          input.playerAccountId,
          input.transition,
          { restrictionCount: nextControls.restrictionCount },
        )
      }

      nextControls.restrictionCount -= 1
      break
    case 'apply_suspension':
      if (nextControls.hasSuspension) {
        throw new DuplicateActiveControlError(
          input.playerAccountId,
          'suspension',
        )
      }

      nextControls.hasSuspension = true
      break
    case 'lift_suspension':
      if (!nextControls.hasSuspension) {
        throw new InvalidPlayerAccountTransitionError(
          input.playerAccountId,
          input.transition,
          { hasSuspension: nextControls.hasSuspension },
        )
      }

      nextControls.hasSuspension = false
      break
    case 'apply_freeze':
      if (nextControls.hasFreeze) {
        throw new DuplicateActiveControlError(input.playerAccountId, 'freeze')
      }

      nextControls.hasFreeze = true
      break
    case 'lift_freeze':
      if (!nextControls.hasFreeze) {
        throw new InvalidPlayerAccountTransitionError(
          input.playerAccountId,
          input.transition,
          { hasFreeze: nextControls.hasFreeze },
        )
      }

      nextControls.hasFreeze = false
      break
  }

  const effectiveStatusAfter = derivePlayerAccountEffectiveStatus(nextControls)

  return {
    previousControls,
    nextControls,
    effectiveStatusBefore,
    effectiveStatusAfter,
    statusChanged: effectiveStatusBefore !== effectiveStatusAfter,
  }
}
