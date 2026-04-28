import type { PlayerAccountEffectiveStatus } from '../state/playerAccountEffectiveStatus.js'
import type { AccountActionType } from './accountActionTypes.js'

export type AccountActionAccess = 'allowed' | 'blocked' | 'admin_only'

export interface AccountActionRule {
  access: AccountActionAccess
  requiresAccountingCorePermission: boolean
  blockedWhenHiddenSuspensionIsActive?: boolean
}

export type AccountActionRulesByStatus = Record<
  PlayerAccountEffectiveStatus,
  AccountActionRule
>

export const restrictionRulesMatrix: Record<
  AccountActionType,
  AccountActionRulesByStatus
> = {
  player_balance_view: {
    active: { access: 'allowed', requiresAccountingCorePermission: false },
    restricted: { access: 'allowed', requiresAccountingCorePermission: false },
    suspended: { access: 'blocked', requiresAccountingCorePermission: false },
    frozen: {
      access: 'allowed',
      requiresAccountingCorePermission: false,
      blockedWhenHiddenSuspensionIsActive: true,
    },
  },
  admin_account_inspection: {
    active: { access: 'admin_only', requiresAccountingCorePermission: false },
    restricted: {
      access: 'admin_only',
      requiresAccountingCorePermission: false,
    },
    suspended: {
      access: 'admin_only',
      requiresAccountingCorePermission: false,
    },
    frozen: { access: 'admin_only', requiresAccountingCorePermission: false },
  },
  bet_reserve: {
    active: { access: 'allowed', requiresAccountingCorePermission: true },
    restricted: { access: 'blocked', requiresAccountingCorePermission: false },
    suspended: { access: 'blocked', requiresAccountingCorePermission: false },
    frozen: { access: 'blocked', requiresAccountingCorePermission: false },
  },
  deposit_credit: {
    active: { access: 'allowed', requiresAccountingCorePermission: true },
    restricted: { access: 'allowed', requiresAccountingCorePermission: true },
    suspended: { access: 'allowed', requiresAccountingCorePermission: true },
    frozen: { access: 'blocked', requiresAccountingCorePermission: false },
  },
  withdrawal_reserve: {
    active: { access: 'allowed', requiresAccountingCorePermission: true },
    restricted: { access: 'blocked', requiresAccountingCorePermission: false },
    suspended: { access: 'blocked', requiresAccountingCorePermission: false },
    frozen: { access: 'blocked', requiresAccountingCorePermission: false },
  },
  settlement_payout: {
    active: { access: 'allowed', requiresAccountingCorePermission: true },
    restricted: { access: 'allowed', requiresAccountingCorePermission: true },
    suspended: { access: 'allowed', requiresAccountingCorePermission: true },
    frozen: { access: 'blocked', requiresAccountingCorePermission: false },
  },
  admin_apply_restriction: {
    active: { access: 'admin_only', requiresAccountingCorePermission: false },
    restricted: {
      access: 'admin_only',
      requiresAccountingCorePermission: false,
    },
    suspended: {
      access: 'admin_only',
      requiresAccountingCorePermission: false,
    },
    frozen: { access: 'admin_only', requiresAccountingCorePermission: false },
  },
  admin_lift_restriction: {
    active: { access: 'admin_only', requiresAccountingCorePermission: false },
    restricted: {
      access: 'admin_only',
      requiresAccountingCorePermission: false,
    },
    suspended: {
      access: 'admin_only',
      requiresAccountingCorePermission: false,
    },
    frozen: { access: 'admin_only', requiresAccountingCorePermission: false },
  },
  admin_apply_suspension: {
    active: { access: 'admin_only', requiresAccountingCorePermission: false },
    restricted: {
      access: 'admin_only',
      requiresAccountingCorePermission: false,
    },
    suspended: {
      access: 'admin_only',
      requiresAccountingCorePermission: false,
    },
    frozen: { access: 'admin_only', requiresAccountingCorePermission: false },
  },
  admin_lift_suspension: {
    active: { access: 'admin_only', requiresAccountingCorePermission: false },
    restricted: {
      access: 'admin_only',
      requiresAccountingCorePermission: false,
    },
    suspended: {
      access: 'admin_only',
      requiresAccountingCorePermission: false,
    },
    frozen: { access: 'admin_only', requiresAccountingCorePermission: false },
  },
  admin_apply_freeze: {
    active: { access: 'admin_only', requiresAccountingCorePermission: true },
    restricted: {
      access: 'admin_only',
      requiresAccountingCorePermission: true,
    },
    suspended: { access: 'admin_only', requiresAccountingCorePermission: true },
    frozen: { access: 'admin_only', requiresAccountingCorePermission: true },
  },
  admin_lift_freeze: {
    active: { access: 'admin_only', requiresAccountingCorePermission: true },
    restricted: {
      access: 'admin_only',
      requiresAccountingCorePermission: true,
    },
    suspended: { access: 'admin_only', requiresAccountingCorePermission: true },
    frozen: { access: 'admin_only', requiresAccountingCorePermission: true },
  },
}

export function getAccountActionRule(
  action: AccountActionType,
  effectiveStatus: PlayerAccountEffectiveStatus,
): AccountActionRule {
  return restrictionRulesMatrix[action][effectiveStatus]
}
