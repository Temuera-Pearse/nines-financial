# Phase 5.3 Withdrawal Production Security

Phase 5.3 hardens the simulated withdrawal provider boundary before any real
provider integration. It still does not send real funds, integrate real
provider credentials, or auto-finalize provider-confirmed withdrawals.

## Provider Webhook Authenticity

Withdrawal provider callbacks use the same HMAC replay model as hardened
deposit webhooks:

```text
<timestamp>.<nonce>.<raw request body>
```

Required headers:

- `x-nines-provider-timestamp`
- `x-nines-provider-nonce`
- `x-nines-provider-signature`

The simulated adapter rejects missing or malformed timestamps, timestamps
outside the configured replay window, missing nonces, invalid signatures, and
malformed payloads before withdrawal state can change. Signature comparison is
constant-time.

Configuration:

- `NINES_WITHDRAWAL_PROVIDER_WEBHOOK_SECRET`
- `NINES_WITHDRAWAL_WEBHOOK_REPLAY_WINDOW_SECONDS` defaults to `300`

Production readiness fails when the withdrawal webhook secret is missing or the
replay window is invalid.

## Event And Receipt Model

Accepted webhook receipts are stored in
`withdrawal_provider_webhook_receipts` with provider, nonce, provider
timestamp, received time, request hash, signature version, parsed external
references, withdrawal id when available, and accepted/rejected status.

Provider-scoped accepted nonces are unique. Duplicate nonce attempts are stored
as rejected receipts with `duplicate_nonce` and cannot persist provider events,
finalize withdrawals, release reservations, or otherwise mutate financial
state.

Normalized provider callbacks are stored in `withdrawal_provider_events`.
Events may be:

- `applied`
- `review_required`
- `rejected`

Unmatched callbacks, external reference mismatches, terminal-withdrawal
callbacks, amount mismatches, and currency mismatches are persisted for review
and do not silently complete or release funds.

## Status Policy

Provider-originated callbacks may move matched withdrawals only through provider
lifecycle states:

- `accepted` or `pending` -> `provider_pending`
- `confirmed` -> `provider_confirmed`
- `failed` -> `provider_failed`
- `rejected` -> `provider_rejected`
- unknown provider statuses -> `provider_unknown`

`provider_confirmed` remains an accounting checkpoint. Completion still requires
the explicit `POST /withdrawal-requests/:id/finalize` command and the
ledger-backed `withdrawal_finalized` transaction.

Failed, rejected, and unknown provider outcomes do not release reservations
automatically. Existing explicit operator commands remain required.

## Audit And RBAC

Existing operator commands keep their Phase 5.2 treasury role boundaries.
Provider webhook status updates write audit events with:

- `actorType: provider`
- provider name
- webhook receipt id
- provider event id
- previous and new withdrawal status
- external withdrawal and transaction references
- no finalization and no reservation release flags

Unmatched provider events are audited against the provider event entity so they
remain traceable even when no withdrawal request can be safely linked.

## Reconciliation

Withdrawal reconciliation now detects provider security drift in addition to
the Phase 5.2 accounting states:

- accepted webhook receipt missing provider event
- duplicate nonce replay rejection
- unmatched withdrawal provider event
- provider confirmed webhook applied but withdrawal not `provider_confirmed`
- provider event/submission metadata mismatch
- provider callback for completed, cancelled, or rejected withdrawal
- stale provider pending withdrawal without recent sync/callback
- provider confirmed not finalized
- completed withdrawal missing finalization ledger
- failed/rejected/unknown provider outcomes still requiring review

Reconciliation remains detection-only. It does not auto-submit, auto-finalize,
or auto-release.

## Contract Tests

The withdrawal provider adapter contract verifies signed webhook parsing,
signature rejection, required external ids, provider status normalization,
minor-unit amount validation, currency validation, raw payload preservation, and
malformed payload rejection. The contract currently runs against the simulated
adapter.

## Real PostgreSQL Drills

Real PostgreSQL drills remain opt-in because they may reset a target database.
Use:

- `NINES_FINANCIAL_REAL_PG_URL`
- `NINES_FINANCIAL_REAL_PG_ALLOW_RESET=1`

Phase 5.3 coverage should include concurrent callbacks, duplicate nonce replay,
webhook crash/retry after receipt persistence, provider-confirmed callback
followed by concurrent finalization, and reconciliation drift detection. These
drills are skipped by default so normal local and CI runs cannot damage a real
database.

## Before Real Provider Integration

Before enabling real withdrawal rails, the platform still needs real provider
credential handling, provider-specific signature schemes, destination
validation, operational runbooks, treasury settlement controls, production
monitoring, and provider-specific finality rules.
