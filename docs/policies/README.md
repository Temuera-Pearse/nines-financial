---
Title: Policy Documentation
Version: v1
Status: Draft
Last Updated: 2026-04-23
---

## Changelog

- v1: Initial policy section guide

# Policy Documentation

This section contains reusable rule summaries and invariant documents that support implementation and review across multiple flows.

## What This Section Contains

- reference handling and duplicate-detection policy summaries
- extracted invariant statements
- extracted idempotency guidance

## Authoritative Relationship

- Policy documents must not override [../architecture/caller-contracts/financial-caller-contracts_v1.md](../architecture/caller-contracts/financial-caller-contracts_v1.md).
- Locked policy summaries may restate stable rules, but the caller contract remains authoritative for caller-facing financial behavior.
- Draft policy documents extracted from the repo README remain draft until explicitly normalized and locked.

## How To Use This Section

- Use [reference-rules/duplicate-reference-policy_v1.md](reference-rules/duplicate-reference-policy_v1.md) for a concise summary of reference-handling rules.
- Use the draft invariant and idempotency docs as supporting references when reviewing implementation behavior.
