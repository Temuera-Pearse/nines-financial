import type { JsonObject } from '../../../shared/types/Json.js'

import type { WithdrawalRequestId } from '../types/withdrawalIdentifiers.js'

export const withdrawalProviderStatuses = [
  'accepted',
  'pending',
  'confirmed',
  'failed',
  'rejected',
  'unknown',
] as const

export type WithdrawalProviderStatus =
  (typeof withdrawalProviderStatuses)[number]

export interface WithdrawalProviderSubmission {
  withdrawalRequestId: WithdrawalRequestId
  provider: string
  externalWithdrawalId: string | null
  externalTransactionId: string | null
  providerStatus: WithdrawalProviderStatus
  submissionAttemptCount: number
  lastSubmittedAt: Date
  lastStatusSyncedAt: Date | null
  rawProviderPayload: JsonObject
  providerIdempotencyKey: string
  createdAt: Date
  updatedAt: Date
}
