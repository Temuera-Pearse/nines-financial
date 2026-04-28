import type {
  DatabaseTransaction,
  Queryable,
} from '../../../shared/db/Database.js'
import type { AccountFreeze } from '../entities/AccountFreeze.js'
import type { AccountFreezeId, PlayerAccountId } from '../types/identifiers.js'

export interface AccountFreezeRepository {
  create(
    freeze: AccountFreeze,
    transaction?: DatabaseTransaction,
  ): Promise<void>
  update(
    freeze: AccountFreeze,
    transaction?: DatabaseTransaction,
  ): Promise<void>
  getById(
    freezeId: AccountFreezeId,
    queryable?: Queryable,
  ): Promise<AccountFreeze | null>
  getActiveByPlayerAccountId(
    playerAccountId: PlayerAccountId,
    queryable?: Queryable,
  ): Promise<AccountFreeze | null>
}
