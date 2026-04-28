import {
  AccountDomainValidationError,
  AccountActionForbiddenByStatusError,
  AccountActionUnauthorizedError,
  InvalidLinkedCoreAccountStateError,
} from '../errors/AccountDomainErrors.js'
import {
  derivePlayerAccountEffectiveStatus,
  hasSuspensionAccessBlock,
  normalizePlayerAccountControlStateSummary,
  type PlayerAccountControlStateSummary,
  type PlayerAccountEffectiveStatus,
} from '../state/playerAccountEffectiveStatus.js'
import type { AccountId } from '../../accounting/types/identifiers.js'
import type { AccountActionActorRole } from '../types/accountDomainTypes.js'
import type { AccountActionType } from './accountActionTypes.js'
import {
  getAccountActionRule,
  type AccountActionRule,
} from './restrictionRulesMatrix.js'

export interface AccountActionAuthorizationInput {
  action: AccountActionType
  actorRole: AccountActionActorRole
  effectiveStatus?: PlayerAccountEffectiveStatus
  controlState: PlayerAccountControlStateSummary
  linkedCoreAccountId?: AccountId
  accountingCorePermitsAction?: boolean
}

export interface AccountActionAuthorizationDecision {
  allowed: boolean
  rule: AccountActionRule
  effectiveStatus: PlayerAccountEffectiveStatus
  controlState: PlayerAccountControlStateSummary
  blockedBy:
    | 'none'
    | 'unauthorized'
    | 'status'
    | 'strictest_control'
    | 'linked_core_state'
}

export class AccountActionAuthorizationService {
  authorize(
    input: AccountActionAuthorizationInput,
  ): AccountActionAuthorizationDecision {
    const controlState = normalizePlayerAccountControlStateSummary(
      input.controlState,
    )
    const effectiveStatus = this.resolveEffectiveStatus(input, controlState)
    const rule = getAccountActionRule(input.action, effectiveStatus)

    if (rule.access === 'admin_only' && input.actorRole !== 'admin') {
      return {
        allowed: false,
        rule,
        effectiveStatus,
        controlState,
        blockedBy: 'unauthorized',
      }
    }

    if (
      input.action === 'player_balance_view' &&
      effectiveStatus === 'frozen' &&
      rule.blockedWhenHiddenSuspensionIsActive &&
      hasSuspensionAccessBlock(controlState)
    ) {
      return {
        allowed: false,
        rule,
        effectiveStatus,
        controlState,
        blockedBy: 'strictest_control',
      }
    }

    if (rule.access === 'blocked') {
      return {
        allowed: false,
        rule,
        effectiveStatus,
        controlState,
        blockedBy: 'status',
      }
    }

    if (rule.requiresAccountingCorePermission) {
      if (input.accountingCorePermitsAction !== true) {
        if (input.accountingCorePermitsAction === undefined) {
          throw new AccountDomainValidationError(
            'MISSING_ACCOUNTING_CORE_PERMISSION_CONTEXT',
            'accountingCorePermitsAction is required for Account Domain actions gated by Accounting Core state',
            {
              action: input.action,
              effectiveStatus,
            },
          )
        }

        this.requireLinkedCoreAccountId(input, effectiveStatus)

        return {
          allowed: false,
          rule,
          effectiveStatus,
          controlState,
          blockedBy: 'linked_core_state',
        }
      }
    }

    return {
      allowed: true,
      rule,
      effectiveStatus,
      controlState,
      blockedBy: 'none',
    }
  }

  assertAuthorized(input: AccountActionAuthorizationInput) {
    const decision = this.authorize(input)

    switch (decision.blockedBy) {
      case 'none':
        return
      case 'unauthorized':
        throw new AccountActionUnauthorizedError(input.action, input.actorRole)
      case 'status':
      case 'strictest_control':
        throw new AccountActionForbiddenByStatusError(
          input.action,
          decision.effectiveStatus,
          {
            restrictionCount: decision.controlState.restrictionCount,
            hasSuspension: decision.controlState.hasSuspension,
            hasFreeze: decision.controlState.hasFreeze,
            blockedBy: decision.blockedBy,
          },
        )
      case 'linked_core_state':
        const linkedCoreAccountId = this.requireLinkedCoreAccountId(
          input,
          decision.effectiveStatus,
        )

        throw new InvalidLinkedCoreAccountStateError(
          linkedCoreAccountId,
          `Accounting Core denied account action ${input.action}`,
          {
            action: input.action,
            effectiveStatus: decision.effectiveStatus,
          },
        )
    }
  }

  private resolveEffectiveStatus(
    input: AccountActionAuthorizationInput,
    controlState: PlayerAccountControlStateSummary,
  ): PlayerAccountEffectiveStatus {
    const derivedEffectiveStatus =
      derivePlayerAccountEffectiveStatus(controlState)

    if (
      input.effectiveStatus !== undefined &&
      input.effectiveStatus !== derivedEffectiveStatus
    ) {
      throw new AccountDomainValidationError(
        'EFFECTIVE_STATUS_MISMATCH',
        'effectiveStatus must match the status derived from active account controls',
        {
          providedEffectiveStatus: input.effectiveStatus,
          derivedEffectiveStatus,
          restrictionCount: controlState.restrictionCount,
          hasSuspension: controlState.hasSuspension,
          hasFreeze: controlState.hasFreeze,
        },
      )
    }

    return derivedEffectiveStatus
  }

  private requireLinkedCoreAccountId(
    input: AccountActionAuthorizationInput,
    effectiveStatus: PlayerAccountEffectiveStatus,
  ): AccountId {
    if (input.linkedCoreAccountId) {
      return input.linkedCoreAccountId
    }

    throw new AccountDomainValidationError(
      'MISSING_LINKED_CORE_ACCOUNT_CONTEXT',
      'linkedCoreAccountId is required when evaluating a denied core-gated Account Domain action',
      {
        action: input.action,
        effectiveStatus,
      },
    )
  }
}
