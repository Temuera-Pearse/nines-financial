import { z } from 'zod'

import type {
  ApplyHouseTakeCommandContract,
  ApplyHouseTakeResultContract,
  ReleaseReservationCommandContract,
  ReleaseReservationResultContract,
  ReserveStakeCommandContract,
  ReserveStakeResultContract,
  SettleBetCommandContract,
  SettleBetResultContract,
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

const acceptedSettlementBetSchema = z.object({
  betId: z.string().trim().min(1),
  userId: z.string().trim().min(1),
  selectionId: z.string().trim().min(1),
  stakeMinor: minorUnitStringSchema,
})

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
  acceptedBets: z
    .array(acceptedSettlementBetSchema)
    .min(1)
    .superRefine((bets, context) => {
      const seenBetIds = new Set<string>()

      for (const [index, bet] of bets.entries()) {
        if (seenBetIds.has(bet.betId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'accepted bets must have unique betId values',
            path: [index, 'betId'],
          })
        }

        seenBetIds.add(bet.betId)
      }
    }),
  totalPoolMinor: minorUnitStringSchema,
  houseTakeBps: z.number().int().min(0).max(10_000),
  currency: canonicalCurrencySchema,
})

export const applyHouseTakeCommandSchema = commandMetadataSchema.extend({
  raceId: z.string().trim().min(1),
  amountMinor: minorUnitStringSchema,
  currency: canonicalCurrencySchema,
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
