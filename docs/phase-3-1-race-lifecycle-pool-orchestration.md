# Phase 3.1 Race Lifecycle / Financial Pool Orchestration

Date: 2026-04-29

Phase 3.1 wires `nines-back-end` race lifecycle events to the
`nines-financial` betting pool lifecycle.

## Authority Boundary

- `nines-financial.financial_bets` is the canonical source for accepted
  financial bets.
- `nines-financial.race_pools` and `race_pool_selections` are the canonical
  source for financial pool lifecycle and valid selections.
- `nines-back-end` remains the canonical source for race engine timing,
  lifecycle, and results.
- Backend-local bet rows are non-authoritative read models for UI,
  performance, and legacy compatibility.

## Backend-Driven Lifecycle

Normal race flow no longer requires manual pool setup:

- race seeded/opened for betting -> `CreateRacePool`
- each valid horse/selection -> `RegisterPoolSelection`
- backend betting close/race start -> `FreezePool`
- race settlement -> backend submits race result inputs to `SettleBet` only
  after the pool is frozen; `nines-financial` reads canonical accepted bets

The pool lifecycle commands are safe under duplicate backend lifecycle events.
Matching duplicate create/register/freeze commands return existing state without
creating duplicate pool rows, selection rows, or lifecycle audit events.

## Settlement Validation

As of Phase 3.2, `SettleBet` validates:

- the financial race pool exists
- the financial race pool is frozen
- the winning selection is registered and active
- canonical accepted `financial_bets` rows are the settlement inputs

The backend settlement path no longer submits payout truth or accepted bet
lists. Backend-local bet drift is a read-model recovery concern.

## Recovery Scaffolding

Phase 3.1 adds detection-oriented recovery scaffolding, not a full automatic
repair engine. Supported detection cases:

- financial accepted bet exists but backend local read-model row is missing
- backend local pending bet exists but no financial accepted bet exists
- backend race exists but no financial race pool exists
- backend race is closed/finished while the financial pool remains open

## Remaining Limitations

- Detection helpers report drift but do not automatically repair local read
  models or replay failed orchestration steps.
- Phase 3.2 adds terminal settlement state. Phase 3.3 adds explicit pending
  carryover application to future eligible pools.
