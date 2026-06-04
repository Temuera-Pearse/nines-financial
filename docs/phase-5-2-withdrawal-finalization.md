# Phase 5.2 Withdrawal Finalization

Phase 5.2 adds the internal accounting closeout for simulated provider-confirmed withdrawals. It still does not integrate a real provider, submit real funds, or perform external money movement.

## Finalization Accounting Model

Finalization is explicit and operator-triggered:

- endpoint: `POST /withdrawal-requests/:withdrawalRequestId/finalize`
- allowed source status: `provider_confirmed`
- final status: `completed`
- ledger transaction type: `withdrawal_finalized`

The ledger posting debits the player reserved withdrawal account and credits the platform `withdrawal_clearing` account. This reduces the player’s locked balance and leaves a treasury-clearing liability record for the simulated external settlement.

Completed withdrawals store `finalizationLedgerTransactionId` on the withdrawal request.

## Provider Failure Resolution

Provider failed and rejected outcomes do not release funds automatically.

Explicit resolution endpoints:

- `POST /withdrawal-requests/:id/release-after-provider-failure`
- `POST /withdrawal-requests/:id/mark-provider-failure-terminal`
- `POST /withdrawal-requests/:id/mark-provider-unknown-reviewed`

Failure release posts `withdrawal_provider_failure_release`, debiting the reserved account and crediting the player available account. Provider unknown cannot be released by this command; it can only be marked reviewed until a safer provider outcome is known.

Terminal no-release decisions keep the reservation in place and require elevated treasury role plus reason.

## Lifecycle Rules

Allowed Phase 5.2 transitions:

- `provider_confirmed -> completed`
- `provider_failed -> provider_failure_released`
- `provider_rejected -> provider_failure_released`
- `provider_failed -> provider_failed_terminal`
- `provider_rejected -> provider_rejected_terminal`
- `provider_unknown -> provider_unknown_reviewed`

Rejected transitions:

- `submitted` or `provider_pending -> completed`
- `provider_failed`, `provider_rejected`, or `provider_unknown -> completed`
- `provider_confirmed` or `completed -> provider failure release`
- `completed -> cancel/reject/release`

## Idempotency

Finalization and failure release are idempotent.

Crash/retry safety is based on durable ledger lookup by withdrawal reference and transaction type. Concurrent finalization or release attempts are serialized by the withdrawal row lock and the ledger follow-up uniqueness guard.

## RBAC And Audit

Finalization and provider failure resolution require `treasury_admin` or `financial_admin`.

Every operator action requires a reason and writes audit metadata:

- `financial.withdrawal.finalized`
- `financial.withdrawal.provider_failure_released`
- `financial.withdrawal.provider_failure_marked_terminal`
- `financial.withdrawal.provider_unknown_reviewed`

Audit payloads include operator identity, role, reason, previous/new status, provider references, provider status, and ledger transaction ids where applicable.

## Reconciliation

Withdrawal reconciliation now detects:

- `provider_confirmed_not_finalized`
- `completed_missing_finalization_ledger`
- `provider_failure_holding_reservation`
- `failure_released_missing_release_ledger`
- `terminal_provider_failure_holding_reservation`
- `provider_unknown_requires_review`
- `invalid_completed_released_state`
- `duplicate_withdrawal_finalization`

Reconciliation remains detection-only. It does not auto-finalize or auto-release.

## Real PostgreSQL Drills

Opt-in real PostgreSQL drills cover:

- concurrent finalization attempts
- finalization crash/retry after ledger posting
- concurrent provider failure release attempts
- provider failure release crash/retry
- reconciliation detection for stuck provider states

They remain skipped unless `NINES_FINANCIAL_REAL_PG_URL` and reset flags are configured for a disposable database.

## Still Simulated

The provider remains simulated. Phase 5.2 does not add real provider credentials, real destination validation, external transaction broadcasts, withdrawal webhooks, or production provider polling.

Before real provider integration, the system still needs real provider contract tests, destination validation policy, external status webhook hardening, operational runbooks, and provider-specific treasury controls.
