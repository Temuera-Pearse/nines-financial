import { randomUUID } from 'node:crypto'

import type {
  Database,
  DatabaseTransaction,
  QueryResultRow,
  Queryable,
} from '../../../../shared/db/Database.js'
import { isJsonValue, type JsonObject } from '../../../../shared/types/Json.js'
import type {
  Discrepancy,
  DiscrepancySeverity,
  DiscrepancyStatus,
} from '../../entities/Discrepancy.js'
import type {
  DiscrepancyInput,
  DiscrepancyWorkflowHistoryRecord,
  MaterializedDiscrepancyResult,
  OperationsRepository,
} from '../OperationsRepository.js'

interface DiscrepancyRow extends QueryResultRow {
  discrepancy_id: string
  dedupe_key: string
  category: string
  severity: string
  status: string
  entity_type: string
  entity_id: string
  related_ids: unknown
  summary: string
  details_payload: unknown
  first_detected_at: Date | string
  last_detected_at: Date | string
  detected_at: Date | string
  updated_at: Date | string
  assigned_to_operator_id: string | null
  resolution_reason: string | null
  resolved_at: Date | string | null
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value) : new Date(value)
}

function nullableDate(value: Date | string | null): Date | null {
  return value ? toDate(value) : null
}

function toJsonObject(value: unknown): JsonObject {
  if (typeof value === 'string') {
    return toJsonObject(JSON.parse(value) as unknown)
  }

  if (
    !isJsonValue(value) ||
    value === null ||
    Array.isArray(value) ||
    typeof value !== 'object'
  ) {
    return {}
  }

  return value
}

function toDiscrepancy(row: DiscrepancyRow): Discrepancy {
  return {
    discrepancyId: row.discrepancy_id,
    dedupeKey: row.dedupe_key,
    category: row.category,
    severity: row.severity as DiscrepancySeverity,
    status: row.status as DiscrepancyStatus,
    entityType: row.entity_type,
    entityId: row.entity_id,
    relatedIds: toJsonObject(row.related_ids),
    summary: row.summary,
    detailsPayload: toJsonObject(row.details_payload),
    firstDetectedAt: toDate(row.first_detected_at),
    lastDetectedAt: toDate(row.last_detected_at),
    detectedAt: toDate(row.detected_at),
    updatedAt: toDate(row.updated_at),
    assignedToOperatorId: row.assigned_to_operator_id,
    resolutionReason: row.resolution_reason,
    resolvedAt: nullableDate(row.resolved_at),
  }
}

export class PostgresOperationsRepository implements OperationsRepository {
  constructor(private readonly database: Database) {}

  async materializeDiscrepancy(
    issue: DiscrepancyInput,
    transaction: DatabaseTransaction,
  ): Promise<MaterializedDiscrepancyResult> {
    const existing = await transaction.query<DiscrepancyRow>(
      `
        SELECT *
        FROM operational_discrepancies
        WHERE dedupe_key = $1
        FOR UPDATE
      `,
      [issue.dedupeKey],
    )

    if (!existing.rows[0]) {
      const discrepancyId = `disc_${randomUUID()}`
      const inserted = await transaction.query<DiscrepancyRow>(
        `
          INSERT INTO operational_discrepancies (
            discrepancy_id,
            dedupe_key,
            category,
            severity,
            status,
            entity_type,
            entity_id,
            related_ids,
            summary,
            details_payload,
            first_detected_at,
            last_detected_at,
            detected_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, 'open', $5, $6, $7::jsonb, $8, $9::jsonb, $10, $10, $10, $10)
          RETURNING *
        `,
        [
          discrepancyId,
          issue.dedupeKey,
          issue.category,
          issue.severity,
          issue.entityType,
          issue.entityId,
          JSON.stringify(issue.relatedIds),
          issue.summary,
          JSON.stringify(issue.detailsPayload),
          issue.detectedAt,
        ],
      )

      return {
        discrepancy: toDiscrepancy(inserted.rows[0]!),
        outcome: 'opened',
      }
    }

    const current = toDiscrepancy(existing.rows[0])
    const shouldReopen =
      current.status === 'resolved' || current.status === 'suppressed'
    const updated = await transaction.query<DiscrepancyRow>(
      `
        UPDATE operational_discrepancies
        SET category = $2,
            severity = $3,
            status = CASE WHEN status IN ('resolved', 'suppressed') THEN 'open' ELSE status END,
            entity_type = $4,
            entity_id = $5,
            related_ids = $6::jsonb,
            summary = $7,
            details_payload = $8::jsonb,
            last_detected_at = $9,
            detected_at = $9,
            updated_at = $9,
            resolution_reason = CASE WHEN status IN ('resolved', 'suppressed') THEN NULL ELSE resolution_reason END,
            resolved_at = CASE WHEN status IN ('resolved', 'suppressed') THEN NULL ELSE resolved_at END
        WHERE dedupe_key = $1
        RETURNING *
      `,
      [
        issue.dedupeKey,
        issue.category,
        issue.severity,
        issue.entityType,
        issue.entityId,
        JSON.stringify(issue.relatedIds),
        issue.summary,
        JSON.stringify(issue.detailsPayload),
        issue.detectedAt,
      ],
    )

    return {
      discrepancy: toDiscrepancy(updated.rows[0]!),
      outcome: shouldReopen ? 'reopened' : 'refreshed',
    }
  }

