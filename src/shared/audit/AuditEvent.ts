import type { JsonObject } from '../types/Json.js'

export interface AuditEvent {
  auditEventId: string
  eventType: string
  entityType: string
  entityId: string
  correlationId: string
  causationId: string
  payload: JsonObject
  createdAt: Date
}