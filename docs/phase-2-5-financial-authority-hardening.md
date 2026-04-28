# Phase 2.5 Financial Authority Hardening Notes

## Authority Boundary

`nines-financial` is the only real authority for ledger writes, balances,
reservations, funding, withdrawals, account controls, and settlement.

The following paths outside `nines-financial` are alpha-only compatibility
paths. They must not be used as real financial truth:

- `nines-back-end/src/services/walletService.ts`
  - alpha-only wallet balance mutation and wallet ledger writes
  - guarded by `NINES_DISABLE_LEGACY_ALPHA_FINANCIAL_MUTATIONS`
- `nines-back-end/src/services/betService.ts`
  - alpha-only local stake debit during bet placement
  - durable reserve-stake flow must move to `nines-financial`
- `nines-back-end/src/services/settlementService.ts`
  - alpha-only fixed payout settlement placeholder
  - final payout truth must move to `nines-financial`
- `nines-front-end/src/state/fundingStore.ts`
  - alpha-only local USDC balance preview state
  - durable balances must come from `nines-financial`

## Remaining Deviations

- Account-control HTTP commands require idempotency keys and persist control
  state, but full replay snapshots for duplicate account-control commands are
  not yet implemented. Add `IdempotencyService` coverage around
  `AccountControlService` before treating duplicate admin commands as safely
  replayable.
- `nines-back-end` still keeps alpha wallet, bet, and settlement tables for
  demo continuity. These are now explicitly guarded and documented, but the
  replacement command client to `nines-financial` is still pending.
- Withdrawals remain late-phase and should not be exposed as mature admin or
  frontend flows.
