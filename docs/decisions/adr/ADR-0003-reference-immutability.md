---
Title: ADR-0003 Reference Immutability
Version: v1
Status: Locked
Last Updated: 2026-04-23
---

## Changelog

- v1: Initial ADR created from accepted duplicate-reference and caller-contract rules

# ADR-0003: Reference Immutability

## Status

Accepted

## Context

Financial references must remain stable once accepted so that the same logical operation cannot be reinterpreted later with different financial meaning. The accepted caller contract already makes accepted business and action reference meaning immutable.

## Decision

- Once a business reference or action reference is first accepted, its accepted material meaning is immutable.
- Same-reference same-payload retries are replay.
- Same-reference different-payload requests are conflict.
- Lifecycle families may support follow-up actions only when the flow explicitly models them as distinct actions under the same family reference.
- Cross-flow reuse is invalid once a reference meaning has been established for another flow or instruction type.

## Consequences

- Accounting Core must compare material payloads for reused references.
- Duplicate detection cannot rely on idempotency alone.
- Flow-specific action-reference scope must be explicit for deposits, withdrawals, betting, and settlement.

## Related Documents

- [../../architecture/caller-contracts/financial-caller-contracts_v1.md](../../architecture/caller-contracts/financial-caller-contracts_v1.md)
- [../../policies/reference-rules/duplicate-reference-policy_v1.md](../../policies/reference-rules/duplicate-reference-policy_v1.md)
