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
  WithdrawalProviderEvent,
  WithdrawalProviderEventStatus,
} from '../../entities/WithdrawalProviderEvent.js'
import type {
  WithdrawalProviderStatus,
  WithdrawalProviderSubmission,
} from '../../entities/WithdrawalProviderSubmission.js'
import type {
  WithdrawalRequest,
  WithdrawalRequestStatus,
} from '../../entities/WithdrawalRequest.js'
import type {
  WithdrawalProviderEventId,
  WithdrawalProviderWebhookReceiptId,
  WithdrawalRequestId,
} from '../../types/withdrawalIdentifiers.js'
import type {
  WithdrawalProviderWebhookReceipt,
  WithdrawalReconciliationIssue,
  WithdrawalRepository,
  WithdrawalReviewItem,
} from '../WithdrawalRepository.js'

interface WithdrawalRequestRow extends QueryResultRow {
  withdrawal_request_id: string
  player_id: string
  player_account_id: string
  currency: string
  amount_minor_units: string | number
  destination_kind: string
  destination_reference: string
  provider: string
  status: string
  idempotency_key: string
  correlation_id: string
  causation_id: string
  reservation_ledger_transaction_id: string | null
  release_ledger_transaction_id: string | null
  finalization_ledger_transaction_id: string | null
  review_reason_code: string | null
  review_reason_text: string | null
  failure_reason_code: string | null
  failure_reason_text: string | null
  created_at: Date | string
  updated_at: Date | string
  requested_at: Date | string
  reserved_at: Date | string | null
  approved_at: Date | string | null
  rejected_at: Date | string | null
  cancelled_at: Date | string | null
}

interface WithdrawalProviderSubmissionRow extends QueryResultRow {
  withdrawal_request_id: string
  provider: string
  external_withdrawal_id: string | null
  external_transaction_id: string | null
  provider_status: string
  submission_attempt_count: number
  last_submitted_at: Date | string
  last_status_synced_at: Date | string | null
  raw_provider_payload: unknown
  provider_idempotency_key: string
  created_at: Date | string
  updated_at: Date | string
}

interface WithdrawalProviderEventRow extends QueryResultRow {
  withdrawal_provider_event_id: string
  provider: string
  external_withdrawal_id: string
  external_transaction_id: string | null
  withdrawal_request_id: string | null
  provider_status: string
  status: string
  review_reason_code: string | null
  review_reason_text: string | null
  raw_payload: unknown
  webhook_receipt_id: string | null
  received_at: Date | string
  updated_at: Date | string
}

interface WithdrawalProviderWebhookReceiptRow extends QueryResultRow {
  withdrawal_provider_webhook_receipt_id: string
  provider: string
  nonce: string
  provider_timestamp: Date | string
  received_at: Date | string
  request_hash: string
  signature_version: string
  external_withdrawal_id: string | null
  external_transaction_id: string | null
  withdrawal_request_id: string | null
  status: string
  rejection_reason: string | null
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

function toWithdrawalRequest(row: WithdrawalRequestRow): WithdrawalRequest {
  return {
    withdrawalRequestId:
      row.withdrawal_request_id as WithdrawalRequestId,
    playerId: row.player_id as UserId,
    playerAccountId: row.player_account_id as PlayerAccountId,
    currency: row.currency,
    amountMinorUnits: String(row.amount_minor_units),
    destinationKind: row.destination_kind,
    destinationReference: row.destination_reference,
    provider: row.provider,
    status: row.status as WithdrawalRequestStatus,
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    reservationLedgerTransactionId:
      row.reservation_ledger_transaction_id as LedgerTransactionId | null,
    releaseLedgerTransactionId:
      row.release_ledger_transaction_id as LedgerTransactionId | null,
    finalizationLedgerTransactionId:
      row.finalization_ledger_transaction_id as LedgerTransactionId | null,
    reviewReasonCode: row.review_reason_code,
    reviewReasonText: row.review_reason_text,
    failureReasonCode: row.failure_reason_code,
    failureReasonText: row.failure_reason_text,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    requestedAt: toDate(row.requested_at),
    reservedAt: nullableDate(row.reserved_at),
    approvedAt: nullableDate(row.approved_at),
    rejectedAt: nullableDate(row.rejected_at),
    cancelledAt: nullableDate(row.cancelled_at),
  }
}

function toProviderSubmission(
  row: WithdrawalProviderSubmissionRow,
): WithdrawalProviderSubmission {
  return {
    withdrawalRequestId: row.withdrawal_request_id as WithdrawalRequestId,
    provider: row.provider,
    externalWithdrawalId: row.external_withdrawal_id,
    externalTransactionId: row.external_transaction_id,
    providerStatus: row.provider_status as WithdrawalProviderStatus,
    submissionAttemptCount: row.submission_attempt_count,
    lastSubmittedAt: toDate(row.last_submitted_at),
    lastStatusSyncedAt: nullableDate(row.last_status_synced_at),
    rawProviderPayload: toJsonObject(row.raw_provider_payload),
    providerIdempotencyKey: row.provider_idempotency_key,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  }
}

function toProviderEvent(row: WithdrawalProviderEventRow): WithdrawalProviderEvent {
  return {
    withdrawalProviderEventId:
      row.withdrawal_provider_event_id as WithdrawalProviderEventId,
    provider: row.provider,
    externalWithdrawalId: row.external_withdrawal_id,
    externalTransactionId: row.external_transaction_id,
    withdrawalRequestId:
      row.withdrawal_request_id as WithdrawalRequestId | null,
    providerStatus: row.provider_status as WithdrawalProviderStatus,
    status: row.status as WithdrawalProviderEventStatus,
    reviewReasonCode: row.review_reason_code,
    reviewReasonText: row.review_reason_text,
    rawPayload: toJsonObject(row.raw_payload),
    webhookReceiptId:
      row.webhook_receipt_id as WithdrawalProviderWebhookReceiptId | null,
    receivedAt: toDate(row.received_at),
    updatedAt: toDate(row.updated_at),
  }
}

export class PostgresWithdrawalRepository implements WithdrawalRepository {
  constructor(private readonly database: Database) {}

