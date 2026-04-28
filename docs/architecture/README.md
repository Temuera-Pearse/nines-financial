---
Title: Architecture Documentation
Version: v1
Status: Draft
Last Updated: 2026-04-23
---

## Changelog

- v1: Initial architecture section guide

# Architecture Documentation

This section contains architecture-level documents for the accounting core, caller contracts, and future domain breakdowns.

## What This Section Contains

- domain and ownership-boundary documents
- the authoritative financial caller contract set
- draft architecture normalization extracted from the repo README and existing specs

## Authoritative Document

- The authoritative financial caller contract is [caller-contracts/financial-caller-contracts_v1.md](caller-contracts/financial-caller-contracts_v1.md).

## How To Use This Section

- Read [caller-contracts/financial-caller-contracts_v1.md](caller-contracts/financial-caller-contracts_v1.md) for implementation-critical caller behavior.
- Use [accounting/accounting-core-architecture_draft.md](accounting/accounting-core-architecture_draft.md) for the current extracted architecture summary.
- Treat empty folders such as `ledger/` and `account-domain/` as reserved structure until approved source material is promoted into them.
