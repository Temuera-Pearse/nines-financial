import type {
  Database,
  DatabaseTransaction,
  Queryable,
} from '../db/Database.js'
import type { OutboxEvent, OutboxRepository } from './OutboxRepository.js'

export class PostgresOutboxRepository implements OutboxRepository {
  constructor(private readonly database: Database) {}

  async appendIfAbsent(
    event: OutboxEvent,
    queryable?: Queryable | DatabaseTransaction,
  ): Promise<boolean> {
    const executor = queryable ?? this.database
    const result = await executor.query(
      `
        INSERT INTO outbox_events (
          outbox_event_id,
          aggregate_type,
          aggregate_id,
          event_type,
          payload,
          status,
          attempts,
          next_attempt_at,
          correlation_id,
          causation_id,
          created_at,
          published_at
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (outbox_event_id) DO NOTHING
      `,
      [
        event.outboxEventId,
        event.aggregateType,
        event.aggregateId,
        event.eventType,
        JSON.stringify(event.payload),
        event.status,
        event.attempts,
        event.nextAttemptAt,
        event.correlationId,
        event.causationId,
        event.createdAt,
        event.publishedAt,
      ],
    )

    return result.rowCount === 1
  }
}