  async create(
    withdrawalRequest: WithdrawalRequest,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    await transaction.query(
      `
        INSERT INTO withdrawal_requests (
          withdrawal_request_id,
          player_id,
          player_account_id,
          currency,
          amount_minor_units,
          destination_kind,
          destination_reference,
          provider,
          status,
          idempotency_key,
          correlation_id,
          causation_id,
          reservation_ledger_transaction_id,
          release_ledger_transaction_id,
          finalization_ledger_transaction_id,
          review_reason_code,
          review_reason_text,
          failure_reason_code,
          failure_reason_text,
          created_at,
          updated_at,
          requested_at,
          reserved_at,
          approved_at,
          rejected_at,
          cancelled_at
        )
        VALUES ($1, $2, $3, $4, $5::NUMERIC(20, 0), $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
      `,
      [
        withdrawalRequest.withdrawalRequestId,
        withdrawalRequest.playerId,
        withdrawalRequest.playerAccountId,
        withdrawalRequest.currency,
        withdrawalRequest.amountMinorUnits,
        withdrawalRequest.destinationKind,
        withdrawalRequest.destinationReference,
        withdrawalRequest.provider,
        withdrawalRequest.status,
        withdrawalRequest.idempotencyKey,
        withdrawalRequest.correlationId,
        withdrawalRequest.causationId,
        withdrawalRequest.reservationLedgerTransactionId,
        withdrawalRequest.releaseLedgerTransactionId,
        withdrawalRequest.finalizationLedgerTransactionId,
        withdrawalRequest.reviewReasonCode,
        withdrawalRequest.reviewReasonText,
        withdrawalRequest.failureReasonCode,
        withdrawalRequest.failureReasonText,
        withdrawalRequest.createdAt,
        withdrawalRequest.updatedAt,
        withdrawalRequest.requestedAt,
        withdrawalRequest.reservedAt,
        withdrawalRequest.approvedAt,
        withdrawalRequest.rejectedAt,
        withdrawalRequest.cancelledAt,
      ],
    )
  }

  async update(
    withdrawalRequest: WithdrawalRequest,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    await transaction.query(
      `
        UPDATE withdrawal_requests
        SET status = $2,
            updated_at = $3,
            reservation_ledger_transaction_id = $4,
            release_ledger_transaction_id = $5,
            finalization_ledger_transaction_id = $6,
            review_reason_code = $7,
            review_reason_text = $8,
            failure_reason_code = $9,
            failure_reason_text = $10,
            reserved_at = $11,
            approved_at = $12,
            rejected_at = $13,
            cancelled_at = $14
        WHERE withdrawal_request_id = $1
      `,
      [
        withdrawalRequest.withdrawalRequestId,
        withdrawalRequest.status,
        withdrawalRequest.updatedAt,
        withdrawalRequest.reservationLedgerTransactionId,
        withdrawalRequest.releaseLedgerTransactionId,
        withdrawalRequest.finalizationLedgerTransactionId,
        withdrawalRequest.reviewReasonCode,
        withdrawalRequest.reviewReasonText,
        withdrawalRequest.failureReasonCode,
        withdrawalRequest.failureReasonText,
        withdrawalRequest.reservedAt,
        withdrawalRequest.approvedAt,
        withdrawalRequest.rejectedAt,
        withdrawalRequest.cancelledAt,
      ],
    )
  }

