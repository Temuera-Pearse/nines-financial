import type { PlayerAccountEffectiveStatus } from './playerAccountEffectiveStatus.js'

export interface ResolveStatusChangedAtInput {
  previousStatusChangedAt: Date
  effectiveStatusBefore: PlayerAccountEffectiveStatus
  effectiveStatusAfter: PlayerAccountEffectiveStatus
  changedAt: Date
}

export function resolveStatusChangedAt(
  input: ResolveStatusChangedAtInput,
): Date {
  if (input.effectiveStatusBefore === input.effectiveStatusAfter) {
    return new Date(input.previousStatusChangedAt)
  }

  return new Date(input.changedAt)
}
