import type { IdempotencyKey } from '../../../../shared/idempotency/types.js'
import type { Database, DatabaseTransaction, QueryResultRow, Queryable } from '../../../../shared/db/Database.js'
import { toIdempotencyKey } from '../../../../shared/idempotency/types.js'
import { AppError } from '../../../../shared/types/AppError.js'
import { LedgerEntry } from '../../entities/LedgerEntry.js'
import { LedgerTransaction } from '../../entities/LedgerTransaction.js'
import type { LedgerRepository } from '../LedgerRepository.js'
import type { AccountId, LedgerTransactionId } from '../../types/identifiers.js'
import type { ReferenceType } from '../../types/accountingTypes.js'

interface LedgerTransactionRow extends QueryResultRow {
  transaction_id: string
  transaction_type: string
  reference_type: string
  reference_id: string
  status: string
  related_transaction_id: string | null
  correlation_id: string
  causation_id: string
  idempotency_key: string | null
  created_at: Date | string
}

interface LedgerEntryRow extends QueryResultRow {
  entry_id: string
  transaction_id: string
  account_id: string
  direction: string
  amount_minor: string | number
  currency: string
  effective_at: Date | string
  created_at: Date | string
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value) : new Date(value)
}

function toLedgerEntry(row: LedgerEntryRow): LedgerEntry {
  return new LedgerEntry({
    entryId: row.entry_id as LedgerEntry['entryId'],
    transactionId: row.transaction_id as LedgerEntry['transactionId'],
    accountId: row.account_id as LedgerEntry['accountId'],
    direction: row.direction as LedgerEntry['direction'],
    amountMinor: row.amount_minor,
    currency: row.currency,
    effectiveAt: toDate(row.effective_at),
    createdAt: toDate(row.created_at),
  })
}

function toLedgerTransaction(
  row: LedgerTransactionRow,
  entries: readonly LedgerEntry[],
): LedgerTransaction {
  const props = {
    transactionId: row.transaction_id as LedgerTransactionId,
    transactionType: row.transaction_type as LedgerTransaction['transactionType'],
    referenceType: row.reference_type as LedgerTransaction['referenceType'],
    referenceId: row.reference_id,
    status: row.status as LedgerTransaction['status'],
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    createdAt: toDate(row.created_at),
    entries,
  }

  return new LedgerTransaction(
    {
      ...props,
      ...(row.related_transaction_id
        ? { relatedTransactionId: row.related_transaction_id as LedgerTransactionId }
        : {}),
      ...(row.idempotency_key ? { idempotencyKey: toIdempotencyKey(row.idempotency_key) as IdempotencyKey } : {}),
    },
  )
}

export class PostgresLedgerRepository implements LedgerRepository {
  constructor(private readonly database: Database) {}

