import type { JsonObject } from '../../../shared/types/Json.js'
import type { RestrictableAccountActionType } from '../restrictions/accountActionTypes.js'
import type { PlayerAccountEffectiveStatus } from '../state/playerAccountEffectiveStatus.js'
import type { PlayerAccountTransitionType } from '../state/playerAccountStateMachine.js'
import type { AccountControlActorType } from '../types/accountDomainTypes.js'
import type {
  AccountFreezeId,
  AccountRestrictionId,
  AccountSuspensionId,
  PlayerAccountId,
  UserId,
} from '../types/identifiers.js'

import type { AccountAuditEventType } from './accountAuditEventTypes.js'

export interface AccountAuditCommonPayload extends JsonObject {
  playerAccountId: PlayerAccountId
  userId: UserId
  currency: string
  actorType: AccountControlActorType
  actorId: string
  source: string
  reasonCode: string
  reasonText: string
  ticketId: string | null
}

export interface PlayerAccountRestrictionAppliedAuditPayload extends AccountAuditCommonPayload {
  restrictionId: AccountRestrictionId
  blockedActions: RestrictableAccountActionType[]
  expiresAt: string | null
  effectiveStatusBefore: PlayerAccountEffectiveStatus
  effectiveStatusAfter: PlayerAccountEffectiveStatus
}

export interface PlayerAccountRestrictionLiftedAuditPayload extends AccountAuditCommonPayload {
  restrictionId: AccountRestrictionId
  blockedActions: RestrictableAccountActionType[]
  liftedAt: string
  effectiveStatusBefore: PlayerAccountEffectiveStatus
  effectiveStatusAfter: PlayerAccountEffectiveStatus
}

export interface PlayerAccountSuspensionAppliedAuditPayload extends AccountAuditCommonPayload {
  suspensionId: AccountSuspensionId
  expiresAt: string | null
  effectiveStatusBefore: PlayerAccountEffectiveStatus
  effectiveStatusAfter: PlayerAccountEffectiveStatus
}

export interface PlayerAccountSuspensionLiftedAuditPayload extends AccountAuditCommonPayload {
  suspensionId: AccountSuspensionId
  liftedAt: string
  effectiveStatusBefore: PlayerAccountEffectiveStatus
  effectiveStatusAfter: PlayerAccountEffectiveStatus
}

export interface PlayerAccountFreezeAppliedAuditPayload extends AccountAuditCommonPayload {
  freezeId: AccountFreezeId
  availableAccountId: string
  reservedAccountId: string
  availableAccountStatus: 'frozen'
  reservedAccountStatus: 'frozen'
  effectiveStatusBefore: PlayerAccountEffectiveStatus
  effectiveStatusAfter: PlayerAccountEffectiveStatus
}

export interface PlayerAccountFreezeLiftedAuditPayload extends AccountAuditCommonPayload {
  freezeId: AccountFreezeId
  availableAccountId: string
  reservedAccountId: string
  availableAccountStatus: 'active'
  reservedAccountStatus: 'active'
  effectiveStatusBefore: PlayerAccountEffectiveStatus
  effectiveStatusAfter: PlayerAccountEffectiveStatus
}

export interface PlayerAccountEffectiveStatusChangedAuditPayload extends AccountAuditCommonPayload {
  triggeringControlId: string
  triggeringTransition: PlayerAccountTransitionType
  effectiveStatusBefore: PlayerAccountEffectiveStatus
  effectiveStatusAfter: PlayerAccountEffectiveStatus
  restrictionCount: number
  hasSuspension: boolean
  hasFreeze: boolean
}

export interface PlayerAccountFreezeApplyFailedAuditPayload extends AccountAuditCommonPayload {
  availableAccountId: string
  reservedAccountId: string
  effectiveStatusBefore: PlayerAccountEffectiveStatus
  attemptedTransition: 'apply_freeze'
}

export interface PlayerAccountFreezeLiftFailedAuditPayload extends AccountAuditCommonPayload {
  freezeId: AccountFreezeId
  availableAccountId: string
  reservedAccountId: string
  effectiveStatusBefore: PlayerAccountEffectiveStatus
  attemptedTransition: 'lift_freeze'
}

export interface AccountAuditPayloadMap {
  player_account_restriction_applied: PlayerAccountRestrictionAppliedAuditPayload
  player_account_restriction_lifted: PlayerAccountRestrictionLiftedAuditPayload
  player_account_suspension_applied: PlayerAccountSuspensionAppliedAuditPayload
  player_account_suspension_lifted: PlayerAccountSuspensionLiftedAuditPayload
  player_account_freeze_applied: PlayerAccountFreezeAppliedAuditPayload
  player_account_freeze_lifted: PlayerAccountFreezeLiftedAuditPayload
  player_account_effective_status_changed: PlayerAccountEffectiveStatusChangedAuditPayload
  player_account_freeze_apply_failed: PlayerAccountFreezeApplyFailedAuditPayload
  player_account_freeze_lift_failed: PlayerAccountFreezeLiftFailedAuditPayload
}

export type AccountAuditPayload<
  TEventType extends AccountAuditEventType = AccountAuditEventType,
> = AccountAuditPayloadMap[TEventType]

export interface PreparedAccountDomainAuditEvent<
  TEventType extends AccountAuditEventType = AccountAuditEventType,
> {
  eventType: TEventType
  playerAccountId: PlayerAccountId
  correlationId: string
  causationId: string
  payload: AccountAuditPayload<TEventType>
  occurredAt: Date
}
