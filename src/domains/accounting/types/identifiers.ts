import { randomUUID } from 'node:crypto'

import { brandString, type Brand } from '../../../shared/ids/brand.js'

export type AccountId = Brand<string, 'AccountId'>
export type OwnerId = Brand<string, 'OwnerId'>
export type LedgerTransactionId = Brand<string, 'LedgerTransactionId'>
export type LedgerEntryId = Brand<string, 'LedgerEntryId'>
export type ReservationId = Brand<string, 'ReservationId'>
export type AuditEventId = Brand<string, 'AuditEventId'>

export function toAccountId(value: string): AccountId {
  return brandString<AccountId['__brand']>(value, 'accountId')
}

export function toOwnerId(value: string): OwnerId {
  return brandString<OwnerId['__brand']>(value, 'ownerId')
}

export function toLedgerTransactionId(value: string): LedgerTransactionId {
  return brandString<LedgerTransactionId['__brand']>(value, 'transactionId')
}

export function toLedgerEntryId(value: string): LedgerEntryId {
  return brandString<LedgerEntryId['__brand']>(value, 'entryId')
}

export function toReservationId(value: string): ReservationId {
  return brandString<ReservationId['__brand']>(value, 'reservationId')
}

export function toAuditEventId(value: string): AuditEventId {
  return brandString<AuditEventId['__brand']>(value, 'auditEventId')
}

export function newAccountId(): AccountId {
  return toAccountId(`acct_${randomUUID()}`)
}

export function newLedgerTransactionId(): LedgerTransactionId {
  return toLedgerTransactionId(`txn_${randomUUID()}`)
}

export function newLedgerEntryId(): LedgerEntryId {
  return toLedgerEntryId(`entry_${randomUUID()}`)
}

export function newReservationId(): ReservationId {
  return toReservationId(`reservation_${randomUUID()}`)
}

export function newAuditEventId(): AuditEventId {
  return toAuditEventId(`audit_${randomUUID()}`)
}