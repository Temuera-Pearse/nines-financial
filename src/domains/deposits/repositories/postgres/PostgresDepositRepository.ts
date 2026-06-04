import type {
  Database,
  DatabaseTransaction,
  QueryResultRow,
  Queryable,
} from '../../../../shared/db/Database.js'
import { isJsonValue, type JsonObject } from '../../../../shared/types/Json.js'
import type { LedgerTransactionId } from '../../../accounting/types/identifiers.js'
import type { PlayerAccountId, UserId } from '../../../account/types/identifiers.js'
import type {
  DepositIntent,
  DepositIntentStatus,
} from '../../entities/DepositIntent.js'
import type {
  ProviderDepositEvent,
  ProviderDepositEventStatus,
} from '../../entities/ProviderDepositEvent.js'
import type {
  DepositEventId,
  DepositIntentId,
} from '../../types/depositIdentifiers.js'
import type {
  DepositReconciliationIssue,
  DepositRepository,
  DepositReviewItem,
  ProviderWebhookReceipt,
} from '../DepositRepository.js'

interface DepositIntentRow extends QueryResultRow {
  deposit_intent_id: string
  player_account_id: string
  user_id: string
  currency: string
  expected_amount_minor: string | number | null
  provider: string
  provider_kind: string
  destination_reference: string
  status: string
  created_at: Date | string
  updated_at: Date | string
  expires_at: Date | string | null
  idempotency_key: string
  correlation_id: string
  causation_id: string
  credited_ledger_transaction_id: string | null
  review_reason_code: string | null
  review_reason_text: string | null
}

interface ProviderDepositEventRow extends QueryResultRow {
  deposit_event_id: string
  provider_event_id: string
  provider: string
  external_transaction_id: string
  deposit_intent_id: string | null
  destination_reference: string | null
  amount_minor: string | number
  currency: string
  confirmation_count: number | null
  confirmed: boolean
  status: string
  review_reason_code: string | null
  review_reason_text: string | null
  raw_payload: unknown
  received_at: Date | string
  updated_at: Date | string
  ledger_transaction_id: string | null
  idempotency_key: string
  correlation_id: string
  causation_id: string
}

interface ReviewRow extends QueryResultRow {
  item_type: 'deposit_intent' | 'provider_deposit_event'
  item_id: string
  status: string
  reason_code: string | null
  reason_text: string | null
  provider: string
  external_transaction_id: string | null
  deposit_intent_id: string | null
  amount_minor: string | number | null
  currency: string
  updated_at: Date | string
}

interface ProviderWebhookReceiptRow extends QueryResultRow {
  provider: string
  nonce: string
  provider_timestamp: Date | string
  received_at: Date | string
  request_hash: string
  rejected_reason: string
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value) : new Date(value)
}

function nullableDate(value: Date | string | null): Date | null {
  return value ? toDate(value) : null
}

