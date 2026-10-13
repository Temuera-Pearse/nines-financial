-- Individual NINES movements and current balances remain bounded by NUMERIC(20,0).
-- Lifetime debit/credit counters can legitimately exceed that bound after funds
-- move through the same account repeatedly, while their difference remains a
-- valid NUMERIC(20,0) balance.

ALTER TABLE account_balances
  ALTER COLUMN total_debits_minor TYPE NUMERIC(38,0),
  ALTER COLUMN total_credits_minor TYPE NUMERIC(38,0);
