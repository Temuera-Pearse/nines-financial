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
      'settlement_carryover_apply',
      'withdrawal_reserve',
      'withdrawal_finalized',
      'withdrawal_provider_failure_release',
      'withdrawal_complete',
      'withdrawal_reversal',
      'manual_adjustment'
    )
  );

ALTER TABLE settlement_carryovers
  ADD COLUMN IF NOT EXISTS applied_to_race_id TEXT;

ALTER TABLE settlement_carryovers
  ADD COLUMN IF NOT EXISTS application_id TEXT;

ALTER TABLE settlement_carryovers
  ADD COLUMN IF NOT EXISTS application_transaction_id TEXT REFERENCES ledger_transactions (transaction_id) ON DELETE RESTRICT;

ALTER TABLE settlement_carryovers
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;

ALTER TABLE settlement_carryovers
  ADD CONSTRAINT settlement_carryovers_application_shape CHECK (
    (
      status = 'pending'
      AND applied_to_race_id IS NULL
      AND application_id IS NULL
      AND application_transaction_id IS NULL
      AND applied_at IS NULL
    )
    OR (
      status = 'applied'
      AND applied_to_race_id IS NOT NULL
      AND application_id IS NOT NULL
      AND application_transaction_id IS NOT NULL
      AND applied_at IS NOT NULL
    )
    OR status = 'voided'
  );

ALTER TABLE settlement_carryovers
  ADD CONSTRAINT settlement_carryovers_applied_pool_fk
    FOREIGN KEY (applied_to_race_id, currency)
    REFERENCES race_pools (race_id, currency)
    ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS settlement_carryovers_applied_target_idx
  ON settlement_carryovers (applied_to_race_id, currency, applied_at)
  WHERE status = 'applied';

CREATE UNIQUE INDEX IF NOT EXISTS settlement_carryovers_application_tx_uidx
  ON settlement_carryovers (application_transaction_id)
  WHERE application_transaction_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS settlement_carryover_applications (
  application_id TEXT PRIMARY KEY,
  target_race_id TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency = 'USDC'),
  idempotency_key TEXT NOT NULL,
  command_fingerprint TEXT NOT NULL,
  total_amount_minor NUMERIC(20, 0) NOT NULL CHECK (total_amount_minor >= 0),
  applied_carryover_ids JSONB NOT NULL,
  result_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT settlement_carryover_applications_target_fk
    FOREIGN KEY (target_race_id, currency)
    REFERENCES race_pools (race_id, currency)
    ON DELETE RESTRICT,
  CONSTRAINT settlement_carryover_applications_idempotency_uidx UNIQUE (idempotency_key),
  CONSTRAINT settlement_carryover_applications_timestamp_order CHECK (completed_at >= created_at)
);

CREATE INDEX IF NOT EXISTS settlement_carryover_applications_target_idx
  ON settlement_carryover_applications (target_race_id, currency, completed_at DESC);

CREATE TABLE IF NOT EXISTS settlement_remediation_actions (
  remediation_action_id TEXT PRIMARY KEY,
  action_type TEXT NOT NULL CHECK (
    action_type IN (
      'mark_manual_review',
      'resolve_manual_review',
      'void_pool_from_manual_review'
    )
  ),
  race_id TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency = 'USDC'),
  idempotency_key TEXT NOT NULL,
  command_fingerprint TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reason_text TEXT,
  result_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT settlement_remediation_actions_pool_fk
    FOREIGN KEY (race_id, currency)
    REFERENCES race_pools (race_id, currency)
    ON DELETE RESTRICT,
  CONSTRAINT settlement_remediation_actions_idempotency_uidx UNIQUE (idempotency_key),
  CONSTRAINT settlement_remediation_actions_not_blank CHECK (
    btrim(operator_id) <> ''
    AND btrim(reason_code) <> ''
    AND (reason_text IS NULL OR btrim(reason_text) <> '')
  )
);

CREATE INDEX IF NOT EXISTS settlement_remediation_actions_race_idx
  ON settlement_remediation_actions (race_id, currency, created_at DESC);
