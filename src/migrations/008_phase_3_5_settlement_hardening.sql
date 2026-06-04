ALTER TABLE settlement_reconciliation_runs
  ADD COLUMN IF NOT EXISTS classification TEXT NOT NULL DEFAULT 'informational';

ALTER TABLE settlement_reconciliation_runs
  ADD COLUMN IF NOT EXISTS action_required BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE settlement_reconciliation_runs
  DROP CONSTRAINT IF EXISTS settlement_reconciliation_runs_classification_check;

ALTER TABLE settlement_reconciliation_runs
  ADD CONSTRAINT settlement_reconciliation_runs_classification_check CHECK (
    classification IN (
      'informational',
      'discrepancy',
      'actionable_incident'
    )
  );

CREATE INDEX IF NOT EXISTS settlement_reconciliation_runs_classification_idx
  ON settlement_reconciliation_runs (classification, action_required, completed_at DESC);
