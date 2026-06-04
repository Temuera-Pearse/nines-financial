ALTER TABLE withdrawal_requests
  DROP CONSTRAINT IF EXISTS withdrawal_requests_status_check;

ALTER TABLE withdrawal_requests
  ADD CONSTRAINT withdrawal_requests_status_check CHECK (
    status IN (
      'requested',
      'reservation_pending',
      'reserved',
      'review_required',
      'approved',
      'rejected',
      'cancelled',
      'submission_pending',
      'submitting',
      'submitted',
      'provider_pending',
      'provider_confirmed',
      'provider_failed',
      'provider_rejected',
      'provider_unknown',
      'provider_failure_released',
      'provider_failed_terminal',
      'provider_rejected_terminal',
      'provider_unknown_reviewed',
      'failed',
      'completed'
    )
  );

ALTER TABLE withdrawal_requests
  DROP CONSTRAINT IF EXISTS withdrawal_requests_reserved_state_check;

ALTER TABLE withdrawal_requests
  ADD CONSTRAINT withdrawal_requests_reserved_state_check CHECK (
    (
      status IN (
        'reserved',
        'review_required',
        'approved',
        'submission_pending',
        'submitting',
        'submitted',
        'provider_pending',
        'provider_confirmed',
        'provider_failed',
        'provider_rejected',
        'provider_unknown',
        'provider_failure_released',
        'provider_failed_terminal',
        'provider_rejected_terminal',
        'provider_unknown_reviewed',
        'completed'
      )
      AND reservation_ledger_transaction_id IS NOT NULL
      AND reserved_at IS NOT NULL
    )
    OR status IN ('requested', 'reservation_pending', 'rejected', 'cancelled', 'failed')
  );

ALTER TABLE withdrawal_requests
  DROP CONSTRAINT IF EXISTS withdrawal_requests_review_reason_check;

ALTER TABLE withdrawal_requests
  ADD CONSTRAINT withdrawal_requests_review_reason_check CHECK (
    (
      status IN (
        'review_required',
        'rejected',
        'provider_failed',
        'provider_rejected',
        'provider_unknown',
        'provider_failure_released',
        'provider_failed_terminal',
        'provider_rejected_terminal',
        'provider_unknown_reviewed',
        'failed'
      )
      AND (
        review_reason_code IS NOT NULL
        OR failure_reason_code IS NOT NULL
      )
    )
    OR status NOT IN (
      'review_required',
      'rejected',
      'provider_failed',
      'provider_rejected',
      'provider_unknown',
      'provider_failure_released',
      'provider_failed_terminal',
      'provider_rejected_terminal',
      'provider_unknown_reviewed',
      'failed'
    )
  );

CREATE TABLE IF NOT EXISTS withdrawal_provider_submissions (
  withdrawal_request_id TEXT PRIMARY KEY REFERENCES withdrawal_requests (withdrawal_request_id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  external_withdrawal_id TEXT,
  external_transaction_id TEXT,
  provider_status TEXT NOT NULL CHECK (
    provider_status IN (
      'accepted',
      'pending',
      'confirmed',
      'failed',
      'rejected',
      'unknown'
    )
  ),
  submission_attempt_count INTEGER NOT NULL CHECK (submission_attempt_count > 0),
  last_submitted_at TIMESTAMPTZ NOT NULL,
  last_status_synced_at TIMESTAMPTZ,
  raw_provider_payload JSONB NOT NULL,
  provider_idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT withdrawal_provider_submissions_provider_not_blank CHECK (btrim(provider) <> ''),
  CONSTRAINT withdrawal_provider_submissions_idempotency_not_blank CHECK (btrim(provider_idempotency_key) <> ''),
  CONSTRAINT withdrawal_provider_submissions_updated_order CHECK (updated_at >= created_at),
  CONSTRAINT withdrawal_provider_submissions_external_reference_check CHECK (
    external_withdrawal_id IS NOT NULL
    OR external_transaction_id IS NOT NULL
    OR provider_status IN ('failed', 'rejected', 'unknown')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_provider_submissions_idempotency_uidx
  ON withdrawal_provider_submissions (provider_idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_provider_submissions_external_withdrawal_uidx
  ON withdrawal_provider_submissions (provider, external_withdrawal_id)
  WHERE external_withdrawal_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_provider_submissions_external_transaction_uidx
  ON withdrawal_provider_submissions (provider, external_transaction_id)
  WHERE external_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS withdrawal_provider_submissions_status_idx
  ON withdrawal_provider_submissions (provider_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS withdrawal_provider_submissions_last_sync_idx
  ON withdrawal_provider_submissions (last_status_synced_at, updated_at DESC);