function toJsonObject(value: unknown): JsonObject {
  if (typeof value === 'string') {
    const parsed = JSON.parse(value) as unknown
    return toJsonObject(parsed)
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

function toIntent(row: DepositIntentRow): DepositIntent {
  return {
    depositIntentId: row.deposit_intent_id as DepositIntentId,
    playerAccountId: row.player_account_id as PlayerAccountId,
    userId: row.user_id as UserId,
    currency: row.currency,
    expectedAmountMinor:
      row.expected_amount_minor === null
        ? null
        : String(row.expected_amount_minor),
    provider: row.provider,
    providerKind: row.provider_kind,
    destinationReference: row.destination_reference,
    status: row.status as DepositIntentStatus,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    expiresAt: nullableDate(row.expires_at),
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    creditedLedgerTransactionId:
      row.credited_ledger_transaction_id as LedgerTransactionId | null,
    reviewReasonCode: row.review_reason_code,
    reviewReasonText: row.review_reason_text,
  }
}

function toEvent(row: ProviderDepositEventRow): ProviderDepositEvent {
  return {
    depositEventId: row.deposit_event_id as DepositEventId,
    providerEventId: row.provider_event_id,
    provider: row.provider,
    externalTransactionId: row.external_transaction_id,
    depositIntentId: row.deposit_intent_id as DepositIntentId | null,
    destinationReference: row.destination_reference,
    amountMinor: String(row.amount_minor),
    currency: row.currency,
    confirmationCount: row.confirmation_count,
    confirmed: row.confirmed,
    status: row.status as ProviderDepositEventStatus,
    reviewReasonCode: row.review_reason_code,
    reviewReasonText: row.review_reason_text,
    rawPayload: toJsonObject(row.raw_payload),
    receivedAt: toDate(row.received_at),
    updatedAt: toDate(row.updated_at),
    ledgerTransactionId: row.ledger_transaction_id as LedgerTransactionId | null,
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
  }
}

export class PostgresDepositRepository implements DepositRepository {
  constructor(private readonly database: Database) {}

  async createIntent(
    intent: DepositIntent,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    await transaction.query(
      `
        INSERT INTO deposit_intents (
          deposit_intent_id,
          player_account_id,
          user_id,
          currency,
          expected_amount_minor,
          provider,
          provider_kind,
          destination_reference,
          status,
          created_at,
          updated_at,
          expires_at,
          idempotency_key,
          correlation_id,
          causation_id,
          credited_ledger_transaction_id,
          review_reason_code,
          review_reason_text
        )
        VALUES ($1, $2, $3, $4, $5::NUMERIC(20, 0), $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      `,
      [
        intent.depositIntentId,
        intent.playerAccountId,
        intent.userId,
        intent.currency,
        intent.expectedAmountMinor,
        intent.provider,
        intent.providerKind,
        intent.destinationReference,
        intent.status,
        intent.createdAt,
        intent.updatedAt,
        intent.expiresAt,
        intent.idempotencyKey,
        intent.correlationId,
        intent.causationId,
        intent.creditedLedgerTransactionId,
        intent.reviewReasonCode,
        intent.reviewReasonText,
      ],
    )
  }

  async updateIntent(
    intent: DepositIntent,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    await transaction.query(
      `
        UPDATE deposit_intents
        SET status = $2,
            updated_at = $3,
            credited_ledger_transaction_id = $4,
            review_reason_code = $5,
            review_reason_text = $6
        WHERE deposit_intent_id = $1
      `,
      [
        intent.depositIntentId,
        intent.status,
        intent.updatedAt,
        intent.creditedLedgerTransactionId,
        intent.reviewReasonCode,
        intent.reviewReasonText,
      ],
    )
  }

  async getIntentById(
    depositIntentId: DepositIntentId,
    queryable?: Queryable,
  ): Promise<DepositIntent | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<DepositIntentRow>(
      'SELECT * FROM deposit_intents WHERE deposit_intent_id = $1',
      [depositIntentId],
    )

    return result.rows[0] ? toIntent(result.rows[0]) : null
  }

  async findIntentByDestination(
    provider: string,
    destinationReference: string,
    queryable?: Queryable,
  ): Promise<DepositIntent | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<DepositIntentRow>(
      `
        SELECT *
        FROM deposit_intents
        WHERE provider = $1
          AND destination_reference = $2
        LIMIT 1
      `,
      [provider, destinationReference],
    )

    return result.rows[0] ? toIntent(result.rows[0]) : null
  }

  async createEvent(
    event: ProviderDepositEvent,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    await transaction.query(
      `
        INSERT INTO provider_deposit_events (
          deposit_event_id,
          provider_event_id,
          provider,
          external_transaction_id,
          deposit_intent_id,
          destination_reference,
          amount_minor,
          currency,
          confirmation_count,
          confirmed,
          status,
          review_reason_code,
          review_reason_text,
          raw_payload,
          received_at,
          updated_at,
          ledger_transaction_id,
          idempotency_key,
          correlation_id,
          causation_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::NUMERIC(20, 0), $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17, $18, $19, $20)
      `,
      [
        event.depositEventId,
        event.providerEventId,
        event.provider,
        event.externalTransactionId,
        event.depositIntentId,
        event.destinationReference,
        event.amountMinor,
        event.currency,
        event.confirmationCount,
        event.confirmed,
        event.status,
        event.reviewReasonCode,
        event.reviewReasonText,
        JSON.stringify(event.rawPayload),
        event.receivedAt,
        event.updatedAt,
        event.ledgerTransactionId,
        event.idempotencyKey,
        event.correlationId,
        event.causationId,
      ],
    )
  }

  async updateEvent(
    event: ProviderDepositEvent,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    await transaction.query(
      `
        UPDATE provider_deposit_events
        SET deposit_intent_id = $2,
            status = $3,
            review_reason_code = $4,
            review_reason_text = $5,
            updated_at = $6,
            ledger_transaction_id = $7,
            confirmation_count = $8,
            confirmed = $9,
            destination_reference = $10
        WHERE deposit_event_id = $1
      `,
      [
        event.depositEventId,
        event.depositIntentId,
        event.status,
        event.reviewReasonCode,
        event.reviewReasonText,
        event.updatedAt,
        event.ledgerTransactionId,
        event.confirmationCount,
        event.confirmed,
        event.destinationReference,
      ],
    )
  }

  async getEventById(
    depositEventId: DepositEventId,
    queryable?: Queryable,
  ): Promise<ProviderDepositEvent | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<ProviderDepositEventRow>(
      'SELECT * FROM provider_deposit_events WHERE deposit_event_id = $1',
      [depositEventId],
    )

    return result.rows[0] ? toEvent(result.rows[0]) : null
  }

  async getEventByProviderEventId(
    provider: string,
    providerEventId: string,
    queryable?: Queryable,
  ): Promise<ProviderDepositEvent | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<ProviderDepositEventRow>(
      `
        SELECT *
        FROM provider_deposit_events
        WHERE provider = $1
          AND provider_event_id = $2
        LIMIT 1
      `,
      [provider, providerEventId],
    )

    return result.rows[0] ? toEvent(result.rows[0]) : null
  }

  async getCreditedEventByExternalTransactionId(
    provider: string,
    externalTransactionId: string,
    queryable?: Queryable,
  ): Promise<ProviderDepositEvent | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<ProviderDepositEventRow>(
      `
        SELECT *
        FROM provider_deposit_events
        WHERE provider = $1
          AND external_transaction_id = $2
          AND status = 'credited'
        LIMIT 1
      `,
      [provider, externalTransactionId],
    )

    return result.rows[0] ? toEvent(result.rows[0]) : null
  }

  async createWebhookReceipt(
    receipt: ProviderWebhookReceipt,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    await transaction.query(
      `
        INSERT INTO provider_webhook_receipts (
          provider,
          nonce,
          provider_timestamp,
          received_at,
          request_hash
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        receipt.provider,
        receipt.nonce,
        receipt.providerTimestamp,
        receipt.receivedAt,
        receipt.requestHash,
      ],
    )
  }

  async recordWebhookReplayRejection(
    receipt: ProviderWebhookReceipt & { rejectedReason: string },
    transaction: DatabaseTransaction,
  ): Promise<void> {
    await transaction.query(
      `
        INSERT INTO provider_webhook_rejections (
          provider,
          nonce,
          provider_timestamp,
          received_at,
          request_hash,
          rejected_reason
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        receipt.provider,
        receipt.nonce,
        receipt.providerTimestamp,
        receipt.receivedAt,
        receipt.requestHash,
        receipt.rejectedReason,
      ],
    )
  }

  async listReviewItems(queryable?: Queryable): Promise<DepositReviewItem[]> {
    const executor = queryable ?? this.database
    const result = await executor.query<ReviewRow>(
      `
        SELECT
          'deposit_intent' AS item_type,
          deposit_intent_id AS item_id,
          status,
          review_reason_code AS reason_code,
          review_reason_text AS reason_text,
          provider,
          NULL::TEXT AS external_transaction_id,
          deposit_intent_id,
          expected_amount_minor AS amount_minor,
          currency,
          updated_at
        FROM deposit_intents
        WHERE status = 'review_required'
        UNION ALL
        SELECT
          'provider_deposit_event' AS item_type,
          deposit_event_id AS item_id,
          status,
          review_reason_code AS reason_code,
          review_reason_text AS reason_text,
          provider,
          external_transaction_id,
          deposit_intent_id,
          amount_minor,
          currency,
          updated_at
        FROM provider_deposit_events
        WHERE status = 'review_required'
        ORDER BY updated_at DESC, item_id ASC
      `,
    )

    return result.rows.map((row) => ({
      itemType: row.item_type,
      itemId: row.item_id,
      status: row.status,
      reasonCode: row.reason_code,
      reasonText: row.reason_text,
      provider: row.provider,
      externalTransactionId: row.external_transaction_id,
      depositIntentId: row.deposit_intent_id,
      amountMinor: row.amount_minor === null ? null : String(row.amount_minor),
      currency: row.currency,
      updatedAt: toDate(row.updated_at),
    }))
  }

  async detectReconciliationIssues(
    asOf: Date,
    queryable?: Queryable,
  ): Promise<DepositReconciliationIssue[]> {
    const executor = queryable ?? this.database
    const expiredIntents = await executor.query<DepositIntentRow>(
      `
        SELECT *
        FROM deposit_intents
        WHERE expires_at IS NOT NULL
          AND expires_at < $1
          AND status IN ('created', 'awaiting_external_payment', 'detected')
      `,
      [asOf],
    )
    const confirmedUncredited = await executor.query<ProviderDepositEventRow>(
      `
        SELECT *
        FROM provider_deposit_events
        WHERE confirmed = TRUE
          AND status NOT IN ('credited', 'duplicate', 'review_required')
      `,
    )
    const eventMissingLedger = await executor.query<ProviderDepositEventRow>(
      `
        SELECT e.*
        FROM provider_deposit_events e
        LEFT JOIN ledger_transactions lt
          ON lt.transaction_id = e.ledger_transaction_id
        WHERE e.status = 'credited'
          AND lt.transaction_id IS NULL
      `,
    )
    const intentMissingLedger = await executor.query<DepositIntentRow>(
      `
        SELECT i.*
        FROM deposit_intents i
        LEFT JOIN ledger_transactions lt
          ON lt.transaction_id = i.credited_ledger_transaction_id
        WHERE i.status = 'credited'
          AND lt.transaction_id IS NULL
      `,
    )
    const confirmedReview = await executor.query<ProviderDepositEventRow>(
      `
        SELECT *
        FROM provider_deposit_events
        WHERE confirmed = TRUE
          AND status = 'review_required'
      `,
    )
    const terminalNoCredit = await executor.query<ProviderDepositEventRow>(
      `
        SELECT *
        FROM provider_deposit_events
        WHERE status IN ('reviewed_no_credit', 'rejected')
      `,
    )
    const duplicateExternalAttempts = await executor.query<ProviderDepositEventRow>(
      `
        SELECT *
        FROM provider_deposit_events
        WHERE status IN ('duplicate', 'review_required')
          AND review_reason_code = 'DUPLICATE_EXTERNAL_TRANSACTION'
      `,
    )
    const expiredIntentLateEvents = await executor.query<ProviderDepositEventRow>(
      `
        SELECT e.*
        FROM provider_deposit_events e
        JOIN deposit_intents i
          ON i.deposit_intent_id = e.deposit_intent_id
        WHERE i.expires_at IS NOT NULL
          AND e.received_at > i.expires_at
          AND e.status <> 'credited'
      `,
    )
    const ledgerAttachedButNotCredited = await executor.query<ProviderDepositEventRow>(
      `
        SELECT *
        FROM provider_deposit_events
        WHERE ledger_transaction_id IS NOT NULL
          AND status <> 'credited'
      `,
    )
    const ledgerPostedIntentNotFinalized = await executor.query<ProviderDepositEventRow>(
      `
        SELECT e.*
        FROM provider_deposit_events e
        JOIN ledger_transactions lt
          ON lt.reference_type = 'deposit'
         AND lt.reference_id = e.deposit_intent_id
         AND lt.transaction_type = 'deposit_confirmed_credit'
        WHERE e.status <> 'credited'
      `,
    )
    const replayRejected = await executor.query<ProviderWebhookReceiptRow>(
      `
        SELECT provider, nonce, provider_timestamp, received_at, request_hash, rejected_reason
        FROM provider_webhook_rejections
        WHERE rejected_reason = 'duplicate_nonce'
      `,
    )

    return [
      ...expiredIntents.rows.map((row) => ({
        code: 'DEPOSIT_INTENT_EXPIRED_WITHOUT_PAYMENT',
        severity: 'warning' as const,
        entityType: 'deposit_intent' as const,
        entityId: row.deposit_intent_id,
        details: {
          status: row.status,
          expiresAt: row.expires_at,
          provider: row.provider,
          destinationReference: row.destination_reference,
        },
      })),
      ...confirmedUncredited.rows.map((row) => ({
        code: 'confirmed_uncredited',
        severity: 'incident' as const,
        entityType: 'provider_deposit_event' as const,
        entityId: row.deposit_event_id,
        details: {
          provider: row.provider,
          externalTransactionId: row.external_transaction_id,
          status: row.status,
          depositIntentId: row.deposit_intent_id,
        },
      })),
      ...eventMissingLedger.rows.map((row) => ({
        code: 'CREDITED_PROVIDER_EVENT_MISSING_LEDGER',
        severity: 'incident' as const,
        entityType: 'provider_deposit_event' as const,
        entityId: row.deposit_event_id,
        details: {
          provider: row.provider,
          externalTransactionId: row.external_transaction_id,
          ledgerTransactionId: row.ledger_transaction_id,
        },
      })),
      ...intentMissingLedger.rows.map((row) => ({
        code: 'CREDITED_DEPOSIT_INTENT_MISSING_LEDGER',
        severity: 'incident' as const,
        entityType: 'deposit_intent' as const,
        entityId: row.deposit_intent_id,
        details: {
          provider: row.provider,
          ledgerTransactionId: row.credited_ledger_transaction_id,
        },
      })),
      ...confirmedReview.rows.map((row) => ({
        code: 'actionable_review_required',
        severity: 'warning' as const,
        entityType: 'provider_deposit_event' as const,
        entityId: row.deposit_event_id,
        details: {
          provider: row.provider,
          externalTransactionId: row.external_transaction_id,
          reasonCode: row.review_reason_code,
          depositIntentId: row.deposit_intent_id,
        },
      })),
      ...terminalNoCredit.rows.map((row) => ({
        code:
          row.status === 'rejected'
            ? 'rejected_terminal'
            : 'reviewed_no_credit_terminal',
        severity: 'info' as const,
        entityType: 'provider_deposit_event' as const,
        entityId: row.deposit_event_id,
        details: {
          provider: row.provider,
          externalTransactionId: row.external_transaction_id,
          status: row.status,
          reasonCode: row.review_reason_code,
        },
      })),
      ...duplicateExternalAttempts.rows.map((row) => ({
        code: 'duplicate_external_transaction',
        severity: 'warning' as const,
        entityType: 'provider_deposit_event' as const,
        entityId: row.deposit_event_id,
        details: {
          provider: row.provider,
          externalTransactionId: row.external_transaction_id,
          status: row.status,
          depositIntentId: row.deposit_intent_id,
        },
      })),
      ...expiredIntentLateEvents.rows.map((row) => ({
        code: 'late_event_for_expired_intent',
        severity: 'warning' as const,
        entityType: 'provider_deposit_event' as const,
        entityId: row.deposit_event_id,
        details: {
          provider: row.provider,
          externalTransactionId: row.external_transaction_id,
          status: row.status,
          depositIntentId: row.deposit_intent_id,
        },
      })),
      ...ledgerAttachedButNotCredited.rows.map((row) => ({
        code: 'PROVIDER_EVENT_LEDGER_ATTACHED_NOT_CREDITED',
        severity: 'incident' as const,
        entityType: 'provider_deposit_event' as const,
        entityId: row.deposit_event_id,
        details: {
          provider: row.provider,
          externalTransactionId: row.external_transaction_id,
          status: row.status,
          ledgerTransactionId: row.ledger_transaction_id,
        },
      })),
      ...ledgerPostedIntentNotFinalized.rows.map((row) => ({
        code: 'credited_not_finalized',
        severity: 'incident' as const,
        entityType: 'provider_deposit_event' as const,
        entityId: row.deposit_event_id,
        details: {
          provider: row.provider,
          externalTransactionId: row.external_transaction_id,
          status: row.status,
          depositIntentId: row.deposit_intent_id,
        },
      })),
      ...replayRejected.rows.map((row) => ({
        code: 'replay_rejected',
        severity: 'warning' as const,
        entityType: 'provider_deposit_event' as const,
        entityId: `${row.provider}:${row.nonce}`,
        details: {
          provider: row.provider,
          nonce: row.nonce,
          providerTimestamp: row.provider_timestamp,
          receivedAt: row.received_at,
          requestHash: row.request_hash,
        },
      })),
    ].sort((left, right) =>
      `${left.entityType}:${left.entityId}`.localeCompare(
        `${right.entityType}:${right.entityId}`,
      ),
    )
  }
}
