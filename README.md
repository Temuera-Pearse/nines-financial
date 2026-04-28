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

## Operational endpoints

- `GET /health` for liveness only
- `GET /ready` for DB and migration readiness
- `GET /system/balances/verify` to compare `account_balances` against ledger-derived totals
- `POST /system/balances/rebuild` to rebuild the derived balance table and emit an audit event

`POST /system/balances/rebuild` requires `x-correlation-id` and `x-causation-id` headers so repair activity stays traceable.

## Startup safety

- service startup requires `DATABASE_URL`
- runtime startup refuses to listen if `schema_migrations` is unavailable or if SQL files exist that have not been applied
- readiness stays separate from liveness so orchestration can distinguish a live process from a usable service

## Commands

- `npm install`
- `npm run typecheck`
- `npm test`
- `npm run db:migrate`

## Environment

- `PORT` optional, defaults to `3000`
- `DATABASE_URL` required for readiness checks, runtime startup, and PostgreSQL-backed execution

Tests use an in-memory PostgreSQL-compatible database and do not require an external instance.
