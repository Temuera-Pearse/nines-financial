---
Title: Financial Invariants
Version: v1
Status: Draft
Last Updated: 2026-04-23
---

## Changelog

- v1: Initial draft extraction of invariant statements from the repository README

# Financial Invariants

This document is a draft normalization of explicit invariant statements currently spread across the repository README and related accounting documentation.

## Source Material

- [../../../README.md](../../../README.md)
- [../../architecture/caller-contracts/financial-caller-contracts_v1.md](../../architecture/caller-contracts/financial-caller-contracts_v1.md)

## Current Extracted Invariants

- ledger transactions must remain balanced and single-currency
- ledger rows are append-only; follow-up actions create new rows instead of mutating old ones
- only the accounting core may write ledger entries or account balance read-model rows
- user available and reserved balances may not go negative
- reservations may be resolved once only
- `account_balances` is a derived read model and must stay reconcilable from ledger entries
- idempotency keys are command-scoped and persisted with posted ledger transactions for audit traceability

## Related Boundary Rules

- Treasury, Settlement, and Bet Intake call accounting services or ports; they do not write ledger state directly.
- Operational repair of `account_balances` must use the accounting maintenance path rather than ad hoc SQL.
- Caller-contract rules for duplicate references, lifecycle transitions, and flow-specific uniqueness remain governed by [../../architecture/caller-contracts/financial-caller-contracts_v1.md](../../architecture/caller-contracts/financial-caller-contracts_v1.md).

## Related Documents

- [../../architecture/accounting/accounting-core-architecture_draft.md](../../architecture/accounting/accounting-core-architecture_draft.md)
- [../../decisions/adr/ADR-0001-ledger-ownership.md](../../decisions/adr/ADR-0001-ledger-ownership.md)
