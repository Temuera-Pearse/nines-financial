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

const currencySchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{3,12}$/)

const nullableIsoDateSchema = z
  .string()
  .trim()
  .datetime()
  .nullable()
  .optional()

export const createDepositIntentCommandSchema = commandMetadataSchema.extend({
  userId: z.string().trim().min(1),
  currency: z.literal('USDC').default('USDC'),
  expectedAmountMinor: minorUnitStringSchema.nullable().optional(),
  provider: z.string().trim().min(1).default('simulated'),
  providerKind: z.string().trim().min(1).default('simulated'),
  expiresAt: nullableIsoDateSchema,
})

export const ingestProviderDepositEventCommandSchema =
  commandMetadataSchema.extend({
    providerEventId: z.string().trim().min(1),
    provider: z.string().trim().min(1).default('simulated'),
    externalTransactionId: z.string().trim().min(1),
    depositIntentId: z.string().trim().min(1).nullable().optional(),
    destinationReference: z.string().trim().min(1).nullable().optional(),
    amountMinor: minorUnitStringSchema,
    currency: currencySchema,
    confirmationCount: z.number().int().min(0).nullable().optional(),
    confirmed: z.boolean().optional(),
    rawPayload: z.record(z.unknown()).optional(),
    operatorId: z.string().trim().min(1).optional(),
    providerWebhookNonce: z.string().trim().min(1).optional(),
    providerWebhookTimestamp: z.string().trim().min(1).optional(),
    providerWebhookRequestHash: z.string().trim().min(1).optional(),
  })

export const getDepositIntentCommandSchema = z.object({
  depositIntentId: z.string().trim().min(1),
  userId: z.string().trim().min(1),
})

const operatorDepositReviewCommandSchema = commandMetadataSchema.extend({
  depositEventId: z.string().trim().min(1),
  operatorId: z.string().trim().min(1),
  operatorRole: z.string().trim().min(1),
  reasonCode: z.string().trim().min(1),
  reasonText: z.string().trim().min(1),
})

export const markDepositReviewedNoCreditCommandSchema =
  operatorDepositReviewCommandSchema

export const rejectProviderDepositEventCommandSchema =
  operatorDepositReviewCommandSchema

export const linkProviderDepositEventCommandSchema =
  commandMetadataSchema.extend({
    depositEventId: z.string().trim().min(1),
    depositIntentId: z.string().trim().min(1),
    operatorId: z.string().trim().min(1),
    operatorRole: z.string().trim().min(1),
    overrideReason: z.string().trim().min(1).nullable().optional(),
  })

export const approveProviderDepositCreditCommandSchema =
  commandMetadataSchema.extend({
    depositEventId: z.string().trim().min(1),
    operatorId: z.string().trim().min(1),
    operatorRole: z.string().trim().min(1),
    overrideReason: z.string().trim().min(1).nullable().optional(),
  })

export type CreateDepositIntentCommandDto = z.infer<
  typeof createDepositIntentCommandSchema
>

export type IngestProviderDepositEventCommandDto = z.infer<
  typeof ingestProviderDepositEventCommandSchema
>

export type GetDepositIntentCommandDto = z.infer<
  typeof getDepositIntentCommandSchema
>

export type MarkDepositReviewedNoCreditCommandDto = z.infer<
  typeof markDepositReviewedNoCreditCommandSchema
>

export type RejectProviderDepositEventCommandDto = z.infer<
  typeof rejectProviderDepositEventCommandSchema
>

export type LinkProviderDepositEventCommandDto = z.infer<
  typeof linkProviderDepositEventCommandSchema
>

export type ApproveProviderDepositCreditCommandDto = z.infer<
  typeof approveProviderDepositCreditCommandSchema
>

export interface DepositIntentDto {
  depositIntentId: string
  playerAccountId: string
  userId: string
  currency: string
  expectedAmountMinor: string | null
  provider: string
  providerKind: string
  destinationReference: string
  status: string
  createdAt: string
  updatedAt: string
  expiresAt: string | null
  creditedLedgerTransactionId: string | null
  reviewReasonCode: string | null
  reviewReasonText: string | null
}

export interface ProviderDepositEventDto {
  depositEventId: string
  providerEventId: string
  provider: string
  externalTransactionId: string
  depositIntentId: string | null
  destinationReference: string | null
  amountMinor: string
  currency: string
  confirmationCount: number | null
  confirmed: boolean
  status: string
  reviewReasonCode: string | null
  reviewReasonText: string | null
  receivedAt: string
  updatedAt: string
  ledgerTransactionId: string | null
}

export interface IngestProviderDepositEventResultDto {
  providerEvent: ProviderDepositEventDto
  depositIntent: DepositIntentDto | null
  credited: boolean
  reviewRequired: boolean
}

export interface ResolveProviderDepositEventResultDto {
  providerEvent: ProviderDepositEventDto
  depositIntent: DepositIntentDto | null
  credited: boolean
  reviewRequired: boolean
}

export interface DepositReviewItemDto {
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
  updatedAt: string
}

export interface DepositReconciliationIssueDto {
  code: string
  severity: 'info' | 'warning' | 'incident'
  entityType: 'deposit_intent' | 'provider_deposit_event'
  entityId: string
  details: Record<string, unknown>
}

export interface DepositReconciliationReportDto {
  checkedAt: string
  issueCount: number
  incidentCount: number
  warningCount: number
  infoCount: number
  issues: DepositReconciliationIssueDto[]
}
