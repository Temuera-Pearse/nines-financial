export const playerAccountClasses = ['primary'] as const

export type PlayerAccountClass = (typeof playerAccountClasses)[number]

export const accountControlKinds = [
  'restriction',
  'suspension',
  'freeze',
] as const

export type AccountControlKind = (typeof accountControlKinds)[number]

export const accountControlActorTypes = [
  'admin_user',
  'system',
  'policy_engine',
] as const

export type AccountControlActorType = (typeof accountControlActorTypes)[number]

export const accountActionActorRoles = ['player', 'admin', 'system'] as const

export type AccountActionActorRole = (typeof accountActionActorRoles)[number]

export interface AccountControlAttribution {
  actorType: AccountControlActorType
  actorId: string
  source: string
}

export interface AccountControlReason {
  reasonCode: string
  reasonText: string
  ticketId: string | null
}

export interface AccountControlLiftReason {
  liftReasonCode: string
  liftReasonText: string
}
