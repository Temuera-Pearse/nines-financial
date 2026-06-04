import type { JsonObject } from '../../../shared/types/Json.js'
import type { LedgerTransactionId } from '../../accounting/types/identifiers.js'
import type {
  DepositEventId,
  DepositIntentId,
} from '../types/depositIdentifiers.js'

export const providerDepositEventStatuses = [
  'received',
  'awaiting_confirmation',
  'credited',
  'duplicate',
  'review_required',
  'reviewed_no_credit',
  'rejected',
] as const

export type ProviderDepositEventStatus =
  (typeof providerDepositEventStatuses)[number]

export interface ProviderDepositEvent {
  depositEventId: DepositEventId
  providerEventId: string
  provider: string
  externalTransactionId: string
  depositIntentId: DepositIntentId | null
  destinationReference: string | null
  amountMinor: string
  currency: string
  confirmationCount: number | null
  confirmed: boolean
  status: ProviderDepositEventStatus
  reviewReasonCode: string | null
  reviewReasonText: string | null
  rawPayload: JsonObject
  receivedAt: Date
  updatedAt: Date
  ledgerTransactionId: LedgerTransactionId | null
  idempotencyKey: string
  correlationId: string
  causationId: string
}
