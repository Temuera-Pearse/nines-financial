# Phase 3.6 Production Simulation

Date: 2026-04-30

Phase 3.6 adds production-simulation drills for settlement, carryover,
reconciliation, restart/replay, and operator controls before deposit rails.
It does not add deposit, withdrawal, provider, or UI scope.

## Real PostgreSQL Harness

The opt-in real PostgreSQL drill suite runs the normal HTTP handlers against
`PostgresDatabase`, resets a disposable database, and applies all SQL migrations
from a clean schema.

Required environment:

```sh
NINES_FINANCIAL_REAL_PG_URL=postgres://user:pass@localhost:5432/nines_financial_test
NINES_FINANCIAL_REAL_PG_ALLOW_RESET=1
```

Run:

```sh
npm run test:real-postgres
```

Optional setup diagnostics:

```sh
NINES_FINANCIAL_REAL_PG_DEBUG=1 npm run test:real-postgres
```

The debug flag prints JSON timing lines for `requireRealPostgresUrl`, schema
reset, each migration file, application container creation, and harness return.
The harness also configures PostgreSQL `lock_timeout=5s` and
`statement_timeout=60s` for setup connections so schema-reset or migration lock
contention fails with a named PostgreSQL error instead of waiting indefinitely.
Each test intentionally starts from a clean schema, applies all migrations,
builds the HTTP application, and then runs concurrency/interruption work against
Docker PostgreSQL.

If a local PostgreSQL server is already bound to `127.0.0.1:5432`, it can shadow
a Docker container that also publishes `5432`. In that case publish the
disposable container on another host port, for example `-p 55432:5432`, and use
that port in `NINES_FINANCIAL_REAL_PG_URL`.

Safety guard:

- The harness drops and recreates the `public` schema.
- The database name must contain `test`, `local`, or `dev`.
- `NINES_FINANCIAL_REAL_PG_ALLOW_NON_TEST_DB=1` bypasses that name check only
  for a known disposable database.

Without `NINES_FINANCIAL_REAL_PG_URL`, the drill file is skipped by the normal
`npm test` and `npm run verify` path.

## Concurrent Worker Drills

The real PostgreSQL suite covers concurrent workers for:

- same-race settlement commands with shared and competing idempotency keys
- carryover application with shared and competing idempotency keys
- manual-review mark and resolve attempts from multiple operators
- reconciliation run creation with the same idempotency key
- settlement replay after rebuilding the application container against the same
  database

Expected invariant checks:

- exactly one completed settlement run per race
- exactly one winning payout posting per settled winner
- losing bets leave no payout posting
- accepted bets do not remain accepted after completed settlement
- carryover application posts exactly once
- reconciliation run creation does not mutate ledger or settlement truth
- duplicate workers return only safe success or conflict responses

## Interruption Drills

The real PostgreSQL suite uses deterministic fault-injection hooks at critical
boundaries:

- after settlement state records are created and before ledger posting
- after settlement ledger posting and before state finalisation
- after settlement outbox writes and before response
- during carryover application after ledger posting and before state
  finalisation
- before and after reconciliation run persistence

The default fault injector is no-op. Tests inject one-shot failures and assert
that real PostgreSQL transactions roll back partial work, after which the same
command can be retried safely.

## Restart And Replay

The restart drill completes settlement, rebuilds a fresh application container
against the same database, and replays the same settlement command. The replay
must return the original durable result and must not mutate final financial
truth.

## Cross-Repo Diagnosis

Backend-settled/financial-missing diagnosis remains intentionally split:

1. Check backend reconciliation:
   `GET /settlements/reconciliation/races/:raceId`
2. Check financial reconciliation:
   `GET /admin/operations/reconciliation/races/:raceId`
3. Persist the financial operator snapshot:
   `POST /admin/operations/reconciliation/races/:raceId/runs`
4. If backend says settled but financial is missing or incomplete, inspect:
   backend race result status, financial pool status, settlement runs,
   `financial_bets`, carryovers, and settlement clearing balance.
5. Do not patch financial rows directly. Use remediation commands only after
   the desired outcome is known.

This is visible to operators but not yet unified into a single cross-service
operations console.

## Operator Auth Review

Guarded operator endpoints:

```http
GET /admin/operations/carryovers
GET /admin/operations/manual-review
GET /admin/operations/reconciliation/races/:raceId
POST /admin/operations/reconciliation/races/:raceId/runs
GET /admin/operations/reconciliation/runs
POST /commands/mark-settlement-manual-review
POST /commands/resolve-settlement-manual-review
POST /commands/void-pool-from-manual-review
```

Current identity inputs:

- `x-nines-authenticated-user-id`
- `x-nines-operator-role` or `x-nines-admin-role`
- optional `x-nines-operator-secret`

If `NINES_FINANCIAL_OPERATOR_SHARED_SECRET` is configured, operator routes
require `x-nines-operator-secret` and compare it with a timing-safe check. This
is a lightweight internal guard, not a replacement for production IdP/RBAC.

Before public deposit rails, production should wire these headers to a trusted
gateway or service mesh that authenticates operators and signs or injects
operator identity.

## Crash And Retry Runbook

1. Re-submit the same idempotency key if the caller timed out or crashed before
   receiving a response.
2. If replay returns a completed settlement result, do not submit a competing
   settlement command.
3. If replay returns active/in-progress conflict, run reconciliation and wait or
   move to manual review.
4. If reconciliation shows stuck non-terminal settlement state, use
   `MarkSettlementManualReview`.
5. Resolve for retry only when the incomplete state is understood.
6. Void only when the race/pool must not settle.
7. Keep the reconciliation run ID with the incident ticket.

## Residual Risk Before Phase 4

- The real PostgreSQL suite is opt-in and must be run against a disposable
  PostgreSQL database in CI or a release checklist before enabling deposit
  rails.
- Operator auth is still trusted-header based with an optional shared secret.
  Full IdP/RBAC integration remains a production dependency.
- Cross-service diagnosis is documented and test-covered, but backend and
  financial readouts are not yet merged into one operator console.

Phase 4 deposit rails are safe to begin only after `npm run test:real-postgres`
passes in the target deployment-like environment.