  async listDiscrepancies(
    criteria: {
      status?: DiscrepancyStatus
      severity?: DiscrepancySeverity
      category?: string
    },
    queryable?: Queryable,
  ): Promise<Discrepancy[]> {
    const executor = queryable ?? this.database
    const result = await executor.query<DiscrepancyRow>(
      `
        SELECT *
        FROM operational_discrepancies
        WHERE ($1::TEXT IS NULL OR status = $1)
          AND ($2::TEXT IS NULL OR severity = $2)
          AND ($3::TEXT IS NULL OR category = $3)
        ORDER BY updated_at DESC, discrepancy_id ASC
      `,
      [criteria.status ?? null, criteria.severity ?? null, criteria.category ?? null],
    )

    return result.rows.map(toDiscrepancy)
  }

  async getDiscrepancyById(
    discrepancyId: string,
    queryable?: Queryable,
  ): Promise<Discrepancy | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<DiscrepancyRow>(
      'SELECT * FROM operational_discrepancies WHERE discrepancy_id = $1',
      [discrepancyId],
    )

    return result.rows[0] ? toDiscrepancy(result.rows[0]) : null
  }

  async getDiscrepancyByIdForUpdate(
    discrepancyId: string,
    transaction: DatabaseTransaction,
  ): Promise<Discrepancy | null> {
    const result = await transaction.query<DiscrepancyRow>(
      `
        SELECT *
        FROM operational_discrepancies
        WHERE discrepancy_id = $1
        FOR UPDATE
      `,
      [discrepancyId],
    )

    return result.rows[0] ? toDiscrepancy(result.rows[0]) : null
  }

  async updateDiscrepancy(
    discrepancy: Discrepancy,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    await transaction.query(
      `
        UPDATE operational_discrepancies
        SET status = $2,
            severity = $3,
            updated_at = $4,
            assigned_to_operator_id = $5,
            resolution_reason = $6,
            resolved_at = $7
        WHERE discrepancy_id = $1
      `,
      [
        discrepancy.discrepancyId,
        discrepancy.status,
        discrepancy.severity,
        discrepancy.updatedAt,
        discrepancy.assignedToOperatorId,
        discrepancy.resolutionReason,
        discrepancy.resolvedAt,
      ],
    )
  }

  async appendDiscrepancyHistory(
    history: DiscrepancyWorkflowHistoryRecord,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    await transaction.query(
      `
        INSERT INTO operational_discrepancy_history (
          discrepancy_history_id,
          discrepancy_id,
          action,
          operator_user_id,
          operator_role,
          reason,
          previous_status,
          new_status,
          metadata,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
      `,
      [
        history.discrepancyHistoryId,
        history.discrepancyId,
        history.action,
        history.operatorUserId,
        history.operatorRole,
        history.reason,
        history.previousStatus,
        history.newStatus,
        JSON.stringify(history.metadata),
        history.createdAt,
      ],
    )
  }
}
