import type { LedgerTransactionId } from '../../accounting/types/identifiers.js'
import type { PlayerAccountId, UserId } from '../../account/types/identifiers.js'
import type { WithdrawalRequestId } from '../types/withdrawalIdentifiers.js'

export const withdrawalRequestStatuses = [
  'requested',
  'reservation_pending',
  'reserved',
  'review_required',
  'approved',
  'rejected',
  'cancelled',
  'submission_pending',
  'submitting',
  'submitted',
  'provider_pending',
  'provider_confirmed',
  'provider_failed',
  'provider_rejected',
  'provider_unknown',
  'provider_failure_released',
  'provider_failed_terminal',
  'provider_rejected_terminal',
  'provider_unknown_reviewed',
  'failed',
  'completed',
] as const

export type WithdrawalRequestStatus =
  (typeof withdrawalRequestStatuses)[number]

export interface WithdrawalRequest {
  withdrawalRequestId: WithdrawalRequestId
  playerId: UserId
  playerAccountId: PlayerAccountId
  currency: string
  amountMinorUnits: string
  destinationKind: string
  destinationReference: string
  provider: string
  status: WithdrawalRequestStatus
  idempotencyKey: string
  correlationId: string
  causationId: string
  reservationLedgerTransactionId: LedgerTransactionId | null
  releaseLedgerTransactionId: LedgerTransactionId | null
  finalizationLedgerTransactionId: LedgerTransactionId | null
  reviewReasonCode: string | null
  reviewReasonText: string | null
  failureReasonCode: string | null
  failureReasonText: string | null
  createdAt: Date
  updatedAt: Date
  requestedAt: Date
  reservedAt: Date | null
  approvedAt: Date | null
  rejectedAt: Date | null
  cancelledAt: Date | null
}
