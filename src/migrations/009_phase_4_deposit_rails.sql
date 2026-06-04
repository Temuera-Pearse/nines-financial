CREATE TABLE IF NOT EXISTS deposit_intents (
  deposit_intent_id TEXT PRIMARY KEY,
  player_account_id TEXT NOT NULL REFERENCES player_accounts (player_account_id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency = 'USDC'),
  expected_amount_minor NUMERIC(20, 0) CHECK (
    expected_amount_minor IS NULL OR expected_amount_minor > 0
  ),
  provider TEXT NOT NULL,
  provider_kind TEXT NOT NULL,
  destination_reference TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'created',
      'awaiting_external_payment',
      'detected',
      'confirmed',
      'credited',
      'expired',
      'cancelled',
      'failed',
      'review_required'
    )
  ),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT NOT NULL,
  credited_ledger_transaction_id TEXT REFERENCES ledger_transactions (transaction_id) ON DELETE RESTRICT,
  review_reason_code TEXT,
  review_reason_text TEXT,
  CONSTRAINT deposit_intents_provider_not_blank CHECK (btrim(provider) <> ''),
  CONSTRAINT deposit_intents_provider_kind_not_blank CHECK (btrim(provider_kind) <> ''),
  CONSTRAINT deposit_intents_destination_not_blank CHECK (btrim(destination_reference) <> ''),
  CONSTRAINT deposit_intents_timestamp_order CHECK (updated_at >= created_at),
  CONSTRAINT deposit_intents_review_reason_check CHECK (
    (status = 'review_required' AND review_reason_code IS NOT NULL)
    OR (status <> 'review_required')
  ),
  CONSTRAINT deposit_intents_provider_destination_uidx UNIQUE (provider, destination_reference),
  CONSTRAINT deposit_intents_idempotency_uidx UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS deposit_intents_player_account_idx
  ON deposit_intents (player_account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS deposit_intents_user_idx
  ON deposit_intents (user_id, currency, created_at DESC);

CREATE INDEX IF NOT EXISTS deposit_intents_status_idx
  ON deposit_intents (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS deposit_intents_created_idx
  ON deposit_intents (created_at DESC);

CREATE INDEX IF NOT EXISTS deposit_intents_updated_idx
  ON deposit_intents (updated_at DESC);

CREATE INDEX IF NOT EXISTS deposit_intents_review_idx
  ON deposit_intents (status, review_reason_code, updated_at DESC)
  WHERE status = 'review_required';

CREATE INDEX IF NOT EXISTS deposit_intents_expiry_idx
  ON deposit_intents (expires_at, status)
  WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS provider_deposit_events (
  deposit_event_id TEXT PRIMARY KEY,
  provider_event_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_transaction_id TEXT NOT NULL,
  deposit_intent_id TEXT REFERENCES deposit_intents (deposit_intent_id) ON DELETE RESTRICT,
  destination_reference TEXT,
  amount_minor NUMERIC(20, 0) NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (char_length(currency) BETWEEN 3 AND 12 AND currency = upper(currency)),
  confirmation_count INTEGER CHECK (confirmation_count IS NULL OR confirmation_count >= 0),
  confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL CHECK (
    status IN (
      'received',
      'awaiting_confirmation',
      'credited',
      'duplicate',
      'review_required',
      'reviewed_no_credit',
      'rejected'
    )
  ),
  review_reason_code TEXT,
  review_reason_text TEXT,
  raw_payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  ledger_transaction_id TEXT REFERENCES ledger_transactions (transaction_id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT NOT NULL,
  CONSTRAINT provider_deposit_events_provider_not_blank CHECK (btrim(provider) <> ''),
  CONSTRAINT provider_deposit_events_provider_event_not_blank CHECK (btrim(provider_event_id) <> ''),
  CONSTRAINT provider_deposit_events_external_tx_not_blank CHECK (btrim(external_transaction_id) <> ''),
  CONSTRAINT provider_deposit_events_timestamp_order CHECK (updated_at >= received_at),
  CONSTRAINT provider_deposit_events_review_reason_check CHECK (
    (
      status IN ('review_required', 'reviewed_no_credit', 'rejected')
      AND review_reason_code IS NOT NULL
    )
    OR status NOT IN ('review_required', 'reviewed_no_credit', 'rejected')
  ),
  CONSTRAINT provider_deposit_events_credited_ledger_check CHECK (
    (status = 'credited' AND ledger_transaction_id IS NOT NULL)
    OR (status <> 'credited')
  ),
  CONSTRAINT provider_deposit_events_provider_event_uidx UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS provider_deposit_events_intent_idx
  ON provider_deposit_events (deposit_intent_id, received_at DESC);

CREATE INDEX IF NOT EXISTS provider_deposit_events_status_idx
  ON provider_deposit_events (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS provider_deposit_events_provider_external_idx
  ON provider_deposit_events (provider, external_transaction_id, received_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS provider_deposit_events_provider_external_credited_uidx
  ON provider_deposit_events (provider, external_transaction_id)
  WHERE status = 'credited';

CREATE INDEX IF NOT EXISTS provider_deposit_events_created_idx
  ON provider_deposit_events (received_at DESC);

CREATE INDEX IF NOT EXISTS provider_deposit_events_updated_idx
  ON provider_deposit_events (updated_at DESC);

CREATE INDEX IF NOT EXISTS provider_deposit_events_review_idx
  ON provider_deposit_events (status, review_reason_code, updated_at DESC)
  WHERE status = 'review_required';
