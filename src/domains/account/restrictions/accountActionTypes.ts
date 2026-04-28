export const accountActionTypes = [
  'player_balance_view',
  'admin_account_inspection',
  'bet_reserve',
  'deposit_credit',
  'withdrawal_reserve',
  'settlement_payout',
  'admin_apply_restriction',
  'admin_lift_restriction',
  'admin_apply_suspension',
  'admin_lift_suspension',
  'admin_apply_freeze',
  'admin_lift_freeze',
] as const

export type AccountActionType = (typeof accountActionTypes)[number]

export const restrictableAccountActionTypes = [
  'bet_reserve',
  'withdrawal_reserve',
] as const

export type RestrictableAccountActionType =
  (typeof restrictableAccountActionTypes)[number]

export const adminOnlyAccountActionTypes = [
  'admin_account_inspection',
  'admin_apply_restriction',
  'admin_lift_restriction',
  'admin_apply_suspension',
  'admin_lift_suspension',
  'admin_apply_freeze',
  'admin_lift_freeze',
] as const

export type AdminOnlyAccountActionType =
  (typeof adminOnlyAccountActionTypes)[number]
