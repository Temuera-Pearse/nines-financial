-- Stage W2: authenticated backend race lifecycle evidence and immutable pool policy.

ALTER TABLE race_pools
  ADD COLUMN IF NOT EXISTS race_ref TEXT,
  ADD COLUMN IF NOT EXISTS lifecycle_managed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS open_lifecycle_event_id UUID,
  ADD COLUMN IF NOT EXISTS open_evidence_hash TEXT,
  ADD COLUMN IF NOT EXISTS last_lifecycle_event_id UUID,
  ADD COLUMN IF NOT EXISTS last_lifecycle_sequence INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_lifecycle_evidence_hash TEXT,
  ADD COLUMN IF NOT EXISTS selection_set_hash TEXT,
  ADD COLUMN IF NOT EXISTS economic_policy_hash TEXT,
  ADD COLUMN IF NOT EXISTS economic_policy_id TEXT,
  ADD COLUMN IF NOT EXISTS economic_policy_version INTEGER,
  ADD COLUMN IF NOT EXISTS house_take_bps INTEGER,
  ADD COLUMN IF NOT EXISTS carryover_policy_id TEXT,
  ADD COLUMN IF NOT EXISTS carryover_policy_version INTEGER,
  ADD COLUMN IF NOT EXISTS settlement_allocation_policy_id TEXT,
  ADD COLUMN IF NOT EXISTS settlement_allocation_policy_version INTEGER,
  ADD COLUMN IF NOT EXISTS rounding_policy_id TEXT,
  ADD COLUMN IF NOT EXISTS rounding_policy_version INTEGER;

