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
- authenticated API funding-attestation consumption, exact scale-6
  USDC-to-NINES issuance, and a durable Security evidence outbox
- authenticated Stage 3 issuance-authorization consumption with exact
  pre-authorized NINES posting and deterministic replay acknowledgement

## Hard invariants

- ledger transactions must remain balanced and single-currency
- ledger rows are append-only; follow-up actions create new rows instead of mutating old ones
- only the accounting core may write ledger entries or account balance read-model rows
- user available and locked balances may not go negative
- reservations may be resolved once only
- `account_balances` is a derived read model and must stay reconcilable from ledger entries
- idempotency keys are command-scoped and persisted with posted ledger transactions for audit traceability
- NINES is a separate scale-6 currency; token purchase debits
  `token_purchase_clearing` and credits the player's NINES `user_available`
  account exactly once
- all new wagering pools, stakes, settlement payouts, house take, and
  carryover are NINES-denominated; one NINES represents NZ$1 of internal
  wagering value and amounts remain integer scale-6 minor units
- legacy USDC wagering rows remain persisted and readable, but active wagering
  commands accept only NINES and never combine the two currencies
- accepted consumption and its ledger posting are atomically and
  bidirectionally coupled by deferred PostgreSQL constraint triggers
- committed ledger transactions and entries are append-only; corrections use
  new compensating transactions
- `(provider, paymentReference)` is the economic external-source identity and
  is unique independently of confirmation-event evidence

## API funding boundary

`POST /internal/v1/funding-attestations` accepts authenticated `nines-api` v1
attestations. Financial validates scale-6 USDC, provisions a NINES account,
rechecks local account controls, and owns conversion and posting under
`usdc-to-nines-par-v1`. Attestations past `automaticProcessingUntil` become
`review_required` without ledger movement. The legacy provider lifecycle is
test/nonproduction-only and cannot run beside this path in production.

The boundary supports HMAC-SHA256 over HTTPS in production. Its primary API
credential is configured with `NINES_API_AUTH_HMAC_SECRET` and
`NINES_API_AUTH_KEY_ID`. During rotation,
`NINES_API_AUTH_HMAC_ADDITIONAL_KEYS` may contain a JSON object mapping each
additional accepted key ID to its secret. Financial to Security delivery uses
the independent `NINES_SECURITY_AUTH_HMAC_SECRET` and
`NINES_SECURITY_AUTH_KEY_ID` pair. `NINES_SERVICE_AUTH_HMAC_SECRET` and
`NINES_SERVICE_AUTH_KEY_ID` remain development/test compatibility variables
and are never used as production fallbacks. `NINES_SERVICE_AUTH_MODE=external`
remains reserved but is not implemented.

`POST /internal/v1/nines-issuance-authorizations` consumes the immutable
valuation-derived authorization produced by `nines-api`. Financial validates
the complete contract and exact `NZD cents * 10,000` relationship, then
atomically records one consumption, debits platform
`token_purchase_clearing`, credits the player's NINES `user_available`
account, updates the balance read model, and writes Security outbox evidence.
An identical replay returns `already_consumed` with the original consumption
and ledger transaction IDs; conflicting reuse of any economic identity fails
closed. Migration 020 also prevents the Stage 4 and legacy v1 paths from
consuming the same funding source.

## First-production HTTP boundary

The deployed server requires an explicit `NODE_ENV`. `npm run dev` supplies
`NODE_ENV=development` for local convenience, while `npm start` fails closed if
the environment is missing or invalid.

`NODE_ENV=production` selects the fixed `production-funding-only` route
profile. That profile mounts only:

- `GET /health`
- `GET /ready`
- `POST /internal/v1/funding-attestations`, when the funding integration and
  its API-specific HMAC credentials are enabled
- `POST /internal/v1/nines-issuance-authorizations`, under the same explicit
  integration and credential gate

The public production readiness response is intentionally limited to
`{"status":"ready"}` or `{"status":"not_ready"}`. Database and migration
checks still run, pending migrations return `503`, and internal details are not
returned over HTTP.

The production boundary rejects implicit `HEAD` and `OPTIONS` handling plus
case, trailing-slash, dot-segment, encoded, and duplicate-slash aliases. Query
strings do not alter the canonical funding path used by the service signature.
`npm run build` copies every SQL migration into `dist/src/migrations` and
verifies the built filename set, file hashes, and compiled server resolution.

All account, player, admin, ledger, betting, settlement, legacy deposit,
withdrawal, provider-simulation, and system-maintenance routes are mounted only
by the nonproduction `full-simulation` profile. Production does not mount these
routers, even if a legacy route flag is supplied. The legacy deposit lifecycle
is rejected by production configuration.

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
    defaulting to active wagering currency `NINES`; legacy `USDC` remains
    queryable explicitly
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

## Authenticated NINES wager intake (Stage W1)

`POST /internal/v1/wagers/place-bet` is the sole production wager boundary. It
accepts `NinesPlaceBetCommandV1` only from HMAC-authenticated
`nines-back-end`, validates a short-lived player assertion bound to the exact
`playerId`, and delegates to the existing betting intake service. Each HTTP
attempt uses a unique transport nonce; the immutable economic command retains
its original idempotency key across retries.

