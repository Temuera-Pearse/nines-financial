import { z } from 'zod'

const minorUnitStringSchema = z
  .string()
  .trim()
  .regex(/^[0-9]+$/, 'amount must be a minor-unit integer string')
  .refine((value) => /^[0-9]+$/.test(value) && BigInt(value) > 0n, {
    message: 'amount must be greater than zero',
  })

const commandMetadataSchema = z.object({
  idempotencyKey: z.string().trim().min(1),
  correlationId: z.string().trim().min(1),
  causationId: z.string().trim().min(1),
})

const operatorCommandMetadataSchema = commandMetadataSchema.extend({
  operatorId: z.string().trim().min(1),
  operatorRole: z.string().trim().min(1),
})

export const createWithdrawalRequestCommandSchema =
  commandMetadataSchema.extend({
    playerId: z.string().trim().min(1),
    currency: z.literal('USDC').default('USDC'),
    amountMinorUnits: minorUnitStringSchema,
    destinationKind: z
      .enum(['simulated_external_account', 'manual_review'])
      .default('simulated_external_account'),
    destinationReference: z.string().trim().min(1),
    provider: z.literal('simulated').default('simulated'),
  })

export const getWithdrawalRequestCommandSchema = z.object({
  withdrawalRequestId: z.string().trim().min(1),
  playerId: z.string().trim().min(1),
})

export const approveWithdrawalRequestCommandSchema =
  operatorCommandMetadataSchema.extend({
    withdrawalRequestId: z.string().trim().min(1),
    reason: z.string().trim().min(1).nullable().optional(),
    overrideReason: z.string().trim().min(1).nullable().optional(),
  })

export const rejectWithdrawalRequestCommandSchema =
  operatorCommandMetadataSchema.extend({
    withdrawalRequestId: z.string().trim().min(1),
    reasonCode: z.string().trim().min(1),
    reason: z.string().trim().min(1),
  })

export const cancelWithdrawalRequestCommandSchema = commandMetadataSchema.extend({
  withdrawalRequestId: z.string().trim().min(1),
  playerId: z.string().trim().min(1),
  reason: z.string().trim().min(1).nullable().optional(),
})

export const submitWithdrawalRequestCommandSchema =
  operatorCommandMetadataSchema.extend({
    withdrawalRequestId: z.string().trim().min(1),
    submissionNote: z.string().trim().min(1),
  })

export const syncWithdrawalProviderStatusCommandSchema =
  operatorCommandMetadataSchema.extend({
    withdrawalRequestId: z.string().trim().min(1),
    reason: z.string().trim().min(1).nullable().optional(),
    simulatedProviderStatus: z
      .enum(['accepted', 'pending', 'confirmed', 'failed', 'rejected', 'unknown'])
      .optional(),
  })

export const finalizeWithdrawalRequestCommandSchema =
  operatorCommandMetadataSchema.extend({
    withdrawalRequestId: z.string().trim().min(1),
    reason: z.string().trim().min(1),
  })

export const releaseWithdrawalProviderFailureCommandSchema =
  operatorCommandMetadataSchema.extend({
    withdrawalRequestId: z.string().trim().min(1),
    reason: z.string().trim().min(1),
  })

export const markWithdrawalProviderFailureTerminalCommandSchema =
  operatorCommandMetadataSchema.extend({
    withdrawalRequestId: z.string().trim().min(1),
    reason: z.string().trim().min(1),
  })

export const markWithdrawalProviderUnknownReviewedCommandSchema =
  operatorCommandMetadataSchema.extend({
    withdrawalRequestId: z.string().trim().min(1),
    reason: z.string().trim().min(1),
  })

export const ingestWithdrawalProviderWebhookCommandSchema = z.object({
  provider: z.string().trim().min(1),
  body: z.unknown(),
  rawBody: z.union([z.instanceof(Buffer), z.string()]).optional(),
  headers: z.record(z.string(), z.string().optional()),
  providerWebhookNonce: z.string().trim().min(1),
  providerWebhookTimestamp: z.string().trim().min(1),
  providerWebhookRequestHash: z.string().trim().min(1),
  correlationId: z.string().trim().min(1),
  causationId: z.string().trim().min(1),
})

