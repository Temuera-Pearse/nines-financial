---
Title: Idempotency Policy
Version: v1
Status: Draft
Last Updated: 2026-04-23
---

## Changelog

- v1: Initial draft extraction of idempotency rules from accepted contract and README material

# Idempotency Policy

This document is a draft policy summary of idempotency behavior currently defined across the authoritative caller contract and the repository README.

## Authoritative Relationship

- The authoritative caller behavior remains [../../architecture/caller-contracts/financial-caller-contracts_v1.md](../../architecture/caller-contracts/financial-caller-contracts_v1.md).
- This draft is a summary for navigation and review; it does not supersede the locked caller contract.

## Current Extracted Rules

- every state-changing request sent to Accounting Core must carry a caller-generated idempotency key
- idempotency uniqueness is scoped to service, environment, and command type
- exact replay with the same idempotency key and materially identical payload must be safe
- reuse of the same idempotency key with materially different payload must be rejected as conflict
- idempotency keys are not substitutes for business references or action references
- the authoritative idempotency store and the accepted ledger transaction record must both preserve idempotency traceability

## Related Documents

- [../../architecture/caller-contracts/financial-caller-contracts_v1.md](../../architecture/caller-contracts/financial-caller-contracts_v1.md)
- [../reference-rules/duplicate-reference-policy_v1.md](../reference-rules/duplicate-reference-policy_v1.md)
- [../../decisions/adr/ADR-0002-idempotency-scope.md](../../decisions/adr/ADR-0002-idempotency-scope.md)
