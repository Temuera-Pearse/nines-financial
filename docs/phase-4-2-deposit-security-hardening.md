# Phase 4.2 Deposit Security Hardening

Date: 2026-05-04

Phase 4.2 is the final deposit hardening slice before withdrawals. It does not
add withdrawals, real provider integration, or external money movement.

## Webhook Replay Protection

Signed provider webhooks now require:

- `x-nines-provider-timestamp`
- `x-nines-provider-nonce`
- `x-nines-provider-signature`

The signature payload is:

```text
<timestamp>.<nonce>.<raw request body>
```

The simulated provider adapter verifies HMAC-SHA256 with constant-time
comparison. Missing or malformed timestamps, timestamps outside the configured
window, missing nonces, duplicate provider-scoped nonces, missing signatures,
invalid signatures, and malformed payloads are rejected before provider deposit
events can enter the deposit domain.

The replay window is configured with:

```sh
NINES_DEPOSIT_WEBHOOK_REPLAY_WINDOW_SECONDS=300
```

Accepted nonces are persisted in `provider_webhook_receipts` with provider,
nonce, provider timestamp, receipt time, and request hash. Duplicate nonce
attempts are recorded in `provider_webhook_rejections` for reconciliation and
audit visibility, but they do not create provider events and cannot credit a
deposit.

## Production Policy

When `NODE_ENV=production`, startup readiness requires:

```sh
NINES_DEPOSIT_PROVIDER_WEBHOOK_SECRET=...
```

Production startup and `/ready` fail if the secret is missing. Local and test
mode may keep using explicit test secrets from the harness; unsigned webhooks
are still rejected by the adapter whenever the webhook route is used.

## Operator Review Boundary

Deposit review commands are role-gated using the existing trusted operator
headers:

- `treasury_operator` may mark reviewed/no-credit, reject, link without
  override, and retry normal credit.
- `treasury_admin` and `financial_admin` may also approve credit and perform
  override-based review actions.

Risky paths still require explicit reason fields. Duplicate external
transactions and already credited intents remain non-overridable.

Each review action appends immutable audit metadata to `audit_events`, including
action, operator user id, operator role, reason or override reason, previous and
new status, deposit event id, deposit intent id when relevant, timestamp, and
ledger transaction id when a credit attempt reaches Accounting Core.

## Reconciliation Categories

Deposit reconciliation now uses explicit security and lifecycle categories:

- `actionable_review_required`
- `rejected_terminal`
- `reviewed_no_credit_terminal`
- `duplicate_external_transaction`
- `replay_rejected`
- `confirmed_uncredited`
- `credited_not_finalized`
- `late_event_for_expired_intent`

Reconciliation remains detection-only. It never credits funds or mutates ledger
state.

## Real PostgreSQL Drills

Real PostgreSQL drills are skipped by default because they reset a schema and
exercise concurrency/failure recovery against a real database. Run them only
against disposable local infrastructure.

Required environment:

```sh
NINES_FINANCIAL_REAL_PG_URL=postgres://...
NINES_FINANCIAL_REAL_PG_ALLOW_RESET=1
npm run test:real-postgres
```

Optional flags:

```sh
NINES_FINANCIAL_REAL_PG_ALLOW_NON_TEST_DB=1
NINES_FINANCIAL_REAL_PG_DEBUG=1
```

`NINES_FINANCIAL_REAL_PG_ALLOW_NON_TEST_DB=1` bypasses the database-name safety
check and should only be used for disposable databases. `NINES_FINANCIAL_REAL_PG_DEBUG=1`
prints setup timing and migration progress.

The deposit drills prove:

- identical signed callbacks do not double credit
- different provider event ids sharing an external transaction credit at most
  once
- interruptions before ledger posting can retry safely
- interruptions after ledger posting roll back and retry without double credit
- concurrent operator retry credit remains idempotent

Failure interpretation:

- Migration or reset failures usually mean the target database is not disposable,
  unavailable, or locked by another process.
- More than one `deposit_confirmed_credit` ledger transaction indicates a
  serious idempotency or external transaction uniqueness regression.
- A persisted provider event after a rejected duplicate nonce indicates replay
  protection has moved too late in the ingestion flow.
- A credited provider event without a ledger transaction indicates deposit state
  escaped Accounting Core ownership and must block release.
