---
Title: ADR-0005 Deposit Lifecycle Pending Before Confirmed
Version: v1
Status: Locked
Last Updated: 2026-04-23
---

## Changelog

- v1: Initial ADR created from accepted deposit lifecycle rules

# ADR-0005: Deposit Lifecycle Pending Before Confirmed

## Status

Accepted

## Context

Inbound deposits are modeled as lifecycle-driven financial actions rather than mutable state transitions. The accepted caller contract now requires an explicit pending stage before confirmation so Accounting Core can validate state progression and preserve append-only history.

## Decision

- Deposit pending is the mandatory first accepted posting in a deposit family.
- Deposit confirmation cannot be the first accepted posting in that family.
- Confirmation requires an already accepted pending deposit family.
- Confirmation must match the accepted pending deposit on provider, user, amount, and currency.
- Deposit action references remain scoped by provider plus deposit action type.

## Consequences

- Treasury must preserve stable action identifiers across pending, confirmed, and reversal-style deposit events.
- Accounting Core must reject confirmation before pending.
- Accounting Core must reject confirmation that drifts from the accepted pending deposit values.
- Deposit reversal remains compensating and append-only rather than mutating prior deposit history.

## Related Documents

- [../../architecture/caller-contracts/financial-caller-contracts_v1.md](../../architecture/caller-contracts/financial-caller-contracts_v1.md)
- [../../flows/deposits/deposit-flow-contract_v1.md](../../flows/deposits/deposit-flow-contract_v1.md)
