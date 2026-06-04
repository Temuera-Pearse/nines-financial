ALTER TABLE ledger_transactions
  DROP CONSTRAINT IF EXISTS ledger_transactions_transaction_type_check;

ALTER TABLE ledger_transactions
  DROP CONSTRAINT IF EXISTS ledger_transactions_constraint_1;

ALTER TABLE ledger_transactions
  ADD CONSTRAINT ledger_transactions_transaction_type_check CHECK (
    transaction_type IN (
      'deposit_pending_credit',
      'deposit_confirmed_credit',
      'bet_reserve',
      'bet_release',
      'bet_capture',
      'settlement_payout',
      'settlement_house_take',
      'settlement_carryover',
      'settlement_carryover_apply',
      'withdrawal_reserve',
      'withdrawal_finalized',
      'withdrawal_provider_failure_release',
      'withdrawal_complete',
      'withdrawal_reversal',
      'manual_adjustment'
    )
  );

ALTER TABLE withdrawal_requests
  ADD COLUMN IF NOT EXISTS finalization_ledger_transaction_id TEXT REFERENCES ledger_transactions (transaction_id) ON DELETE RESTRICT;

ALTER TABLE withdrawal_requests
  DROP CONSTRAINT IF EXISTS withdrawal_requests_status_check;

ALTER TABLE withdrawal_requests
  ADD CONSTRAINT withdrawal_requests_status_check CHECK (
    status IN (
      'requested',
      'reservation_pending',
      'reserved',
      'review_required',
      'approved',
      'rejected',
      'cancelled',
      'submission_pending',
      'submitting',
      'submitted',
      'provider_pending',
      'provider_confirmed',
      'provider_failed',
      'provider_rejected',
      'provider_unknown',
      'provider_failure_released',
      'provider_failed_terminal',
      'provider_rejected_terminal',
      'provider_unknown_reviewed',
      'failed',
      'completed'
    )
  );

ALTER TABLE withdrawal_requests
  DROP CONSTRAINT IF EXISTS withdrawal_requests_reserved_state_check;

ALTER TABLE withdrawal_requests
  ADD CONSTRAINT withdrawal_requests_reserved_state_check CHECK (
    (
      status IN (
        'reserved',
        'review_required',
        'approved',
        'submission_pending',
        'submitting',
        'submitted',
        'provider_pending',
        'provider_confirmed',
        'provider_failed',
        'provider_rejected',
        'provider_unknown',
        'provider_failure_released',
        'provider_failed_terminal',
        'provider_rejected_terminal',
        'provider_unknown_reviewed',
        'completed'
      )
      AND reservation_ledger_transaction_id IS NOT NULL
      AND reserved_at IS NOT NULL
    )
    OR status IN ('requested', 'reservation_pending', 'rejected', 'cancelled', 'failed')
  );

ALTER TABLE withdrawal_requests
  DROP CONSTRAINT IF EXISTS withdrawal_requests_review_reason_check;

ALTER TABLE withdrawal_requests
  ADD CONSTRAINT withdrawal_requests_review_reason_check CHECK (
    (
      status IN (
        'review_required',
        'rejected',
        'provider_failed',
        'provider_rejected',
        'provider_unknown',
        'provider_failure_released',
        'provider_failed_terminal',
        'provider_rejected_terminal',
        'provider_unknown_reviewed',
        'failed'
      )
      AND (
        review_reason_code IS NOT NULL
        OR failure_reason_code IS NOT NULL
      )
    )
    OR status NOT IN (
      'review_required',
      'rejected',
      'provider_failed',
      'provider_rejected',
      'provider_unknown',
      'provider_failure_released',
      'provider_failed_terminal',
      'provider_rejected_terminal',
      'provider_unknown_reviewed',
      'failed'
    )
  );

CREATE INDEX IF NOT EXISTS withdrawal_requests_finalization_idx
  ON withdrawal_requests (finalization_ledger_transaction_id)
  WHERE finalization_ledger_transaction_id IS NOT NULL;

INSERT INTO accounts (
  account_id,
  account_type,
  account_class,
  normal_balance,
  owner_type,
  owner_id,
  currency,
  status,
  created_at,
  updated_at
)
VALUES (
  'acct_platform_withdrawal_clearing_usdc',
  'withdrawal_clearing',
  'liability',
  'credit',
  'platform',
  'platform-withdrawal-clearing',
  'USDC',
  'active',
  '2026-04-22T12:00:00.000Z',
  '2026-04-22T12:00:00.000Z'
)
ON CONFLICT (account_type, owner_type, owner_id, currency) DO NOTHING;
