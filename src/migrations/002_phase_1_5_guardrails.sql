ALTER TABLE ledger_transactions
  ADD CONSTRAINT ledger_transactions_idempotency_key_not_blank CHECK (
    idempotency_key IS NULL OR btrim(idempotency_key) <> ''
  );

ALTER TABLE ledger_transactions
  ADD CONSTRAINT ledger_transactions_follow_up_requires_related_transaction CHECK (
    transaction_type NOT IN ('bet_release', 'bet_capture', 'withdrawal_complete', 'withdrawal_reversal')
    OR related_transaction_id IS NOT NULL
  );

CREATE INDEX IF NOT EXISTS ledger_transactions_idempotency_key_idx
  ON ledger_transactions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ledger_transactions_single_reservation_resolution_idx
  ON ledger_transactions (related_transaction_id)
  WHERE transaction_type IN ('bet_release', 'bet_capture', 'withdrawal_complete', 'withdrawal_reversal');