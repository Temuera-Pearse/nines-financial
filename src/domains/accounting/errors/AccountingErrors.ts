import { AppError } from '../../../shared/types/AppError.js'
import type { AccountId, LedgerTransactionId, ReservationId } from '../types/identifiers.js'
import type { AccountStatus, TransactionType } from '../types/accountingTypes.js'

export class AccountNotFoundError extends AppError {
  constructor(accountId: AccountId) {
    super({
      category: 'not_found',
      code: 'ACCOUNT_NOT_FOUND',
      message: `Account ${accountId} was not found`,
      details: { accountId },
    })
  }
}

export class TransactionNotFoundError extends AppError {
  constructor(transactionId: LedgerTransactionId) {
    super({
      category: 'not_found',
      code: 'TRANSACTION_NOT_FOUND',
      message: `Ledger transaction ${transactionId} was not found`,
      details: { transactionId },
    })
  }
}

export class ReservationNotFoundError extends AppError {
  constructor(reservationId: ReservationId) {
    super({
      category: 'not_found',
      code: 'RESERVATION_NOT_FOUND',
      message: `Reservation ${reservationId} was not found`,
      details: { reservationId },
    })
  }
}

export class AccountStatusError extends AppError {
  constructor(accountId: AccountId, status: AccountStatus) {
    super({
      category: 'forbidden',
      code: 'ACCOUNT_NOT_POSTABLE',
      message: `Account ${accountId} cannot accept postings while in status ${status}`,
      details: { accountId, status },
    })
  }
}

export class InsufficientFundsError extends AppError {
  constructor(accountId: AccountId, currentBalanceMinor: string, requestedDebitMinor: string) {
    super({
      category: 'conflict',
      code: 'INSUFFICIENT_FUNDS',
      message: `Account ${accountId} does not have sufficient funds for the requested debit`,
      details: {
        accountId,
        currentBalanceMinor,
        requestedDebitMinor,
      },
      retryable: false,
    })
  }
}

export class UnbalancedTransactionError extends AppError {
  constructor(transactionType: TransactionType, debitTotalMinor: string, creditTotalMinor: string) {
    super({
      category: 'invariant_violation',
      code: 'UNBALANCED_TRANSACTION',
      message: `Transaction ${transactionType} is not balanced`,
      details: {
        transactionType,
        debitTotalMinor,
        creditTotalMinor,
      },
    })
  }
}

export class DuplicateReferenceConflictError extends AppError {
  constructor(referenceType: string, referenceId: string) {
    super({
      category: 'conflict',
      code: 'DUPLICATE_REFERENCE',
      message: `${referenceType} reference ${referenceId} has already been posted`,
      details: { referenceType, referenceId },
    })
  }
}

export class ReservationStateError extends AppError {
  constructor(reservationId: ReservationId, expectedState: string, actualState: string) {
    super({
      category: 'conflict',
      code: 'INVALID_RESERVATION_STATE',
      message: `Reservation ${reservationId} is in state ${actualState} but expected ${expectedState}`,
      details: { reservationId, expectedState, actualState },
    })
  }
}