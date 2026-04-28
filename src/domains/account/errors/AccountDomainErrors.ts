import type { JsonObject } from '../../../shared/types/Json.js'
import { AppError } from '../../../shared/types/AppError.js'
import type { AccountId } from '../../accounting/types/identifiers.js'
import type { AccountActionType } from '../restrictions/accountActionTypes.js'
import type { PlayerAccountEffectiveStatus } from '../state/playerAccountEffectiveStatus.js'
import type {
  AccountControlKind,
  AccountActionActorRole,
} from '../types/accountDomainTypes.js'
import type { PlayerAccountId } from '../types/identifiers.js'

export class PlayerAccountNotFoundError extends AppError {
  constructor(playerAccountId: PlayerAccountId) {
    super({
      category: 'not_found',
      code: 'PLAYER_ACCOUNT_NOT_FOUND',
      message: `Player account ${playerAccountId} was not found`,
      details: { playerAccountId },
    })
  }
}

export class InvalidPlayerAccountTransitionError extends AppError {
  constructor(
    playerAccountId: PlayerAccountId,
    transitionType: string,
    details?: JsonObject,
  ) {
    super({
      category: 'conflict',
      code: 'INVALID_PLAYER_ACCOUNT_TRANSITION',
      message: `Transition ${transitionType} is invalid for player account ${playerAccountId}`,
      details: {
        playerAccountId,
        transitionType,
        ...(details ?? {}),
      },
    })
  }
}

export class AccountActionUnauthorizedError extends AppError {
  constructor(action: AccountActionType, actorRole: AccountActionActorRole) {
    super({
      category: 'forbidden',
      code: 'ACCOUNT_ACTION_UNAUTHORIZED',
      message: `Actor role ${actorRole} is not permitted to perform account action ${action}`,
      details: {
        action,
        actorRole,
      },
    })
  }
}

export class AccountActionForbiddenByStatusError extends AppError {
  constructor(
    action: AccountActionType,
    effectiveStatus: PlayerAccountEffectiveStatus,
    details?: JsonObject,
  ) {
    super({
      category: 'forbidden',
      code: 'ACCOUNT_ACTION_FORBIDDEN_BY_STATUS',
      message: `Account action ${action} is forbidden while the effective status is ${effectiveStatus}`,
      details: {
        action,
        effectiveStatus,
        ...(details ?? {}),
      },
    })
  }
}

export class InvalidLinkedCoreAccountStateError extends AppError {
  constructor(accountId: AccountId, reason: string, details?: JsonObject) {
    super({
      category: 'conflict',
      code: 'INVALID_LINKED_CORE_ACCOUNT_STATE',
      message: `Linked Accounting Core account ${accountId} is in an invalid state: ${reason}`,
      details: {
        accountId,
        reason,
        ...(details ?? {}),
      },
    })
  }
}

export class FreezeSyncFailedError extends AppError {
  constructor(
    playerAccountId: PlayerAccountId,
    operation: 'apply' | 'lift',
    details?: JsonObject,
    cause?: unknown,
  ) {
    super({
      category: 'internal_error',
      code: 'FREEZE_SYNC_FAILED',
      message: `Failed to ${operation} freeze state for player account ${playerAccountId} in Accounting Core`,
      details: {
        playerAccountId,
        operation,
        ...(details ?? {}),
      },
      cause,
    })
  }
}

export class DuplicateActiveControlError extends AppError {
  constructor(
    playerAccountId: PlayerAccountId,
    controlKind: AccountControlKind,
  ) {
    super({
      category: 'conflict',
      code: 'DUPLICATE_ACTIVE_CONTROL',
      message: `Player account ${playerAccountId} already has an active ${controlKind}`,
      details: {
        playerAccountId,
        controlKind,
      },
    })
  }
}

export class AccountDomainValidationError extends AppError {
  constructor(code: string, message: string, details?: JsonObject) {
    super({
      category: 'validation_error',
      code,
      message,
      ...(details ? { details } : {}),
    })
  }
}
