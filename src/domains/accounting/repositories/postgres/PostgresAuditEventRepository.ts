import type { AuditEvent } from '../../../../shared/audit/AuditEvent.js'
import type { Database, DatabaseTransaction, QueryResultRow, Queryable } from '../../../../shared/db/Database.js'
import { isJsonValue } from '../../../../shared/types/Json.js'
import type { AuditEventRepository } from '../AuditEventRepository.js'

interface AuditEventRow extends QueryResultRow {
  audit_event_id: string
  event_type: string
  entity_type: string
  entity_id: string
  correlation_id: string
  causation_id: string
  payload: Record<string, unknown>
  created_at: Date | string
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value) : new Date(value)
}

function toAuditEvent(row: AuditEventRow): AuditEvent {
  if (!isJsonValue(row.payload) || Array.isArray(row.payload) || row.payload === null) {
    throw new TypeError('Audit event payload must be a JSON object')
  }

  return {
    auditEventId: row.audit_event_id,
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    payload: row.payload,
    createdAt: toDate(row.created_at),
  }
}

export class PostgresAuditEventRepository implements AuditEventRepository {
  constructor(private readonly database: Database) {}

  async append(event: AuditEvent, transaction: DatabaseTransaction): Promise<void> {
    await transaction.query(
      `
        INSERT INTO audit_events (
          audit_event_id,
          event_type,
          entity_type,
          entity_id,
          correlation_id,
          causation_id,
          payload,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        event.auditEventId,
        event.eventType,
        event.entityType,
        event.entityId,
        event.correlationId,
        event.causationId,
        event.payload,
        event.createdAt,
      ],
    )
  }

  async listByEntity(entityType: string, entityId: string, queryable?: Queryable): Promise<AuditEvent[]> {
    const executor = queryable ?? this.database
    const result = await executor.query<AuditEventRow>(
      `
        SELECT *
        FROM audit_events
        WHERE entity_type = $1 AND entity_id = $2
        ORDER BY created_at ASC, audit_event_id ASC
      `,
      [entityType, entityId],
    )

    return result.rows.map((row) => toAuditEvent(row))
  }
}