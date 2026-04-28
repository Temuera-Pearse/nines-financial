import { Money } from '../../../shared/money/Money.js'
import { AppError } from '../../../shared/types/AppError.js'
import type { IdempotencyKey } from '../../../shared/idempotency/types.js'
import type { CorrelationMetadata } from '../../../shared/observability/correlation.js'
import { UnbalancedTransactionError } from '../errors/AccountingErrors.js'
import type { LedgerTransactionId } from '../types/identifiers.js'
import type {
  LedgerTransactionStatus,
  ReferenceType,
  TransactionType,
} from '../types/accountingTypes.js'
import type { LedgerEntry } from './LedgerEntry.js'

export interface LedgerTransactionProps extends CorrelationMetadata {
  transactionId: LedgerTransactionId
  transactionType: TransactionType
  referenceType: ReferenceType
  referenceId: string
  status: LedgerTransactionStatus
  relatedTransactionId?: LedgerTransactionId
  idempotencyKey?: IdempotencyKey
  createdAt: Date
  entries: readonly LedgerEntry[]
}

export class LedgerTransaction {
  readonly transactionId: LedgerTransactionId

  readonly transactionType: TransactionType

  readonly referenceType: ReferenceType

  readonly referenceId: string

  readonly status: LedgerTransactionStatus

  readonly relatedTransactionId: LedgerTransactionId | undefined

  readonly correlationId: string

  readonly causationId: string

  readonly idempotencyKey: IdempotencyKey | undefined

  readonly createdAt: Date

  readonly entries: readonly LedgerEntry[]

  constructor(props: LedgerTransactionProps) {
    this.transactionId = props.transactionId
    this.transactionType = props.transactionType
    this.referenceType = props.referenceType
    this.referenceId = props.referenceId.trim()
    this.status = props.status
    this.relatedTransactionId = props.relatedTransactionId
    this.correlationId = props.correlationId.trim()
    this.causationId = props.causationId.trim()
    this.idempotencyKey = props.idempotencyKey
    this.createdAt = new Date(props.createdAt)
    this.entries = [...props.entries]

    if (!this.referenceId) {
      throw new AppError({
        category: 'validation_error',
        code: 'MISSING_REFERENCE_ID',
        message: 'Ledger transaction referenceId is required',
      })
    }

    if (this.relatedTransactionId && this.relatedTransactionId === this.transactionId) {
      throw new AppError({
        category: 'validation_error',
        code: 'RELATED_TRANSACTION_SELF_REFERENCE',
        message: 'Ledger transaction cannot reference itself as a related transaction',
        details: { transactionId: this.transactionId },
      })
    }

    if (this.entries.length === 0) {
      throw new AppError({
        category: 'validation_error',
        code: 'EMPTY_LEDGER_TRANSACTION',
        message: 'Ledger transaction must include at least one debit and one credit entry',
        details: { transactionId: this.transactionId },
      })
    }

    for (const entry of this.entries) {
      if (entry.transactionId !== this.transactionId) {
        throw new AppError({
          category: 'invariant_violation',
          code: 'LEDGER_ENTRY_TRANSACTION_MISMATCH',
          message: 'Ledger entries must reference the containing transaction id',
          details: {
            transactionId: this.transactionId,
            entryId: entry.entryId,
            entryTransactionId: entry.transactionId,
          },
        })
      }
    }

    this.assertSingleCurrency()
    this.assertBalanced()
  }

  currency(): string {
    return this.entries[0]?.amount.currency ?? 'UNKNOWN'
  }

  debitTotal(): Money {
    return this.aggregateByDirection('debit')
  }

  creditTotal(): Money {
    return this.aggregateByDirection('credit')
  }

  private aggregateByDirection(direction: 'debit' | 'credit'): Money {
    const firstEntry = this.entries[0]

    if (!firstEntry) {
      throw new AppError({
        category: 'invariant_violation',
        code: 'EMPTY_LEDGER_TRANSACTION',
        message: 'Cannot aggregate an empty ledger transaction',
        details: { transactionId: this.transactionId },
      })
    }

    return this.entries
      .filter((entry) => entry.direction === direction)
      .reduce((runningTotal, entry) => runningTotal.add(entry.amount), Money.zero(firstEntry.amount.currency))
  }

  private assertSingleCurrency() {
    const currencies = new Set(this.entries.map((entry) => entry.amount.currency))

    if (currencies.size > 1) {
      throw new AppError({
        category: 'invariant_violation',
        code: 'MIXED_CURRENCY_TRANSACTION',
        message: 'Phase 1 ledger transactions must be single-currency',
        details: {
          transactionId: this.transactionId,
          currencies: [...currencies],
        },
      })
    }
  }

  private assertBalanced() {
    const debitTotal = this.debitTotal()
    const creditTotal = this.creditTotal()

    if (!debitTotal.equals(creditTotal)) {
      throw new UnbalancedTransactionError(
        this.transactionType,
        debitTotal.amountMinor.toString(),
        creditTotal.amountMinor.toString(),
      )
    }
  }
}