  async getById(
    withdrawalRequestId: WithdrawalRequestId,
    queryable?: Queryable,
  ): Promise<WithdrawalRequest | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<WithdrawalRequestRow>(
      'SELECT * FROM withdrawal_requests WHERE withdrawal_request_id = $1',
      [withdrawalRequestId],
    )

    return result.rows[0] ? toWithdrawalRequest(result.rows[0]) : null
  }

  async getByIdempotencyKey(
    idempotencyKey: string,
    queryable?: Queryable,
  ): Promise<WithdrawalRequest | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<WithdrawalRequestRow>(
      'SELECT * FROM withdrawal_requests WHERE idempotency_key = $1 LIMIT 1',
      [idempotencyKey],
    )

    return result.rows[0] ? toWithdrawalRequest(result.rows[0]) : null
  }

  async getByIdForUpdate(
    withdrawalRequestId: WithdrawalRequestId,
    transaction: DatabaseTransaction,
  ): Promise<WithdrawalRequest | null> {
    const result = await transaction.query<WithdrawalRequestRow>(
      `
        SELECT *
        FROM withdrawal_requests
        WHERE withdrawal_request_id = $1
        FOR UPDATE
      `,
      [withdrawalRequestId],
    )

    return result.rows[0] ? toWithdrawalRequest(result.rows[0]) : null
  }

  async createProviderSubmission(
    submission: WithdrawalProviderSubmission,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    await transaction.query(
      `
        INSERT INTO withdrawal_provider_submissions (
          withdrawal_request_id,
          provider,
          external_withdrawal_id,
          external_transaction_id,
          provider_status,
          submission_attempt_count,
          last_submitted_at,
          last_status_synced_at,
          raw_provider_payload,
          provider_idempotency_key,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
      `,
      [
        submission.withdrawalRequestId,
        submission.provider,
        submission.externalWithdrawalId,
        submission.externalTransactionId,
        submission.providerStatus,
        submission.submissionAttemptCount,
        submission.lastSubmittedAt,
        submission.lastStatusSyncedAt,
        JSON.stringify(submission.rawProviderPayload),
        submission.providerIdempotencyKey,
        submission.createdAt,
        submission.updatedAt,
      ],
    )
  }

  async updateProviderSubmission(
    submission: WithdrawalProviderSubmission,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    await transaction.query(
      `
        UPDATE withdrawal_provider_submissions
        SET provider_status = $2,
            external_withdrawal_id = $3,
            external_transaction_id = $4,
            submission_attempt_count = $5,
            last_submitted_at = $6,
            last_status_synced_at = $7,
            raw_provider_payload = $8::jsonb,
            updated_at = $9
        WHERE withdrawal_request_id = $1
      `,
      [
        submission.withdrawalRequestId,
        submission.providerStatus,
        submission.externalWithdrawalId,
        submission.externalTransactionId,
        submission.submissionAttemptCount,
        submission.lastSubmittedAt,
        submission.lastStatusSyncedAt,
        JSON.stringify(submission.rawProviderPayload),
        submission.updatedAt,
      ],
    )
  }

  async getProviderSubmissionByWithdrawalRequestId(
    withdrawalRequestId: WithdrawalRequestId,
    queryable?: Queryable,
  ): Promise<WithdrawalProviderSubmission | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<WithdrawalProviderSubmissionRow>(
      `
        SELECT *
        FROM withdrawal_provider_submissions
        WHERE withdrawal_request_id = $1
      `,
      [withdrawalRequestId],
    )

    return result.rows[0] ? toProviderSubmission(result.rows[0]) : null
  }

  async getProviderSubmissionByProviderIdempotencyKey(
    providerIdempotencyKey: string,
    queryable?: Queryable,
  ): Promise<WithdrawalProviderSubmission | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<WithdrawalProviderSubmissionRow>(
      `
        SELECT *
        FROM withdrawal_provider_submissions
        WHERE provider_idempotency_key = $1
      `,
      [providerIdempotencyKey],
    )

    return result.rows[0] ? toProviderSubmission(result.rows[0]) : null
  }

  async getProviderSubmissionByExternalWithdrawalId(
    provider: string,
    externalWithdrawalId: string,
    queryable?: Queryable,
  ): Promise<WithdrawalProviderSubmission | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<WithdrawalProviderSubmissionRow>(
      `
        SELECT *
        FROM withdrawal_provider_submissions
        WHERE provider = $1
          AND external_withdrawal_id = $2
        LIMIT 1
      `,
      [provider, externalWithdrawalId],
    )

    return result.rows[0] ? toProviderSubmission(result.rows[0]) : null
  }

  async getProviderSubmissionByExternalTransactionId(
    provider: string,
    externalTransactionId: string,
    queryable?: Queryable,
  ): Promise<WithdrawalProviderSubmission | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<WithdrawalProviderSubmissionRow>(
      `
        SELECT *
        FROM withdrawal_provider_submissions
        WHERE provider = $1
          AND external_transaction_id = $2
        LIMIT 1
      `,
      [provider, externalTransactionId],
    )

    return result.rows[0] ? toProviderSubmission(result.rows[0]) : null
  }

  async createWebhookReceipt(
    receipt: WithdrawalProviderWebhookReceipt,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    await transaction.query(
      `
        INSERT INTO withdrawal_provider_webhook_receipts (
          withdrawal_provider_webhook_receipt_id,
          provider,
          nonce,
          provider_timestamp,
          received_at,
          request_hash,
          signature_version,
          external_withdrawal_id,
          external_transaction_id,
          withdrawal_request_id,
          status,
          rejection_reason
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
      [
        receipt.withdrawalProviderWebhookReceiptId,
        receipt.provider,
        receipt.nonce,
        receipt.providerTimestamp,
        receipt.receivedAt,
        receipt.requestHash,
        receipt.signatureVersion,
        receipt.externalWithdrawalId,
        receipt.externalTransactionId,
        receipt.withdrawalRequestId,
        receipt.status,
        receipt.rejectionReason,
      ],
    )
  }

  async recordWebhookReplayRejection(
    receipt: WithdrawalProviderWebhookReceipt,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    await this.createWebhookReceipt(receipt, transaction)
  }

  async createProviderEvent(
    event: WithdrawalProviderEvent,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    await transaction.query(
      `
        INSERT INTO withdrawal_provider_events (
          withdrawal_provider_event_id,
          provider,
          external_withdrawal_id,
          external_transaction_id,
          withdrawal_request_id,
          provider_status,
          status,
          review_reason_code,
          review_reason_text,
          raw_payload,
          webhook_receipt_id,
          received_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13)
      `,
      [
        event.withdrawalProviderEventId,
        event.provider,
        event.externalWithdrawalId,
        event.externalTransactionId,
        event.withdrawalRequestId,
        event.providerStatus,
        event.status,
        event.reviewReasonCode,
        event.reviewReasonText,
        JSON.stringify(event.rawPayload),
        event.webhookReceiptId,
        event.receivedAt,
        event.updatedAt,
      ],
    )
  }

  async listReviewItems(queryable?: Queryable): Promise<WithdrawalReviewItem[]> {
    const executor = queryable ?? this.database
    const result = await executor.query<WithdrawalRequestRow>(
      `
        SELECT *
        FROM withdrawal_requests
        WHERE status = 'review_required'
        ORDER BY updated_at DESC, withdrawal_request_id ASC
      `,
    )

    return result.rows.map((row) => ({
      withdrawalRequestId: row.withdrawal_request_id,
      playerId: row.player_id,
      playerAccountId: row.player_account_id,
      currency: row.currency,
      amountMinorUnits: String(row.amount_minor_units),
      destinationKind: row.destination_kind,
      destinationReference: row.destination_reference,
      provider: row.provider,
      status: row.status,
      reasonCode: row.review_reason_code,
      reasonText: row.review_reason_text,
      updatedAt: toDate(row.updated_at),
    }))
  }

  async detectReconciliationIssues(
    asOf: Date,
    queryable?: Queryable,
  ): Promise<WithdrawalReconciliationIssue[]> {
    const executor = queryable ?? this.database
    const requestedWithoutReservation =
      await executor.query<WithdrawalRequestRow>(
        `
          SELECT *
          FROM withdrawal_requests
          WHERE status IN ('requested', 'reservation_pending')
            AND reservation_ledger_transaction_id IS NULL
        `,
      )
    const reservedMissingFinalStatus =
      await executor.query<WithdrawalRequestRow>(
        `
          SELECT *
          FROM withdrawal_requests
          WHERE reservation_ledger_transaction_id IS NOT NULL
            AND reserved_at IS NOT NULL
            AND status IN ('requested', 'reservation_pending')
        `,
      )
    const terminalUnreleased = await executor.query<WithdrawalRequestRow>(
      `
        SELECT *
        FROM withdrawal_requests
        WHERE status IN ('rejected', 'cancelled')
          AND reservation_ledger_transaction_id IS NOT NULL
          AND release_ledger_transaction_id IS NULL
      `,
    )
    const approvedAwaitingSubmission = await executor.query<WithdrawalRequestRow>(
      `
        SELECT wr.*
        FROM withdrawal_requests wr
        LEFT JOIN withdrawal_provider_submissions wps
          ON wps.withdrawal_request_id = wr.withdrawal_request_id
        WHERE wr.status IN ('approved', 'submission_pending')
          AND wps.withdrawal_request_id IS NULL
      `,
    )
    const submittingStuck = await executor.query<WithdrawalRequestRow>(
      `
        SELECT *
        FROM withdrawal_requests
        WHERE status = 'submitting'
          AND updated_at < $1
      `,
      [new Date(asOf.getTime() - 15 * 60 * 1000)],
    )
    const submittedMissingProviderReference =
      await executor.query<WithdrawalRequestRow>(
        `
          SELECT wr.*
          FROM withdrawal_requests wr
          LEFT JOIN withdrawal_provider_submissions wps
            ON wps.withdrawal_request_id = wr.withdrawal_request_id
          WHERE wr.status IN ('submitted', 'provider_pending')
            AND (
              wps.withdrawal_request_id IS NULL
              OR (
                wps.external_withdrawal_id IS NULL
                AND wps.external_transaction_id IS NULL
              )
            )
        `,
      )
    const providerPendingNotRecentlySynced =
      await executor.query<WithdrawalRequestRow>(
        `
          SELECT wr.*
          FROM withdrawal_requests wr
          JOIN withdrawal_provider_submissions wps
            ON wps.withdrawal_request_id = wr.withdrawal_request_id
          WHERE wr.status = 'provider_pending'
            AND (
              wps.last_status_synced_at IS NULL
              OR wps.last_status_synced_at < $1
            )
        `,
        [new Date(asOf.getTime() - 24 * 60 * 60 * 1000)],
      )
    const providerConfirmedNotFinalized =
      await executor.query<WithdrawalRequestRow>(
        `
          SELECT wr.*
          FROM withdrawal_requests wr
          LEFT JOIN ledger_transactions lt
            ON lt.transaction_id = wr.finalization_ledger_transaction_id
           AND lt.transaction_type = 'withdrawal_finalized'
          WHERE wr.status = 'provider_confirmed'
            OR (
              wr.status = 'completed'
              AND (
                wr.finalization_ledger_transaction_id IS NULL
                OR lt.transaction_id IS NULL
              )
            )
        `,
      )
    const providerFailureRequiresReview =
      await executor.query<WithdrawalRequestRow>(
        `
          SELECT *
          FROM withdrawal_requests
          WHERE status IN ('provider_failed', 'provider_rejected', 'provider_unknown')
        `,
      )
    const failureReleasedMissingLedger =
      await executor.query<WithdrawalRequestRow>(
        `
          SELECT wr.*
          FROM withdrawal_requests wr
          LEFT JOIN ledger_transactions lt
            ON lt.transaction_id = wr.release_ledger_transaction_id
           AND lt.transaction_type = 'withdrawal_provider_failure_release'
          WHERE wr.status = 'provider_failure_released'
            AND (
              wr.release_ledger_transaction_id IS NULL
              OR lt.transaction_id IS NULL
            )
        `,
      )
    const terminalProviderFailureHoldingReservation =
      await executor.query<WithdrawalRequestRow>(
        `
          SELECT *
          FROM withdrawal_requests
          WHERE status IN ('provider_failed_terminal', 'provider_rejected_terminal')
            AND reservation_ledger_transaction_id IS NOT NULL
            AND release_ledger_transaction_id IS NULL
            AND finalization_ledger_transaction_id IS NULL
        `,
      )
    const invalidCompletedReleasedState =
      await executor.query<WithdrawalRequestRow>(
        `
          SELECT *
          FROM withdrawal_requests
          WHERE status = 'completed'
            AND release_ledger_transaction_id IS NOT NULL
        `,
      )
    const duplicateFinalizations =
      await executor.query<
        QueryResultRow & {
          withdrawal_request_id: string
          duplicate_count: number
        }
      >(
        `
          SELECT reference_id AS withdrawal_request_id,
                 count(*)::int AS duplicate_count
          FROM ledger_transactions
          WHERE reference_type = 'withdrawal'
            AND transaction_type = 'withdrawal_finalized'
          GROUP BY reference_id
        `,
      )
    const duplicateExternalWithdrawalReferences =
      await executor.query<
        QueryResultRow & {
          provider: string
          reference_value: string
          duplicate_count: number
        }
      >(
        `
          SELECT provider,
                 external_withdrawal_id AS reference_value,
                 count(*)::int AS duplicate_count
          FROM withdrawal_provider_submissions
          WHERE external_withdrawal_id IS NOT NULL
          GROUP BY provider, external_withdrawal_id
        `,
      )
    const duplicateExternalTransactionReferences =
      await executor.query<
        QueryResultRow & {
          provider: string
          reference_value: string
          duplicate_count: number
        }
      >(
        `
          SELECT provider,
                 external_transaction_id AS reference_value,
                 count(*)::int AS duplicate_count
          FROM withdrawal_provider_submissions
          WHERE external_transaction_id IS NOT NULL
          GROUP BY provider, external_transaction_id
        `,
      )
    const duplicateProviderReferences = [
      ...duplicateExternalWithdrawalReferences.rows.map((row) => ({
        ...row,
        reference_kind: 'external_withdrawal_id',
      })),
      ...duplicateExternalTransactionReferences.rows.map((row) => ({
        ...row,
        reference_kind: 'external_transaction_id',
      })),
    ].filter((row) => Number(row.duplicate_count) > 1)
    const stuckReview = await executor.query<WithdrawalRequestRow>(
      `
        SELECT *
        FROM withdrawal_requests
        WHERE status = 'review_required'
          AND updated_at < $1
      `,
      [new Date(asOf.getTime() - 60 * 60 * 1000)],
    )
    const impossibleReleasedActive = await executor.query<WithdrawalRequestRow>(
      `
        SELECT *
        FROM withdrawal_requests
        WHERE release_ledger_transaction_id IS NOT NULL
          AND status NOT IN ('rejected', 'cancelled', 'provider_failure_released')
      `,
    )
    const acceptedReceiptsMissingEvents =
      await executor.query<WithdrawalProviderWebhookReceiptRow>(
        `
          SELECT r.*
          FROM withdrawal_provider_webhook_receipts r
          LEFT JOIN withdrawal_provider_events e
            ON e.webhook_receipt_id = r.withdrawal_provider_webhook_receipt_id
          WHERE r.status = 'accepted'
            AND e.withdrawal_provider_event_id IS NULL
        `,
      )
    const replayRejected =
      await executor.query<WithdrawalProviderWebhookReceiptRow>(
        `
          SELECT *
          FROM withdrawal_provider_webhook_receipts
          WHERE status = 'rejected'
            AND rejection_reason = 'duplicate_nonce'
        `,
      )
    const unmatchedProviderEvents =
      await executor.query<WithdrawalProviderEventRow>(
        `
          SELECT *
          FROM withdrawal_provider_events
          WHERE withdrawal_request_id IS NULL
             OR status = 'review_required'
        `,
      )
    const confirmedEventDrift = await executor.query<WithdrawalProviderEventRow>(
      `
        SELECT e.*
        FROM withdrawal_provider_events e
        JOIN withdrawal_requests wr
          ON wr.withdrawal_request_id = e.withdrawal_request_id
        WHERE e.provider_status = 'confirmed'
          AND e.status = 'applied'
          AND wr.status <> 'provider_confirmed'
      `,
    )
    const providerEventSubmissionMismatch =
      await executor.query<WithdrawalProviderEventRow>(
        `
          SELECT e.*
          FROM withdrawal_provider_events e
          JOIN withdrawal_provider_submissions wps
            ON wps.withdrawal_request_id = e.withdrawal_request_id
          WHERE e.status = 'review_required'
             OR e.provider <> wps.provider
             OR e.external_withdrawal_id <> wps.external_withdrawal_id
             OR (
               e.external_transaction_id IS NOT NULL
               AND wps.external_transaction_id IS NOT NULL
               AND e.external_transaction_id <> wps.external_transaction_id
             )
        `,
      )
    const terminalProviderCallbacks =
      await executor.query<WithdrawalProviderEventRow>(
        `
          SELECT e.*
          FROM withdrawal_provider_events e
          JOIN withdrawal_requests wr
            ON wr.withdrawal_request_id = e.withdrawal_request_id
          WHERE wr.status IN ('completed', 'cancelled', 'rejected')
        `,
      )

    return [
      ...requestedWithoutReservation.rows.map((row) => ({
        code: 'requested_without_reservation',
        severity: 'incident' as const,
        entityType: 'withdrawal_request' as const,
        entityId: row.withdrawal_request_id,
        details: {
          status: row.status,
          playerId: row.player_id,
          amountMinorUnits: String(row.amount_minor_units),
        },
      })),
      ...reservedMissingFinalStatus.rows.map((row) => ({
        code: 'reserved_missing_final_reserved_status',
        severity: 'incident' as const,
        entityType: 'withdrawal_request' as const,
        entityId: row.withdrawal_request_id,
        details: {
          status: row.status,
          reservationLedgerTransactionId:
            row.reservation_ledger_transaction_id,
        },
      })),
      ...terminalUnreleased.rows.map((row) => ({
        code:
          row.status === 'cancelled'
            ? 'cancelled_with_unreleased_reservation'
            : 'rejected_with_unreleased_reservation',
        severity: 'incident' as const,
        entityType: 'withdrawal_request' as const,
        entityId: row.withdrawal_request_id,
        details: {
          status: row.status,
          reservationLedgerTransactionId:
            row.reservation_ledger_transaction_id,
        },
      })),
      ...approvedAwaitingSubmission.rows.map((row) => ({
        code: 'approved_awaiting_provider_submission',
        severity: 'info' as const,
        entityType: 'withdrawal_request' as const,
        entityId: row.withdrawal_request_id,
        details: {
          status: row.status,
          provider: row.provider,
          amountMinorUnits: String(row.amount_minor_units),
        },
      })),
      ...submittingStuck.rows.map((row) => ({
        code: 'submitting_withdrawal_stuck',
        severity: 'warning' as const,
        entityType: 'withdrawal_request' as const,
        entityId: row.withdrawal_request_id,
        details: {
          status: row.status,
          provider: row.provider,
          updatedAt: row.updated_at,
        },
      })),
      ...submittedMissingProviderReference.rows.map((row) => ({
        code: 'submitted_missing_provider_reference',
        severity: 'incident' as const,
        entityType: 'withdrawal_request' as const,
        entityId: row.withdrawal_request_id,
        details: {
          status: row.status,
          provider: row.provider,
        },
      })),
      ...providerPendingNotRecentlySynced.rows.map((row) => ({
        code: 'provider_pending_not_recently_synced',
        severity: 'warning' as const,
        entityType: 'withdrawal_request' as const,
        entityId: row.withdrawal_request_id,
        details: {
          status: row.status,
          provider: row.provider,
        },
      })),
      ...providerConfirmedNotFinalized.rows.map((row) => ({
        code:
          row.status === 'completed'
            ? 'completed_missing_finalization_ledger'
            : 'provider_confirmed_not_finalized',
        severity:
          row.status === 'completed' ? ('incident' as const) : ('info' as const),
        entityType: 'withdrawal_request' as const,
        entityId: row.withdrawal_request_id,
        details: {
          status: row.status,
          provider: row.provider,
          finalizationLedgerTransactionId:
            row.finalization_ledger_transaction_id,
        },
      })),
      ...providerFailureRequiresReview.rows.map((row) => ({
        code:
          row.status === 'provider_unknown'
            ? 'provider_unknown_requires_review'
            : 'provider_failure_holding_reservation',
        severity: 'warning' as const,
        entityType: 'withdrawal_request' as const,
        entityId: row.withdrawal_request_id,
        details: {
          status: row.status,
          provider: row.provider,
          reviewReasonCode: row.review_reason_code,
          failureReasonCode: row.failure_reason_code,
        },
      })),
      ...failureReleasedMissingLedger.rows.map((row) => ({
        code: 'failure_released_missing_release_ledger',
        severity: 'incident' as const,
        entityType: 'withdrawal_request' as const,
        entityId: row.withdrawal_request_id,
        details: {
          status: row.status,
          releaseLedgerTransactionId: row.release_ledger_transaction_id,
        },
      })),
      ...terminalProviderFailureHoldingReservation.rows.map((row) => ({
        code: 'terminal_provider_failure_holding_reservation',
        severity: 'warning' as const,
        entityType: 'withdrawal_request' as const,
        entityId: row.withdrawal_request_id,
        details: {
          status: row.status,
          reservationLedgerTransactionId:
            row.reservation_ledger_transaction_id,
        },
      })),
      ...invalidCompletedReleasedState.rows.map((row) => ({
        code: 'invalid_completed_released_state',
        severity: 'incident' as const,
        entityType: 'withdrawal_request' as const,
        entityId: row.withdrawal_request_id,
        details: {
          status: row.status,
          releaseLedgerTransactionId: row.release_ledger_transaction_id,
          finalizationLedgerTransactionId:
            row.finalization_ledger_transaction_id,
        },
      })),
      ...duplicateFinalizations.rows
        .filter((row) => Number(row.duplicate_count) > 1)
        .map((row) => ({
          code: 'duplicate_withdrawal_finalization',
          severity: 'incident' as const,
          entityType: 'withdrawal_request' as const,
          entityId: row.withdrawal_request_id,
          details: {
            duplicateCount: row.duplicate_count,
          },
        })),
      ...duplicateProviderReferences.map((row) => ({
        code: 'duplicate_provider_reference',
        severity: 'incident' as const,
        entityType: 'withdrawal_request' as const,
        entityId: `${row.provider}:${row.reference_kind}:${row.reference_value}`,
        details: {
          provider: row.provider,
          referenceKind: row.reference_kind,
          referenceValue: row.reference_value,
          duplicateCount: row.duplicate_count,
        },
      })),
      ...stuckReview.rows.map((row) => ({
        code: 'stuck_review_required_withdrawal',
        severity: 'warning' as const,
        entityType: 'withdrawal_request' as const,
        entityId: row.withdrawal_request_id,
        details: {
          status: row.status,
          reviewReasonCode: row.review_reason_code,
          updatedAt: row.updated_at,
        },
      })),
      ...impossibleReleasedActive.rows.map((row) => ({
        code: 'impossible_released_nonterminal_withdrawal',
        severity: 'incident' as const,
        entityType: 'withdrawal_request' as const,
        entityId: row.withdrawal_request_id,
        details: {
          status: row.status,
          releaseLedgerTransactionId: row.release_ledger_transaction_id,
        },
      })),
      ...acceptedReceiptsMissingEvents.rows.map((row) => ({
        code: 'provider_webhook_receipt_missing_event',
        severity: 'incident' as const,
        entityType: 'withdrawal_provider_webhook_receipt' as const,
        entityId: row.withdrawal_provider_webhook_receipt_id,
        details: {
          provider: row.provider,
          nonce: row.nonce,
          externalWithdrawalId: row.external_withdrawal_id,
        },
      })),
      ...replayRejected.rows.map((row) => ({
        code: 'provider_webhook_replay_rejected',
        severity: 'warning' as const,
        entityType: 'withdrawal_provider_webhook_receipt' as const,
        entityId: row.withdrawal_provider_webhook_receipt_id,
        details: {
          provider: row.provider,
          nonce: row.nonce,
          receivedAt: row.received_at,
        },
      })),
      ...unmatchedProviderEvents.rows.map((row) => ({
        code:
          row.withdrawal_request_id === null
            ? 'unmatched_withdrawal_provider_event'
            : 'withdrawal_provider_event_requires_review',
        severity: 'warning' as const,
        entityType: 'withdrawal_provider_event' as const,
        entityId: row.withdrawal_provider_event_id,
        details: {
          provider: row.provider,
          externalWithdrawalId: row.external_withdrawal_id,
          providerStatus: row.provider_status,
          reviewReasonCode: row.review_reason_code,
        },
      })),
      ...confirmedEventDrift.rows.map((row) => ({
        code: 'provider_webhook_confirmed_status_drift',
        severity: 'incident' as const,
        entityType: 'withdrawal_provider_event' as const,
        entityId: row.withdrawal_provider_event_id,
        details: {
          provider: row.provider,
          externalWithdrawalId: row.external_withdrawal_id,
          withdrawalRequestId: row.withdrawal_request_id,
        },
      })),
      ...providerEventSubmissionMismatch.rows.map((row) => ({
        code: 'provider_event_submission_mismatch',
        severity: 'incident' as const,
        entityType: 'withdrawal_provider_event' as const,
        entityId: row.withdrawal_provider_event_id,
        details: {
          provider: row.provider,
          externalWithdrawalId: row.external_withdrawal_id,
          externalTransactionId: row.external_transaction_id,
          withdrawalRequestId: row.withdrawal_request_id,
          reviewReasonCode: row.review_reason_code,
        },
      })),
      ...terminalProviderCallbacks.rows.map((row) => ({
        code: 'provider_callback_for_terminal_withdrawal',
        severity: 'warning' as const,
        entityType: 'withdrawal_provider_event' as const,
        entityId: row.withdrawal_provider_event_id,
        details: {
          provider: row.provider,
          externalWithdrawalId: row.external_withdrawal_id,
          withdrawalRequestId: row.withdrawal_request_id,
          providerStatus: row.provider_status,
        },
      })),
    ].sort((left, right) => left.entityId.localeCompare(right.entityId))
  }
}
