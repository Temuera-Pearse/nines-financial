-- Stage W3: immutable authoritative race results and result-bound settlement.

CREATE TABLE IF NOT EXISTS authoritative_race_results (
  result_id UUID PRIMARY KEY,
  race_id TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NINES' CHECK (currency = 'NINES'),
  race_ref TEXT NOT NULL,
  result_version INTEGER NOT NULL CHECK (result_version = 1),
  event_type TEXT NOT NULL CHECK (event_type = 'nines_race_completed.v1'),
  environment TEXT NOT NULL CHECK (environment IN ('development','test','production')),
  winning_runner_id TEXT NOT NULL,
  winning_selection_id TEXT NOT NULL,
  finish_order JSONB NOT NULL CHECK (jsonb_typeof(finish_order) = 'array'),
  race_checksum TEXT NOT NULL CHECK (race_checksum ~ '^[0-9a-f]{64}$'),
  close_lifecycle_event_id UUID NOT NULL,
  close_lifecycle_evidence_hash TEXT NOT NULL CHECK (close_lifecycle_evidence_hash ~ '^[0-9a-f]{64}$'),
  evidence_hash TEXT NOT NULL CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT NOT NULL,
  settlement_status TEXT NOT NULL CHECK (settlement_status IN ('pending','running','completed')),
  settlement_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (settlement_attempt_count >= 0),
  settlement_locked_at TIMESTAMPTZ,
  settlement_run_id TEXT,
  settled_at TIMESTAMPTZ,
  acknowledgement JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT authoritative_race_results_pool_fk FOREIGN KEY (race_id,currency)
    REFERENCES race_pools (race_id,currency) ON DELETE RESTRICT,
  CONSTRAINT authoritative_race_results_winner_fk FOREIGN KEY
    (race_id,winning_selection_id,currency)
    REFERENCES race_pool_selections (race_id,selection_id,currency) ON DELETE RESTRICT,
  CONSTRAINT authoritative_race_results_close_fk FOREIGN KEY (close_lifecycle_event_id)
    REFERENCES race_lifecycle_evidence (lifecycle_event_id) ON DELETE RESTRICT,
  CONSTRAINT authoritative_race_results_race_uidx UNIQUE (race_id,currency),
  CONSTRAINT authoritative_race_results_identity_check CHECK (
    winning_runner_id = winning_selection_id AND causation_id = close_lifecycle_event_id::text
  ),
  CONSTRAINT authoritative_race_results_settlement_shape_check CHECK (
    (settlement_status IN ('pending','running') AND settlement_run_id IS NULL
      AND settled_at IS NULL AND acknowledgement IS NULL)
    OR
    (settlement_status='completed' AND settlement_run_id IS NOT NULL
      AND settled_at IS NOT NULL AND acknowledgement IS NOT NULL)
  ),
  CONSTRAINT authoritative_race_results_timestamp_order CHECK (
    updated_at >= created_at
  )
);

ALTER TABLE settlement_runs
  ADD COLUMN IF NOT EXISTS authoritative_result_id UUID;

