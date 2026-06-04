# Nines Financial

Phase 2.5 financial authority service for Nines.

`nines-financial` is the only authority for ledger writes, balances,
reservations, funding, withdrawals, account controls, and settlement. Other
repos may request financial commands, but they must not own or mutate financial
truth.

## Current scope

- chart of accounts and account entity model
- append-only ledger transactions and entries
- atomic posting engine with idempotency enforcement
- account balance read model
- persisted player accounts linked to canonical `user_available` and
  `user_locked` ledger accounts
- persisted account restrictions, suspensions, and freezes
- financial race pools, pool selections, accepted/rejected financial bets, and
  live pool totals
- terminal settlement runs, applied/pending carryovers, and manual-review
  remediation records
- settlement reconciliation run classifications for operator triage
- alpha-safe deposit intents, replay-protected signed simulated provider
  deposit webhooks, operator review resolution, and ledger-backed deposit
  crediting
- alpha-safe withdrawal requests, ledger-backed reservation, operator approval,
  cancellation/rejection release, simulated provider submission state, and
  ledger-backed simulated finalization/failure resolution with signed
  replay-protected withdrawal provider callbacks and no real external sends
- operational discrepancy queue, reconciliation materialization, financial
  health diagnostics, risk freeze controls, and incident investigation
  timelines
- opt-in real PostgreSQL production drills for settlement concurrency,
  interruption, and restart/replay checks
- player/admin account HTTP routes mounted through handlers and services
- outbox scaffolding for durable financial events
- internal HTTP handlers for account, reservation, readiness, and maintenance workflows
- tests for ledger and idempotency invariants

## Hard invariants

- ledger transactions must remain balanced and single-currency
- ledger rows are append-only; follow-up actions create new rows instead of mutating old ones
- only the accounting core may write ledger entries or account balance read-model rows
- user available and locked balances may not go negative
- reservations may be resolved once only
- `account_balances` is a derived read model and must stay reconcilable from ledger entries
- idempotency keys are command-scoped and persisted with posted ledger transactions for audit traceability

## Ownership boundaries

- treasury, settlement, and bet-intake call accounting services or ports; they do not write ledger state directly
- account freezing affects posting eligibility but does not bypass ledger ownership rules
- operational repair of `account_balances` must use the accounting maintenance path rather than ad hoc SQL
- `financial_bets` is the canonical accepted-bet source. Backend-local bet
  tables are read models only.
- race timing/results stay in `nines-back-end`; financial pool and accepted bet
  state stay in `nines-financial`.

## Operational endpoints

- `GET /health` for liveness only
- `GET /ready` for DB and migration readiness
- `GET /races/:raceId/pool` to inspect financial pool lifecycle state and
  registered selections
- `GET /carryovers` to inspect pending/applied/voided carryovers
- `GET /races/:raceId/settlement-reconciliation` to detect settlement,
  carryover, and manual-review drift
- `GET /admin/operations/*` for guarded operator carryover, manual-review, and
  reconciliation readouts; reconciliation runs are detection-only and classify
  clean summaries, discrepancies, and actionable incidents
- `POST /deposit-intents` and `GET /deposit-intents/:id` for player deposit
  intent lifecycle
- `POST /provider-events/deposits` for guarded simulated provider callbacks
- `POST /provider-events/deposits/webhook/:provider` for signed simulated
  provider webhooks
- `POST /deposits/provider-events/:id/{mark-reviewed-no-credit,reject,link-intent,approve-credit,retry-credit}`
  for guarded operator deposit review resolution
- `GET /deposits/review` and
  `GET /admin/operations/deposits/reconciliation` for guarded deposit review
  and reconciliation readouts
- `POST /withdrawal-requests`, `GET /withdrawal-requests/:id`, and
  `POST /withdrawal-requests/:id/{approve,reject,cancel,submit,sync-provider-status,finalize,release-after-provider-failure,mark-provider-failure-terminal,mark-provider-unknown-reviewed}`
  for alpha-safe withdrawal request and simulated provider workflow
- `POST /provider-events/withdrawals/webhook/:provider` for signed simulated
  withdrawal provider callbacks
- `GET /withdrawal-requests/review` and
  `GET /admin/operations/withdrawals/reconciliation` for guarded withdrawal
  review and reconciliation readouts
- `POST /admin/operations/reconciliation/run` and
  `GET /admin/operations/discrepancies` for durable operational discrepancy
  materialization and triage
- `POST /admin/operations/discrepancies/:id/{acknowledge,assign,resolve,suppress,reopen}`
  for audited discrepancy workflow actions
