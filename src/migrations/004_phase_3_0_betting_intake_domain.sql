CREATE TABLE IF NOT EXISTS race_pools (
  race_id TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency = 'USDC'),
  status TEXT NOT NULL CHECK (status IN ('open', 'frozen')),
  betting_opens_at TIMESTAMPTZ,
  betting_closes_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  frozen_at TIMESTAMPTZ,
  PRIMARY KEY (race_id, currency),
  CONSTRAINT race_pools_race_not_blank CHECK (btrim(race_id) <> ''),
  CONSTRAINT race_pools_timestamp_order CHECK (
    updated_at >= created_at
    AND (frozen_at IS NULL OR frozen_at >= created_at)
    AND (betting_opens_at IS NULL OR betting_closes_at IS NULL OR betting_closes_at > betting_opens_at)
  ),
  CONSTRAINT race_pools_frozen_at_status_check CHECK (
    (status = 'open' AND frozen_at IS NULL)
    OR (status = 'frozen' AND frozen_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS race_pools_status_idx
  ON race_pools (status, created_at DESC);

CREATE TABLE IF NOT EXISTS race_pool_selections (
  race_id TEXT NOT NULL,
  selection_id TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency = 'USDC'),
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (race_id, selection_id, currency),
  CONSTRAINT race_pool_selections_pool_fk FOREIGN KEY (race_id, currency)
    REFERENCES race_pools (race_id, currency)
    ON DELETE RESTRICT,
  CONSTRAINT race_pool_selections_not_blank CHECK (
    btrim(race_id) <> ''
    AND btrim(selection_id) <> ''
    AND (display_name IS NULL OR btrim(display_name) <> '')
  ),
  CONSTRAINT race_pool_selections_timestamp_order CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS race_pool_selections_race_status_idx
  ON race_pool_selections (race_id, currency, status, selection_id);

CREATE TABLE IF NOT EXISTS financial_bets (
  bet_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  race_id TEXT NOT NULL,
  selection_id TEXT NOT NULL,
  stake_minor NUMERIC(20, 0) NOT NULL CHECK (stake_minor > 0),
  currency TEXT NOT NULL CHECK (currency = 'USDC'),
  status TEXT NOT NULL CHECK (
    status IN (
      'accepted',
      'rejected',
      'settlement_pending',
      'settled_win',
      'settled_loss',
      'voided',
      'manual_review'
    )
  ),
  rejection_code TEXT,
  rejection_reason TEXT,
  reservation_transaction_id TEXT REFERENCES ledger_transactions (transaction_id) ON DELETE RESTRICT,
  accepted_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT financial_bets_not_blank CHECK (
    btrim(bet_id) <> ''
    AND btrim(user_id) <> ''
    AND btrim(race_id) <> ''
    AND btrim(selection_id) <> ''
    AND btrim(idempotency_key) <> ''
    AND btrim(correlation_id) <> ''
    AND btrim(causation_id) <> ''
  ),
  CONSTRAINT financial_bets_timestamp_order CHECK (
    updated_at >= created_at
    AND (accepted_at IS NULL OR accepted_at >= created_at)
    AND (rejected_at IS NULL OR rejected_at >= created_at)
  ),
  CONSTRAINT financial_bets_acceptance_shape CHECK (
    (
      status = 'accepted'
      AND reservation_transaction_id IS NOT NULL
      AND accepted_at IS NOT NULL
      AND rejected_at IS NULL
      AND rejection_code IS NULL
      AND rejection_reason IS NULL
    )
    OR (
      status = 'rejected'
      AND reservation_transaction_id IS NULL
      AND accepted_at IS NULL
      AND rejected_at IS NOT NULL
      AND btrim(rejection_code) <> ''
      AND btrim(rejection_reason) <> ''
    )
    OR status IN ('settlement_pending', 'settled_win', 'settled_loss', 'voided', 'manual_review')
  )
);

CREATE INDEX IF NOT EXISTS financial_bets_race_status_idx
  ON financial_bets (race_id, currency, status, created_at DESC);

CREATE INDEX IF NOT EXISTS financial_bets_user_idx
  ON financial_bets (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS financial_bets_selection_status_idx
  ON financial_bets (race_id, selection_id, currency, status);

CREATE INDEX IF NOT EXISTS financial_bets_reservation_idx
  ON financial_bets (reservation_transaction_id)
  WHERE reservation_transaction_id IS NOT NULL;
