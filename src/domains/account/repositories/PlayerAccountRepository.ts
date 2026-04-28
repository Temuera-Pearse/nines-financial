import type {
  DatabaseTransaction,
  Queryable,
} from '../../../shared/db/Database.js'
import type { AccountId } from '../../accounting/types/identifiers.js'
import type { PlayerAccount } from '../entities/PlayerAccount.js'
import type { PlayerAccountClass } from '../types/accountDomainTypes.js'
import type { PlayerAccountId, UserId } from '../types/identifiers.js'

export interface FindPlayerAccountByUserCriteria {
  userId: UserId
  currency: string
  accountClass: PlayerAccountClass
}

export interface FindPlayerAccountByLinkedAccountsCriteria {
  availableAccountId: AccountId
  reservedAccountId: AccountId
}

export interface PlayerAccountRepository {
  // Implementations must enforce uniqueness on (userId, currency, accountClass)
  // as the authoritative final guard for PlayerAccount creation.
  create(
    playerAccount: PlayerAccount,
    transaction?: DatabaseTransaction,
  ): Promise<void>
  update(
    playerAccount: PlayerAccount,
    transaction?: DatabaseTransaction,
  ): Promise<void>
  getById(
    playerAccountId: PlayerAccountId,
    queryable?: Queryable,
  ): Promise<PlayerAccount | null>
  findByUserAndCurrency(
    criteria: FindPlayerAccountByUserCriteria,
    queryable?: Queryable,
  ): Promise<PlayerAccount | null>
  findByLinkedAccounts(
    criteria: FindPlayerAccountByLinkedAccountsCriteria,
    queryable?: Queryable,
  ): Promise<PlayerAccount | null>
}
