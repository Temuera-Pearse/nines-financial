import type {
  DatabaseTransaction,
  Queryable,
} from '../../../shared/db/Database.js'
import type { DepositIntent } from '../entities/DepositIntent.js'
import type { ProviderDepositEvent } from '../entities/ProviderDepositEvent.js'
import type {
  DepositEventId,
  DepositIntentId,
} from '../types/depositIdentifiers.js'

export interface DepositReviewItem {
  itemType: 'deposit_intent' | 'provider_deposit_event'
  itemId: string
  status: string
  reasonCode: string | null
  reasonText: string | null
  provider: string
  externalTransactionId: string | null
  depositIntentId: string | null
  amountMinor: string | null
  currency: string
  updatedAt: Date
}

export interface DepositReconciliationIssue {
  code: string
  severity: 'info' | 'warning' | 'incident'
  entityType: 'deposit_intent' | 'provider_deposit_event'
  entityId: string
  details: Record<string, unknown>
}

export interface ProviderWebhookReceipt {
  provider: string
  nonce: string
  providerTimestamp: Date
  receivedAt: Date
  requestHash: string
}

export interface DepositRepository {
  createIntent(
    intent: DepositIntent,
    transaction: DatabaseTransaction,
  ): Promise<void>
  updateIntent(
    intent: DepositIntent,
    transaction: DatabaseTransaction,
  ): Promise<void>
  getIntentById(
    depositIntentId: DepositIntentId,
    queryable?: Queryable,
  ): Promise<DepositIntent | null>
  findIntentByDestination(
    provider: string,
    destinationReference: string,
    queryable?: Queryable,
  ): Promise<DepositIntent | null>
  createEvent(
    event: ProviderDepositEvent,
    transaction: DatabaseTransaction,
  ): Promise<void>
  updateEvent(
    event: ProviderDepositEvent,
    transaction: DatabaseTransaction,
  ): Promise<void>
  getEventById(
    depositEventId: DepositEventId,
    queryable?: Queryable,
  ): Promise<ProviderDepositEvent | null>
  getEventByProviderEventId(
    provider: string,
    providerEventId: string,
    queryable?: Queryable,
  ): Promise<ProviderDepositEvent | null>
  getCreditedEventByExternalTransactionId(
    provider: string,
    externalTransactionId: string,
    queryable?: Queryable,
  ): Promise<ProviderDepositEvent | null>
  createWebhookReceipt(
    receipt: ProviderWebhookReceipt,
    transaction: DatabaseTransaction,
  ): Promise<void>
  recordWebhookReplayRejection(
    receipt: ProviderWebhookReceipt & { rejectedReason: string },
    transaction: DatabaseTransaction,
  ): Promise<void>
  listReviewItems(queryable?: Queryable): Promise<DepositReviewItem[]>
  detectReconciliationIssues(
    asOf: Date,
    queryable?: Queryable,
  ): Promise<DepositReconciliationIssue[]>
}
