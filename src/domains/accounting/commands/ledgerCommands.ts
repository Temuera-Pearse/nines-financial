import type { IdempotencyKey } from '../../../shared/idempotency/types.js'
import type { CorrelationMetadata } from '../../../shared/observability/correlation.js'
import type { AccountId, LedgerTransactionId } from '../types/identifiers.js'
import type { LedgerDirection, ReferenceType, TransactionType } from '../types/accountingTypes.js'

export interface LedgerEntryInput {
  accountId: AccountId
  direction: LedgerDirection
  amountMinor: string
  currency: string
}

export interface PostTransactionCommand extends CorrelationMetadata {
  idempotencyKey: IdempotencyKey
  transactionType: TransactionType
  referenceType: ReferenceType
  referenceId: string
  relatedTransactionId?: LedgerTransactionId
  effectiveAt?: string
  adminOnlyOverride?: boolean
  entries: readonly LedgerEntryInput[]
}

export interface PostTransferCommand extends CorrelationMetadata {
  idempotencyKey: IdempotencyKey
  transactionType: TransactionType
  referenceType: ReferenceType
  referenceId: string
  relatedTransactionId?: LedgerTransactionId
  effectiveAt?: string
  adminOnlyOverride?: boolean
  debitAccountId: AccountId
  creditAccountId: AccountId
  amountMinor: string
  currency: string
}

export interface CreditAccountCommand extends Omit<PostTransferCommand, 'debitAccountId' | 'creditAccountId'> {
  creditAccountId: AccountId
  offsetDebitAccountId: AccountId
}

export interface DebitAccountCommand extends Omit<PostTransferCommand, 'debitAccountId' | 'creditAccountId'> {
  debitAccountId: AccountId
  offsetCreditAccountId: AccountId
}

export interface ReserveFundsCommand extends CorrelationMetadata {
  idempotencyKey: IdempotencyKey
  transactionType: 'bet_reserve' | 'withdrawal_reserve'
  referenceType: 'bet' | 'withdrawal'
  referenceId: string
  sourceAccountId: AccountId
  reserveAccountId: AccountId
  amountMinor: string
  currency: string
  effectiveAt?: string
}

export interface ReleaseReservedFundsCommand extends CorrelationMetadata {
  idempotencyKey: IdempotencyKey
  reservationId: string
  effectiveAt?: string
}

export interface CaptureReservedFundsCommand extends CorrelationMetadata {
  idempotencyKey: IdempotencyKey
  reservationId: string
  destinationAccountId: AccountId
  effectiveAt?: string
}