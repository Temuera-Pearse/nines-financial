# Phase 3.3 Carryover Recovery

Date: 2026-04-29

Phase 3.3 makes pending settlement carryovers usable, adds explicit
manual-review remediation commands, and expands recovery detection. Financial
truth remains in `nines-financial`; operators can re-drive or remediate
commands, but no automatic repair changes financial state silently.

## Carryover Lifecycle

Carryovers are stored in `settlement_carryovers`.

States:

- `pending`
- `applied`
- `voided`

Normal lifecycle:

- no-winning-stake settlement creates a `pending` carryover
- `ApplyCarryoversToRace` moves eligible carryovers to `applied`
- applied carryovers record `applied_to_race_id`, `application_id`,
  `application_transaction_id`, and `applied_at`
- a carryover can be applied at most once

The application command is idempotent by command idempotency key and command
fingerprint. Duplicate commands replay the original application response.

## Eligibility Rule

The default eligibility rule is deterministic:

- use the next chronological pool after the source race
- chronology is `bettingOpensAt`, falling back to `createdAt`
- `raceId` breaks ties
- only `open` and `frozen` pools are eligible application targets
- if no eligible future pool exists, the carryover remains `pending`

Applying to a settled, voided, manual-review, or settlement-running pool is
rejected.

## Accounting Treatment

No-winning-stake settlement posts the remaining net pool into a carryover
liability account:

```text
Dr settlement_clearing:race:<sourceRaceId>
Cr race_selection_pool:settlement:carryover:<sourceRaceId>
```

Carryover application posts that amount into the target race's settlement
clearing account:

```text
Dr race_selection_pool:settlement:carryover:<sourceRaceId>
Cr settlement_clearing:race:<targetRaceId>
```

Settlement treats applied carryovers as distributable pool basis. House take is
calculated only on newly accepted stake, not on already-carried rollover value.

Formula:

- `acceptedStakeMinor = sum(accepted financial_bets.stakeMinor)`
- `appliedCarryoverMinor = sum(applied carryovers for race)`
- `totalPoolMinor = acceptedStakeMinor + appliedCarryoverMinor`
- `houseTakeMinor = floor(acceptedStakeMinor * houseTakeBps / 10000)`
- `netPoolMinor = acceptedStakeMinor - houseTakeMinor + appliedCarryoverMinor`

## Commands

Added command endpoints:

```http
POST /commands/apply-carryovers-to-race
POST /commands/mark-settlement-manual-review
POST /commands/resolve-settlement-manual-review
POST /commands/void-pool-from-manual-review
```

Read support:

```http
GET /carryovers?status=pending|applied|voided
GET /carryovers?sourceRaceId=<raceId>
GET /carryovers?targetRaceId=<raceId>
GET /races/:raceId/pool
GET /races/:raceId/pool-totals
```

Pool reads include a carryover summary. Pool totals include accepted stake,
applied carryover, and distributable basis.

## Manual Review

Manual review is explicit and audited in `settlement_remediation_actions`.

Supported flows:

- `MarkSettlementManualReview`
  - moves non-terminal pools to `manual_review`
  - creates or updates a settlement run to `manual_review`
  - blocks normal settlement because settlement can start only from `frozen`
- `ResolveSettlementManualReview`
  - moves a manual-review pool back to `frozen`
  - marks the manual-review run `failed`
  - allows a new settlement command to be submitted
- `VoidPoolFromManualReview`
  - moves a manual-review pool to `voided`
  - marks the manual-review run `failed`

Invalid transitions are rejected. `settled` and `voided` pools cannot be moved
into manual review through the normal remediation commands.

## Recovery Expectations

Operators should use idempotent commands to re-drive incomplete orchestration:

- re-submit `ApplyCarryoversToRace` for an eligible race pool
- re-submit settlement with the same idempotency key to replay a completed
  result
- resolve manual review to `frozen` only after the anomaly is understood
- void from manual review only with an explicit operator reason

Direct database edits are not part of the supported recovery model.

## Reconciliation Detection

`GET /races/:raceId/settlement-reconciliation` now also detects:

- pending carryover with an eligible future pool
- stale manual-review pool
- stale manual-review settlement run
- stuck non-terminal settlement run
- applied carryover missing a ledger reference
- applied carryover amount mismatching its application ledger posting

Detection remains read-only. It reports drift and operator work items; it does
not repair balances, carryovers, runs, or pool state automatically.

## Phase 3.4 Closeout

Phase 3.4 adds backend orchestration for `ApplyCarryoversToRace` during normal
race pool opening, guarded operator/admin remediation routes, and durable
reconciliation run summaries.

## Remaining Limitations

- Admin UI is limited to command/read endpoints; no dedicated operator screen
  has been added yet.
- Remediation can resolve to retry or void, but does not yet support completing
  a settlement directly from manual review with custom posted effects.