Financial `race_id` is the backend's private `race_id`, which is the economic
primary key. `race_ref` is carried for public display/correlation only and is
not used as the ledger identity. For an accepted wager, Financial debits the
player's NINES available account and credits the same player's NINES reserved
(displayed as locked) account.

## Authenticated race lifecycle projection (Stage W2)

`POST /internal/v1/race-lifecycle-events` accepts versioned, HMAC-authenticated
race-open and betting-close evidence from `nines-back-end`. The private backend
`raceId` remains the Financial economic primary key; `raceRef` is persisted as
public evidence. Race-open atomically creates the NINES pool, maps every backend
runner ID directly to a selection ID, freezes the betting window, and snapshots
the house-take, carryover, allocation, and rounding policy identities. Race-close
advances the append-only lifecycle sequence and freezes the pool.

Migration 022 makes lifecycle evidence append-only and prevents changes to the
authoritative window, runner identities, or policy. PostgreSQL serializes pool
freeze against wager insertion, so a wager either commits with its exact stake
reservation before closure or is rejected without movement. W2 introduces no
result, winner, settlement, payout, or carryover execution behavior.

## Authenticated race result and settlement (Stage W3)

`POST /internal/v1/race-results` accepts only the versioned, HMAC-authenticated
`nines_race_completed.v1` contract from `nines-back-end`. Financial verifies the
canonical evidence hash, environment, issuer/audience, W2 race and close-event
linkage, and the winner/finish order against the immutable selection snapshot.
It persists one append-only authoritative result per NINES race.

Settlement consumes the house-take, carryover, allocation, and rounding policy
already frozen on the W2 pool; the caller cannot supply or override economic
policy. The existing exact-minor-unit settlement engine performs stake capture,
house take, proportional largest-remainder payouts, or no-winner carryover. The
durable result state machine is `pending` to `running` to `completed`; identical
delivery replays the original acknowledgement, while changed evidence or a
second result for the race fails closed. Migration 023 links the completed
settlement run to its authoritative result and makes both terminal records
immutable.

## Core-loop integration and soak drill (Stage I1)

The opt-in Stage I1 drill runs the actual backend race repository, lifecycle and
result outboxes/workers, authenticated HTTP clients, Financial routes, issuance
consumption, wagering, carryover, settlement, ledger, and balance rebuild paths
against two fresh PostgreSQL databases. It runs the deterministic 100-race
scenario twice and can run a configurable 1,000+ race soak with a PostgreSQL
container restart while durable delivery work is pending.

The target must be an explicitly disposable PostgreSQL instance. Set
`NINES_I1_ENABLED=1`, `NINES_I1_BACKEND_DISPOSABLE_PG_URL`,
`NINES_I1_BACKEND_DISPOSABLE_PG_ALLOW_RESET=1`,
`NINES_FINANCIAL_REAL_PG_URL`, `NINES_FINANCIAL_REAL_PG_ALLOW_RESET=1`, and run
`npm run test:i1`. Both database names must identify test/disposable databases
and must be distinct. For the long
soak also set `NINES_I1_SOAK_ENABLED=1`, `NINES_I1_SOAK_RACES` (at least 1000),
and `NINES_I1_POSTGRES_CONTAINER`. The harness destructively resets the
Financial schema and truncates backend race tables; it must never target shared
or production data.

## Authoritative wager cutoff (Stage I1.1)

For W2-projected pools, an otherwise valid wager is eligible only when the
Financial service's trusted `Clock` reports a time strictly before the immutable
`betting_closes_at` value and the pool remains open. Production constructs this
clock as `SystemClock`; request timestamps and player/client clocks never decide
wager eligibility. The check is repeated inside the wager transaction after the
pool row is locked. Equality with, or any time after, the cutoff is rejected even
if the close lifecycle event is delayed and the projection still says `open`.
The PostgreSQL lifecycle bet trigger provides a second server-side guard.

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
- `npm run db:migrate` for source/development execution
- `npm run db:migrate:production` after `npm run build` for compiled production execution
- `npm run test:real-postgres`

## Environment

- `PORT` optional, defaults to `3000`
- `DATABASE_URL` required for readiness checks, runtime startup, and PostgreSQL-backed execution
- `NINES_FINANCIAL_REAL_PG_URL` optional, enables destructive real PostgreSQL
  drill tests when combined with `NINES_FINANCIAL_REAL_PG_ALLOW_RESET=1`
- `NINES_BACKEND_RACE_LIFECYCLE_ENABLED` enables the authenticated lifecycle
  endpoint and uses the same receiver-side backend HMAC key ring as W1
- `NINES_BACKEND_RACE_RESULT_ENABLED` enables the authenticated authoritative
  result endpoint and uses the same receiver-side backend HMAC key ring
- `NINES_RACE_RESULT_RECOVERY_ENABLED` enables startup and periodic autonomous
  settlement recovery for durably accepted results (defaults to `true`; the
  worker runs only when authoritative result ingestion is enabled)
- `NINES_RACE_RESULT_RECOVERY_POLL_INTERVAL_MS`,
  `NINES_RACE_RESULT_RECOVERY_LEASE_MS`,
  `NINES_RACE_RESULT_RECOVERY_MAX_ATTEMPTS`, and
  `NINES_RACE_RESULT_RECOVERY_BATCH_SIZE` bound polling, claim expiry, retries,
  and startup/periodic batch work
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
