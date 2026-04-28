import type {
  Database,
  DatabaseTransaction,
  QueryResultRow,
  Queryable,
} from '../../../../shared/db/Database.js'
import { AppError } from '../../../../shared/types/AppError.js'
import { AccountSuspension } from '../../entities/AccountSuspension.js'
import type {
  AccountSuspensionId,
  PlayerAccountId,
} from '../../types/identifiers.js'
import type { AccountSuspensionRepository } from '../AccountSuspensionRepository.js'

interface AccountSuspensionRow extends QueryResultRow {
  suspension_id: string
  player_account_id: string
  reason_code: string
  reason_text: string
  ticket_id: string | null
  actor_type: string
  actor_id: string
  source: string
  created_at: Date | string
  expires_at: Date | string | null
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

function toSuspension(row: AccountSuspensionRow): AccountSuspension {
  return new AccountSuspension({
    suspensionId: row.suspension_id as AccountSuspensionId,
    playerAccountId: row.player_account_id as PlayerAccountId,
    reasonCode: row.reason_code,
    reasonText: row.reason_text,
    ticketId: row.ticket_id,
    actorType: row.actor_type as AccountSuspension['actorType'],
    actorId: row.actor_id,
    source: row.source,
    createdAt: toDate(row.created_at),
    expiresAt: optionalDate(row.expires_at),
    liftedAt: optionalDate(row.lifted_at),
    liftReasonCode: row.lift_reason_code,
    liftReasonText: row.lift_reason_text,
  })
}

export class PostgresAccountSuspensionRepository
  implements AccountSuspensionRepository
{
  constructor(private readonly database: Database) {}

  async create(
    suspension: AccountSuspension,
    transaction?: DatabaseTransaction,
  ): Promise<void> {
    const queryable = transaction ?? this.database

    await queryable.query(
      `
        INSERT INTO account_suspensions (
          suspension_id,
          player_account_id,
          reason_code,
          reason_text,
          ticket_id,
          actor_type,
          actor_id,
          source,
          created_at,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        suspension.suspensionId,
        suspension.playerAccountId,
        suspension.reasonCode,
        suspension.reasonText,
        suspension.ticketId,
        suspension.actorType,
        suspension.actorId,
        suspension.source,
        suspension.createdAt,
        suspension.expiresAt,
      ],
    )
  }

  async update(
    suspension: AccountSuspension,
    transaction?: DatabaseTransaction,
  ): Promise<void> {
    const queryable = transaction ?? this.database
    const result = await queryable.query(
      `
        UPDATE account_suspensions
        SET lifted_at = $2,
            lift_reason_code = $3,
            lift_reason_text = $4
        WHERE suspension_id = $1
      `,
      [
        suspension.suspensionId,
        suspension.liftedAt,
        suspension.liftReasonCode,
        suspension.liftReasonText,
      ],
    )

    if (result.rowCount !== 1) {
      throw new AppError({
        category: 'not_found',
        code: 'ACCOUNT_SUSPENSION_NOT_FOUND',
        message: `Account suspension ${suspension.suspensionId} was not found`,
        details: { suspensionId: suspension.suspensionId },
      })
    }
  }

  async getById(
    suspensionId: AccountSuspensionId,
    queryable?: Queryable,
  ): Promise<AccountSuspension | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<AccountSuspensionRow>(
      'SELECT * FROM account_suspensions WHERE suspension_id = $1',
      [suspensionId],
    )

    return result.rows[0] ? toSuspension(result.rows[0]) : null
  }

  async getActiveByPlayerAccountId(
    playerAccountId: PlayerAccountId,
    at: Date = new Date(),
    queryable?: Queryable,
  ): Promise<AccountSuspension | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<AccountSuspensionRow>(
      `
        SELECT *
        FROM account_suspensions
        WHERE player_account_id = $1
          AND lifted_at IS NULL
          AND (expires_at IS NULL OR expires_at > $2)
        ORDER BY created_at DESC, suspension_id DESC
        LIMIT 1
      `,
      [playerAccountId, at],
    )

    return result.rows[0] ? toSuspension(result.rows[0]) : null
  }
}
