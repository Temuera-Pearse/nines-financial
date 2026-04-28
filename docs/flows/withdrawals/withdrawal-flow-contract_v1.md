---
Title: Withdrawal Flow Contract
Version: v1
Status: Locked
Last Updated: 2026-04-23
---

## Changelog

- v1: Initial locked withdrawal-flow extract from the authoritative caller contract

# Withdrawal Flow Contract

This document is a locked convenience extract for withdrawal behavior. The authoritative source remains [../../architecture/caller-contracts/financial-caller-contracts_v1.md](../../architecture/caller-contracts/financial-caller-contracts_v1.md).

## Governing Documents

- [../../architecture/caller-contracts/financial-caller-contracts_v1.md](../../architecture/caller-contracts/financial-caller-contracts_v1.md)
- [../../policies/reference-rules/duplicate-reference-policy_v1.md](../../policies/reference-rules/duplicate-reference-policy_v1.md)
- [../../policies/idempotency/idempotency-policy_draft.md](../../policies/idempotency/idempotency-policy_draft.md)
- [../../policies/financial-invariants/financial-invariants_draft.md](../../policies/financial-invariants/financial-invariants_draft.md)

## Flow Coverage

- withdrawal requested
- withdrawal reserved
- withdrawal completed
- withdrawal failed or reversed

## Canonical References And Scopes

- `withdrawalId` is the canonical withdrawal family reference.
- Completion actions use provider-scoped payout identity `(provider, withdrawalPayoutId)`.
- Reserve, complete, and reverse actions all remain anchored to the same withdrawal family.

## Locked Rules

- Withdrawal request creation is Treasury-local until Accounting Core reserve is invoked.
- Reserve creates the financial reservation handle used by later resolution actions.
- Completion is a follow-up action against a reservation, not a second reserve.
- Only one terminal resolution is allowed per reservation.
- Reusing `(provider, withdrawalPayoutId)` with different payload is conflict.
- Reversal after completion is invalid state.

## Authoritative Sections

- [Flow policy matrix](../../architecture/caller-contracts/financial-caller-contracts_v1.md#flow-policy-matrix)
- [Withdrawal requested](../../architecture/caller-contracts/financial-caller-contracts_v1.md#withdrawal-requested)
- [Withdrawal reserved](../../architecture/caller-contracts/financial-caller-contracts_v1.md#withdrawal-reserved)
- [Withdrawal completed](../../architecture/caller-contracts/financial-caller-contracts_v1.md#withdrawal-completed)
- [Withdrawal failed or reversed](../../architecture/caller-contracts/financial-caller-contracts_v1.md#withdrawal-failed-or-reversed)
