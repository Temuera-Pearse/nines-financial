import type {
  DatabaseTransaction,
  Queryable,
} from '../../../shared/db/Database.js'
import type { AccountSuspension } from '../entities/AccountSuspension.js'
import type {
  AccountSuspensionId,
  PlayerAccountId,
} from '../types/identifiers.js'

export interface AccountSuspensionRepository {
  create(
    suspension: AccountSuspension,
    transaction?: DatabaseTransaction,
  ): Promise<void>
  update(
    suspension: AccountSuspension,
    transaction?: DatabaseTransaction,
  ): Promise<void>
  getById(
    suspensionId: AccountSuspensionId,
    queryable?: Queryable,
  ): Promise<AccountSuspension | null>
  getActiveByPlayerAccountId(
    playerAccountId: PlayerAccountId,
    at?: Date,
    queryable?: Queryable,
  ): Promise<AccountSuspension | null>
}
