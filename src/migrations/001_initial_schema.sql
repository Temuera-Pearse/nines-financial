CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY,
  account_type TEXT NOT NULL CHECK (
    account_type IN (
      'user_available_balance',
      'user_reserved_balance',
      'funding_clearing',
      'treasury_operating',
      'house_revenue',
      'race_pool_liability',
      'unsettled_bets_holding',
      'settlement_clearing'
    )
  ),
  owner_type TEXT NOT NULL CHECK (
    owner_type IN ('user', 'platform', 'treasury', 'settlement', 'bet_intake', 'system')
  ),
  owner_id TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (char_length(currency) BETWEEN 3 AND 12 AND currency = upper(currency)),
  status TEXT NOT NULL CHECK (status IN ('active', 'frozen', 'closed')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT accounts_timestamp_order CHECK (updated_at >= created_at),
  CONSTRAINT accounts_owner_type_currency_unique UNIQUE (account_type, owner_type, owner_id, currency)
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  transaction_id TEXT PRIMARY KEY,
  transaction_type TEXT NOT NULL CHECK (
    transaction_type IN (
      'deposit_pending_credit',
      'deposit_confirmed_credit',
      'bet_reserve',
      'bet_release',
      'bet_capture',
      'settlement_payout',
      'settlement_house_take',
      'withdrawal_reserve',
      'withdrawal_finalized',
      'withdrawal_provider_failure_release',
      'withdrawal_complete',
      'withdrawal_reversal',
      'manual_adjustment'
    )
  ),
  reference_type TEXT NOT NULL CHECK (
    reference_type IN (
      'account',
      'deposit',
      'withdrawal',
      'bet',
      'reservation',
      'settlement',
      'manual_adjustment',
      'internal_transfer'
    )
  ),
  reference_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'posted', 'rejected')),
  related_transaction_id TEXT REFERENCES ledger_transactions (transaction_id) ON DELETE RESTRICT,
  correlation_id TEXT NOT NULL,
  causation_id TEXT NOT NULL,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT ledger_transactions_reference_not_blank CHECK (btrim(reference_id) <> ''),
  CONSTRAINT ledger_transactions_correlation_not_blank CHECK (btrim(correlation_id) <> ''),
  CONSTRAINT ledger_transactions_causation_not_blank CHECK (btrim(causation_id) <> '')
);

CREATE INDEX IF NOT EXISTS ledger_transactions_reference_idx
  ON ledger_transactions (reference_type, reference_id, transaction_type);

CREATE INDEX IF NOT EXISTS ledger_transactions_correlation_idx
  ON ledger_transactions (correlation_id, causation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ledger_transactions_related_idx
  ON ledger_transactions (related_transaction_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ledger_entries (
  entry_id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES ledger_transactions (transaction_id) ON DELETE RESTRICT,
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE RESTRICT,
  direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount_minor NUMERIC(20, 0) NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (char_length(currency) BETWEEN 3 AND 12 AND currency = upper(currency)),
  effective_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS ledger_entries_transaction_idx
  ON ledger_entries (transaction_id, created_at ASC);

CREATE INDEX IF NOT EXISTS ledger_entries_account_idx
  ON ledger_entries (account_id, effective_at DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS idempotency_records (
  idempotency_key TEXT NOT NULL,
  command_type TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_snapshot JSONB,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  PRIMARY KEY (idempotency_key, command_type)
);

CREATE INDEX IF NOT EXISTS idempotency_records_status_idx
  ON idempotency_records (status, created_at DESC);

CREATE TABLE IF NOT EXISTS account_balances (
  account_id TEXT PRIMARY KEY REFERENCES accounts (account_id) ON DELETE RESTRICT,
  currency TEXT NOT NULL CHECK (char_length(currency) BETWEEN 3 AND 12 AND currency = upper(currency)),
  balance_minor NUMERIC(20, 0) NOT NULL,
  total_debits_minor NUMERIC(20, 0) NOT NULL CHECK (total_debits_minor >= 0),
  total_credits_minor NUMERIC(20, 0) NOT NULL CHECK (total_credits_minor >= 0),
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT account_balances_balance_consistency CHECK (
    balance_minor = total_credits_minor - total_debits_minor
  )
);

CREATE TABLE IF NOT EXISTS audit_events (
  audit_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_events_entity_idx
  ON audit_events (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_correlation_idx
  ON audit_events (correlation_id, causation_id, created_at DESC);

-- account_balances is a derived read model. It is updated transactionally by the
-- Accounting Core repository only after valid append-only ledger inserts succeed.
