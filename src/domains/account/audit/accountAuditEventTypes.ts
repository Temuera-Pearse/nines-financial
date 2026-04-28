export const accountAuditEntityTypes = ['player_account'] as const

export type AccountAuditEntityType = (typeof accountAuditEntityTypes)[number]

export const accountAuditEventTypes = [
  'player_account_restriction_applied',
  'player_account_restriction_lifted',
  'player_account_suspension_applied',
  'player_account_suspension_lifted',
  'player_account_freeze_applied',
  'player_account_freeze_lifted',
  'player_account_effective_status_changed',
  'player_account_freeze_apply_failed',
  'player_account_freeze_lift_failed',
] as const

export type AccountAuditEventType = (typeof accountAuditEventTypes)[number]

export const accountAuditFailureEventTypes = [
  'player_account_freeze_apply_failed',
  'player_account_freeze_lift_failed',
] as const

export type AccountAuditFailureEventType =
  (typeof accountAuditFailureEventTypes)[number]

export function isAccountAuditFailureEventType(
  eventType: AccountAuditEventType,
): eventType is AccountAuditFailureEventType {
  return (accountAuditFailureEventTypes as readonly string[]).includes(
    eventType,
  )
}
