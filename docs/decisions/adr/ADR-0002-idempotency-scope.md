---
Title: ADR-0002 Idempotency Scope
Version: v1
Status: Locked
Last Updated: 2026-04-23
---

## Changelog

- v1: Initial ADR created from accepted idempotency rules in the caller contract and README

# ADR-0002: Idempotency Scope

## Status

Accepted

## Context

Financial callers must be able to retry commands safely without causing duplicate money movement. The current accepted contract already distinguishes idempotency from business-reference handling and defines the persisted uniqueness boundary for idempotency keys.

## Decision

- Every state-changing request sent to Accounting Core must carry a caller-generated idempotency key.
- Idempotency uniqueness is scoped to service, environment, and command type.
- Exact replay with the same idempotency key and materially identical payload must be safe.
- Reuse of the same idempotency key with materially different payload must be rejected as conflict.
- Idempotency keys are separate from business or action references and must not replace them.

## Consequences

- Accounting Core persistence must enforce the `service + environment + command_type + idempotency_key` uniqueness boundary.
- Accepted postings must retain idempotency traceability on the transaction record.
- Callers must generate stable retry keys for outbound command attempts.

## Related Documents

- [../../architecture/caller-contracts/financial-caller-contracts_v1.md](../../architecture/caller-contracts/financial-caller-contracts_v1.md)
- [../../policies/idempotency/idempotency-policy_draft.md](../../policies/idempotency/idempotency-policy_draft.md)
- [../../policies/reference-rules/duplicate-reference-policy_v1.md](../../policies/reference-rules/duplicate-reference-policy_v1.md)
