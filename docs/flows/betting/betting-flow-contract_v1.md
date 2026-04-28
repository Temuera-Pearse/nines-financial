---
Title: Betting Flow Contract
Version: v1
Status: Locked
Last Updated: 2026-04-23
---

## Changelog

- v1: Initial locked betting-flow extract from the authoritative caller contract

# Betting Flow Contract

This document is a locked convenience extract for betting behavior. The authoritative source remains [../../architecture/caller-contracts/financial-caller-contracts_v1.md](../../architecture/caller-contracts/financial-caller-contracts_v1.md).

## Governing Documents

- [../../architecture/caller-contracts/financial-caller-contracts_v1.md](../../architecture/caller-contracts/financial-caller-contracts_v1.md)
- [../../policies/reference-rules/duplicate-reference-policy_v1.md](../../policies/reference-rules/duplicate-reference-policy_v1.md)
- [../../policies/financial-invariants/financial-invariants_draft.md](../../policies/financial-invariants/financial-invariants_draft.md)

## Flow Coverage

- bet reserve
- bet release
- bet capture

## Canonical References And Scopes

- `betId` is the canonical betting family reference.
- `betReleaseInstructionId` identifies a release action.
- `betCaptureInstructionId` identifies a capture action.

## Locked Rules

- One bet may reserve once.
- Release and capture are mutually exclusive terminal resolutions of the same reservation.
- A second release or capture for the same reservation is invalid state.
- Reusing release or capture instruction IDs with different payload is conflict.

## Authoritative Sections

- [Flow policy matrix](../../architecture/caller-contracts/financial-caller-contracts_v1.md#flow-policy-matrix)
- [Bet reserve](../../architecture/caller-contracts/financial-caller-contracts_v1.md#bet-reserve)
- [Bet release](../../architecture/caller-contracts/financial-caller-contracts_v1.md#bet-release)
- [Bet capture](../../architecture/caller-contracts/financial-caller-contracts_v1.md#bet-capture)
