import type { Queryable } from '../../../shared/db/Database.js'
import type { Account } from '../../accounting/entities/Account.js'
import type { AccountBalance } from '../../accounting/entities/AccountBalance.js'
import type { AccountId } from '../../accounting/types/identifiers.js'
import type { AccountType } from '../../accounting/types/accountingTypes.js'
import type { UserId } from '../types/identifiers.js'

export type LinkedPlayerAccountingAccountType = Extract<
  AccountType,
  'user_available' | 'user_locked'
>

export interface FindUserAccountingAccountCriteria {
  userId: UserId
  currency: string
  accountType: LinkedPlayerAccountingAccountType
}

export interface AccountingAccountSnapshot {
  account: Account
  balance: AccountBalance | null
}

export interface PlayerLinkedAccountingAccountsCriteria {
  availableAccountId: AccountId
  reservedAccountId: AccountId
}

export interface PlayerLinkedAccountingAccountsSnapshot {
  available: AccountingAccountSnapshot
  reserved: AccountingAccountSnapshot
}

export interface AccountingAccountReadPort {
  getAccount(
    accountId: AccountId,
    queryable?: Queryable,
  ): Promise<Account | null>
  getBalance(
    accountId: AccountId,
    queryable?: Queryable,
  ): Promise<AccountBalance | null>
  findUserAccount(
    criteria: FindUserAccountingAccountCriteria,
    queryable?: Queryable,
  ): Promise<Account | null>
  getPlayerLinkedAccounts(
    criteria: PlayerLinkedAccountingAccountsCriteria,
    queryable?: Queryable,
  ): Promise<PlayerLinkedAccountingAccountsSnapshot | null>
}
