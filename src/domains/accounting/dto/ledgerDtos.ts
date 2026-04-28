import { z } from 'zod'

import type { LedgerEntry } from '../entities/LedgerEntry.js'
import type { LedgerTransaction } from '../entities/LedgerTransaction.js'
import { ledgerDirections, referenceTypes, transactionTypes } from '../types/accountingTypes.js'

const accountIdSchema = z.string().trim().min(1)
const currencyCodeSchema = z.string().trim().regex(/^[A-Z]{3,12}$/)
const positiveMinorUnitSchema = z.string().regex(/^[1-9]\d*$/)

export const ledgerEntryInputSchema = z.object({
  accountId: accountIdSchema,
  direction: z.enum(ledgerDirections),
  amountMinor: positiveMinorUnitSchema,
  currency: currencyCodeSchema,
})

export const postLedgerTransactionRequestSchema = z.object({
  transactionType: z.enum(transactionTypes),
  referenceType: z.enum(referenceTypes),
  referenceId: z.string().trim().min(1),
  relatedTransactionId: z.string().trim().min(1).optional(),
  effectiveAt: z.string().datetime().optional(),
  adminOnlyOverride: z.boolean().optional(),
  entries: z.array(ledgerEntryInputSchema).min(2),
})

export const reserveFundsRequestSchema = z.object({
  transactionType: z.enum(['bet_reserve', 'withdrawal_reserve']),
  referenceType: z.enum(['bet', 'withdrawal']),
  referenceId: z.string().trim().min(1),
  sourceAccountId: accountIdSchema,
  reserveAccountId: accountIdSchema,
  amountMinor: positiveMinorUnitSchema,
  currency: currencyCodeSchema,
  effectiveAt: z.string().datetime().optional(),
})

export const releaseReservationRequestSchema = z.object({
  effectiveAt: z.string().datetime().optional(),
})

export const captureReservationRequestSchema = z.object({
  destinationAccountId: accountIdSchema,
  effectiveAt: z.string().datetime().optional(),
})

function toLedgerEntryResponseDto(entry: LedgerEntry) {
  return {
    entryId: entry.entryId,
    transactionId: entry.transactionId,
    accountId: entry.accountId,
    direction: entry.direction,
    amountMinor: entry.amount.amountMinor.toString(),
    currency: entry.amount.currency,
    effectiveAt: entry.effectiveAt.toISOString(),
    createdAt: entry.createdAt.toISOString(),
  }
}

export function toLedgerTransactionResponseDto(transaction: LedgerTransaction) {
  return {
    transactionId: transaction.transactionId,
    transactionType: transaction.transactionType,
    referenceType: transaction.referenceType,
    referenceId: transaction.referenceId,
    relatedTransactionId: transaction.relatedTransactionId ?? null,
    status: transaction.status,
    correlationId: transaction.correlationId,
    causationId: transaction.causationId,
    idempotencyKey: transaction.idempotencyKey ?? null,
    createdAt: transaction.createdAt.toISOString(),
    entries: transaction.entries.map((entry) => toLedgerEntryResponseDto(entry)),
  }
}