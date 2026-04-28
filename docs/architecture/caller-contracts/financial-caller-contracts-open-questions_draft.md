---
Title: Financial Caller Contracts Open Questions
Version: v1
Status: Draft
Last Updated: 2026-04-23
---

## Changelog

- v1: Initial extraction of unresolved items from the caller-contract source document

# Financial Caller Contracts Open Questions

This document contains only unresolved questions extracted from the authoritative caller contract.

## Authoritative Relationship

- The locked contract remains [financial-caller-contracts_v1.md](financial-caller-contracts_v1.md).
- This draft does not change any locked financial rule.
- Questions listed here must be resolved explicitly before a new contract version is issued.

## Open Questions

1. Do all deposit and withdrawal providers supply stable action identifiers for confirm, fail, and reverse events, or must Treasury generate platform-stable action references for some providers?
2. Will Settlement always emit one stable `payoutInstructionId` per payout and one stable `houseTakeInstructionId` per house-take action, or are there cases where one higher-level outcome must expand into child instructions inside Accounting Core?
3. Should deposit reversal and settlement correction receive dedicated transaction types in the next phase, or should they remain temporary compensating instructions routed through tightly controlled adjustment semantics?
