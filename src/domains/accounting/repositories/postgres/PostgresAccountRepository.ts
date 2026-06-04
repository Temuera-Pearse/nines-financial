import { AppError } from '../../../../shared/types/AppError.js'
import type { Database, DatabaseTransaction, QueryResultRow, Queryable } from '../../../../shared/db/Database.js'
import { Account } from '../../entities/Account.js'
import { AccountBalance } from '../../entities/AccountBalance.js'
import type { AccountRepository, AccountPostingState, FindAccountByOwnerCriteria } from '../AccountRepository.js'
import type { AccountId } from '../../types/identifiers.js'

interface AccountRow extends QueryResultRow {
  account_id: string
  account_type: string
  account_class: string
  normal_balance: string
  owner_type: string
  owner_id: string
  currency: string
  status: string
  created_at: Date | string
  updated_at: Date | string
}

interface AccountWithBalanceRow extends AccountRow {
  balance_minor: string | number
  balance_normal_balance: string
  total_debits_minor: string | number
  total_credits_minor: string | number
  balance_updated_at: Date | string
}

interface BalanceRow extends QueryResultRow {
  account_id: string
  balance_minor: string | number
  normal_balance: string
  total_debits_minor: string | number
  total_credits_minor: string | number
  updated_at: Date | string
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value) : new Date(value)
}

function toAccount(row: AccountRow): Account {
  return new Account({
    accountId: row.account_id as AccountId,
    accountType: row.account_type as Account['accountType'],
    accountClass: row.account_class as Account['accountClass'],
    normalBalance: row.normal_balance as Account['normalBalance'],
    ownerType: row.owner_type as Account['ownerType'],
    ownerId: row.owner_id as Account['ownerId'],
    currency: row.currency,
    status: row.status as Account['status'],
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  })
}

function toAccountBalance(row: AccountWithBalanceRow): AccountBalance {
  return new AccountBalance({
    accountId: row.account_id as AccountId,
    currency: row.currency,
    balanceMinor: row.balance_minor,
    totalDebitsMinor: row.total_debits_minor,
    totalCreditsMinor: row.total_credits_minor,
    normalBalance: row.balance_normal_balance as AccountBalance['normalBalance'],
    updatedAt: toDate(row.balance_updated_at),
  })
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505'
}

export class PostgresAccountRepository implements AccountRepository {
  constructor(private readonly database: Database) {}

  async create(account: Account, transaction?: DatabaseTransaction): Promise<void> {
    const queryable = transaction ?? this.database

    try {
      await queryable.query(
        `
          INSERT INTO accounts (
            account_id,
            account_type,
            account_class,
            normal_balance,
            owner_type,
            owner_id,
            currency,
            status,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          account.accountId,
          account.accountType,
          account.accountClass,
          account.normalBalance,
          account.ownerType,
          account.ownerId,
          account.currency,
          account.status,
          account.createdAt,
          account.updatedAt,
        ],
      )
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError({
          category: 'conflict',
          code: 'ACCOUNT_ALREADY_EXISTS',
          message: 'An account already exists for the given owner, type, and currency',
          details: {
            accountType: account.accountType,
            ownerType: account.ownerType,
            ownerId: account.ownerId,
            currency: account.currency,
          },
        })
      }

      throw error
    }
  }

  async update(account: Account, transaction?: DatabaseTransaction): Promise<void> {
    const queryable = transaction ?? this.database
    const result = await queryable.query(
      `
        UPDATE accounts
        SET status = $2, updated_at = $3
        WHERE account_id = $1
      `,
      [account.accountId, account.status, account.updatedAt],
    )

    if (result.rowCount !== 1) {
      throw new AppError({
        category: 'not_found',
        code: 'ACCOUNT_NOT_FOUND',
        message: `Account ${account.accountId} was not found`,
        details: { accountId: account.accountId },
      })
    }
  }

  async getById(accountId: AccountId, queryable?: Queryable): Promise<Account | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<AccountRow>('SELECT * FROM accounts WHERE account_id = $1', [accountId])
    return result.rows[0] ? toAccount(result.rows[0]) : null
  }

  async findByOwnerAndType(criteria: FindAccountByOwnerCriteria, queryable?: Queryable): Promise<Account | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<AccountRow>(
      `
        SELECT *
        FROM accounts
        WHERE account_type = $1
          AND owner_type = $2
          AND owner_id = $3
          AND currency = $4
        LIMIT 1
      `,
      [criteria.accountType, criteria.ownerType, criteria.ownerId, criteria.currency],
    )

    return result.rows[0] ? toAccount(result.rows[0]) : null
  }

  async getBalance(accountId: AccountId, queryable?: Queryable): Promise<AccountBalance | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<AccountWithBalanceRow>(
      `
        SELECT
          a.account_id,
          a.account_type,
          a.account_class,
          a.normal_balance,
          a.owner_type,
          a.owner_id,
          a.currency,
          a.status,
          a.created_at,
          a.updated_at,
          COALESCE(b.balance_minor, 0) AS balance_minor,
          COALESCE(b.normal_balance, a.normal_balance) AS balance_normal_balance,
          COALESCE(b.total_debits_minor, 0) AS total_debits_minor,
          COALESCE(b.total_credits_minor, 0) AS total_credits_minor,
          COALESCE(b.updated_at, a.updated_at) AS balance_updated_at
        FROM accounts a
        LEFT JOIN account_balances b ON b.account_id = a.account_id
        WHERE a.account_id = $1
      `,
      [accountId],
    )

    return result.rows[0] ? toAccountBalance(result.rows[0]) : null
  }

  async getPostingStatesForUpdate(
    accountIds: readonly AccountId[],
    transaction: DatabaseTransaction,
  ): Promise<AccountPostingState[]> {
    if (accountIds.length === 0) {
      return []
    }

    const placeholders = accountIds.map((_, index) => `$${index + 1}`).join(', ')

    const accountRows = await transaction.query<AccountRow>(
      `
        SELECT *
        FROM accounts
        WHERE account_id IN (${placeholders})
        ORDER BY account_id ASC
        FOR UPDATE
      `,
      accountIds,
    )

    if (accountRows.rows.length === 0) {
      return []
    }

    const balanceRows = await transaction.query<BalanceRow>(
      `
        SELECT
          account_id,
          balance_minor,
          normal_balance,
          total_debits_minor,
          total_credits_minor,
          updated_at
        FROM account_balances
        WHERE account_id IN (${placeholders})
      `,
      accountIds,
    )
    const balanceByAccountId = new Map(
      balanceRows.rows.map((row) => [row.account_id, row]),
    )

    return accountRows.rows.map((accountRow) => {
      const balanceRow = balanceByAccountId.get(accountRow.account_id)
      const row: AccountWithBalanceRow = {
        ...accountRow,
        balance_minor: balanceRow?.balance_minor ?? 0,
        balance_normal_balance:
          balanceRow?.normal_balance ?? accountRow.normal_balance,
        total_debits_minor: balanceRow?.total_debits_minor ?? 0,
        total_credits_minor: balanceRow?.total_credits_minor ?? 0,
        balance_updated_at: balanceRow?.updated_at ?? accountRow.updated_at,
      }

      return {
        account: toAccount(row),
        balance: toAccountBalance(row),
      }
    })
  }
}
