import type { DatabaseTransaction, Queryable } from '../../../shared/db/Database.js'
import type { AuditEvent } from '../../../shared/audit/AuditEvent.js'

export interface AuditEventRepository {
  append(event: AuditEvent, transaction: DatabaseTransaction): Promise<void>
  listByEntity(entityType: string, entityId: string, queryable?: Queryable): Promise<AuditEvent[]>
}