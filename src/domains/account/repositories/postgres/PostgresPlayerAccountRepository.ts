import { AppError } from '../../../../shared/types/AppError.js'
import type {
  Database,
  DatabaseTransaction,
  QueryResultRow,
  Queryable,
} from '../../../../shared/db/Database.js'
import type { AccountId } from '../../../accounting/types/identifiers.js'
import { PlayerAccount } from '../../entities/PlayerAccount.js'
import type {
  FindPlayerAccountByLinkedAccountsCriteria,
  FindPlayerAccountByUserCriteria,
  PlayerAccountRepository,
} from '../PlayerAccountRepository.js'
import type { PlayerAccountClass } from '../../types/accountDomainTypes.js'
import type { PlayerAccountId, UserId } from '../../types/identifiers.js'

interface PlayerAccountRow extends QueryResultRow {
  player_account_id: string
  user_id: string
  currency: string
  account_class: string
  available_account_id: string
  locked_account_id: string
  created_at: Date | string
  updated_at: Date | string
  status_changed_at: Date | string
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value) : new Date(value)
}

function toPlayerAccount(row: PlayerAccountRow): PlayerAccount {
  return new PlayerAccount({
    playerAccountId: row.player_account_id as PlayerAccountId,
    userId: row.user_id as UserId,
    currency: row.currency,
    accountClass: row.account_class as PlayerAccountClass,
    availableAccountId: row.available_account_id as AccountId,
    reservedAccountId: row.locked_account_id as AccountId,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    statusChangedAt: toDate(row.status_changed_at),
  })
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  )
}

export class PostgresPlayerAccountRepository
  implements PlayerAccountRepository
{
  constructor(private readonly database: Database) {}

  async create(
    playerAccount: PlayerAccount,
    transaction?: DatabaseTransaction,
  ): Promise<void> {
    const queryable = transaction ?? this.database

    try {
      await queryable.query(
        `
          INSERT INTO player_accounts (
            player_account_id,
            user_id,
            currency,
            account_class,
            available_account_id,
            locked_account_id,
            created_at,
            updated_at,
            status_changed_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          playerAccount.playerAccountId,
          playerAccount.userId,
          playerAccount.currency,
          playerAccount.accountClass,
          playerAccount.availableAccountId,
          playerAccount.reservedAccountId,
          playerAccount.createdAt,
          playerAccount.updatedAt,
          playerAccount.statusChangedAt,
        ],
      )
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError({
          category: 'conflict',
          code: 'PLAYER_ACCOUNT_ALREADY_EXISTS',
          message:
            'A PlayerAccount already exists for the user, currency, class, or linked core accounts',
          details: {
            playerAccountId: playerAccount.playerAccountId,
            userId: playerAccount.userId,
            currency: playerAccount.currency,
            accountClass: playerAccount.accountClass,
            availableAccountId: playerAccount.availableAccountId,
            lockedAccountId: playerAccount.reservedAccountId,
          },
        })
      }

      throw error
    }
  }

  async update(
    playerAccount: PlayerAccount,
    transaction?: DatabaseTransaction,
  ): Promise<void> {
    const queryable = transaction ?? this.database
    const result = await queryable.query(
      `
        UPDATE player_accounts
        SET updated_at = $2,
            status_changed_at = $3
        WHERE player_account_id = $1
      `,
      [
        playerAccount.playerAccountId,
        playerAccount.updatedAt,
        playerAccount.statusChangedAt,
      ],
    )

    if (result.rowCount !== 1) {
      throw new AppError({
        category: 'not_found',
        code: 'PLAYER_ACCOUNT_NOT_FOUND',
        message: `PlayerAccount ${playerAccount.playerAccountId} was not found`,
        details: { playerAccountId: playerAccount.playerAccountId },
      })
    }
  }

  async getById(
    playerAccountId: PlayerAccountId,
    queryable?: Queryable,
  ): Promise<PlayerAccount | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<PlayerAccountRow>(
      'SELECT * FROM player_accounts WHERE player_account_id = $1',
      [playerAccountId],
    )

    return result.rows[0] ? toPlayerAccount(result.rows[0]) : null
  }

  async findByUserAndCurrency(
    criteria: FindPlayerAccountByUserCriteria,
    queryable?: Queryable,
  ): Promise<PlayerAccount | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<PlayerAccountRow>(
      `
        SELECT *
        FROM player_accounts
        WHERE user_id = $1
          AND currency = $2
          AND account_class = $3
        LIMIT 1
      `,
      [criteria.userId, criteria.currency, criteria.accountClass],
    )

    return result.rows[0] ? toPlayerAccount(result.rows[0]) : null
  }

  async findByLinkedAccounts(
    criteria: FindPlayerAccountByLinkedAccountsCriteria,
    queryable?: Queryable,
  ): Promise<PlayerAccount | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<PlayerAccountRow>(
      `
        SELECT *
        FROM player_accounts
        WHERE available_account_id = $1
           OR locked_account_id = $2
        LIMIT 1
      `,
      [criteria.availableAccountId, criteria.reservedAccountId],
    )

    return result.rows[0] ? toPlayerAccount(result.rows[0]) : null
  }
}
