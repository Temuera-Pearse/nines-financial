import { Money } from '../../../shared/money/Money.js'
import { AppError } from '../../../shared/types/AppError.js'
import type { NormalBalance } from '../types/accountingTypes.js'
import type { AccountId } from '../types/identifiers.js'
import type { LedgerEntry } from './LedgerEntry.js'

export interface AccountBalanceProps {
  accountId: AccountId
  currency: string
  balanceMinor: bigint | string | number
  totalDebitsMinor: bigint | string | number
  totalCreditsMinor: bigint | string | number
  normalBalance?: NormalBalance
  updatedAt: Date
}

export class AccountBalance {
  readonly accountId: AccountId

  readonly balance: Money

  readonly totalDebits: Money

  readonly totalCredits: Money

  readonly normalBalance: NormalBalance

  readonly updatedAt: Date

  constructor(props: AccountBalanceProps) {
    this.accountId = props.accountId
    this.balance = Money.fromMinorUnits(props.balanceMinor, props.currency)
    this.totalDebits = Money.fromMinorUnits(props.totalDebitsMinor, props.currency)
    this.totalCredits = Money.fromMinorUnits(props.totalCreditsMinor, props.currency)
    this.normalBalance = props.normalBalance ?? 'credit'
    this.updatedAt = new Date(props.updatedAt)

    const derivedBalance =
      this.normalBalance === 'debit'
        ? this.totalDebits.subtract(this.totalCredits)
        : this.totalCredits.subtract(this.totalDebits)
    if (!derivedBalance.equals(this.balance)) {
      throw new AppError({
        category: 'invariant_violation',
        code: 'BALANCE_READ_MODEL_MISMATCH',
        message:
          'Account balance read model must match the account normal balance',
        details: {
          accountId: this.accountId,
          normalBalance: this.normalBalance,
          balanceMinor: this.balance.amountMinor.toString(),
          derivedBalanceMinor: derivedBalance.amountMinor.toString(),
        },
      })
    }
  }

  static zero(accountId: AccountId, currency: string, updatedAt: Date): AccountBalance {
    return new AccountBalance({
      accountId,
      currency,
      balanceMinor: 0n,
      totalDebitsMinor: 0n,
      totalCreditsMinor: 0n,
      normalBalance: 'credit',
      updatedAt,
    })
  }

  applyEntry(entry: LedgerEntry, updatedAt: Date): AccountBalance {
    if (entry.accountId !== this.accountId) {
      throw new AppError({
        category: 'invariant_violation',
        code: 'BALANCE_ACCOUNT_MISMATCH',
        message: 'Ledger entry accountId does not match balance accountId',
        details: {
          accountId: this.accountId,
          entryAccountId: entry.accountId,
        },
      })
    }

    const increasesBalance =
      entry.direction === this.normalBalance
    const balance = increasesBalance
      ? this.balance.add(entry.amount)
      : this.balance.subtract(entry.amount)
    const totalCredits =
      entry.direction === 'credit' ? this.totalCredits.add(entry.amount) : this.totalCredits
    const totalDebits = entry.direction === 'debit' ? this.totalDebits.add(entry.amount) : this.totalDebits

    return new AccountBalance({
      accountId: this.accountId,
      currency: this.balance.currency,
      balanceMinor: balance.amountMinor,
      totalDebitsMinor: totalDebits.amountMinor,
      totalCreditsMinor: totalCredits.amountMinor,
      normalBalance: this.normalBalance,
      updatedAt,
    })
  }
}
