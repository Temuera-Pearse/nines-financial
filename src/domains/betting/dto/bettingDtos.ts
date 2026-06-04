import { z } from 'zod'

import type {
  FinancialBetContract,
  AppliedCarryoverContract,
  FreezePoolCommandContract,
  PlaceBetCommandContract,
  PlaceBetResultContract,
  PoolSelectionContract,
  PoolTotalContract,
  RacePoolContract,
  RacePoolWithSelectionsContract,
  SelectionTotalContract,
  SettlementManualReviewItemContract,
  SettlementReconciliationReportContract,
  SettlementReconciliationRunSummaryContract,
} from '../../../contracts/financialAuthorityDtos.js'

const commandMetadataSchema = z.object({
  idempotencyKey: z.string().trim().min(1),
  correlationId: z.string().trim().min(1),
  causationId: z.string().trim().min(1),
})

const canonicalCurrencySchema = z.literal('USDC')

const optionalIsoTimestampSchema = z
  .string()
  .trim()
  .datetime({ offset: true })
  .nullable()
  .optional()

export const minorUnitStringSchema = z
  .string()
  .trim()
  .regex(/^[0-9]+$/, 'amount must be a minor-unit integer string')
  .refine((value) => /^[0-9]+$/.test(value) && BigInt(value) > 0n, {
    message: 'amount must be greater than zero',
  })

export const createRacePoolCommandSchema = commandMetadataSchema.extend({
  raceId: z.string().trim().min(1),
  currency: canonicalCurrencySchema,
  bettingOpensAt: optionalIsoTimestampSchema,
  bettingClosesAt: optionalIsoTimestampSchema,
})

export const registerPoolSelectionCommandSchema = commandMetadataSchema.extend({
  raceId: z.string().trim().min(1),
  selectionId: z.string().trim().min(1),
  currency: canonicalCurrencySchema,
  status: z.enum(['active', 'inactive']).optional(),
  displayName: z.string().trim().min(1).nullable().optional(),
})

export const freezePoolCommandSchema = commandMetadataSchema.extend({
  raceId: z.string().trim().min(1),
  currency: canonicalCurrencySchema,
  reasonCode: z.string().trim().min(1),
})

export const placeBetCommandSchema = commandMetadataSchema.extend({
  betId: z.string().trim().min(1),
  userId: z.string().trim().min(1),
  raceId: z.string().trim().min(1),
  selectionId: z.string().trim().min(1),
  stakeMinor: minorUnitStringSchema,
  currency: canonicalCurrencySchema,
})

export type CreateRacePoolCommandDto = z.infer<
  typeof createRacePoolCommandSchema
>
export type RacePoolDto = RacePoolContract
export type RacePoolWithSelectionsDto = RacePoolWithSelectionsContract

export type RegisterPoolSelectionCommandDto = z.infer<
  typeof registerPoolSelectionCommandSchema
>
export type PoolSelectionDto = PoolSelectionContract

export type FreezePoolCommandDto = z.infer<typeof freezePoolCommandSchema> &
  FreezePoolCommandContract

export type PlaceBetCommandDto = z.infer<typeof placeBetCommandSchema> &
  PlaceBetCommandContract
export type FinancialBetDto = FinancialBetContract
export type SettlementCarryoverDto = AppliedCarryoverContract
export type PlaceBetResultDto = PlaceBetResultContract
export type PoolTotalDto = PoolTotalContract
export type SelectionTotalDto = SelectionTotalContract
export type SettlementManualReviewItemDto = SettlementManualReviewItemContract
export type SettlementReconciliationReportDto =
  SettlementReconciliationReportContract
export type SettlementReconciliationRunSummaryDto =
  SettlementReconciliationRunSummaryContract
