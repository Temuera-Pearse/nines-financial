import type { PlayerAccountId, UserId } from '../../account/types/identifiers.js'
import type { LedgerTransactionId } from '../../accounting/types/identifiers.js'
import type { DepositIntentId } from '../types/depositIdentifiers.js'

export const depositIntentStatuses = [
  'created',
  'awaiting_external_payment',
  'detected',
  'confirmed',
  'credited',
  'expired',
  'cancelled',
  'failed',
  'review_required',
] as const

export type DepositIntentStatus = (typeof depositIntentStatuses)[number]

export interface DepositIntent {
  depositIntentId: DepositIntentId
  playerAccountId: PlayerAccountId
  userId: UserId
  currency: string
  expectedAmountMinor: string | null
  provider: string
  providerKind: string
  destinationReference: string
  status: DepositIntentStatus
  createdAt: Date
  updatedAt: Date
  expiresAt: Date | null
  idempotencyKey: string
  correlationId: string
  causationId: string
  creditedLedgerTransactionId: LedgerTransactionId | null
  reviewReasonCode: string | null
  reviewReasonText: string | null
}
