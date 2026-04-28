ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_account_type_check;

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_owner_type_check;

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_constraint_1;

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_constraint_2;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS account_class TEXT NOT NULL DEFAULT 'liability';

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS normal_balance TEXT NOT NULL DEFAULT 'credit';

UPDATE accounts
SET account_type = CASE account_type
  WHEN 'user_available_balance' THEN 'user_available'
  WHEN 'user_reserved_balance' THEN 'user_locked'
  WHEN 'funding_clearing' THEN 'deposit_clearing'
  WHEN 'treasury_operating' THEN 'treasury_cash'
  WHEN 'house_revenue' THEN 'house_take_revenue'
  WHEN 'race_pool_liability' THEN 'race_selection_pool'
  WHEN 'unsettled_bets_holding' THEN 'settlement_clearing'
  ELSE account_type
END;

UPDATE accounts
SET
  account_class = CASE account_type
    WHEN 'deposit_clearing' THEN 'asset'
    WHEN 'treasury_cash' THEN 'asset'
    WHEN 'house_take_revenue' THEN 'revenue'
    WHEN 'house_rounding_residual' THEN 'revenue'
    WHEN 'adjustment_reserve' THEN 'equity'
    ELSE 'liability'
  END,
  normal_balance = CASE account_type
    WHEN 'deposit_clearing' THEN 'debit'
    WHEN 'treasury_cash' THEN 'debit'
    ELSE 'credit'
  END;

ALTER TABLE accounts
  ADD CONSTRAINT accounts_account_type_check CHECK (
    account_type IN (
      'user_available',
      'user_locked',
      'user_withdrawal_reserved',
      'deposit_clearing',
      'treasury_cash',
      'house_take_revenue',
      'house_rounding_residual',
      'race_selection_pool',
      'settlement_clearing',
      'withdrawal_clearing',
      'adjustment_reserve'
    )
  );

ALTER TABLE accounts
  ADD CONSTRAINT accounts_owner_type_check CHECK (
    owner_type IN ('user', 'platform', 'treasury', 'settlement', 'race', 'selection', 'system')
  );

ALTER TABLE accounts
  ADD CONSTRAINT accounts_class_normal_balance_check CHECK (
    account_class IN ('asset', 'liability', 'revenue', 'expense', 'equity')
    AND normal_balance IN ('debit', 'credit')
    AND (
      (account_type IN ('deposit_clearing', 'treasury_cash') AND account_class = 'asset' AND normal_balance = 'debit')
      OR (account_type IN ('house_take_revenue', 'house_rounding_residual') AND account_class = 'revenue' AND normal_balance = 'credit')
      OR (account_type = 'adjustment_reserve' AND account_class = 'equity' AND normal_balance = 'credit')
      OR (account_type IN (
        'user_available',
        'user_locked',
        'user_withdrawal_reserved',
        'race_selection_pool',
        'settlement_clearing',
        'withdrawal_clearing'
      ) AND account_class = 'liability' AND normal_balance = 'credit')
    )
  );

ALTER TABLE account_balances
  DROP CONSTRAINT IF EXISTS account_balances_balance_consistency;

ALTER TABLE account_balances
  ADD COLUMN IF NOT EXISTS normal_balance TEXT NOT NULL DEFAULT 'credit';

UPDATE account_balances
SET normal_balance = 'debit'
WHERE account_id IN (
  SELECT account_id
  FROM accounts
  WHERE normal_balance = 'debit'
);

UPDATE account_balances
SET normal_balance = 'credit'
WHERE account_id IN (
  SELECT account_id
  FROM accounts
  WHERE normal_balance = 'credit'
);

UPDATE account_balances
SET balance_minor = CASE normal_balance
  WHEN 'debit' THEN total_debits_minor - total_credits_minor
  ELSE total_credits_minor - total_debits_minor
END;

