import type { DatabaseTransaction, Queryable } from '../../../shared/db/Database.js'
import type { LedgerEntry } from '../entities/LedgerEntry.js'
import type { LedgerTransaction } from '../entities/LedgerTransaction.js'
import type { AccountId, LedgerTransactionId } from '../types/identifiers.js'
import type { ReferenceType } from '../types/accountingTypes.js'

export interface LedgerRepository {
  appendTransaction(transaction: LedgerTransaction, databaseTransaction: DatabaseTransaction): Promise<void>
  getById(transactionId: LedgerTransactionId, queryable?: Queryable): Promise<LedgerTransaction | null>
  listByReference(referenceType: ReferenceType, referenceId: string, queryable?: Queryable): Promise<LedgerTransaction[]>
  listByRelatedTransactionId(
    relatedTransactionId: LedgerTransactionId,
    queryable?: Queryable,
  ): Promise<LedgerTransaction[]>
  listEntriesByTransactionId(transactionId: LedgerTransactionId, queryable?: Queryable): Promise<LedgerEntry[]>
  listEntriesByAccountId(accountId: AccountId, queryable?: Queryable): Promise<LedgerEntry[]>
  listAllEntries(queryable?: Queryable): Promise<LedgerEntry[]>
}