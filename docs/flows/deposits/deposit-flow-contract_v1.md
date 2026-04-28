---
Title: Deposit Flow Contract
Version: v1
Status: Locked
Last Updated: 2026-04-23
---

## Changelog

- v1: Initial locked deposit-flow extract from the authoritative caller contract

# Deposit Flow Contract

This document is a locked convenience extract for deposit behavior. The authoritative source remains [../../architecture/caller-contracts/financial-caller-contracts_v1.md](../../architecture/caller-contracts/financial-caller-contracts_v1.md).

## Governing Documents

- [../../architecture/caller-contracts/financial-caller-contracts_v1.md](../../architecture/caller-contracts/financial-caller-contracts_v1.md)
- [../../policies/reference-rules/duplicate-reference-policy_v1.md](../../policies/reference-rules/duplicate-reference-policy_v1.md)
- [../../policies/idempotency/idempotency-policy_draft.md](../../policies/idempotency/idempotency-policy_draft.md)
- [../../decisions/adr/ADR-0003-reference-immutability.md](../../decisions/adr/ADR-0003-reference-immutability.md)
- [../../decisions/adr/ADR-0005-deposit-lifecycle-pending-before-confirmed.md](../../decisions/adr/ADR-0005-deposit-lifecycle-pending-before-confirmed.md)

## Flow Coverage

- deposit initiated
- deposit confirmed
- deposit failed or reversed

## Canonical References And Scopes

- `providerDepositId` is the canonical deposit family reference and is scoped by provider.
- Deposit action references such as provider event identifiers are conceptually scoped by `(provider, providerEventId, depositActionType)`.
- Confirmation is a distinct lifecycle action from pending and may reuse the family reference only because the action type is different.

## Locked Rules

- Pending is the mandatory first accepted posting in a deposit family.
- Confirmation requires an already accepted pending deposit family.
- Confirmation must match the accepted pending deposit on provider, user, amount, and currency.
- Reversal behavior is compensating and append-only; prior deposit history is not mutated.
- Reusing a deposit action reference with different material payload is conflict.
- Cross-flow reuse of deposit action references is invalid.

## Authoritative Sections

- [Flow policy matrix](../../architecture/caller-contracts/financial-caller-contracts_v1.md#flow-policy-matrix)
- [Deposit initiated](../../architecture/caller-contracts/financial-caller-contracts_v1.md#deposit-initiated)
- [Deposit confirmed](../../architecture/caller-contracts/financial-caller-contracts_v1.md#deposit-confirmed)
- [Deposit failed or reversed](../../architecture/caller-contracts/financial-caller-contracts_v1.md#deposit-failed-or-reversed)
