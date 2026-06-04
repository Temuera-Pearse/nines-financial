ALTER TABLE provider_deposit_events
  DROP CONSTRAINT IF EXISTS provider_deposit_events_review_reason_check;

ALTER TABLE provider_deposit_events
  DROP CONSTRAINT IF EXISTS provider_deposit_events_credited_ledger_check;

ALTER TABLE provider_deposit_events
  DROP CONSTRAINT IF EXISTS provider_deposit_events_status_check;

ALTER TABLE provider_deposit_events
  ADD CONSTRAINT provider_deposit_events_status_check CHECK (
    status IN (
      'received',
      'awaiting_confirmation',
      'credited',
      'duplicate',
      'review_required',
      'reviewed_no_credit',
      'rejected'
    )
  );

ALTER TABLE provider_deposit_events
  ADD CONSTRAINT provider_deposit_events_review_reason_check CHECK (
    (
      status IN ('review_required', 'reviewed_no_credit', 'rejected')
      AND review_reason_code IS NOT NULL
    )
    OR status NOT IN ('review_required', 'reviewed_no_credit', 'rejected')
  );

ALTER TABLE provider_deposit_events
  ADD CONSTRAINT provider_deposit_events_credited_ledger_check CHECK (
    (status = 'credited' AND ledger_transaction_id IS NOT NULL)
    OR (status <> 'credited')
  );

CREATE INDEX IF NOT EXISTS provider_deposit_events_resolution_idx
  ON provider_deposit_events (status, review_reason_code, updated_at DESC)
  WHERE status IN ('review_required', 'reviewed_no_credit', 'rejected');

CREATE INDEX IF NOT EXISTS provider_deposit_events_ledger_state_idx
  ON provider_deposit_events (ledger_transaction_id, status)
  WHERE ledger_transaction_id IS NOT NULL;
