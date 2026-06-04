import { z } from 'zod'

import { discrepancyStatuses } from '../entities/Discrepancy.js'

export const operatorCommandSchema = z.object({
  operatorId: z.string().trim().min(1),
  operatorRole: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(1),
  correlationId: z.string().trim().min(1),
  causationId: z.string().trim().min(1),
})

export const discrepancyWorkflowCommandSchema = operatorCommandSchema.extend({
  discrepancyId: z.string().trim().min(1),
  reason: z.string().trim().min(1).optional(),
  assignedToOperatorId: z.string().trim().min(1).optional(),
})

export const riskFreezeCommandSchema = operatorCommandSchema.extend({
  playerId: z.string().trim().min(1),
  currency: z.literal('USDC').default('USDC'),
  scope: z.enum(['withdrawals', 'all_financial']).default('withdrawals'),
  reason: z.string().trim().min(1),
  ticketId: z.string().trim().min(1).optional(),
})

export const riskUnfreezeCommandSchema = operatorCommandSchema.extend({
  playerId: z.string().trim().min(1),
  currency: z.literal('USDC').default('USDC'),
  reason: z.string().trim().min(1),
  ticketId: z.string().trim().min(1).optional(),
})

export const listDiscrepanciesQuerySchema = z.object({
  status: z.enum(discrepancyStatuses).optional(),
  severity: z.enum(['info', 'warning', 'incident']).optional(),
  category: z.string().trim().min(1).optional(),
})

export type OperatorCommandDto = z.infer<typeof operatorCommandSchema>
export type DiscrepancyWorkflowCommandDto = z.infer<
  typeof discrepancyWorkflowCommandSchema
>
export type RiskFreezeCommandDto = z.infer<typeof riskFreezeCommandSchema>
export type RiskUnfreezeCommandDto = z.infer<typeof riskUnfreezeCommandSchema>
export type ListDiscrepanciesQueryDto = z.infer<
  typeof listDiscrepanciesQuerySchema
>

export interface DiscrepancyDto {
  discrepancyId: string
  dedupeKey: string
  category: string
  severity: string
  status: string
  entityType: string
  entityId: string
  relatedIds: Record<string, unknown>
  summary: string
  detailsPayload: Record<string, unknown>
  firstDetectedAt: string
  lastDetectedAt: string
  detectedAt: string
  updatedAt: string
  assignedToOperatorId: string | null
  resolutionReason: string | null
  resolvedAt: string | null
}

export interface ReconciliationMaterializationDto {
  scannedAt: string
  scannedIssueCount: number
  openedCount: number
  reopenedCount: number
  refreshedCount: number
  bySeverity: Record<string, number>
  byStatus: Record<string, number>
  discrepancies: DiscrepancyDto[]
}