ALTER TABLE account_balances
  ADD CONSTRAINT account_balances_normal_balance_check CHECK (
    normal_balance IN ('debit', 'credit')
  );

ALTER TABLE account_balances
  ADD CONSTRAINT account_balances_balance_consistency CHECK (
    balance_minor = CASE normal_balance
      WHEN 'debit' THEN total_debits_minor - total_credits_minor
      ELSE total_credits_minor - total_debits_minor
    END
  );

ALTER TABLE idempotency_records
  ADD COLUMN IF NOT EXISTS service_scope TEXT NOT NULL DEFAULT 'nines-financial';

ALTER TABLE idempotency_records
  ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'local';

ALTER TABLE idempotency_records
  ADD COLUMN IF NOT EXISTS request_fingerprint TEXT NOT NULL DEFAULT '';

UPDATE idempotency_records
SET request_fingerprint = request_hash
WHERE request_fingerprint = '';

ALTER TABLE idempotency_records
  ADD CONSTRAINT idempotency_records_scope_not_blank CHECK (btrim(service_scope) <> '');

ALTER TABLE idempotency_records
  ADD CONSTRAINT idempotency_records_environment_not_blank CHECK (btrim(environment) <> '');

ALTER TABLE idempotency_records
  ADD CONSTRAINT idempotency_records_fingerprint_not_blank CHECK (btrim(request_fingerprint) <> '');

CREATE UNIQUE INDEX IF NOT EXISTS idempotency_records_scoped_command_uidx
  ON idempotency_records (service_scope, environment, command_type, idempotency_key);

CREATE TABLE IF NOT EXISTS outbox_events (
  outbox_event_id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'publishing', 'published', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ,
  correlation_id TEXT NOT NULL,
  causation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ,
  CONSTRAINT outbox_events_aggregate_not_blank CHECK (btrim(aggregate_type) <> '' AND btrim(aggregate_id) <> ''),
  CONSTRAINT outbox_events_event_type_not_blank CHECK (btrim(event_type) <> '')
);

CREATE INDEX IF NOT EXISTS outbox_events_pending_idx
  ON outbox_events (status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS outbox_events_aggregate_idx
  ON outbox_events (aggregate_type, aggregate_id, created_at DESC);

CREATE TABLE IF NOT EXISTS player_accounts (
  player_account_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (char_length(currency) BETWEEN 3 AND 12 AND currency = upper(currency)),
  account_class TEXT NOT NULL CHECK (account_class IN ('primary')),
  available_account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE RESTRICT,
  locked_account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  status_changed_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT player_accounts_timestamp_order CHECK (
    updated_at >= created_at
    AND status_changed_at >= created_at
    AND status_changed_at <= updated_at
  ),
  CONSTRAINT player_accounts_linked_accounts_distinct CHECK (available_account_id <> locked_account_id),
  CONSTRAINT player_accounts_user_currency_class_uidx UNIQUE (user_id, currency, account_class),
  CONSTRAINT player_accounts_available_account_uidx UNIQUE (available_account_id),
  CONSTRAINT player_accounts_locked_account_uidx UNIQUE (locked_account_id)
);

CREATE INDEX IF NOT EXISTS player_accounts_user_currency_idx
  ON player_accounts (user_id, currency, account_class);

CREATE TABLE IF NOT EXISTS account_restrictions (
  restriction_id TEXT PRIMARY KEY,
  player_account_id TEXT NOT NULL REFERENCES player_accounts (player_account_id) ON DELETE RESTRICT,
  blocked_actions JSONB NOT NULL,
  reason_code TEXT NOT NULL,
  reason_text TEXT NOT NULL,
  ticket_id TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('admin_user', 'system', 'policy_engine')),
  actor_id TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  lifted_at TIMESTAMPTZ,
  lift_reason_code TEXT,
  lift_reason_text TEXT,
  CONSTRAINT account_restrictions_reason_not_blank CHECK (btrim(reason_code) <> '' AND btrim(reason_text) <> ''),
  CONSTRAINT account_restrictions_actor_not_blank CHECK (btrim(actor_id) <> '' AND btrim(source) <> ''),
  CONSTRAINT account_restrictions_expiry_order CHECK (expires_at IS NULL OR expires_at > created_at),
  CONSTRAINT account_restrictions_lift_order CHECK (lifted_at IS NULL OR lifted_at >= created_at),
  CONSTRAINT account_restrictions_lift_reason_pair CHECK (
    (lifted_at IS NULL AND lift_reason_code IS NULL AND lift_reason_text IS NULL)
    OR (lifted_at IS NOT NULL AND btrim(lift_reason_code) <> '' AND btrim(lift_reason_text) <> '')
  )
);