ALTER TABLE settlement_runs
  ADD CONSTRAINT settlement_runs_authoritative_result_fk
  FOREIGN KEY (authoritative_result_id)
  REFERENCES authoritative_race_results (result_id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS settlement_runs_authoritative_result_uidx
  ON settlement_runs (authoritative_result_id)
  WHERE authoritative_result_id IS NOT NULL;

ALTER TABLE authoritative_race_results
  ADD CONSTRAINT authoritative_race_results_settlement_run_fk
  FOREIGN KEY (settlement_run_id)
  REFERENCES settlement_runs (settlement_run_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS authoritative_race_results_status_idx
  ON authoritative_race_results (settlement_status,received_at);

CREATE OR REPLACE FUNCTION validate_authoritative_race_result()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE pool_record RECORD; selection_record RECORD; close_record RECORD;
BEGIN
  SELECT * INTO pool_record FROM race_pools
    WHERE race_id=NEW.race_id AND currency=NEW.currency FOR SHARE;
  IF NOT FOUND OR NOT pool_record.lifecycle_managed OR pool_record.status <> 'frozen'
     OR pool_record.last_lifecycle_sequence <> 2 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='authoritative result requires a frozen W2 pool';
  END IF;
  IF pool_record.race_ref IS DISTINCT FROM NEW.race_ref
     OR pool_record.last_lifecycle_event_id IS DISTINCT FROM NEW.close_lifecycle_event_id
     OR pool_record.last_lifecycle_evidence_hash IS DISTINCT FROM NEW.close_lifecycle_evidence_hash THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='authoritative result conflicts with W2 close evidence';
  END IF;
  SELECT * INTO close_record FROM race_lifecycle_evidence
    WHERE lifecycle_event_id=NEW.close_lifecycle_event_id
      AND race_id=NEW.race_id AND race_ref=NEW.race_ref
      AND event_type='nines_race_betting_closed.v1' AND lifecycle_sequence=2
      AND evidence_hash=NEW.close_lifecycle_evidence_hash;
  IF NOT FOUND OR NEW.occurred_at < close_record.occurred_at THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='authoritative result has no matching prior close';
  END IF;
  SELECT * INTO selection_record FROM race_pool_selections
    WHERE race_id=NEW.race_id AND currency=NEW.currency
      AND selection_id=NEW.winning_selection_id;
  IF NOT FOUND OR selection_record.status <> 'active'
     OR selection_record.authoritative_runner_id IS DISTINCT FROM NEW.winning_runner_id THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='authoritative result winner is not a frozen active runner';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER authoritative_race_results_validate
BEFORE INSERT ON authoritative_race_results
FOR EACH ROW EXECUTE FUNCTION validate_authoritative_race_result();

CREATE OR REPLACE FUNCTION protect_authoritative_race_result()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='authoritative race result evidence is append-only';
  END IF;
  IF NEW.result_id IS DISTINCT FROM OLD.result_id OR NEW.race_id IS DISTINCT FROM OLD.race_id
     OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.race_ref IS DISTINCT FROM OLD.race_ref
     OR NEW.result_version IS DISTINCT FROM OLD.result_version OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.environment IS DISTINCT FROM OLD.environment
     OR NEW.winning_runner_id IS DISTINCT FROM OLD.winning_runner_id
     OR NEW.winning_selection_id IS DISTINCT FROM OLD.winning_selection_id
     OR NEW.finish_order IS DISTINCT FROM OLD.finish_order
     OR NEW.race_checksum IS DISTINCT FROM OLD.race_checksum
     OR NEW.close_lifecycle_event_id IS DISTINCT FROM OLD.close_lifecycle_event_id
     OR NEW.close_lifecycle_evidence_hash IS DISTINCT FROM OLD.close_lifecycle_evidence_hash
     OR NEW.evidence_hash IS DISTINCT FROM OLD.evidence_hash OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at OR NEW.received_at IS DISTINCT FROM OLD.received_at
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
     OR NEW.causation_id IS DISTINCT FROM OLD.causation_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='authoritative race result evidence is immutable';
  END IF;
  IF OLD.settlement_status='completed' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='completed authoritative result is immutable';
  END IF;
  IF NOT ((OLD.settlement_status='pending' AND NEW.settlement_status IN ('pending','running','completed'))
       OR (OLD.settlement_status='running' AND NEW.settlement_status IN ('pending','running','completed'))) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='illegal authoritative result settlement transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER authoritative_race_results_append_only
BEFORE UPDATE OR DELETE ON authoritative_race_results
FOR EACH ROW EXECUTE FUNCTION protect_authoritative_race_result();

CREATE OR REPLACE FUNCTION validate_result_bound_settlement()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE pool_record RECORD; result_record RECORD;
BEGIN
  SELECT * INTO pool_record FROM race_pools
    WHERE race_id=NEW.race_id AND currency=NEW.currency FOR SHARE;
  IF pool_record.lifecycle_managed THEN
    IF NEW.authoritative_result_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='W2-managed settlement requires authoritative result evidence';
    END IF;
    SELECT * INTO result_record FROM authoritative_race_results
      WHERE result_id=NEW.authoritative_result_id;
    IF NOT FOUND OR result_record.race_id <> NEW.race_id OR result_record.currency <> NEW.currency
       OR result_record.winning_selection_id <> NEW.winning_selection_id
       OR result_record.settlement_status NOT IN ('pending','running','completed')
       OR NEW.house_take_bps IS DISTINCT FROM pool_record.house_take_bps THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='settlement conflicts with authoritative result or frozen policy';
    END IF;
  END IF;
  IF TG_OP='UPDATE' AND OLD.status='completed' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='completed settlement run is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER settlement_runs_authoritative_result_guard
BEFORE INSERT OR UPDATE ON settlement_runs
FOR EACH ROW EXECUTE FUNCTION validate_result_bound_settlement();

CREATE OR REPLACE FUNCTION protect_result_bound_settlement_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='completed' OR OLD.authoritative_result_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='result-bound or completed settlement run is immutable';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER settlement_runs_completed_delete_guard
BEFORE DELETE ON settlement_runs
FOR EACH ROW EXECUTE FUNCTION protect_result_bound_settlement_delete();
