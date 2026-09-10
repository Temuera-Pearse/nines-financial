ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_account_type_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_account_type_check CHECK (
  account_type IN (
    'user_available', 'user_locked', 'user_withdrawal_reserved',
    'deposit_clearing', 'token_purchase_clearing', 'treasury_cash',
    'house_take_revenue', 'house_rounding_residual', 'race_selection_pool',
    'settlement_clearing', 'withdrawal_clearing', 'adjustment_reserve'
  )
);

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_class_normal_balance_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_class_normal_balance_check CHECK (
  (account_type IN ('deposit_clearing', 'token_purchase_clearing', 'treasury_cash')
    AND account_class = 'asset' AND normal_balance = 'debit') OR
  (account_type IN ('user_available', 'user_locked', 'user_withdrawal_reserved',
    'race_selection_pool', 'settlement_clearing', 'withdrawal_clearing')
    AND account_class = 'liability' AND normal_balance = 'credit') OR
  (account_type IN ('house_take_revenue', 'house_rounding_residual')
    AND account_class = 'revenue' AND normal_balance = 'credit') OR
  (account_type = 'adjustment_reserve' AND account_class = 'equity' AND normal_balance = 'credit')
);

ALTER TABLE ledger_transactions DROP CONSTRAINT IF EXISTS ledger_transactions_transaction_type_check;
ALTER TABLE ledger_transactions DROP CONSTRAINT IF EXISTS ledger_transactions_constraint_1;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_transaction_type_check CHECK (
  transaction_type IN (
    'deposit_pending_credit', 'deposit_confirmed_credit', 'token_purchase_issuance',
    'bet_reserve', 'bet_release', 'bet_capture', 'settlement_payout',
    'settlement_house_take', 'settlement_carryover', 'settlement_carryover_apply',
    'withdrawal_reserve', 'withdrawal_finalized', 'withdrawal_provider_failure_release',
    'withdrawal_complete', 'withdrawal_reversal', 'manual_adjustment'
  )
);

ALTER TABLE ledger_transactions DROP CONSTRAINT IF EXISTS ledger_transactions_reference_type_check;
ALTER TABLE ledger_transactions DROP CONSTRAINT IF EXISTS ledger_transactions_constraint_2;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_reference_type_check CHECK (
  reference_type IN ('account', 'deposit', 'funding_attestation', 'withdrawal', 'bet',
    'reservation', 'settlement', 'manual_adjustment', 'internal_transfer')
);

CREATE TABLE funding_attestation_consumptions (
  consumption_id UUID PRIMARY KEY,
  funding_attestation_id UUID NOT NULL UNIQUE,
  attestation_payload_hash TEXT NOT NULL CHECK (attestation_payload_hash ~ '^[0-9a-f]{64}$'),
  issuer TEXT NOT NULL CHECK (issuer = 'nines-api'),
  environment TEXT NOT NULL CHECK (environment IN ('development', 'test', 'production')),
  player_id UUID NOT NULL,
  funding_intent_id UUID NOT NULL UNIQUE,
  provider_name TEXT NOT NULL,
  provider_payment_reference TEXT NOT NULL,
  provider_confirmation_event_id TEXT NOT NULL,
  external_asset TEXT NOT NULL,
  external_atomic_units NUMERIC(96,0) NOT NULL CHECK (external_atomic_units > 0),
  external_scale INTEGER NOT NULL,
  issuance_policy_version TEXT NULL,
  issued_currency TEXT NULL,
  issued_scale INTEGER NULL,
  issued_minor_units NUMERIC(96,0) NULL,
  ledger_transaction_id TEXT NULL UNIQUE REFERENCES ledger_transactions (transaction_id) ON DELETE RESTRICT,
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'review_required')),
  reason_code TEXT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT NOT NULL,
  attestation_payload JSONB NOT NULL CHECK (JSONB_TYPEOF(attestation_payload) = 'object'),
  received_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT funding_attestation_provider_payment_unique UNIQUE
    (provider_name, provider_payment_reference),
  CONSTRAINT funding_attestation_outcome_shape CHECK (
    (outcome = 'accepted' AND issuance_policy_version IS NOT NULL AND issued_currency = 'NINES'
      AND issued_scale IS NOT NULL AND issued_minor_units > 0
      AND ledger_transaction_id IS NOT NULL AND reason_code IS NULL) OR
    (outcome = 'review_required' AND issuance_policy_version IS NULL AND issued_currency IS NULL
      AND issued_scale IS NULL AND issued_minor_units IS NULL
      AND ledger_transaction_id IS NULL AND reason_code IS NOT NULL)
  ),
  CONSTRAINT funding_attestation_v1_policy_economics CHECK (
    outcome <> 'accepted' OR (
      external_asset = 'USDC' AND external_scale = 6 AND
      issuance_policy_version = 'usdc-to-nines-par-v1' AND
      issued_currency = 'NINES' AND issued_scale = 6 AND
      issued_minor_units = external_atomic_units
    )
  )
);

