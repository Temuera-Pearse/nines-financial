---
Title: ADR-0001 Ledger Ownership
Version: v1
Status: Locked
Last Updated: 2026-04-23
---

## Changelog

- v1: Initial ADR created from accepted accounting-core ownership rules

# ADR-0001: Ledger Ownership

## Status

Accepted

## Context

The financial system requires a single ledger-writing authority so that posted history, balances, and auditability stay consistent. The current repository README and caller contract already state that Treasury, Settlement, and Bet Intake integrate through explicit ports and must not mutate ledger state directly.

## Decision

- The accounting core is the only service allowed to write ledger entries.
- The accounting core is also the only service allowed to write derived balance read-model rows.
- Upstream domains call accounting services or ports and do not write ledger state directly.
- Operational repair of derived balances must use the accounting maintenance path rather than ad hoc SQL.

## Consequences

- Financial caller contracts must remain explicit because upstream domains cannot bypass accounting-core ownership.
- Auditability improves because one subsystem owns posted ledger history.
- Operational tooling must route repair and rebuild actions through approved maintenance interfaces.

## Related Documents

- [../../architecture/accounting/accounting-core-architecture_draft.md](../../architecture/accounting/accounting-core-architecture_draft.md)
- [../../architecture/caller-contracts/financial-caller-contracts_v1.md](../../architecture/caller-contracts/financial-caller-contracts_v1.md)
