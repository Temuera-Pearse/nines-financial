CREATE TABLE IF NOT EXISTS withdrawal_provider_webhook_receipts (
  withdrawal_provider_webhook_receipt_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  nonce TEXT NOT NULL,
  provider_timestamp TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  request_hash TEXT NOT NULL,
  signature_version TEXT NOT NULL DEFAULT 'hmac-sha256-v1',
  external_withdrawal_id TEXT,
  external_transaction_id TEXT,
  withdrawal_request_id TEXT REFERENCES withdrawal_requests (withdrawal_request_id) ON DELETE RESTRICT,
  status TEXT NOT NULL,
  rejection_reason TEXT,
  CONSTRAINT withdrawal_provider_webhook_receipts_provider_not_blank CHECK (btrim(provider) <> ''),
  CONSTRAINT withdrawal_provider_webhook_receipts_nonce_not_blank CHECK (btrim(nonce) <> ''),
  CONSTRAINT withdrawal_provider_webhook_receipts_request_hash_not_blank CHECK (btrim(request_hash) <> ''),
  CONSTRAINT withdrawal_provider_webhook_receipts_signature_version_not_blank CHECK (btrim(signature_version) <> ''),
  CONSTRAINT withdrawal_provider_webhook_receipts_status_check CHECK (status IN ('accepted', 'rejected')),
  CONSTRAINT withdrawal_provider_webhook_receipts_rejection_reason_check CHECK (
    (status = 'rejected' AND rejection_reason IS NOT NULL AND btrim(rejection_reason) <> '')
    OR (status = 'accepted' AND rejection_reason IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_provider_webhook_receipts_provider_nonce_accepted_uidx
  ON withdrawal_provider_webhook_receipts (provider, nonce)
  WHERE status = 'accepted';

CREATE INDEX IF NOT EXISTS withdrawal_provider_webhook_receipts_received_idx
  ON withdrawal_provider_webhook_receipts (received_at DESC);

CREATE INDEX IF NOT EXISTS withdrawal_provider_webhook_receipts_rejection_idx
  ON withdrawal_provider_webhook_receipts (status, rejection_reason, received_at DESC);

CREATE TABLE IF NOT EXISTS withdrawal_provider_events (
  withdrawal_provider_event_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  external_withdrawal_id TEXT NOT NULL,
  external_transaction_id TEXT,
  withdrawal_request_id TEXT REFERENCES withdrawal_requests (withdrawal_request_id) ON DELETE RESTRICT,
  provider_status TEXT NOT NULL,
  status TEXT NOT NULL,
  review_reason_code TEXT,
  review_reason_text TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  webhook_receipt_id TEXT REFERENCES withdrawal_provider_webhook_receipts (withdrawal_provider_webhook_receipt_id) ON DELETE RESTRICT,
  received_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT withdrawal_provider_events_provider_not_blank CHECK (btrim(provider) <> ''),
  CONSTRAINT withdrawal_provider_events_external_withdrawal_not_blank CHECK (btrim(external_withdrawal_id) <> ''),
  CONSTRAINT withdrawal_provider_events_status_check CHECK (status IN ('applied', 'review_required', 'rejected')),
  CONSTRAINT withdrawal_provider_events_provider_status_check CHECK (
    provider_status IN ('accepted', 'pending', 'confirmed', 'failed', 'rejected', 'unknown')
  ),
  CONSTRAINT withdrawal_provider_events_review_reason_check CHECK (
    (status = 'review_required' AND review_reason_code IS NOT NULL AND btrim(review_reason_code) <> '')
    OR (status <> 'review_required')
  ),
  CONSTRAINT withdrawal_provider_events_updated_order CHECK (updated_at >= received_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_provider_events_webhook_receipt_uidx
  ON withdrawal_provider_events (webhook_receipt_id)
  WHERE webhook_receipt_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS withdrawal_provider_events_withdrawal_idx
  ON withdrawal_provider_events (withdrawal_request_id, received_at DESC);

CREATE INDEX IF NOT EXISTS withdrawal_provider_events_external_withdrawal_idx
  ON withdrawal_provider_events (provider, external_withdrawal_id, received_at DESC);

CREATE INDEX IF NOT EXISTS withdrawal_provider_events_review_idx
  ON withdrawal_provider_events (status, review_reason_code, received_at DESC);
