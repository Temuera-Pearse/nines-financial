import type { DatabaseTransaction, Queryable } from '../db/Database.js'
import type { JsonObject } from '../types/Json.js'

export interface OutboxEvent {
  outboxEventId: string
  aggregateType: string
  aggregateId: string
  eventType: string
  payload: JsonObject
  status: 'pending'
  attempts: number
  nextAttemptAt: Date | null
  correlationId: string
  causationId: string
  createdAt: Date
  publishedAt: Date | null
}

export interface OutboxRepository {
  appendIfAbsent(
    event: OutboxEvent,
    queryable?: Queryable | DatabaseTransaction,
  ): Promise<boolean>
}
