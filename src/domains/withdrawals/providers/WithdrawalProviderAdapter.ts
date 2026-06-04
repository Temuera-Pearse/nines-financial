import type { JsonObject } from '../../../shared/types/Json.js'

import type { WithdrawalRequest } from '../entities/WithdrawalRequest.js'
import type { WithdrawalProviderStatus } from '../entities/WithdrawalProviderSubmission.js'

export interface WithdrawalDestinationValidationInput {
  provider: string
  currency: string
  destinationKind: string
  destinationReference: string
}

export interface WithdrawalDestinationValidation {
  valid: boolean
  reasonCode: string | null
  reasonText: string | null
}

export interface SubmitWithdrawalProviderInput {
  withdrawalRequest: WithdrawalRequest
  providerIdempotencyKey: string
}

export interface WithdrawalProviderSubmissionResult {
  provider: string
  externalWithdrawalId: string | null
  externalTransactionId: string | null
  providerStatus: WithdrawalProviderStatus
  submittedAt: Date
  rawPayload: JsonObject
  providerIdempotencyKey: string
}

export interface WithdrawalProviderStatusInput {
  withdrawalRequest: WithdrawalRequest
  provider: string
  externalWithdrawalId: string | null
  externalTransactionId: string | null
  currentProviderStatus: WithdrawalProviderStatus
  simulatedProviderStatus?: WithdrawalProviderStatus | undefined
}

export interface WithdrawalProviderStatusResult {
  providerStatus: WithdrawalProviderStatus
  syncedAt: Date
  rawPayload: JsonObject
}

export interface WithdrawalProviderWebhookInput {
  provider: string
  body: unknown
  rawBody?: Buffer | string | undefined
  headers: Record<string, string | undefined>
}

export interface NormalizedWithdrawalProviderEvent {
  provider: string
  externalWithdrawalId: string
  externalTransactionId: string | null
  withdrawalRequestId: string | null
  providerStatus: WithdrawalProviderStatus
  amountMinorUnits: string | null
  currency: string | null
  rawPayload: JsonObject
}

export interface WithdrawalProviderAdapter {
  submitWithdrawal(
    input: SubmitWithdrawalProviderInput,
  ): Promise<WithdrawalProviderSubmissionResult>
  getWithdrawalStatus(
    input: WithdrawalProviderStatusInput,
  ): Promise<WithdrawalProviderStatusResult>
  normalizeWithdrawalStatus(payload: unknown): WithdrawalProviderStatus
  verifyWebhookSignature(input: WithdrawalProviderWebhookInput): void
  parseWithdrawalWebhook(
    input: WithdrawalProviderWebhookInput,
  ): NormalizedWithdrawalProviderEvent
  validateDestination(
    input: WithdrawalDestinationValidationInput,
  ): WithdrawalDestinationValidation
}