ALTER TABLE race_pools ADD CONSTRAINT race_pools_lifecycle_shape_check CHECK (
  NOT lifecycle_managed OR (
    currency = 'NINES' AND race_ref ~ '^N9-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$' AND
    open_lifecycle_event_id IS NOT NULL AND open_evidence_hash ~ '^[0-9a-f]{64}$' AND
    last_lifecycle_event_id IS NOT NULL AND last_lifecycle_sequence IN (1,2) AND
    last_lifecycle_evidence_hash ~ '^[0-9a-f]{64}$' AND
    selection_set_hash ~ '^[0-9a-f]{64}$' AND economic_policy_hash ~ '^[0-9a-f]{64}$' AND
    economic_policy_id = 'nines-parimutuel.v1' AND economic_policy_version = 1 AND
    house_take_bps BETWEEN 0 AND 10000 AND
    carryover_policy_id = 'nines-carryover.v1' AND carryover_policy_version = 1 AND
    settlement_allocation_policy_id = 'nines-proportional-allocation.v1' AND
    settlement_allocation_policy_version = 1 AND
    rounding_policy_id = 'nines-largest-remainder.v1' AND rounding_policy_version = 1 AND
    betting_opens_at IS NOT NULL AND betting_closes_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS race_pools_lifecycle_race_ref_uidx
  ON race_pools (race_ref) WHERE lifecycle_managed;

ALTER TABLE race_pool_selections
  ADD COLUMN IF NOT EXISTS authoritative_runner_id TEXT,
  ADD COLUMN IF NOT EXISTS source_lifecycle_event_id UUID;

ALTER TABLE race_pool_selections ADD CONSTRAINT race_pool_selections_runner_identity_check CHECK (
  authoritative_runner_id IS NULL OR authoritative_runner_id = selection_id
);

CREATE TABLE IF NOT EXISTS race_lifecycle_evidence (
  lifecycle_event_id UUID PRIMARY KEY,
  race_id TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NINES' CHECK (currency = 'NINES'),
  race_ref TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('nines_race_opened.v1','nines_race_betting_closed.v1')),
  lifecycle_sequence INTEGER NOT NULL CHECK (lifecycle_sequence IN (1,2)),
  evidence_hash TEXT NOT NULL CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT NOT NULL,
  CONSTRAINT race_lifecycle_evidence_pool_fk FOREIGN KEY (race_id, currency)
    REFERENCES race_pools (race_id, currency) ON DELETE RESTRICT,
  CONSTRAINT race_lifecycle_evidence_race_sequence_uidx UNIQUE (race_id, lifecycle_sequence),
  CONSTRAINT race_lifecycle_evidence_type_sequence_check CHECK (
    (event_type='nines_race_opened.v1' AND lifecycle_sequence=1) OR
    (event_type='nines_race_betting_closed.v1' AND lifecycle_sequence=2)
  )
);

CREATE INDEX IF NOT EXISTS race_lifecycle_evidence_race_idx
  ON race_lifecycle_evidence (race_id, lifecycle_sequence);

CREATE OR REPLACE FUNCTION protect_race_lifecycle_evidence()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='race lifecycle evidence is append-only';
END;
$$;

CREATE TRIGGER race_lifecycle_evidence_append_only
BEFORE UPDATE OR DELETE ON race_lifecycle_evidence
FOR EACH ROW EXECUTE FUNCTION protect_race_lifecycle_evidence();

CREATE OR REPLACE FUNCTION protect_lifecycle_projected_pool()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.lifecycle_managed THEN
    IF NEW.race_id IS DISTINCT FROM OLD.race_id OR NEW.currency IS DISTINCT FROM OLD.currency OR
       NEW.race_ref IS DISTINCT FROM OLD.race_ref OR
       NEW.betting_opens_at IS DISTINCT FROM OLD.betting_opens_at OR
       NEW.betting_closes_at IS DISTINCT FROM OLD.betting_closes_at OR
       NEW.open_lifecycle_event_id IS DISTINCT FROM OLD.open_lifecycle_event_id OR
       NEW.open_evidence_hash IS DISTINCT FROM OLD.open_evidence_hash OR
       NEW.selection_set_hash IS DISTINCT FROM OLD.selection_set_hash OR
       NEW.economic_policy_hash IS DISTINCT FROM OLD.economic_policy_hash OR
       NEW.economic_policy_id IS DISTINCT FROM OLD.economic_policy_id OR
       NEW.economic_policy_version IS DISTINCT FROM OLD.economic_policy_version OR
       NEW.house_take_bps IS DISTINCT FROM OLD.house_take_bps OR
       NEW.carryover_policy_id IS DISTINCT FROM OLD.carryover_policy_id OR
       NEW.carryover_policy_version IS DISTINCT FROM OLD.carryover_policy_version OR
       NEW.settlement_allocation_policy_id IS DISTINCT FROM OLD.settlement_allocation_policy_id OR
       NEW.settlement_allocation_policy_version IS DISTINCT FROM OLD.settlement_allocation_policy_version OR
       NEW.rounding_policy_id IS DISTINCT FROM OLD.rounding_policy_id OR
       NEW.rounding_policy_version IS DISTINCT FROM OLD.rounding_policy_version THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='lifecycle-projected pool identity, window, runner evidence, and policy are immutable';
    END IF;
    IF NEW.last_lifecycle_sequence < OLD.last_lifecycle_sequence OR
       NEW.last_lifecycle_sequence > OLD.last_lifecycle_sequence + 1 THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='race lifecycle sequence must be monotonic and contiguous';
    END IF;
    IF NEW.last_lifecycle_sequence = OLD.last_lifecycle_sequence AND (
       NEW.last_lifecycle_event_id IS DISTINCT FROM OLD.last_lifecycle_event_id OR
       NEW.last_lifecycle_evidence_hash IS DISTINCT FROM OLD.last_lifecycle_evidence_hash) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='lifecycle event identity cannot change without advancing sequence';
    END IF;
    IF NEW.last_lifecycle_sequence = OLD.last_lifecycle_sequence + 1 AND NOT EXISTS (
      SELECT 1 FROM race_lifecycle_evidence e
      WHERE e.race_id=NEW.race_id AND e.lifecycle_sequence=NEW.last_lifecycle_sequence
        AND e.lifecycle_event_id=NEW.last_lifecycle_event_id
        AND e.evidence_hash=NEW.last_lifecycle_evidence_hash) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='pool lifecycle advancement requires matching append-only evidence';
    END IF;
    IF OLD.status <> 'open' AND NEW.status = 'open' THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='a closed race pool cannot reopen';
    END IF;
    IF OLD.status='open' AND NEW.status='frozen' AND NEW.last_lifecycle_sequence <> 2 THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='pool freeze requires authoritative close evidence';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER race_pools_lifecycle_immutability
BEFORE UPDATE ON race_pools
FOR EACH ROW EXECUTE FUNCTION protect_lifecycle_projected_pool();

CREATE OR REPLACE FUNCTION protect_lifecycle_projected_selection()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE managed BOOLEAN; evidence_exists BOOLEAN;
BEGIN
  SELECT lifecycle_managed INTO managed FROM race_pools
    WHERE race_id=COALESCE(NEW.race_id,OLD.race_id) AND currency=COALESCE(NEW.currency,OLD.currency);
  IF managed THEN
    IF TG_OP IN ('UPDATE','DELETE') THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='lifecycle-projected runner identities are immutable';
    END IF;
    SELECT EXISTS(SELECT 1 FROM race_lifecycle_evidence
      WHERE race_id=NEW.race_id) INTO evidence_exists;
    IF evidence_exists THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='runner set is finalized by race-open evidence';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER race_pool_selections_lifecycle_immutability
BEFORE INSERT OR UPDATE OR DELETE ON race_pool_selections
FOR EACH ROW EXECUTE FUNCTION protect_lifecycle_projected_selection();

CREATE OR REPLACE FUNCTION validate_lifecycle_managed_bet()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE managed BOOLEAN; pool_status TEXT; closes_at TIMESTAMPTZ; runner TEXT; selection_status TEXT;
BEGIN
  IF NEW.currency <> 'NINES' OR NEW.status='rejected' THEN RETURN NEW; END IF;
  SELECT lifecycle_managed,status,betting_closes_at INTO managed,pool_status,closes_at
    FROM race_pools WHERE race_id=NEW.race_id AND currency=NEW.currency FOR SHARE;
  IF managed THEN
    IF pool_status <> 'open' OR CURRENT_TIMESTAMP >= closes_at THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='lifecycle-projected pool is closed for betting';
    END IF;
    SELECT authoritative_runner_id,status INTO runner,selection_status
      FROM race_pool_selections WHERE race_id=NEW.race_id AND currency=NEW.currency
      AND selection_id=NEW.selection_id;
    IF runner IS NULL OR runner <> NEW.selection_id OR selection_status <> 'active' THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='accepted bet must reference an authoritative active runner';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER financial_bets_lifecycle_pool_guard
BEFORE INSERT ON financial_bets
FOR EACH ROW EXECUTE FUNCTION validate_lifecycle_managed_bet();
