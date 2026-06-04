CREATE TABLE IF NOT EXISTS provider_webhook_receipts (
  provider TEXT NOT NULL,
  nonce TEXT NOT NULL,
  provider_timestamp TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  request_hash TEXT NOT NULL,
  CONSTRAINT provider_webhook_receipts_provider_not_blank CHECK (btrim(provider) <> ''),
  CONSTRAINT provider_webhook_receipts_nonce_not_blank CHECK (btrim(nonce) <> ''),
  CONSTRAINT provider_webhook_receipts_request_hash_not_blank CHECK (btrim(request_hash) <> ''),
  CONSTRAINT provider_webhook_receipts_provider_nonce_uidx UNIQUE (provider, nonce)
);

CREATE INDEX IF NOT EXISTS provider_webhook_receipts_received_idx
  ON provider_webhook_receipts (received_at DESC);

CREATE INDEX IF NOT EXISTS provider_webhook_receipts_provider_timestamp_idx
  ON provider_webhook_receipts (provider, provider_timestamp DESC);

CREATE TABLE IF NOT EXISTS provider_webhook_rejections (
  provider TEXT NOT NULL,
  nonce TEXT NOT NULL,
  provider_timestamp TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  request_hash TEXT NOT NULL,
  rejected_reason TEXT NOT NULL,
  CONSTRAINT provider_webhook_rejections_provider_not_blank CHECK (btrim(provider) <> ''),
  CONSTRAINT provider_webhook_rejections_nonce_not_blank CHECK (btrim(nonce) <> ''),
  CONSTRAINT provider_webhook_rejections_request_hash_not_blank CHECK (btrim(request_hash) <> ''),
  CONSTRAINT provider_webhook_rejections_reason_not_blank CHECK (btrim(rejected_reason) <> '')
);

CREATE INDEX IF NOT EXISTS provider_webhook_rejections_received_idx
  ON provider_webhook_rejections (received_at DESC);

CREATE INDEX IF NOT EXISTS provider_webhook_rejections_reason_idx
  ON provider_webhook_rejections (rejected_reason, received_at DESC);
