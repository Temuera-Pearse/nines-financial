ALTER TABLE race_pools
  DROP CONSTRAINT IF EXISTS race_pools_status_check;

ALTER TABLE race_pools
  DROP CONSTRAINT IF EXISTS race_pools_constraint_2;

ALTER TABLE race_pools
  DROP CONSTRAINT IF EXISTS race_pools_frozen_at_status_check;

ALTER TABLE race_pools
  ADD CONSTRAINT race_pools_status_check CHECK (
    status IN (
      'open',
      'frozen',
      'settlement_running',
      'settled',
      'voided',
      'manual_review'
    )
  );

ALTER TABLE race_pools
  ADD CONSTRAINT race_pools_frozen_at_status_check CHECK (
    (status = 'open' AND frozen_at IS NULL)
    OR (status <> 'open' AND frozen_at IS NOT NULL)
  );

ALTER TABLE ledger_transactions
  DROP CONSTRAINT IF EXISTS ledger_transactions_transaction_type_check;

ALTER TABLE ledger_transactions
  DROP CONSTRAINT IF EXISTS ledger_transactions_constraint_1;

ALTER TABLE ledger_transactions
  ADD CONSTRAINT ledger_transactions_transaction_type_check CHECK (
    transaction_type IN (
      'deposit_pending_credit',
      'deposit_confirmed_credit',
      'bet_reserve',
      'bet_release',
      'bet_capture',
      'settlement_payout',
      'settlement_house_take',
      'settlement_carryover',
      'withdrawal_reserve',
      'withdrawal_finalized',
      'withdrawal_provider_failure_release',
      'withdrawal_complete',
      'withdrawal_reversal',
      'manual_adjustment'
    )
  );

CREATE TABLE IF NOT EXISTS settlement_runs (
  settlement_run_id TEXT PRIMARY KEY,
  race_id TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency = 'USDC'),
  status TEXT NOT NULL CHECK (
    status IN (
      'pending',
      'running',
      'posting_required',
      'completed',
      'failed',
      'manual_review'
    )
  ),
  winning_selection_id TEXT NOT NULL,
  house_take_bps INTEGER NOT NULL CHECK (house_take_bps >= 0 AND house_take_bps <= 10000),
  idempotency_key TEXT NOT NULL,
  command_fingerprint TEXT NOT NULL,
  total_pool_minor NUMERIC(20, 0) NOT NULL DEFAULT 0 CHECK (total_pool_minor >= 0),
  house_take_minor NUMERIC(20, 0) NOT NULL DEFAULT 0 CHECK (house_take_minor >= 0),
  net_pool_minor NUMERIC(20, 0) NOT NULL DEFAULT 0 CHECK (net_pool_minor >= 0),
  rounding_residual_minor NUMERIC(20, 0) NOT NULL DEFAULT 0 CHECK (rounding_residual_minor >= 0),
  carryover_minor NUMERIC(20, 0) NOT NULL DEFAULT 0 CHECK (carryover_minor >= 0),
  reason_code TEXT,
  error_code TEXT,
  error_message TEXT,
  result_snapshot JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT settlement_runs_pool_fk
    FOREIGN KEY (race_id, currency)
    REFERENCES race_pools (race_id, currency)
    ON DELETE RESTRICT,
  CONSTRAINT settlement_runs_idempotency_uidx UNIQUE (idempotency_key),
  CONSTRAINT settlement_runs_timestamp_order CHECK (
    updated_at >= created_at
    AND (started_at IS NULL OR started_at >= created_at)
    AND (completed_at IS NULL OR completed_at >= created_at)
    AND (failed_at IS NULL OR failed_at >= created_at)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS settlement_runs_one_completed_per_race_uidx
  ON settlement_runs (race_id, currency)
  WHERE status = 'completed';

CREATE UNIQUE INDEX IF NOT EXISTS settlement_runs_one_active_per_race_uidx
  ON settlement_runs (race_id, currency)
  WHERE status IN ('pending', 'running', 'posting_required');

CREATE INDEX IF NOT EXISTS settlement_runs_race_idx
  ON settlement_runs (race_id, currency, created_at DESC);

ALTER TABLE financial_bets
  ADD COLUMN IF NOT EXISTS settlement_run_id TEXT REFERENCES settlement_runs (settlement_run_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS financial_bets_settlement_run_idx
  ON financial_bets (settlement_run_id)
  WHERE settlement_run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS settlement_carryovers (
  carryover_id TEXT PRIMARY KEY,
  settlement_run_id TEXT NOT NULL REFERENCES settlement_runs (settlement_run_id) ON DELETE RESTRICT,
  race_id TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency = 'USDC'),
  amount_minor NUMERIC(20, 0) NOT NULL CHECK (amount_minor >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'voided')),
  reason_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT settlement_carryovers_run_uidx UNIQUE (settlement_run_id),
  CONSTRAINT settlement_carryovers_pool_fk
    FOREIGN KEY (race_id, currency)
    REFERENCES race_pools (race_id, currency)
    ON DELETE RESTRICT,
  CONSTRAINT settlement_carryovers_reason_not_blank CHECK (btrim(reason_code) <> ''),
  CONSTRAINT settlement_carryovers_timestamp_order CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS settlement_carryovers_pending_idx
  ON settlement_carryovers (status, created_at ASC)
  WHERE status = 'pending';
