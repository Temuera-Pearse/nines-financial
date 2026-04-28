import { randomUUID } from 'node:crypto'

import { brandString, type Brand } from '../../../shared/ids/brand.js'

export type PlayerAccountId = Brand<string, 'PlayerAccountId'>
export type UserId = Brand<string, 'UserId'>
export type AccountRestrictionId = Brand<string, 'AccountRestrictionId'>
export type AccountSuspensionId = Brand<string, 'AccountSuspensionId'>
export type AccountFreezeId = Brand<string, 'AccountFreezeId'>

export function toPlayerAccountId(value: string): PlayerAccountId {
  return brandString<PlayerAccountId['__brand']>(value, 'playerAccountId')
}

export function toUserId(value: string): UserId {
  return brandString<UserId['__brand']>(value, 'userId')
}

export function toAccountRestrictionId(value: string): AccountRestrictionId {
  return brandString<AccountRestrictionId['__brand']>(value, 'restrictionId')
}

export function toAccountSuspensionId(value: string): AccountSuspensionId {
  return brandString<AccountSuspensionId['__brand']>(value, 'suspensionId')
}

export function toAccountFreezeId(value: string): AccountFreezeId {
  return brandString<AccountFreezeId['__brand']>(value, 'freezeId')
}

export function newPlayerAccountId(): PlayerAccountId {
  return toPlayerAccountId(`pa_${randomUUID()}`)
}

export function newAccountRestrictionId(): AccountRestrictionId {
  return toAccountRestrictionId(`restriction_${randomUUID()}`)
}

export function newAccountSuspensionId(): AccountSuspensionId {
  return toAccountSuspensionId(`suspension_${randomUUID()}`)
}

export function newAccountFreezeId(): AccountFreezeId {
  return toAccountFreezeId(`freeze_${randomUUID()}`)
}
