import type {
  DatabaseTransaction,
  Queryable,
} from '../../../shared/db/Database.js'
import type { WithdrawalProviderEvent } from '../entities/WithdrawalProviderEvent.js'
import type { WithdrawalProviderSubmission } from '../entities/WithdrawalProviderSubmission.js'
import type { WithdrawalRequest } from '../entities/WithdrawalRequest.js'
import type {
  WithdrawalProviderWebhookReceiptId,
  WithdrawalRequestId,
} from '../types/withdrawalIdentifiers.js'

export interface WithdrawalReviewItem {
  withdrawalRequestId: string
  playerId: string
  playerAccountId: string
  currency: string
  amountMinorUnits: string
  destinationKind: string
  destinationReference: string
  provider: string
  status: string
  reasonCode: string | null
  reasonText: string | null
  updatedAt: Date
}

export interface WithdrawalReconciliationIssue {
  code: string
  severity: 'info' | 'warning' | 'incident'
  entityType:
    | 'withdrawal_request'
    | 'withdrawal_provider_event'
    | 'withdrawal_provider_webhook_receipt'
  entityId: string
  details: Record<string, unknown>
}

export interface WithdrawalProviderWebhookReceipt {
  withdrawalProviderWebhookReceiptId: WithdrawalProviderWebhookReceiptId
  provider: string
  nonce: string
  providerTimestamp: Date
  receivedAt: Date
  requestHash: string
  signatureVersion: string
  externalWithdrawalId: string | null
  externalTransactionId: string | null
  withdrawalRequestId: WithdrawalRequestId | null
  status: 'accepted' | 'rejected'
  rejectionReason: string | null
}

export interface WithdrawalRepository {
  create(
    withdrawalRequest: WithdrawalRequest,
    transaction: DatabaseTransaction,
  ): Promise<void>
  update(
    withdrawalRequest: WithdrawalRequest,
    transaction: DatabaseTransaction,
  ): Promise<void>
  getById(
    withdrawalRequestId: WithdrawalRequestId,
    queryable?: Queryable,
  ): Promise<WithdrawalRequest | null>
  getByIdempotencyKey(
    idempotencyKey: string,
    queryable?: Queryable,
  ): Promise<WithdrawalRequest | null>
  getByIdForUpdate(
    withdrawalRequestId: WithdrawalRequestId,
    transaction: DatabaseTransaction,
  ): Promise<WithdrawalRequest | null>
  createProviderSubmission(
    submission: WithdrawalProviderSubmission,
    transaction: DatabaseTransaction,
  ): Promise<void>
  updateProviderSubmission(
    submission: WithdrawalProviderSubmission,
    transaction: DatabaseTransaction,
  ): Promise<void>
  getProviderSubmissionByWithdrawalRequestId(
    withdrawalRequestId: WithdrawalRequestId,
    queryable?: Queryable,
  ): Promise<WithdrawalProviderSubmission | null>
  getProviderSubmissionByProviderIdempotencyKey(
    providerIdempotencyKey: string,
    queryable?: Queryable,
  ): Promise<WithdrawalProviderSubmission | null>
  getProviderSubmissionByExternalWithdrawalId(
    provider: string,
    externalWithdrawalId: string,
    queryable?: Queryable,
  ): Promise<WithdrawalProviderSubmission | null>
  getProviderSubmissionByExternalTransactionId(
    provider: string,
    externalTransactionId: string,
    queryable?: Queryable,
  ): Promise<WithdrawalProviderSubmission | null>
  createWebhookReceipt(
    receipt: WithdrawalProviderWebhookReceipt,
    transaction: DatabaseTransaction,
  ): Promise<void>
  recordWebhookReplayRejection(
    receipt: WithdrawalProviderWebhookReceipt,
    transaction: DatabaseTransaction,
  ): Promise<void>
  createProviderEvent(
    event: WithdrawalProviderEvent,
    transaction: DatabaseTransaction,
  ): Promise<void>
  listReviewItems(queryable?: Queryable): Promise<WithdrawalReviewItem[]>
  detectReconciliationIssues(
    asOf: Date,
    queryable?: Queryable,
  ): Promise<WithdrawalReconciliationIssue[]>
}
