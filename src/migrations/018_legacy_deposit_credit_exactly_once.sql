-- Every confirmed deposit posting carries the established economic idempotency
-- key derived from (provider, external transaction id). Make that key a database
-- uniqueness boundary so concurrent webhook/operator paths cannot append more
-- than one economic credit for the same external deposit.
DO $$
DECLARE
  missing_identity_count BIGINT;
  duplicate_identity_count BIGINT;
BEGIN
  SELECT count(*) INTO missing_identity_count
  FROM ledger_transactions
  WHERE transaction_type = 'deposit_confirmed_credit'
    AND idempotency_key IS NULL;

  SELECT count(*) INTO duplicate_identity_count
  FROM (
    SELECT idempotency_key
    FROM ledger_transactions
    WHERE transaction_type = 'deposit_confirmed_credit'
      AND idempotency_key IS NOT NULL
    GROUP BY idempotency_key
    HAVING count(*) > 1
  ) duplicate_sources;

  IF missing_identity_count > 0 OR duplicate_identity_count > 0 THEN
    RAISE EXCEPTION
      'cannot enforce legacy deposit credit uniqueness: % missing and % duplicate economic source identities require reconciliation',
      missing_identity_count,
      duplicate_identity_count
      USING ERRCODE = '23514',
        HINT = 'Reconcile historical deposit_confirmed_credit rows before retrying migration 018; no rows were changed.';
  END IF;
END;
$$;

ALTER TABLE ledger_transactions
  ADD CONSTRAINT ledger_transactions_deposit_credit_idempotency_required CHECK (
    transaction_type <> 'deposit_confirmed_credit' OR idempotency_key IS NOT NULL
  );

CREATE UNIQUE INDEX ledger_transactions_deposit_credit_idempotency_uidx
  ON ledger_transactions (idempotency_key)
  WHERE transaction_type = 'deposit_confirmed_credit';
