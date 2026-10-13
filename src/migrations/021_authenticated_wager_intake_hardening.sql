-- Stage W1: bind each accepted NINES bet to one exact, immutable stake lock.
-- Existing USDC history remains valid and is intentionally outside this rule.

CREATE UNIQUE INDEX IF NOT EXISTS financial_bets_reservation_unique_idx
  ON financial_bets (reservation_transaction_id)
  WHERE reservation_transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ledger_bet_reserve_reference_unique_idx
  ON ledger_transactions (reference_id)
  WHERE transaction_type = 'bet_reserve' AND reference_type = 'bet';

CREATE OR REPLACE FUNCTION validate_nines_bet_reservation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  reservation RECORD;
BEGIN
  IF NEW.currency <> 'NINES' OR NEW.status = 'rejected' THEN
    RETURN NEW;
  END IF;

  SELECT
    lt.transaction_id,
    lt.transaction_type,
    lt.reference_type,
    lt.reference_id,
    lt.status,
    COUNT(le.entry_id) AS entry_count,
    COUNT(le.entry_id) FILTER (
      WHERE le.direction = 'debit'
        AND le.currency = 'NINES'
        AND le.amount_minor = NEW.stake_minor
        AND a.account_type = 'user_available'
        AND a.owner_type = 'user'
        AND a.owner_id = NEW.user_id
    ) AS source_count,
    COUNT(le.entry_id) FILTER (
      WHERE le.direction = 'credit'
        AND le.currency = 'NINES'
        AND le.amount_minor = NEW.stake_minor
        AND a.account_type = 'user_locked'
        AND a.owner_type = 'user'
        AND a.owner_id = NEW.user_id
    ) AS destination_count
  INTO reservation
  FROM ledger_transactions lt
  LEFT JOIN ledger_entries le ON le.transaction_id = lt.transaction_id
  LEFT JOIN accounts a ON a.account_id = le.account_id
  WHERE lt.transaction_id = NEW.reservation_transaction_id
  GROUP BY lt.transaction_id, lt.transaction_type, lt.reference_type,
    lt.reference_id, lt.status;

  IF reservation.transaction_id IS NULL
     OR reservation.transaction_type <> 'bet_reserve'
     OR reservation.reference_type <> 'bet'
     OR reservation.reference_id <> NEW.bet_id
     OR reservation.status <> 'posted'
     OR reservation.entry_count <> 2
     OR reservation.source_count <> 1
     OR reservation.destination_count <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'accepted NINES bet must reference its exact available-to-locked reservation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS financial_bets_nines_reservation_constraint ON financial_bets;
CREATE CONSTRAINT TRIGGER financial_bets_nines_reservation_constraint
AFTER INSERT OR UPDATE ON financial_bets
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_nines_bet_reservation();

CREATE OR REPLACE FUNCTION protect_accepted_bet_economic_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'rejected' THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'accepted financial bet rows are immutable and cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status <> 'rejected' AND (
       NEW.bet_id IS DISTINCT FROM OLD.bet_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.race_id IS DISTINCT FROM OLD.race_id
    OR NEW.selection_id IS DISTINCT FROM OLD.selection_id
    OR NEW.stake_minor IS DISTINCT FROM OLD.stake_minor
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.reservation_transaction_id IS DISTINCT FROM OLD.reservation_transaction_id
    OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
    OR NEW.causation_id IS DISTINCT FROM OLD.causation_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'accepted financial bet economic fields are immutable';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS financial_bets_economic_immutability ON financial_bets;
CREATE TRIGGER financial_bets_economic_immutability
BEFORE UPDATE OR DELETE ON financial_bets
FOR EACH ROW
EXECUTE FUNCTION protect_accepted_bet_economic_fields();