CREATE INDEX IF NOT EXISTS account_restrictions_active_idx
  ON account_restrictions (player_account_id, created_at DESC)
  WHERE lifted_at IS NULL;

CREATE TABLE IF NOT EXISTS account_suspensions (
  suspension_id TEXT PRIMARY KEY,
  player_account_id TEXT NOT NULL REFERENCES player_accounts (player_account_id) ON DELETE RESTRICT,
  reason_code TEXT NOT NULL,
  reason_text TEXT NOT NULL,
  ticket_id TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('admin_user', 'system', 'policy_engine')),
  actor_id TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  lifted_at TIMESTAMPTZ,
  lift_reason_code TEXT,
  lift_reason_text TEXT,
  CONSTRAINT account_suspensions_reason_not_blank CHECK (btrim(reason_code) <> '' AND btrim(reason_text) <> ''),
  CONSTRAINT account_suspensions_actor_not_blank CHECK (btrim(actor_id) <> '' AND btrim(source) <> ''),
  CONSTRAINT account_suspensions_expiry_order CHECK (expires_at IS NULL OR expires_at > created_at),
  CONSTRAINT account_suspensions_lift_order CHECK (lifted_at IS NULL OR lifted_at >= created_at),
  CONSTRAINT account_suspensions_lift_reason_pair CHECK (
    (lifted_at IS NULL AND lift_reason_code IS NULL AND lift_reason_text IS NULL)
    OR (lifted_at IS NOT NULL AND btrim(lift_reason_code) <> '' AND btrim(lift_reason_text) <> '')
  )
);

CREATE INDEX IF NOT EXISTS account_suspensions_active_idx
  ON account_suspensions (player_account_id, created_at DESC)
  WHERE lifted_at IS NULL;

CREATE TABLE IF NOT EXISTS account_freezes (
  freeze_id TEXT PRIMARY KEY,
  player_account_id TEXT NOT NULL REFERENCES player_accounts (player_account_id) ON DELETE RESTRICT,
  reason_code TEXT NOT NULL,
  reason_text TEXT NOT NULL,
  ticket_id TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('admin_user', 'system', 'policy_engine')),
  actor_id TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  lifted_at TIMESTAMPTZ,
  lift_reason_code TEXT,
  lift_reason_text TEXT,
  CONSTRAINT account_freezes_reason_not_blank CHECK (btrim(reason_code) <> '' AND btrim(reason_text) <> ''),
  CONSTRAINT account_freezes_actor_not_blank CHECK (btrim(actor_id) <> '' AND btrim(source) <> ''),
  CONSTRAINT account_freezes_lift_order CHECK (lifted_at IS NULL OR lifted_at >= created_at),
  CONSTRAINT account_freezes_lift_reason_pair CHECK (
    (lifted_at IS NULL AND lift_reason_code IS NULL AND lift_reason_text IS NULL)
    OR (lifted_at IS NOT NULL AND btrim(lift_reason_code) <> '' AND btrim(lift_reason_text) <> '')
  )
);

CREATE INDEX IF NOT EXISTS account_freezes_active_idx
  ON account_freezes (player_account_id, created_at DESC)
  WHERE lifted_at IS NULL;
