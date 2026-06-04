import { z } from 'zod'

import type {
  ApplyHouseTakeCommandContract,
  ApplyHouseTakeResultContract,
  ApplyCarryoversToRaceCommandContract,
  ApplyCarryoversToRaceResultContract,
  MarkSettlementManualReviewCommandContract,
  ReleaseReservationCommandContract,
  ReleaseReservationResultContract,
  ResolveSettlementManualReviewCommandContract,
  ReserveStakeCommandContract,
  ReserveStakeResultContract,
  SettlementRemediationResultContract,
  SettleBetCommandContract,
  SettleBetResultContract,
  VoidPoolFromManualReviewCommandContract,
} from '../../../contracts/financialAuthorityDtos.js'

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

const canonicalCurrencySchema = z.literal('USDC')

export const reserveStakeCommandSchema = commandMetadataSchema.extend({
  userId: z.string().trim().min(1),
  betId: z.string().trim().min(1),
  raceId: z.string().trim().min(1),
  selectionId: z.string().trim().min(1),
  stakeMinor: minorUnitStringSchema,
  currency: canonicalCurrencySchema,
})

export const releaseReservationCommandSchema = commandMetadataSchema.extend({
  reservationId: z.string().trim().min(1),
  reasonCode: z.string().trim().min(1),
})

export const settleBetCommandSchema = commandMetadataSchema.extend({
  raceId: z.string().trim().min(1),
  winningSelectionId: z.string().trim().min(1),
  houseTakeBps: z.number().int().min(0).max(10_000),
  currency: canonicalCurrencySchema,
})

export const applyHouseTakeCommandSchema = commandMetadataSchema.extend({
  raceId: z.string().trim().min(1),
  amountMinor: minorUnitStringSchema,
  currency: canonicalCurrencySchema,
})

export const applyCarryoversToRaceCommandSchema = commandMetadataSchema.extend({
  targetRaceId: z.string().trim().min(1),
  currency: canonicalCurrencySchema,
})

const manualReviewBaseCommandSchema = commandMetadataSchema.extend({
  raceId: z.string().trim().min(1),
  currency: canonicalCurrencySchema,
  operatorId: z.string().trim().min(1),
  reasonText: z.string().trim().min(1).nullable().optional(),
})

export const markSettlementManualReviewCommandSchema =
  manualReviewBaseCommandSchema.extend({
    reasonCode: z.string().trim().min(1),
  })

export const resolveSettlementManualReviewCommandSchema =
  manualReviewBaseCommandSchema.extend({
    resolutionCode: z.string().trim().min(1),
  })

export const voidPoolFromManualReviewCommandSchema =
  manualReviewBaseCommandSchema.extend({
    reasonCode: z.string().trim().min(1),
  })

export type ReserveStakeCommandDto = z.infer<
  typeof reserveStakeCommandSchema
> &
  ReserveStakeCommandContract
export type ReserveStakeResultDto = ReserveStakeResultContract

export type ReleaseReservationCommandDto = z.infer<
  typeof releaseReservationCommandSchema
> &
  ReleaseReservationCommandContract
export type ReleaseReservationResultDto = ReleaseReservationResultContract

export type SettleBetCommandDto = z.infer<typeof settleBetCommandSchema> &
  SettleBetCommandContract
export type SettleBetResultDto = SettleBetResultContract

export type ApplyHouseTakeCommandDto = z.infer<
  typeof applyHouseTakeCommandSchema
> &
  ApplyHouseTakeCommandContract
export type ApplyHouseTakeResultDto = ApplyHouseTakeResultContract

export type ApplyCarryoversToRaceCommandDto = z.infer<
  typeof applyCarryoversToRaceCommandSchema
> &
  ApplyCarryoversToRaceCommandContract
export type ApplyCarryoversToRaceResultDto =
  ApplyCarryoversToRaceResultContract

export type MarkSettlementManualReviewCommandDto = z.infer<
  typeof markSettlementManualReviewCommandSchema
> &
  MarkSettlementManualReviewCommandContract

export type ResolveSettlementManualReviewCommandDto = z.infer<
  typeof resolveSettlementManualReviewCommandSchema
> &
  ResolveSettlementManualReviewCommandContract

export type VoidPoolFromManualReviewCommandDto = z.infer<
  typeof voidPoolFromManualReviewCommandSchema
> &
  VoidPoolFromManualReviewCommandContract

export type SettlementRemediationResultDto =
  SettlementRemediationResultContract
