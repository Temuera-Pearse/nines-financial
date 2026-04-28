import type {
  DatabaseTransaction,
  Queryable,
} from '../../../shared/db/Database.js'
import type {
  IdempotencyKey,
  IdempotencyRecord,
} from '../../../shared/idempotency/types.js'

export interface IdempotencyRepository {
  getByKey(
    commandType: string,
    idempotencyKey: IdempotencyKey,
    queryable?: Queryable,
  ): Promise<IdempotencyRecord | null>
  createIfAbsent(
    record: IdempotencyRecord,
    transaction: DatabaseTransaction,
  ): Promise<boolean>
  update(
    record: IdempotencyRecord,
    transaction: DatabaseTransaction,
  ): Promise<void>
}
