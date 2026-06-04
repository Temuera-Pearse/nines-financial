# Phase 5.1 Withdrawal Provider Boundary

Phase 5.1 adds the withdrawal provider boundary and a simulated submission lifecycle. It is intentionally alpha-safe: the system never calls a real provider, never sends funds externally, and never mutates balances directly.

## Provider Boundary

Withdrawals submit through `WithdrawalProviderAdapter`.

The simulated adapter supports:

- `submitWithdrawal` for deterministic simulated provider acceptance, rejection, failure, or unknown results.
- `getWithdrawalStatus` for explicit operator-driven simulated status sync.
- `normalizeWithdrawalStatus` for provider status validation.
- `validateDestination` for simulated-only destination checks.

Only the simulated provider is supported. Provider-specific response shaping stays outside `WithdrawalService`.

## Submission State Machine

Approved withdrawals move from `submission_pending` to `submitting`, then to one of:

- `provider_pending` for simulated accepted or pending provider responses.
- `provider_confirmed` when an operator sync reports simulated confirmation.
- `provider_failed` when the simulated provider reports failure.
- `provider_rejected` when the simulated provider rejects the submission.
- `provider_unknown` when the simulated provider response is ambiguous.

Only `approved`, `submission_pending`, or recovered `submitting` withdrawals may be submitted. Player cancellation and operator rejection are blocked once provider submission has begun.

## Persistence And Idempotency

Provider submission metadata is stored in `withdrawal_provider_submissions`.

The table stores:

- `withdrawalRequestId`
- `provider`
- `externalWithdrawalId`
- `externalTransactionId`
- `providerStatus`
- `submissionAttemptCount`
- `lastSubmittedAt`
- `lastStatusSyncedAt`
- `rawProviderPayload`
- `providerIdempotencyKey`

Uniqueness is enforced for:

- one provider submission per withdrawal request
- provider idempotency key
- provider plus external withdrawal id
- provider plus external transaction id

Retries first inspect durable submission state. A duplicate submit command returns the existing provider reference and does not create a second simulated submission.

## Audit Model

Operator submit writes `financial.withdrawal.provider_submitted`.

Provider status sync writes `financial.withdrawal.provider_status_synced`.

Audit payloads include operator identity and role, previous and new withdrawal status, provider reference metadata, provider status, correlation metadata, and the explicit simulated/no-real-send flag.

## Ledger Policy

Phase 5.1 stopped at `provider_confirmed`. Phase 5.2 adds the later
ledger-backed finalization policy using `withdrawal_finalized`; see
`docs/phase-5-2-withdrawal-finalization.md`.

## Reconciliation Categories

Withdrawal reconciliation now detects:

- `approved_awaiting_provider_submission`
- `submitting_withdrawal_stuck`
- `submitted_missing_provider_reference`
- `provider_pending_not_recently_synced`
- `provider_confirmed_not_finalized`
- `provider_failure_requires_review`
- `duplicate_provider_reference`

Existing Phase 5 categories remain in place for unreserved, unreleased, and impossible withdrawal states.

Reconciliation does not auto-submit, auto-release, or auto-finalize withdrawals.

## Real PostgreSQL Drills

Real PostgreSQL drills remain opt-in behind the existing real PG environment and reset flags.

Phase 5.1 adds drills for:

- concurrent submit attempts creating one provider submission
- concurrent provider status sync remaining idempotent
- confirmed simulated provider status not finalizing funds

These drills are skipped by default because they require a disposable PostgreSQL database and destructive reset permission.

## Intentionally Not Implemented

Phase 5.1 does not:

- integrate a real withdrawal provider
- send real funds
- validate real blockchain or bank destinations
- release provider rejected/failed withdrawals automatically
- finalize confirmed withdrawals into completed status
- create withdrawal provider webhooks

## Phase 5.2 Candidates

Before real provider integration, the next slice should define ledger finalization, completion policy, provider webhook/status contract hardening, provider-specific destination validation, and operational playbooks for provider failure and confirmed-but-not-finalized states.
