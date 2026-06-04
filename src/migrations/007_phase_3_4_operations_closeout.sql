CREATE TABLE IF NOT EXISTS settlement_reconciliation_runs (
  reconciliation_run_id TEXT PRIMARY KEY,
  race_id TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency = 'USDC'),
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  issue_count INTEGER NOT NULL CHECK (issue_count >= 0),
  error_count INTEGER NOT NULL CHECK (error_count >= 0),
  warning_count INTEGER NOT NULL CHECK (warning_count >= 0),
  issues_snapshot JSONB NOT NULL,
  requested_by_operator_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT settlement_reconciliation_runs_idempotency_uidx UNIQUE (idempotency_key),
  CONSTRAINT settlement_reconciliation_runs_operator_not_blank CHECK (
    btrim(requested_by_operator_id) <> ''
  ),
  CONSTRAINT settlement_reconciliation_runs_timestamp_order CHECK (
    completed_at >= created_at
  )
);

CREATE INDEX IF NOT EXISTS settlement_reconciliation_runs_race_idx
  ON settlement_reconciliation_runs (race_id, currency, completed_at DESC);
