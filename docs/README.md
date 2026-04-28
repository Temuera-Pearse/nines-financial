---
Title: Nines Financial Documentation
Version: v1
Status: Draft
Last Updated: 2026-04-23
---

## Changelog

- v1: Initial structured documentation index and governance guide

# Nines Financial Documentation

This folder contains the versioned financial design, contract, policy, flow, and decision records for `nines-financial`.

## Purpose

- make financial behavior traceable from code to documentation
- separate locked contract documents from evolving drafts
- keep decision history auditable through ADRs
- prevent duplication drift across flow and policy summaries

## Documentation Categories

- Architecture: system structure, ownership boundaries, and domain-level design
- Policy: financial rules, invariants, and reusable contract constraints
- Flow: flow-specific extracts for deposits, withdrawals, betting, and settlement
- ADR: architecture decision records explaining why locked choices exist
- Archive: deprecated or superseded historical documents retained for traceability

## Authoritative Documents

- The single authoritative source of truth for financial caller behavior is [architecture/caller-contracts/financial-caller-contracts_v1.md](architecture/caller-contracts/financial-caller-contracts_v1.md).
- Flow and policy documents may extract or summarize relevant subsets, but they must not redefine or override the authoritative caller contract.
- ADRs record the rationale behind locked decisions but do not replace the locked contract text.

## Versioning And Status

- Locked documents use the `_v1.md` naming convention and may only be changed by issuing a new version.
- Draft documents use the `_draft.md` naming convention and may be refined as the design is normalized.
- Deprecated documents live under [archive](archive) and remain available for audit and historical review.

## Safe Update Process

1. Identify whether the change affects a locked document, a draft document, or an ADR.
2. If the change alters financial behavior, update or supersede the locked source document before changing summary docs.
3. Update related extracts, section READMEs, and ADR cross-links after the authoritative source is updated.
4. Preserve the previous version in [archive](archive) when a locked document is superseded.
5. Record the document change in the local changelog at the top of the affected file.

## Enforcement Rule

- Code must not violate locked documents.
- If implementation behavior and a locked document disagree, treat the document mismatch as a defect to be resolved explicitly.

## Traceability

- Start with [architecture/caller-contracts/financial-caller-contracts_v1.md](architecture/caller-contracts/financial-caller-contracts_v1.md) for caller-facing financial behavior.
- Use [policies](policies) for reusable rule summaries and [flows](flows) for flow-specific extracts.
- Use [decisions/adr](decisions/adr) to understand why core constraints were locked.
