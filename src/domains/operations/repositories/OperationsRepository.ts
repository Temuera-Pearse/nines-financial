import type {
  DatabaseTransaction,
  Queryable,
} from '../../../shared/db/Database.js'
import type { JsonObject } from '../../../shared/types/Json.js'
import type {
  Discrepancy,
  DiscrepancySeverity,
  DiscrepancyStatus,
} from '../entities/Discrepancy.js'

export interface DiscrepancyInput {
  dedupeKey: string
  category: string
  severity: DiscrepancySeverity
  entityType: string
  entityId: string
  relatedIds: JsonObject
  summary: string
  detailsPayload: JsonObject
  detectedAt: Date
}

export interface MaterializedDiscrepancyResult {
  discrepancy: Discrepancy
  outcome: 'opened' | 'reopened' | 'refreshed'
}

export interface DiscrepancyWorkflowHistoryRecord {
  discrepancyHistoryId: string
  discrepancyId: string
  action: string
  operatorUserId: string
  operatorRole: string
  reason: string | null
  previousStatus: DiscrepancyStatus
  newStatus: DiscrepancyStatus
  metadata: JsonObject
  createdAt: Date
}

export interface OperationsRepository {
  materializeDiscrepancy(
    issue: DiscrepancyInput,
    transaction: DatabaseTransaction,
  ): Promise<MaterializedDiscrepancyResult>
  listDiscrepancies(
    criteria: {
      status?: DiscrepancyStatus
      severity?: DiscrepancySeverity
      category?: string
    },
    queryable?: Queryable,
  ): Promise<Discrepancy[]>
  getDiscrepancyById(
    discrepancyId: string,
    queryable?: Queryable,
  ): Promise<Discrepancy | null>
  getDiscrepancyByIdForUpdate(
    discrepancyId: string,
    transaction: DatabaseTransaction,
  ): Promise<Discrepancy | null>
  updateDiscrepancy(
    discrepancy: Discrepancy,
    transaction: DatabaseTransaction,
  ): Promise<void>
  appendDiscrepancyHistory(
    history: DiscrepancyWorkflowHistoryRecord,
    transaction: DatabaseTransaction,
  ): Promise<void>
}
