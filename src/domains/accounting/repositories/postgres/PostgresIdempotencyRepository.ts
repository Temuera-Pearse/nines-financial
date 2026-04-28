import type {
  IdempotencyKey,
  IdempotencyRecord,
} from '../../../../shared/idempotency/types.js'
import type {
  Database,
  DatabaseTransaction,
  QueryResultRow,
  Queryable,
} from '../../../../shared/db/Database.js'
import { toIdempotencyKey } from '../../../../shared/idempotency/types.js'
import { AppError } from '../../../../shared/types/AppError.js'
import type { IdempotencyRepository } from '../IdempotencyRepository.js'

interface IdempotencyRecordRow extends QueryResultRow {
  idempotency_key: string
  command_type: string
  request_hash: string
  response_snapshot: Record<string, unknown> | null
  status: 'in_progress' | 'completed' | 'failed'
  created_at: Date | string
  updated_at: Date | string
  expires_at: Date | string | null
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value) : new Date(value)
}

function toIdempotencyRecord(row: IdempotencyRecordRow): IdempotencyRecord {
  const record: IdempotencyRecord = {
    idempotencyKey: toIdempotencyKey(row.idempotency_key),
    commandType: row.command_type,
    requestHash: row.request_hash,
    responseSnapshot:
      (row.response_snapshot as IdempotencyRecord['responseSnapshot']) ?? null,
    status: row.status,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  }

  if (row.expires_at) {
    record.expiresAt = toDate(row.expires_at)
  }

  return record
}

export class PostgresIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly database: Database) {}

  async getByKey(
    commandType: string,
    idempotencyKey: IdempotencyKey,
    queryable?: Queryable,
  ): Promise<IdempotencyRecord | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<IdempotencyRecordRow>(
      `
        SELECT *
        FROM idempotency_records
        WHERE command_type = $1 AND idempotency_key = $2
      `,
      [commandType, idempotencyKey],
    )

    return result.rows[0] ? toIdempotencyRecord(result.rows[0]) : null
  }

  async createIfAbsent(
    record: IdempotencyRecord,
    transaction: DatabaseTransaction,
  ): Promise<boolean> {
    const result = await transaction.query(
      `
        INSERT INTO idempotency_records (
          idempotency_key,
          command_type,
          request_hash,
          request_fingerprint,
          response_snapshot,
          status,
          created_at,
          updated_at,
          expires_at
        )
        VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (idempotency_key, command_type) DO NOTHING
      `,
      [
        record.idempotencyKey,
        record.commandType,
        record.requestHash,
        record.responseSnapshot,
        record.status,
        record.createdAt,
        record.updatedAt,
        record.expiresAt ?? null,
      ],
    )

    return result.rowCount === 1
  }

  async update(
    record: IdempotencyRecord,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    const result = await transaction.query(
      `
        UPDATE idempotency_records
        SET request_hash = $3,
            request_fingerprint = $3,
            response_snapshot = $4,
            status = $5,
            updated_at = $6,
            expires_at = $7
        WHERE command_type = $1 AND idempotency_key = $2
      `,
      [
        record.commandType,
        record.idempotencyKey,
        record.requestHash,
        record.responseSnapshot,
        record.status,
        record.updatedAt,
        record.expiresAt ?? null,
      ],
    )

    if (result.rowCount !== 1) {
      throw new AppError({
        category: 'not_found',
        code: 'IDEMPOTENCY_RECORD_NOT_FOUND',
        message: 'Idempotency record was not found for update',
        details: {
          commandType: record.commandType,
          idempotencyKey: record.idempotencyKey,
        },
      })
    }
  }
}
