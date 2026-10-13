-- Stage R4: durable, leased recovery of accepted authoritative race results.

ALTER TABLE authoritative_race_results
  ADD COLUMN IF NOT EXISTS settlement_lease_token UUID,
  ADD COLUMN IF NOT EXISTS settlement_next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT current_timestamp,
  ADD COLUMN IF NOT EXISTS settlement_last_error_code TEXT,
  ADD COLUMN IF NOT EXISTS settlement_last_error TEXT,
  ADD COLUMN IF NOT EXISTS settlement_last_error_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settlement_escalated_at TIMESTAMPTZ;

-- A migration is applied while application processes are stopped. Any old
-- timestamp-only running claim has no owner identity and must be made eligible
-- for the new leased worker without changing its immutable result evidence.
UPDATE authoritative_race_results
SET settlement_status='pending', settlement_locked_at=NULL,
    settlement_next_attempt_at=current_timestamp, updated_at=current_timestamp
WHERE settlement_status='running';

ALTER TABLE authoritative_race_results
  DROP CONSTRAINT authoritative_race_results_settlement_status_check,
  DROP CONSTRAINT authoritative_race_results_settlement_shape_check;

ALTER TABLE authoritative_race_results
  ADD CONSTRAINT authoritative_race_results_settlement_status_check
    CHECK (settlement_status IN ('pending','running','completed','manual_review')),
  ADD CONSTRAINT authoritative_race_results_settlement_shape_check CHECK (
    (settlement_status='pending' AND settlement_run_id IS NULL
      AND settled_at IS NULL AND acknowledgement IS NULL
      AND settlement_locked_at IS NULL AND settlement_lease_token IS NULL)
    OR
    (settlement_status='running' AND settlement_run_id IS NULL
      AND settled_at IS NULL AND acknowledgement IS NULL
      AND settlement_locked_at IS NOT NULL AND settlement_lease_token IS NOT NULL)
    OR
    (settlement_status='completed' AND settlement_run_id IS NOT NULL
      AND settled_at IS NOT NULL AND acknowledgement IS NOT NULL
      AND settlement_locked_at IS NULL AND settlement_lease_token IS NULL)
    OR
    (settlement_status='manual_review' AND settlement_run_id IS NULL
      AND settled_at IS NULL AND acknowledgement IS NULL
      AND settlement_locked_at IS NULL AND settlement_lease_token IS NULL
      AND settlement_escalated_at IS NOT NULL)
  );

DROP INDEX IF EXISTS authoritative_race_results_status_idx;
CREATE INDEX authoritative_race_results_recovery_idx
  ON authoritative_race_results (settlement_next_attempt_at,received_at,result_id)
  WHERE settlement_status IN ('pending','running');

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
  IF OLD.settlement_status IN ('completed','manual_review') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='terminal authoritative result is immutable';
  END IF;
  IF NOT ((OLD.settlement_status='pending'
             AND NEW.settlement_status IN ('pending','running','completed','manual_review'))
       OR (OLD.settlement_status='running'
             AND NEW.settlement_status IN ('pending','running','completed','manual_review'))) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='illegal authoritative result settlement transition';
  END IF;
  RETURN NEW;
END;
$$;
