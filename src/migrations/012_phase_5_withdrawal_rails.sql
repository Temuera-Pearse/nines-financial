CREATE TABLE IF NOT EXISTS withdrawal_requests (
  withdrawal_request_id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  player_account_id TEXT NOT NULL REFERENCES player_accounts (player_account_id) ON DELETE RESTRICT,
  currency TEXT NOT NULL CHECK (currency = 'USDC'),
  amount_minor_units NUMERIC(20, 0) NOT NULL CHECK (amount_minor_units > 0),
  destination_kind TEXT NOT NULL,
  destination_reference TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
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
  ),
  idempotency_key TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT NOT NULL,
  reservation_ledger_transaction_id TEXT REFERENCES ledger_transactions (transaction_id) ON DELETE RESTRICT,
  release_ledger_transaction_id TEXT REFERENCES ledger_transactions (transaction_id) ON DELETE RESTRICT,
  review_reason_code TEXT,
  review_reason_text TEXT,
  failure_reason_code TEXT,
  failure_reason_text TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL,
  reserved_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  CONSTRAINT withdrawal_requests_player_not_blank CHECK (btrim(player_id) <> ''),
  CONSTRAINT withdrawal_requests_destination_kind_not_blank CHECK (btrim(destination_kind) <> ''),
  CONSTRAINT withdrawal_requests_destination_reference_not_blank CHECK (btrim(destination_reference) <> ''),
  CONSTRAINT withdrawal_requests_provider_not_blank CHECK (btrim(provider) <> ''),
  CONSTRAINT withdrawal_requests_idempotency_not_blank CHECK (btrim(idempotency_key) <> ''),
  CONSTRAINT withdrawal_requests_timestamp_order CHECK (updated_at >= created_at),
  CONSTRAINT withdrawal_requests_reserved_state_check CHECK (
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
  ),
  CONSTRAINT withdrawal_requests_review_reason_check CHECK (
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
  ),
  CONSTRAINT withdrawal_requests_idempotency_uidx UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS withdrawal_requests_player_idx
  ON withdrawal_requests (player_id, created_at DESC);

CREATE INDEX IF NOT EXISTS withdrawal_requests_player_account_idx
  ON withdrawal_requests (player_account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS withdrawal_requests_status_idx
  ON withdrawal_requests (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS withdrawal_requests_currency_idx
  ON withdrawal_requests (currency, created_at DESC);

CREATE INDEX IF NOT EXISTS withdrawal_requests_provider_idx
  ON withdrawal_requests (provider, created_at DESC);

CREATE INDEX IF NOT EXISTS withdrawal_requests_review_idx
  ON withdrawal_requests (status, review_reason_code, updated_at DESC)
  WHERE status = 'review_required';

CREATE INDEX IF NOT EXISTS withdrawal_requests_reservation_idx
  ON withdrawal_requests (reservation_ledger_transaction_id)
  WHERE reservation_ledger_transaction_id IS NOT NULL;
