---
Title: Flow Documentation
Version: v1
Status: Draft
Last Updated: 2026-04-23
---

## Changelog

- v1: Initial flow section guide

# Flow Documentation

This section contains flow-specific contract extracts for deposits, withdrawals, betting, and settlement.

## Authoritative Relationship

- Flow documents are convenience extracts only.
- The authoritative source of truth remains [../architecture/caller-contracts/financial-caller-contracts_v1.md](../architecture/caller-contracts/financial-caller-contracts_v1.md).
- If a flow extract and the authoritative caller contract ever diverge, the authoritative caller contract wins.

## How To Use This Section

- Use a flow document to narrow review or implementation work to one business area.
- Use the linked policy and ADR references inside each flow document to trace supporting rules.
- Return to the authoritative caller contract before changing any locked financial behavior.
