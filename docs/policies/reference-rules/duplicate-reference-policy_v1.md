---
Title: Duplicate Reference Policy
Version: v1
Status: Locked
Last Updated: 2026-04-23
---

## Changelog

- v1: Initial locked summary of duplicate-reference rules extracted from the authoritative caller contract

# Duplicate Reference Policy

This document is a locked summary of the duplicate-reference and reference-scope rules governed authoritatively by [../../architecture/caller-contracts/financial-caller-contracts_v1.md](../../architecture/caller-contracts/financial-caller-contracts_v1.md).

## Authority And Drift Rule

- This document summarizes stable rules only.
- It must not expand, weaken, or override the authoritative caller contract.
- If any wording here and the authoritative caller contract diverge, the authoritative caller contract wins.

## Core Rules

- Every money-moving request must carry a canonical business reference.
- Business reference and idempotency key are separate controls and must not be substituted for one another.
- Once a business reference or action reference is first accepted, its accepted financial meaning is immutable.
- Duplicate same-payload requests are deterministic replay, not second money movement.
- Reuse of the same reference with materially different payload is conflict unless the flow explicitly models a distinct follow-up action.
- Lifecycle families may reuse one canonical family reference across multiple actions only when each action is separately distinguishable and independently deduplicated.
- Cross-flow reference isolation is mandatory.
- Action-reference scope is flow-specific rather than global.

## Flow-Specific Scope Summary

- Deposits use `providerDepositId` as the family reference and action references conceptually scoped by `(provider, providerEventId, depositActionType)`. See [../../flows/deposits/deposit-flow-contract_v1.md](../../flows/deposits/deposit-flow-contract_v1.md).
- Withdrawals use `withdrawalId` as the family reference and `(provider, withdrawalPayoutId)` for payout completion actions. See [../../flows/withdrawals/withdrawal-flow-contract_v1.md](../../flows/withdrawals/withdrawal-flow-contract_v1.md).
- Betting uses `betId` as the family reference plus release and capture instruction IDs. See [../../flows/betting/betting-flow-contract_v1.md](../../flows/betting/betting-flow-contract_v1.md).
- Settlement isolates `payoutInstructionId`, `houseTakeInstructionId`, and `settlementCorrectionInstructionId`, with typed `originalInstruction` linkage for corrections. See [../../flows/settlement/settlement-flow-contract_v1.md](../../flows/settlement/settlement-flow-contract_v1.md).

## Related Decisions

- [../../decisions/adr/ADR-0002-idempotency-scope.md](../../decisions/adr/ADR-0002-idempotency-scope.md)
- [../../decisions/adr/ADR-0003-reference-immutability.md](../../decisions/adr/ADR-0003-reference-immutability.md)
