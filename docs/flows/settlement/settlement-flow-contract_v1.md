---
Title: Settlement Flow Contract
Version: v1
Status: Locked
Last Updated: 2026-04-23
---

## Changelog

- v1: Initial locked settlement-flow extract from the authoritative caller contract

# Settlement Flow Contract

This document is a locked convenience extract for settlement behavior. The authoritative source remains [../../architecture/caller-contracts/financial-caller-contracts_v1.md](../../architecture/caller-contracts/financial-caller-contracts_v1.md).

## Governing Documents

- [../../architecture/caller-contracts/financial-caller-contracts_v1.md](../../architecture/caller-contracts/financial-caller-contracts_v1.md)
- [../../policies/reference-rules/duplicate-reference-policy_v1.md](../../policies/reference-rules/duplicate-reference-policy_v1.md)
- [../../decisions/adr/ADR-0004-settlement-instruction-naming.md](../../decisions/adr/ADR-0004-settlement-instruction-naming.md)

## Flow Coverage

- settlement payout
- settlement house take
- settlement reversal or correction

## Canonical References And Scopes

- `payoutInstructionId` identifies payout instructions only.
- `houseTakeInstructionId` identifies house-take instructions only.
- `settlementCorrectionInstructionId` identifies correction instructions only.
- Correction linkage uses `originalInstruction { type, instructionId }` and targets exactly one accepted original payout or house-take instruction.

## Locked Rules

- Payout and house-take instruction spaces are isolated from each other and from other flow reference spaces.
- Settlement corrections are compensating and append-only.
- A correction must target an existing accepted original payout or house-take instruction.
- A correction must never target another correction.
- Reusing a settlement instruction reference with different payload is conflict.

## Authoritative Sections

- [Flow policy matrix](../../architecture/caller-contracts/financial-caller-contracts_v1.md#flow-policy-matrix)
- [Settlement payout](../../architecture/caller-contracts/financial-caller-contracts_v1.md#settlement-payout)
- [Settlement house take](../../architecture/caller-contracts/financial-caller-contracts_v1.md#settlement-house-take)
- [Settlement reversal or correction](../../architecture/caller-contracts/financial-caller-contracts_v1.md#settlement-reversal-or-correction)
