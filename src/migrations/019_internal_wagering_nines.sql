-- Keep legacy USDC wagering rows valid while allowing all new application-level
-- wagering commands to persist NINES. The command boundary is intentionally
-- stricter than these coexistence constraints.

ALTER TABLE race_pools
  DROP CONSTRAINT IF EXISTS race_pools_currency_check;
ALTER TABLE race_pools
  DROP CONSTRAINT IF EXISTS race_pools_constraint_1;
ALTER TABLE race_pools
  ADD CONSTRAINT race_pools_currency_check
  CHECK (currency IN ('USDC', 'NINES'));

ALTER TABLE race_pool_selections
  DROP CONSTRAINT IF EXISTS race_pool_selections_currency_check;
ALTER TABLE race_pool_selections
  DROP CONSTRAINT IF EXISTS race_pool_selections_constraint_1;
ALTER TABLE race_pool_selections
  ADD CONSTRAINT race_pool_selections_currency_check
  CHECK (currency IN ('USDC', 'NINES'));

ALTER TABLE financial_bets
  DROP CONSTRAINT IF EXISTS financial_bets_currency_check;
ALTER TABLE financial_bets
  DROP CONSTRAINT IF EXISTS financial_bets_constraint_2;
ALTER TABLE financial_bets
  ADD CONSTRAINT financial_bets_currency_check
  CHECK (currency IN ('USDC', 'NINES'));

ALTER TABLE settlement_runs
  DROP CONSTRAINT IF EXISTS settlement_runs_currency_check;
ALTER TABLE settlement_runs
  DROP CONSTRAINT IF EXISTS settlement_runs_constraint_1;
ALTER TABLE settlement_runs
  ADD CONSTRAINT settlement_runs_currency_check
  CHECK (currency IN ('USDC', 'NINES'));

ALTER TABLE settlement_carryovers
  DROP CONSTRAINT IF EXISTS settlement_carryovers_currency_check;
ALTER TABLE settlement_carryovers
  DROP CONSTRAINT IF EXISTS settlement_carryovers_constraint_1;
ALTER TABLE settlement_carryovers
  ADD CONSTRAINT settlement_carryovers_currency_check
  CHECK (currency IN ('USDC', 'NINES'));

ALTER TABLE settlement_carryover_applications
  DROP CONSTRAINT IF EXISTS settlement_carryover_applications_currency_check;
ALTER TABLE settlement_carryover_applications
  DROP CONSTRAINT IF EXISTS settlement_carryover_applications_constraint_1;
ALTER TABLE settlement_carryover_applications
  ADD CONSTRAINT settlement_carryover_applications_currency_check
  CHECK (currency IN ('USDC', 'NINES'));

ALTER TABLE settlement_remediation_actions
  DROP CONSTRAINT IF EXISTS settlement_remediation_actions_currency_check;
ALTER TABLE settlement_remediation_actions
  DROP CONSTRAINT IF EXISTS settlement_remediation_actions_constraint_2;
ALTER TABLE settlement_remediation_actions
  ADD CONSTRAINT settlement_remediation_actions_currency_check
  CHECK (currency IN ('USDC', 'NINES'));

ALTER TABLE settlement_reconciliation_runs
  DROP CONSTRAINT IF EXISTS settlement_reconciliation_runs_currency_check;
ALTER TABLE settlement_reconciliation_runs
  DROP CONSTRAINT IF EXISTS settlement_reconciliation_runs_constraint_1;
ALTER TABLE settlement_reconciliation_runs
  ADD CONSTRAINT settlement_reconciliation_runs_currency_check
  CHECK (currency IN ('USDC', 'NINES'));
