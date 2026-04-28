import { toCurrencyCode, type CurrencyCode } from '../../../shared/money/Money.js'
import { AppError } from '../../../shared/types/AppError.js'
import { AccountStatusError } from '../errors/AccountingErrors.js'
import type { AccountId, OwnerId } from '../types/identifiers.js'
import {
  classifyAccountType,
  type AccountClass,
  type AccountStatus,
  type AccountType,
  type NormalBalance,
  type OwnerType,
} from '../types/accountingTypes.js'

export interface AccountProps {
  accountId: AccountId
  accountType: AccountType
  accountClass?: AccountClass
  normalBalance?: NormalBalance
  ownerType: OwnerType
  ownerId: OwnerId
  currency: string
  status: AccountStatus
  createdAt: Date
  updatedAt: Date
}

export class Account {
  readonly accountId: AccountId

  readonly accountType: AccountType

  readonly accountClass: AccountClass

  readonly normalBalance: NormalBalance

  readonly ownerType: OwnerType

  readonly ownerId: OwnerId

  readonly currency: CurrencyCode

  readonly status: AccountStatus

  readonly createdAt: Date

  readonly updatedAt: Date

  constructor(props: AccountProps) {
    this.accountId = props.accountId
    this.accountType = props.accountType
    const classification = classifyAccountType(props.accountType)
    this.accountClass = props.accountClass ?? classification.accountClass
    this.normalBalance = props.normalBalance ?? classification.normalBalance
    this.ownerType = props.ownerType
    this.ownerId = props.ownerId
    this.currency = toCurrencyCode(props.currency)
    this.status = props.status
    this.createdAt = new Date(props.createdAt)
    this.updatedAt = new Date(props.updatedAt)

    if (this.updatedAt.getTime() < this.createdAt.getTime()) {
      throw new AppError({
        category: 'invariant_violation',
        code: 'ACCOUNT_TIMESTAMP_ORDER',
        message: 'Account updatedAt cannot be earlier than createdAt',
        details: { accountId: this.accountId },
      })
    }

    if (
      this.accountClass !== classification.accountClass ||
      this.normalBalance !== classification.normalBalance
    ) {
      throw new AppError({
        category: 'invariant_violation',
        code: 'ACCOUNT_CLASSIFICATION_MISMATCH',
        message:
          'Account class and normal balance must match the canonical account type classification',
        details: {
          accountId: this.accountId,
          accountType: this.accountType,
          accountClass: this.accountClass,
          normalBalance: this.normalBalance,
          expectedAccountClass: classification.accountClass,
          expectedNormalBalance: classification.normalBalance,
        },
      })
    }
  }

  freeze(at: Date): Account {
    if (this.status === 'closed') {
      throw new AccountStatusError(this.accountId, this.status)
    }

    if (this.status === 'frozen') {
      return this
    }

      return new Account({
        accountId: this.accountId,
        accountType: this.accountType,
        accountClass: this.accountClass,
        normalBalance: this.normalBalance,
        ownerType: this.ownerType,
      ownerId: this.ownerId,
      currency: this.currency,
      status: 'frozen',
      createdAt: this.createdAt,
      updatedAt: at,
    })
  }

  unfreeze(at: Date): Account {
    if (this.status === 'closed') {
      throw new AccountStatusError(this.accountId, this.status)
    }

    if (this.status === 'active') {
      return this
    }

    return new Account({
      accountId: this.accountId,
      accountType: this.accountType,
      accountClass: this.accountClass,
      normalBalance: this.normalBalance,
      ownerType: this.ownerType,
      ownerId: this.ownerId,
      currency: this.currency,
      status: 'active',
      createdAt: this.createdAt,
      updatedAt: at,
    })
  }

  ensureCanPost() {
    if (this.status !== 'active') {
      throw new AccountStatusError(this.accountId, this.status)
    }
  }
}