export type CreateWithdrawalRequestCommandDto = z.infer<
  typeof createWithdrawalRequestCommandSchema
>

export type GetWithdrawalRequestCommandDto = z.infer<
  typeof getWithdrawalRequestCommandSchema
>

export type ApproveWithdrawalRequestCommandDto = z.infer<
  typeof approveWithdrawalRequestCommandSchema
>

export type RejectWithdrawalRequestCommandDto = z.infer<
  typeof rejectWithdrawalRequestCommandSchema
>

export type CancelWithdrawalRequestCommandDto = z.infer<
  typeof cancelWithdrawalRequestCommandSchema
>

export type SubmitWithdrawalRequestCommandDto = z.infer<
  typeof submitWithdrawalRequestCommandSchema
>

export type SyncWithdrawalProviderStatusCommandDto = z.infer<
  typeof syncWithdrawalProviderStatusCommandSchema
>

export type FinalizeWithdrawalRequestCommandDto = z.infer<
  typeof finalizeWithdrawalRequestCommandSchema
>

export type ReleaseWithdrawalProviderFailureCommandDto = z.infer<
  typeof releaseWithdrawalProviderFailureCommandSchema
>

export type MarkWithdrawalProviderFailureTerminalCommandDto = z.infer<
  typeof markWithdrawalProviderFailureTerminalCommandSchema
>

export type MarkWithdrawalProviderUnknownReviewedCommandDto = z.infer<
  typeof markWithdrawalProviderUnknownReviewedCommandSchema
>

export type IngestWithdrawalProviderWebhookCommandDto = z.infer<
  typeof ingestWithdrawalProviderWebhookCommandSchema
>

export interface WithdrawalProviderWebhookIngestionDto {
  webhookReceiptId: string
  providerEventId: string
  provider: string
  externalWithdrawalId: string
  externalTransactionId: string | null
  withdrawalRequestId: string | null
  providerStatus: string
  eventStatus: string
  withdrawalStatus: string | null
}

export interface WithdrawalProviderSubmissionDto {
  withdrawalRequestId: string
  provider: string
  externalWithdrawalId: string | null
  externalTransactionId: string | null
  providerStatus: string
  submissionAttemptCount: number
  lastSubmittedAt: string
  lastStatusSyncedAt: string | null
  providerIdempotencyKey: string
  createdAt: string
  updatedAt: string
}

export interface WithdrawalRequestDto {
  withdrawalRequestId: string
  playerId: string
  playerAccountId: string
  currency: string
  amountMinorUnits: string
  destinationKind: string
  destinationReference: string
  provider: string
  status: string
  reservationLedgerTransactionId: string | null
  releaseLedgerTransactionId: string | null
  finalizationLedgerTransactionId: string | null
  reviewReasonCode: string | null
  reviewReasonText: string | null
  failureReasonCode: string | null
  failureReasonText: string | null
  createdAt: string
  updatedAt: string
  requestedAt: string
  reservedAt: string | null
  approvedAt: string | null
  rejectedAt: string | null
  cancelledAt: string | null
  providerSubmission: WithdrawalProviderSubmissionDto | null
}

export interface WithdrawalReviewItemDto {
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
  updatedAt: string
}

export interface WithdrawalReconciliationIssueDto {
  code: string
  severity: 'info' | 'warning' | 'incident'
  entityType:
    | 'withdrawal_request'
    | 'withdrawal_provider_event'
    | 'withdrawal_provider_webhook_receipt'
  entityId: string
  details: Record<string, unknown>
}

export interface WithdrawalReconciliationReportDto {
  checkedAt: string
  issueCount: number
  incidentCount: number
  warningCount: number
  infoCount: number
  issues: WithdrawalReconciliationIssueDto[]
}
