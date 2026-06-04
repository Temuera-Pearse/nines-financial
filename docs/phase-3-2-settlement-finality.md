# Phase 3.2 Settlement Finality

Date: 2026-04-29

Phase 3.2 makes `nines-financial` settlement terminal, replay-safe, and tied to
pool and bet lifecycle state.

## Authority Boundary

- `financial_bets` is the canonical source for accepted financial bets.
- Backend-local bet rows are non-authoritative read models only.
- `nines-back-end` submits race result inputs: `raceId`,
  `winningSelectionId`, `houseTakeBps`, and correlation metadata.
- `nines-financial` owns settlement finality, payout calculation, ledger
  postings, terminal bet states, settlement runs, and pool terminal state.

## Settlement Run Lifecycle

Settlement runs are persisted in `settlement_runs`.

States:

- `pending`
- `running`
- `posting_required`
- `completed`
- `failed`
- `manual_review`

The normal command path creates a `running` run and completes it in the same
transaction that posts ledger entries, marks bets terminal, and marks the pool
settled. One completed settlement is allowed per race. Duplicate commands with
the same idempotency key and command fingerprint replay the original response.
Conflicting commands after completion are rejected.

## Pool Lifecycle

Pool states are now:

- `open`
- `frozen`
- `settlement_running`
- `settled`
- `voided`
- `manual_review`

Settlement starts only from `frozen`. The `settlement_running` transition and
the terminal `settled` transition commit atomically with settlement postings
and bet terminal states. `settled` and `voided` are terminal outside explicit
remediation.

## Bet Terminal Lifecycle

Financial bet states are:

- `accepted`
- `rejected`
- `settlement_pending`
- `settled_win`
- `settled_loss`
- `voided`
- `manual_review`

Accepted bets move to `settlement_pending` when settlement starts, then to
`settled_win` or `settled_loss` before the transaction commits. Rejected bets
remain rejected. A completed settlement must not leave accepted or pending bets
for that race.

## Settlement Formula

All money math uses USDC minor-unit strings and `bigint`.

- `acceptedStakeMinor = sum(accepted financial_bets.stakeMinor)`
- `appliedCarryoverMinor = sum(applied settlement_carryovers for race)`
- `grossPoolMinor = acceptedStakeMinor + appliedCarryoverMinor`
- `houseTakeMinor = floor(acceptedStakeMinor * houseTakeBps / 10000)`
- `netPoolMinor = acceptedStakeMinor - houseTakeMinor + appliedCarryoverMinor`
- winning payout uses proportional proration:
  `floor(netPoolMinor * winningBetStakeMinor / totalWinningStakeMinor)`
- remainder units are assigned deterministically by largest remainder, then
  `betId` ascending

The backend does not submit `acceptedBets` or `totalPoolMinor`; those values are
read from `financial_bets` and applied carryovers.

## Empty And No-Winning Policies

Empty frozen pools complete with:

- `totalPoolMinor = "0"`
- no ledger postings
- pool `settled`
- completed settlement run

When no accepted bet backed the winning selection:

- house take is applied if configured
- all accepted bets become `settled_loss`
- the remaining net pool is moved to a pending carryover liability account
- `settlement_carryovers` records the pending rollover
- the settlement completes with `reasonCode =
  "NO_WINNING_STAKE_ROLLOVER"`

Phase 3.3 applies pending carryovers to future eligible pools and provides
explicit manual-review remediation.

## Reconciliation Detection

Detection is available at:

```http
GET /races/:raceId/settlement-reconciliation
```

Detected cases include:

- completed settlement with accepted or pending financial bets
- settled pool without a completed settlement run
- completed settlement run with pool not settled
- duplicate completed settlement runs
- settlement clearing residual without a pending carryover
- pending carryover with an eligible future pool
- stale manual-review pool or settlement run
- stuck non-terminal settlement run
- applied carryover ledger mismatch

This is detection only. Automatic repair remains out of scope.
