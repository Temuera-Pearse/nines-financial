import type {
  Database,
  DatabaseTransaction,
  QueryResultRow,
  Queryable,
} from '../../../../shared/db/Database.js'
import { AppError } from '../../../../shared/types/AppError.js'
import { AccountFreeze } from '../../entities/AccountFreeze.js'
import type { AccountFreezeId, PlayerAccountId } from '../../types/identifiers.js'
import type { AccountFreezeRepository } from '../AccountFreezeRepository.js'

interface AccountFreezeRow extends QueryResultRow {
  freeze_id: string
  player_account_id: string
  reason_code: string
  reason_text: string
  ticket_id: string | null
  actor_type: string
  actor_id: string
  source: string
  created_at: Date | string
  lifted_at: Date | string | null
  lift_reason_code: string | null
  lift_reason_text: string | null
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value) : new Date(value)
}

function optionalDate(value: Date | string | null): Date | null {
  return value ? toDate(value) : null
}

function toFreeze(row: AccountFreezeRow): AccountFreeze {
  return new AccountFreeze({
    freezeId: row.freeze_id as AccountFreezeId,
    playerAccountId: row.player_account_id as PlayerAccountId,
    reasonCode: row.reason_code,
    reasonText: row.reason_text,
    ticketId: row.ticket_id,
    actorType: row.actor_type as AccountFreeze['actorType'],
    actorId: row.actor_id,
    source: row.source,
    createdAt: toDate(row.created_at),
    liftedAt: optionalDate(row.lifted_at),
    liftReasonCode: row.lift_reason_code,
    liftReasonText: row.lift_reason_text,
  })
}

export class PostgresAccountFreezeRepository
  implements AccountFreezeRepository
{
  constructor(private readonly database: Database) {}

  async create(
    freeze: AccountFreeze,
    transaction?: DatabaseTransaction,
  ): Promise<void> {
    const queryable = transaction ?? this.database

    await queryable.query(
      `
        INSERT INTO account_freezes (
          freeze_id,
          player_account_id,
          reason_code,
          reason_text,
          ticket_id,
          actor_type,
          actor_id,
          source,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        freeze.freezeId,
        freeze.playerAccountId,
        freeze.reasonCode,
        freeze.reasonText,
        freeze.ticketId,
        freeze.actorType,
        freeze.actorId,
        freeze.source,
        freeze.createdAt,
      ],
    )
  }

  async update(
    freeze: AccountFreeze,
    transaction?: DatabaseTransaction,
  ): Promise<void> {
    const queryable = transaction ?? this.database
    const result = await queryable.query(
      `
        UPDATE account_freezes
        SET lifted_at = $2,
            lift_reason_code = $3,
            lift_reason_text = $4
        WHERE freeze_id = $1
      `,
      [
        freeze.freezeId,
        freeze.liftedAt,
        freeze.liftReasonCode,
        freeze.liftReasonText,
      ],
    )

    if (result.rowCount !== 1) {
      throw new AppError({
        category: 'not_found',
        code: 'ACCOUNT_FREEZE_NOT_FOUND',
        message: `Account freeze ${freeze.freezeId} was not found`,
        details: { freezeId: freeze.freezeId },
      })
    }
  }

  async getById(
    freezeId: AccountFreezeId,
    queryable?: Queryable,
  ): Promise<AccountFreeze | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<AccountFreezeRow>(
      'SELECT * FROM account_freezes WHERE freeze_id = $1',
      [freezeId],
    )

    return result.rows[0] ? toFreeze(result.rows[0]) : null
  }

  async getActiveByPlayerAccountId(
    playerAccountId: PlayerAccountId,
    queryable?: Queryable,
  ): Promise<AccountFreeze | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<AccountFreezeRow>(
      `
        SELECT *
        FROM account_freezes
        WHERE player_account_id = $1
          AND lifted_at IS NULL
        ORDER BY created_at DESC, freeze_id DESC
        LIMIT 1
      `,
      [playerAccountId],
    )

    return result.rows[0] ? toFreeze(result.rows[0]) : null
  }
}