CREATE TABLE service_request_nonces (
  service_id TEXT NOT NULL,
  request_id UUID NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (service_id, request_id)
);

CREATE INDEX service_request_nonces_received_idx ON service_request_nonces (received_at);

CREATE TABLE security_evidence_outbox (
  event_id UUID PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type = 'financial.nines_issuance_decided.v1'),
  funding_attestation_id UUID NOT NULL REFERENCES funding_attestation_consumptions (funding_attestation_id) ON DELETE RESTRICT,
  payload JSONB NOT NULL CHECK (JSONB_TYPEOF(payload) = 'object'),
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'retry_wait', 'delivered', 'dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_token UUID NULL,
  next_attempt_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  delivered_at TIMESTAMPTZ NULL
);

CREATE INDEX financial_security_evidence_delivery_idx
  ON security_evidence_outbox (delivery_status, next_attempt_at, created_at)
  WHERE delivery_status IN ('pending', 'retry_wait');

CREATE OR REPLACE FUNCTION protect_funding_attestation_consumption()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'funding attestation consumptions are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER funding_attestation_consumption_immutable
  BEFORE UPDATE OR DELETE ON funding_attestation_consumptions
  FOR EACH ROW EXECUTE FUNCTION protect_funding_attestation_consumption();

CREATE OR REPLACE FUNCTION protect_committed_ledger_history()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append only; use a compensating transaction', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

-- Ledger transactions and entries are posted as append-only records throughout
-- Accounting Core. Corrections are represented by new compensating transactions.
CREATE TRIGGER ledger_transactions_append_only
  BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION protect_committed_ledger_history();

CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION protect_committed_ledger_history();

CREATE OR REPLACE FUNCTION validate_funding_attestation_consumption_ledger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  target_id UUID;
  valid_coupling BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'funding_attestation_consumptions' THEN
    target_id := NEW.funding_attestation_id;
  ELSE
    IF NEW.transaction_type <> 'token_purchase_issuance' THEN
      RETURN NEW;
    END IF;
    target_id := NEW.reference_id::UUID;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM funding_attestation_consumptions c
    JOIN ledger_transactions t ON t.transaction_id = c.ledger_transaction_id
    JOIN ledger_entries debit ON debit.transaction_id = t.transaction_id AND debit.direction = 'debit'
    JOIN accounts debit_account ON debit_account.account_id = debit.account_id
    JOIN ledger_entries credit ON credit.transaction_id = t.transaction_id AND credit.direction = 'credit'
    JOIN accounts credit_account ON credit_account.account_id = credit.account_id
    WHERE c.funding_attestation_id = target_id
      AND c.outcome = 'accepted'
      AND t.transaction_type = 'token_purchase_issuance'
      AND t.reference_type = 'funding_attestation'
      AND t.reference_id = c.funding_attestation_id::TEXT
      AND t.status = 'posted'
      AND debit_account.account_type = 'token_purchase_clearing'
      AND debit_account.currency = 'NINES'
      AND credit_account.account_type = 'user_available'
      AND credit_account.owner_type = 'user'
      AND credit_account.owner_id = c.player_id::TEXT
      AND credit_account.currency = 'NINES'
      AND debit.currency = 'NINES' AND credit.currency = 'NINES'
      AND debit.amount_minor = c.issued_minor_units
      AND credit.amount_minor = c.issued_minor_units
      AND (SELECT count(*) FROM ledger_entries e WHERE e.transaction_id = t.transaction_id) = 2
  ) INTO valid_coupling;

  IF NOT valid_coupling THEN
    RAISE EXCEPTION 'token purchase attestation and ledger posting are not exactly coupled'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER funding_attestation_consumption_ledger_coupling
  AFTER INSERT ON funding_attestation_consumptions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.outcome = 'accepted')
  EXECUTE FUNCTION validate_funding_attestation_consumption_ledger();

CREATE CONSTRAINT TRIGGER token_purchase_ledger_consumption_coupling
  AFTER INSERT ON ledger_transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.transaction_type = 'token_purchase_issuance')
  EXECUTE FUNCTION validate_funding_attestation_consumption_ledger();
