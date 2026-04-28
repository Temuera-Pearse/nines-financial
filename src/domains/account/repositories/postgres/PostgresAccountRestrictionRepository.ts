import type {
  Database,
  DatabaseTransaction,
  QueryResultRow,
  Queryable,
} from '../../../../shared/db/Database.js'
import { AppError } from '../../../../shared/types/AppError.js'
import { AccountRestriction } from '../../entities/AccountRestriction.js'
import type { RestrictableAccountActionType } from '../../restrictions/accountActionTypes.js'
import type {
  AccountRestrictionId,
  PlayerAccountId,
} from '../../types/identifiers.js'
import type { AccountRestrictionRepository } from '../AccountRestrictionRepository.js'

interface AccountRestrictionRow extends QueryResultRow {
  restriction_id: string
  player_account_id: string
  blocked_actions: unknown
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

function toBlockedActions(value: unknown): readonly RestrictableAccountActionType[] {
  if (Array.isArray(value)) {
    return value as RestrictableAccountActionType[]
  }

  if (typeof value === 'string') {
    return JSON.parse(value) as RestrictableAccountActionType[]
  }

  return [] as const
}

function toRestriction(row: AccountRestrictionRow): AccountRestriction {
  return new AccountRestriction({
    restrictionId: row.restriction_id as AccountRestrictionId,
    playerAccountId: row.player_account_id as PlayerAccountId,
    blockedActions: toBlockedActions(row.blocked_actions),
    reasonCode: row.reason_code,
    reasonText: row.reason_text,
    ticketId: row.ticket_id,
    actorType: row.actor_type as AccountRestriction['actorType'],
    actorId: row.actor_id,
    source: row.source,
    createdAt: toDate(row.created_at),
    expiresAt: optionalDate(row.expires_at),
    liftedAt: optionalDate(row.lifted_at),
    liftReasonCode: row.lift_reason_code,
    liftReasonText: row.lift_reason_text,
  })
}

export class PostgresAccountRestrictionRepository
  implements AccountRestrictionRepository
{
  constructor(private readonly database: Database) {}

  async create(
    restriction: AccountRestriction,
    transaction?: DatabaseTransaction,
  ): Promise<void> {
    const queryable = transaction ?? this.database

    await queryable.query(
      `
        INSERT INTO account_restrictions (
          restriction_id,
          player_account_id,
          blocked_actions,
          reason_code,
          reason_text,
          ticket_id,
          actor_type,
          actor_id,
          source,
          created_at,
          expires_at
        )
        VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        restriction.restrictionId,
        restriction.playerAccountId,
        JSON.stringify([...restriction.blockedActions]),
        restriction.reasonCode,
        restriction.reasonText,
        restriction.ticketId,
        restriction.actorType,
        restriction.actorId,
        restriction.source,
        restriction.createdAt,
        restriction.expiresAt,
      ],
    )
  }

  async update(
    restriction: AccountRestriction,
    transaction?: DatabaseTransaction,
  ): Promise<void> {
    const queryable = transaction ?? this.database
    const result = await queryable.query(
      `
        UPDATE account_restrictions
        SET lifted_at = $2,
            lift_reason_code = $3,
            lift_reason_text = $4
        WHERE restriction_id = $1
      `,
      [
        restriction.restrictionId,
        restriction.liftedAt,
        restriction.liftReasonCode,
        restriction.liftReasonText,
      ],
    )

    if (result.rowCount !== 1) {
      throw new AppError({
        category: 'not_found',
        code: 'ACCOUNT_RESTRICTION_NOT_FOUND',
        message: `Account restriction ${restriction.restrictionId} was not found`,
        details: { restrictionId: restriction.restrictionId },
      })
    }
  }

  async getById(
    restrictionId: AccountRestrictionId,
    queryable?: Queryable,
  ): Promise<AccountRestriction | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<AccountRestrictionRow>(
      'SELECT * FROM account_restrictions WHERE restriction_id = $1',
      [restrictionId],
    )

    return result.rows[0] ? toRestriction(result.rows[0]) : null
  }

  async listActiveByPlayerAccountId(
    playerAccountId: PlayerAccountId,
    at: Date = new Date(),
    queryable?: Queryable,
  ): Promise<readonly AccountRestriction[]> {
    const executor = queryable ?? this.database
    const result = await executor.query<AccountRestrictionRow>(
      `
        SELECT *
        FROM account_restrictions
        WHERE player_account_id = $1
          AND lifted_at IS NULL
          AND (expires_at IS NULL OR expires_at > $2)
        ORDER BY created_at ASC, restriction_id ASC
      `,
      [playerAccountId, at],
    )

    return result.rows.map((row) => toRestriction(row))
  }

  async countActiveByPlayerAccountId(
    playerAccountId: PlayerAccountId,
    at: Date = new Date(),
    queryable?: Queryable,
  ): Promise<number> {
    const executor = queryable ?? this.database
    const result = await executor.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM account_restrictions
        WHERE player_account_id = $1
          AND lifted_at IS NULL
          AND (expires_at IS NULL OR expires_at > $2)
      `,
      [playerAccountId, at],
    )

    return result.rows[0]?.count ?? 0
  }
}
