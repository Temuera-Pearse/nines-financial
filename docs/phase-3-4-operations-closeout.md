# Phase 3.4 Operations Closeout

Date: 2026-04-30

Phase 3.4 closes the Phase 3 settlement operations loop with automatic
carryover application orchestration, guarded remediation commands, minimal
operator read endpoints, durable reconciliation run summaries, and runbooks.

## Normal Race Pool Opening

`nines-back-end` now calls `ApplyCarryoversToRace` as part of race pool opening
after `CreateRacePool` and `RegisterPoolSelection` have completed. The command
uses a deterministic race-scoped idempotency key:

```text
race:<raceId>:carryovers:apply
```

If no pending carryover is eligible, the result is a zero-amount no-op summary
and no application row, outbox event, ledger transaction, or settlement-clearing
account is persisted. This keeps later retries with the same race-scoped key
able to apply a carryover that becomes eligible after pool opening. If an
eligible carryover exists, `nines-financial` applies it exactly once to the next
chronological open/frozen pool.

## Operator Guard

Manual-review remediation commands require:

- `x-nines-authenticated-user-id`
- `x-nines-operator-role`

Accepted roles:

- `admin`
- `operator`
- `settlement_operator`
- `finance_operator`

The route layer stamps the authenticated operator ID onto the command payload.
The request body cannot spoof `operatorId`.

Guarded commands:

```http
POST /commands/mark-settlement-manual-review
POST /commands/resolve-settlement-manual-review
POST /commands/void-pool-from-manual-review
```

## Operator Read Endpoints

Minimal operator/admin reads are available under `/admin/operations`:

```http
GET /admin/operations/carryovers
GET /admin/operations/manual-review
GET /admin/operations/reconciliation/races/:raceId
POST /admin/operations/reconciliation/races/:raceId/runs
GET /admin/operations/reconciliation/runs
```

The public/internal read endpoints remain available for service integration,
but `/admin/operations/*` requires the operator guard.

## Reconciliation Run Summaries

`POST /admin/operations/reconciliation/races/:raceId/runs` records a durable
summary in `settlement_reconciliation_runs`.

Each summary stores:

- run ID
- race and currency
- status
- classification and action-required flag
- issue, warning, and error counts
- issue snapshot
- operator ID
- idempotency/correlation/causation metadata
- created/completed timestamps

The run is detection-only. It does not repair settlement, pool, bet, ledger, or
carryover state.

## Runbooks

### Pending Carryover Exists

1. Check `GET /admin/operations/carryovers?status=pending`.
2. Check whether the source race has a next eligible open/frozen pool.
3. If normal backend orchestration missed the application, re-submit
   `POST /commands/apply-carryovers-to-race` with the target race ID.
4. Run `POST /admin/operations/reconciliation/races/:raceId/runs`.
5. Confirm the pending carryover moved to `applied` and has an application
   ledger transaction.

### Manual Review Pool

1. Check `GET /admin/operations/manual-review`.
2. Inspect `GET /admin/operations/reconciliation/races/:raceId`.
3. If the anomaly is resolved and settlement should retry, call
   `ResolveSettlementManualReview`.
4. If the pool must not settle, call `VoidPoolFromManualReview`.
5. Re-run reconciliation and keep the run summary with the incident ticket.

### Backend Settled, Financial Settlement Missing

1. Use backend `GET /settlements/reconciliation/races/:raceId`.
2. Confirm the financial pool state with
   `GET /admin/operations/reconciliation/races/:raceId`.
3. If the pool is frozen and the winner is valid, re-submit backend settlement
   orchestration.
4. If financial state is manual review or invalid, follow the manual-review
   runbook.

### Stuck Settlement Run

1. Run admin reconciliation for the race.
2. If the run is non-terminal past the threshold, mark manual review.
3. Do not patch DB rows directly.
4. Resolve for retry or void only through guarded remediation commands.

## Remaining Limitations

- Admin visibility is endpoint-level, not a polished operator UI.
- Reconciliation run summaries are per-race settlement summaries, not a full
  cross-domain reconciliation engine.
- Remediation supports resolve-for-retry or void. Direct completion from manual
  review remains out of scope.
