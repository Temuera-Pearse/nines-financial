import type {
  DatabaseTransaction,
  Queryable,
} from '../../../shared/db/Database.js'
import type { AccountRestriction } from '../entities/AccountRestriction.js'
import type {
  AccountRestrictionId,
  PlayerAccountId,
} from '../types/identifiers.js'

export interface AccountRestrictionRepository {
  create(
    restriction: AccountRestriction,
    transaction?: DatabaseTransaction,
  ): Promise<void>
  update(
    restriction: AccountRestriction,
    transaction?: DatabaseTransaction,
  ): Promise<void>
  getById(
    restrictionId: AccountRestrictionId,
    queryable?: Queryable,
  ): Promise<AccountRestriction | null>
  listActiveByPlayerAccountId(
    playerAccountId: PlayerAccountId,
    at?: Date,
    queryable?: Queryable,
  ): Promise<readonly AccountRestriction[]>
  countActiveByPlayerAccountId(
    playerAccountId: PlayerAccountId,
    at?: Date,
    queryable?: Queryable,
  ): Promise<number>
}