  async appendTransaction(transaction: LedgerTransaction, databaseTransaction: DatabaseTransaction): Promise<void> {
    await databaseTransaction.query(
      `
        INSERT INTO ledger_transactions (
          transaction_id,
          transaction_type,
          reference_type,
          reference_id,
          status,
          related_transaction_id,
          correlation_id,
          causation_id,
          idempotency_key,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        transaction.transactionId,
        transaction.transactionType,
        transaction.referenceType,
        transaction.referenceId,
        transaction.status,
        transaction.relatedTransactionId ?? null,
        transaction.correlationId,
        transaction.causationId,
        transaction.idempotencyKey ?? null,
        transaction.createdAt,
      ],
    )

    for (const entry of transaction.entries) {
      await databaseTransaction.query(
        `
          INSERT INTO ledger_entries (
            entry_id,
            transaction_id,
            account_id,
            direction,
            amount_minor,
            currency,
            effective_at,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          entry.entryId,
          entry.transactionId,
          entry.accountId,
          entry.direction,
          entry.amount.amountMinor.toString(),
          entry.amount.currency,
          entry.effectiveAt,
          entry.createdAt,
        ],
      )

      await this.applyBalanceReadModelUpdate(entry, databaseTransaction)
    }
  }

  async getById(transactionId: LedgerTransactionId, queryable?: Queryable): Promise<LedgerTransaction | null> {
    const executor = queryable ?? this.database
    const transactionResult = await executor.query<LedgerTransactionRow>(
      'SELECT * FROM ledger_transactions WHERE transaction_id = $1',
      [transactionId],
    )
    const transactionRow = transactionResult.rows[0]

    if (!transactionRow) {
      return null
    }

    const entries = await this.listEntriesByTransactionId(transactionId, executor)
    return toLedgerTransaction(transactionRow, entries)
  }

  async listByReference(referenceType: ReferenceType, referenceId: string, queryable?: Queryable): Promise<LedgerTransaction[]> {
    const executor = queryable ?? this.database
    const transactionRows = await executor.query<LedgerTransactionRow>(
      `
        SELECT *
        FROM ledger_transactions
        WHERE reference_type = $1 AND reference_id = $2
        ORDER BY created_at ASC, transaction_id ASC
      `,
      [referenceType, referenceId],
    )

    const transactions: LedgerTransaction[] = []

    for (const row of transactionRows.rows) {
      const entries = await this.listEntriesByTransactionId(row.transaction_id as LedgerTransactionId, executor)
      transactions.push(toLedgerTransaction(row, entries))
    }

    return transactions
  }

  async listByRelatedTransactionId(
    relatedTransactionId: LedgerTransactionId,
    queryable?: Queryable,
  ): Promise<LedgerTransaction[]> {
    const executor = queryable ?? this.database
    const transactionRows = await executor.query<LedgerTransactionRow>(
      `
        SELECT *
        FROM ledger_transactions
        WHERE related_transaction_id = $1
        ORDER BY created_at ASC, transaction_id ASC
      `,
      [relatedTransactionId],
    )

    const transactions: LedgerTransaction[] = []

    for (const row of transactionRows.rows) {
      const entries = await this.listEntriesByTransactionId(row.transaction_id as LedgerTransactionId, executor)
      transactions.push(toLedgerTransaction(row, entries))
    }

    return transactions
  }

  async listEntriesByTransactionId(transactionId: LedgerTransactionId, queryable?: Queryable): Promise<LedgerEntry[]> {
    const executor = queryable ?? this.database
    const result = await executor.query<LedgerEntryRow>(
      `
        SELECT *
        FROM ledger_entries
        WHERE transaction_id = $1
        ORDER BY created_at ASC, entry_id ASC
      `,
      [transactionId],
    )
    return result.rows.map((row) => toLedgerEntry(row))
  }

  async listEntriesByAccountId(accountId: AccountId, queryable?: Queryable): Promise<LedgerEntry[]> {
    const executor = queryable ?? this.database
    const result = await executor.query<LedgerEntryRow>(
      `
        SELECT *
        FROM ledger_entries
        WHERE account_id = $1
        ORDER BY effective_at ASC, created_at ASC, entry_id ASC
      `,
      [accountId],
    )
    return result.rows.map((row) => toLedgerEntry(row))
  }

  async listAllEntries(queryable?: Queryable): Promise<LedgerEntry[]> {
    const executor = queryable ?? this.database
    const result = await executor.query<LedgerEntryRow>(
      `
        SELECT *
        FROM ledger_entries
        ORDER BY created_at ASC, entry_id ASC
      `,
    )

    return result.rows.map((row) => toLedgerEntry(row))
  }

  private async applyBalanceReadModelUpdate(
    entry: LedgerEntry,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    const debitDeltaMinor = entry.direction === 'debit' ? entry.amount.amountMinor : 0n
    const creditDeltaMinor = entry.direction === 'credit' ? entry.amount.amountMinor : 0n
    const result = await transaction.query(
      `
        INSERT INTO account_balances (
          account_id,
          currency,
          normal_balance,
          balance_minor,
          total_debits_minor,
          total_credits_minor,
          updated_at
        )
        SELECT
          a.account_id,
          a.currency,
          a.normal_balance,
          CASE a.normal_balance
            WHEN 'debit' THEN $3::NUMERIC(20, 0) - $4::NUMERIC(20, 0)
            ELSE $4::NUMERIC(20, 0) - $3::NUMERIC(20, 0)
          END,
          $3::NUMERIC(20, 0),
          $4::NUMERIC(20, 0),
          $5::TIMESTAMPTZ
        FROM accounts a
        WHERE a.account_id = $1 AND a.currency = $2
        ON CONFLICT (account_id)
        DO UPDATE SET
          balance_minor = account_balances.balance_minor + EXCLUDED.balance_minor,
          total_debits_minor = account_balances.total_debits_minor + EXCLUDED.total_debits_minor,
          total_credits_minor = account_balances.total_credits_minor + EXCLUDED.total_credits_minor,
          updated_at = GREATEST(account_balances.updated_at, EXCLUDED.updated_at)
        WHERE account_balances.currency = EXCLUDED.currency
          AND account_balances.normal_balance = EXCLUDED.normal_balance
      `,
      [
        entry.accountId,
        entry.amount.currency,
        debitDeltaMinor.toString(),
        creditDeltaMinor.toString(),
        entry.createdAt,
      ],
    )

    if (result.rowCount !== 1) {
      throw new AppError({
        category: 'invariant_violation',
        code: 'BALANCE_READ_MODEL_UPDATE_FAILED',
        message: 'Failed to update the account balance read model after a ledger insert',
        details: {
          accountId: entry.accountId,
          currency: entry.amount.currency,
        },
      })
    }
  }
}
