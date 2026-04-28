import type { JsonObject } from '../../../shared/types/Json.js'
import type { TransactionType } from '../types/accountingTypes.js'

export const accountingEventTypes = [
  'account_created',
  'account_frozen',
  'account_unfrozen',
  'ledger_transaction_posted',
] as const

export type AccountingEventType = (typeof accountingEventTypes)[number]

export interface AccountingEvent {
  eventId: string
  eventType: AccountingEventType
  aggregateType: 'account' | 'ledger_transaction'
  aggregateId: string
  correlationId: string
  causationId: string
  transactionType?: TransactionType
  occurredAt: Date
  payload: JsonObject
}