- `GET /admin/operations/health/{ledger-balance-check,accounting-integrity,treasury-summary}`
  for read-only operational health diagnostics
- `POST /admin/risk/accounts/:playerId/{freeze,unfreeze}` and
  `GET /admin/risk/accounts/:playerId` for elevated account risk controls
- `GET /admin/operations/players/:playerId/financial-timeline`,
  `GET /admin/operations/deposits/:depositIntentId/timeline`, and
  `GET /admin/operations/withdrawals/:withdrawalRequestId/timeline` for
  incident investigation timelines
- `POST /admin/operations/balances/rebuild` for elevated, reason-protected
  balance read-model rebuilds
- `GET /system/balances/verify` to compare `account_balances` against ledger-derived totals
- `POST /system/balances/rebuild` to rebuild the derived balance table and emit an audit event

`POST /system/balances/rebuild` requires `x-correlation-id` and `x-causation-id` headers so repair activity stays traceable.

### Admin Phase 4 read-only control-plane contracts

`nines-financial` also exposes aggregate-only `GET` contracts for
`nines-admin` Mission Control. These endpoints are operational read models only:
they do not trigger settlements, move funds, create deposits, submit
withdrawals, resolve discrepancies, rebuild balances, or expose individual
player balances.

- `GET /admin/health`
  - service name, status, uptime, timestamp, database status, ledger status,
    and degraded flags when dependencies are unavailable
- `GET /admin/treasury/summary`
  - total player available, reserved, and display balances for a currency
    defaulting to `USDC`
  - platform clearing balances by account type where available
  - pending deposit and withdrawal counts and minor-unit totals
- `GET /admin/settlements/recent`
  - recent settlement summaries: race id, status, gross pool, house take, net
    pool, total winning stake, and settled timestamp
- `GET /admin/deposits/pending`
  - pending deposit count, total minor-unit amount, and oldest creation time
- `GET /admin/withdrawals/pending`
  - pending withdrawal count, total minor-unit amount, and oldest creation time
- `GET /admin/reconciliation/summary`
  - safe discrepancy counts only: open, critical, warning, and last run time

If a backing read model is unavailable, the endpoint returns zero counts with
`degraded` and/or `notImplemented` markers instead of inventing financial
incidents or live production numbers. Unsupported write methods (`POST`, `PUT`,
`PATCH`, `DELETE`) are intentionally not registered for these contracts.

## Startup safety

- service startup requires `DATABASE_URL`
- runtime startup refuses to listen if `schema_migrations` is unavailable or if SQL files exist that have not been applied
- production startup refuses missing `NINES_DEPOSIT_PROVIDER_WEBHOOK_SECRET`
- production startup refuses missing `NINES_WITHDRAWAL_PROVIDER_WEBHOOK_SECRET`
- withdrawal provider webhook replay windows must be positive integers
- readiness stays separate from liveness so orchestration can distinguish a live process from a usable service

## Commands

- `npm install`
- `npm run typecheck`
- `npm test`
- `npm run db:migrate`
- `npm run test:real-postgres`

## Environment

- `PORT` optional, defaults to `3000`
- `DATABASE_URL` required for readiness checks, runtime startup, and PostgreSQL-backed execution
- `NINES_FINANCIAL_REAL_PG_URL` optional, enables destructive real PostgreSQL
  drill tests when combined with `NINES_FINANCIAL_REAL_PG_ALLOW_RESET=1`
- `NINES_FINANCIAL_OPERATOR_SHARED_SECRET` optional, requires guarded operator
  endpoints to include `x-nines-operator-secret`
- `NINES_DEPOSIT_PROVIDER_WEBHOOK_SECRET` required in production mode and
  required to accept signed simulated provider deposit webhooks
- `NINES_DEPOSIT_WEBHOOK_REPLAY_WINDOW_SECONDS` optional, defaults to `300`
- `NINES_WITHDRAWAL_PROVIDER_WEBHOOK_SECRET` required in production mode and
  required to accept signed simulated provider withdrawal webhooks
- `NINES_WITHDRAWAL_WEBHOOK_REPLAY_WINDOW_SECONDS` optional, defaults to `300`

Tests use an in-memory PostgreSQL-compatible database and do not require an external instance.
Real PostgreSQL production drills are opt-in; see
`docs/phase-5-withdrawal-rails.md` and
`docs/phase-5-1-withdrawal-provider-boundary.md`, and
`docs/phase-5-2-withdrawal-finalization.md`, and
`docs/phase-5-3-withdrawal-production-security.md`, and
`docs/phase-6-operational-hardening.md`.
