import type { JsonObject } from '../../../shared/types/Json.js'

import type { WithdrawalProviderStatus } from './WithdrawalProviderSubmission.js'
import type {
  WithdrawalProviderEventId,
  WithdrawalProviderWebhookReceiptId,
  WithdrawalRequestId,
} from '../types/withdrawalIdentifiers.js'

export const withdrawalProviderEventStatuses = [
  'applied',
  'review_required',
  'rejected',
] as const

export type WithdrawalProviderEventStatus =
  (typeof withdrawalProviderEventStatuses)[number]

export interface WithdrawalProviderEvent {
  withdrawalProviderEventId: WithdrawalProviderEventId
  provider: string
  externalWithdrawalId: string
  externalTransactionId: string | null
  withdrawalRequestId: WithdrawalRequestId | null
  providerStatus: WithdrawalProviderStatus
  status: WithdrawalProviderEventStatus
  reviewReasonCode: string | null
  reviewReasonText: string | null
  rawPayload: JsonObject
  webhookReceiptId: WithdrawalProviderWebhookReceiptId | null
  receivedAt: Date
  updatedAt: Date
}
