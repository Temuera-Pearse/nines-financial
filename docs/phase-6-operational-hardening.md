# Phase 6 Operational Hardening

Phase 6 turns reconciliation and treasury controls into operator-manageable
workflows. It does not add new money movement, real providers, automatic
repairs, or product-facing UX.

## Discrepancy Queue

Reconciliation findings are materialized into `operational_discrepancies`.
Each discrepancy has a stable `dedupeKey`, category, severity, status, entity
reference, related metadata, summary, first/last detection timestamps, and
resolution metadata.

Statuses:

- `open`
- `acknowledged`
- `in_progress`
- `resolved`
- `suppressed`

Repeated scans refresh the same discrepancy instead of duplicating it. If a
resolved or suppressed issue is still detected later, the discrepancy reopens
and keeps its original history.

## Reconciliation Materialization

`POST /admin/operations/reconciliation/run` runs deposit reconciliation,
withdrawal reconciliation, and ledger balance verification, then persists
operator-actionable discrepancies. The response includes scanned issue count,
opened/refreshed/reopened counts, and status/severity summaries.

The scan is detection-only. It does not auto-credit deposits, auto-submit or
finalize withdrawals, release reservations, rebuild balances, or mutate ledger
state.

## Discrepancy Workflow

Operator workflow endpoints:

- `GET /admin/operations/discrepancies`
- `GET /admin/operations/discrepancies/:discrepancyId`
- `POST /admin/operations/discrepancies/:discrepancyId/acknowledge`
- `POST /admin/operations/discrepancies/:discrepancyId/assign`
- `POST /admin/operations/discrepancies/:discrepancyId/resolve`
- `POST /admin/operations/discrepancies/:discrepancyId/suppress`
- `POST /admin/operations/discrepancies/:discrepancyId/reopen`

Resolution, suppression, and reopen require a reason. Suppression requires an
elevated role. Every workflow transition appends immutable history in
`operational_discrepancy_history` and emits
`financial.operations.discrepancy_workflow`.

## Risk Controls

Risk endpoints:

- `POST /admin/risk/accounts/:playerId/freeze`
- `POST /admin/risk/accounts/:playerId/unfreeze`
- `GET /admin/risk/accounts/:playerId`

`scope: withdrawals` applies a withdrawal-reserve restriction. `scope:
all_financial` applies a full account freeze. Existing balances remain intact.
Future blocked actions are rejected through the account control service rather
than by direct balance mutation. Freeze and unfreeze require elevated role and
reason and emit operational audit events.

## Financial Health Checks

Read-only diagnostics:

- `GET /admin/operations/health/ledger-balance-check`
- `GET /admin/operations/health/accounting-integrity`
- `GET /admin/operations/health/treasury-summary`

These expose balance read-model mismatches, forbidden negative balances,
reservation aggregates, treasury pipeline totals, and open discrepancy counts.
They are intended for runbooks and dashboards, not automatic repair.

## Investigation Timelines

Read-only timeline endpoints:

- `GET /admin/operations/players/:playerId/financial-timeline`
- `GET /admin/operations/deposits/:depositIntentId/timeline`
- `GET /admin/operations/withdrawals/:withdrawalRequestId/timeline`

Timelines aggregate ledger transactions, deposit or withdrawal lifecycle rows,
and audit events so operators can reconstruct incident context without writing
ad hoc SQL.

## Rebuild And Verify

`POST /admin/operations/balances/rebuild` wraps the accounting balance rebuild
path with elevated RBAC and reason capture. The rebuild remains explicit and
audited. Phase 6 does not add destructive repair endpoints for financial
domain rows.

## RBAC And Audit

General operational read and triage actions accept operator-style roles such as
`finance_operator`, `treasury_operator`, `treasury_admin`, `financial_admin`,
and `admin`. Suppression, freeze/unfreeze, and rebuild require elevated roles:
`treasury_admin`, `financial_admin`, or `admin`.

Audit payloads include actor type, operator id, operator role, action, reason
where applicable, target entity, previous/new status where applicable, and
correlation/causation ids.

## Real PostgreSQL Drills

Real PostgreSQL drills remain opt-in because they may reset the configured
database:

- `NINES_FINANCIAL_REAL_PG_URL`
- `NINES_FINANCIAL_REAL_PG_ALLOW_RESET=1`

Phase 6 drill coverage includes concurrent reconciliation materialization,
discrepancy upsert races, concurrent workflow transitions, and freeze/unfreeze
race cases. Normal local and CI runs skip these drills by default.

## Runbook Notes

When reconciliation produces a discrepancy, operators should acknowledge it,
assign an owner, use timelines and health checks to inspect the related
ledger/provider/domain records, and then resolve only after the underlying
condition is gone. Suppression should be rare and reserved for known benign
conditions with a clear reason.

No Phase 6 workflow silently fixes financial drift. Ledger-backed corrections,
provider outcome resolution, and balance rebuilds remain explicit, audited
operator actions.
