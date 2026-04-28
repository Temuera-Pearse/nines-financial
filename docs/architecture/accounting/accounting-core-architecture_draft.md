---
Title: Accounting Core Architecture
Version: v1
Status: Draft
Last Updated: 2026-04-23
---

## Changelog

- v1: Initial draft normalization extracted from the repository README and accepted caller-contract sources

# Accounting Core Architecture

This document is a draft normalization of the accounting-core architecture currently stated in the repository README and related locked contract documents.

## Source Material

- [../../../README.md](../../../README.md)
- [../caller-contracts/financial-caller-contracts_v1.md](../caller-contracts/financial-caller-contracts_v1.md)

## System Role

- The accounting domain is the only layer allowed to persist ledger entries.
- Treasury, Settlement, and Bet Intake integrate through explicit ports and must not mutate ledger rows or balances directly.
- The accounting core owns posted financial history, idempotency enforcement for accepted commands, and the derived balance read model.

## Current Scope

- chart of accounts and account entity model
- append-only ledger transactions and entries
- atomic posting engine with idempotency enforcement
- account balance read model
- internal HTTP handlers for account, reservation, readiness, and maintenance workflows
- tests for ledger and idempotency invariants

## Ownership Boundaries

- only the accounting core may write ledger entries or account balance read-model rows
- upstream domains call accounting services or ports; they do not write financial state directly
- operational repair of `account_balances` must use the accounting maintenance path rather than ad hoc SQL
- account freezing affects posting eligibility but does not bypass ledger ownership rules

## Operational Surfaces

- `GET /health` for liveness only
- `GET /ready` for database and migration readiness
- `GET /system/balances/verify` to compare `account_balances` against ledger-derived totals
- `POST /system/balances/rebuild` to rebuild the derived balance table and emit an audit event

## Startup Safety

- service startup requires `DATABASE_URL`
- runtime startup refuses to listen if `schema_migrations` is unavailable or if unapplied SQL files remain
- readiness is intentionally separate from liveness so orchestration can distinguish a live process from a usable service

## Related Documents

- [../caller-contracts/financial-caller-contracts_v1.md](../caller-contracts/financial-caller-contracts_v1.md)
- [../../policies/financial-invariants/financial-invariants_draft.md](../../policies/financial-invariants/financial-invariants_draft.md)
- [../../decisions/adr/ADR-0001-ledger-ownership.md](../../decisions/adr/ADR-0001-ledger-ownership.md)
