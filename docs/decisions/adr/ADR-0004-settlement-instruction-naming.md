---
Title: ADR-0004 Settlement Instruction Naming
Version: v1
Status: Locked
Last Updated: 2026-04-23
---

## Changelog

- v1: Initial ADR created from accepted settlement instruction naming rules

# ADR-0004: Settlement Instruction Naming

## Status

Accepted

## Context

Settlement behavior includes multiple instruction types with materially different meanings. The accepted caller contract now treats payout, house-take, and correction instructions as distinct identifiers to avoid ambiguity and cross-flow reuse.

## Decision

- Settlement payout uses `payoutInstructionId`.
- Settlement house take uses `houseTakeInstructionId`.
- Settlement correction uses `settlementCorrectionInstructionId`.
- Correction linkage references the original settlement instruction through typed `originalInstruction { type, instructionId }` rather than overloaded generic settlement identifiers.

## Consequences

- Settlement instruction namespaces are isolated by instruction type.
- Cross-flow or cross-instruction reuse of settlement identifiers is invalid.
- Correction validation must confirm that the typed original instruction exists, is accepted, and is an original payout or house-take instruction rather than another correction.

## Related Documents

- [../../architecture/caller-contracts/financial-caller-contracts_v1.md](../../architecture/caller-contracts/financial-caller-contracts_v1.md)
- [../../flows/settlement/settlement-flow-contract_v1.md](../../flows/settlement/settlement-flow-contract_v1.md)
