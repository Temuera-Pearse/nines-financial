# Phase 3.5 Settlement Hardening

Date: 2026-04-30

Phase 3.5 is a production-readiness hardening slice for the internal economic
loop. It does not add deposit, withdrawal, provider, or cosmetic admin scope.

## Hardened Invariants

- A race can have only one completed settlement run.
- Settlement payout, house-take, carryover, and bet terminal state changes stay
  in the settlement transaction.
- Duplicate settlement commands with the same fingerprint replay the original
  completed result.
- Conflicting settlement commands after completion are rejected.
- Carryover application rows are written only when at least one carryover is
  applied, so a zero-effect orchestration retry cannot permanently block a
  later eligible carryover.
- Applied carryovers remain single-use through the carryover status transition,
  application ledger transaction reference, and persisted application command.
- Reconciliation runs record diagnostics only. They do not post ledger entries,
  apply carryovers, change pool state, or mutate bet state.

## Gap Fixed

Before this slice, `ApplyCarryoversToRace` persisted a zero-amount application
when no carryovers were eligible. Backend pool opening uses a deterministic
race-scoped idempotency key, so a later retry with the same key could replay the
old zero-result after an eligible carryover appeared.

Now zero-effect carryover checks return a deterministic no-op response without
persisting an application row, outbox event, ledger transaction, or
settlement-clearing account. Once a carryover becomes eligible, the same
orchestration key can still apply it exactly once.

## Reconciliation Run Classification

Durable reconciliation runs now classify their result:

- `informational`: no issues, `actionRequired = false`
- `discrepancy`: warning-only findings, `actionRequired = true`
- `actionable_incident`: at least one error finding, `actionRequired = true`

This keeps operator readouts explicit about the difference between a clean
summary, a drift signal that needs review, and a settlement incident.

## Operator Diagnostics

Manual-review remediation responses and snapshots now include the acting
operator and reason text. Manual-review readouts also expose settlement-run
`errorMessage`, giving operators enough context to correlate a manual-review
row with the original incident or ticket.

## Runbooks

### Failed Or Ambiguous Settlement

1. Query `GET /admin/operations/reconciliation/races/:raceId`.
2. Record a durable run with
   `POST /admin/operations/reconciliation/races/:raceId/runs`.
3. If the pool or settlement run is stuck in `running`, `posting_required`, or
   `manual_review`, do not retry blindly.
4. Use `MarkSettlementManualReview` if the state is unsafe or ambiguous.
5. Resolve for retry with `ResolveSettlementManualReview` only after the
   underlying cause is known.
6. Void with `VoidPoolFromManualReview` only when settlement must not continue.

### Payout Mismatch

1. Run admin reconciliation and inspect issue details.
2. For `CARRYOVER_LEDGER_AMOUNT_MISMATCH`, compare the carryover amount,
   application transaction ID, and settlement clearing credit.
3. For settlement residuals, inspect settlement clearing balance and pending
   carryovers.
4. Keep the reconciliation run ID with the incident record.
5. Use remediation commands only after the desired financial outcome is agreed.

### Stuck Reconciliation

1. Re-submit the same reconciliation run command with the same idempotency key
   to replay the original summary.
2. Submit a new reconciliation run with a new key only when a fresh snapshot is
   needed.
3. Reconciliation must remain detection-only; it must never be used as repair.

### Duplicate Or Ambiguous Remediation

1. Reusing the same remediation idempotency key with the same fingerprint
   returns the original remediation result.
2. Reusing the key with different race, operator, reason, or resolution details
   is rejected.
3. If an old remediation replay differs from current pool state, trust the
   current pool, settlement run, and reconciliation readouts for current truth.

## Verification Coverage

Phase 3.5 adds adversarial coverage for:

- zero-carryover orchestration replay followed by later eligible carryover
- full wallet balance to bet placement, race close, carryover, payout, and clean
  reconciliation loop
- reconciliation run classification and detection-only behavior
- applied carryover ledger mismatch detection
- richer manual-review diagnostics

## Residual Risks

- Recovery remains explicit and operator-driven; there is no automatic repair of
  financial truth.
- Manual review can resolve for retry or void, but direct operator-completed
  settlement remains out of scope.
- Cross-repo/backend settled versus financial missing detection is split between
  backend and financial reconciliation until a broader operations console exists.
