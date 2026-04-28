import type { DatabaseTransaction, Queryable } from '../../../shared/db/Database.js'
import type { Account } from '../entities/Account.js'
import type { AccountBalance } from '../entities/AccountBalance.js'
import type { AccountId, OwnerId } from '../types/identifiers.js'
import type { AccountType, OwnerType } from '../types/accountingTypes.js'

export interface AccountPostingState {
  account: Account
  balance: AccountBalance
}

export interface FindAccountByOwnerCriteria {
  accountType: AccountType
  ownerType: OwnerType
  ownerId: OwnerId
  currency: string
}

export interface AccountRepository {
  create(account: Account, transaction?: DatabaseTransaction): Promise<void>
  update(account: Account, transaction?: DatabaseTransaction): Promise<void>
  getById(accountId: AccountId, queryable?: Queryable): Promise<Account | null>
  findByOwnerAndType(criteria: FindAccountByOwnerCriteria, queryable?: Queryable): Promise<Account | null>
  getBalance(accountId: AccountId, queryable?: Queryable): Promise<AccountBalance | null>
  getPostingStatesForUpdate(
    accountIds: readonly AccountId[],
    transaction: DatabaseTransaction,
  ): Promise<AccountPostingState[]>
}