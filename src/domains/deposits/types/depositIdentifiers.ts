import { randomUUID } from 'node:crypto'

import { brandString, type Brand } from '../../../shared/ids/brand.js'

export type DepositIntentId = Brand<string, 'DepositIntentId'>
export type DepositEventId = Brand<string, 'DepositEventId'>

export function toDepositIntentId(value: string): DepositIntentId {
  return brandString<DepositIntentId['__brand']>(value, 'depositIntentId')
}

export function toDepositEventId(value: string): DepositEventId {
  return brandString<DepositEventId['__brand']>(value, 'depositEventId')
}

export function newDepositIntentId(): DepositIntentId {
  return toDepositIntentId(`dep_intent_${randomUUID()}`)
}

export function newDepositEventId(): DepositEventId {
  return toDepositEventId(`dep_event_${randomUUID()}`)
}
