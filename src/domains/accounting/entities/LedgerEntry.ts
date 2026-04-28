import { Money } from '../../../shared/money/Money.js'
import { AppError } from '../../../shared/types/AppError.js'
import type { LedgerEntryId, LedgerTransactionId, AccountId } from '../types/identifiers.js'
import type { LedgerDirection } from '../types/accountingTypes.js'

export interface LedgerEntryProps {
  entryId: LedgerEntryId
  transactionId: LedgerTransactionId
  accountId: AccountId
  direction: LedgerDirection
  amountMinor: bigint | string | number
  currency: string
  effectiveAt: Date
  createdAt: Date
}

export class LedgerEntry {
  readonly entryId: LedgerEntryId

  readonly transactionId: LedgerTransactionId

  readonly accountId: AccountId

  readonly direction: LedgerDirection

  readonly amount: Money

  readonly effectiveAt: Date

  readonly createdAt: Date

  constructor(props: LedgerEntryProps) {
    this.entryId = props.entryId
    this.transactionId = props.transactionId
    this.accountId = props.accountId
    this.direction = props.direction
    this.amount = Money.fromMinorUnits(props.amountMinor, props.currency)
    this.effectiveAt = new Date(props.effectiveAt)
    this.createdAt = new Date(props.createdAt)

    if (!this.amount.isPositive()) {
      throw new AppError({
        category: 'validation_error',
        code: 'INVALID_LEDGER_ENTRY_AMOUNT',
        message: 'Ledger entry amountMinor must be a positive integer in minor units',
        details: {
          entryId: this.entryId,
          amountMinor: this.amount.amountMinor.toString(),
        },
      })
    }
  }

  signedAmount(): Money {
    return this.direction === 'credit' ? this.amount : this.amount.negate()
  }
}