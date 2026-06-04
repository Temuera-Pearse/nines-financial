# Phase 4.1 Deposit Hardening

Date: 2026-05-01

Phase 4.1 hardens deposit rails before withdrawals. It adds provider
boundaries, signed simulated webhooks, operator review commands, reconciliation
signals, and opt-in real PostgreSQL drills. It does not add withdrawals or real
provider connectivity.

## Provider Boundary

Provider-specific behavior lives behind `DepositProviderAdapter`:

- `verifyWebhookSignature`
- `parseDepositWebhook`
- `normalizeProviderDepositEvent`
- `getProviderTransaction`

The core deposit service receives normalized provider deposit events and owns
matching, idempotency, review routing, and ledger-backed crediting.

## Webhook Signing

`POST /provider-events/deposits/webhook/:provider` requires
`x-nines-provider-signature`.

The simulated adapter verifies HMAC-SHA256 over stable JSON using
`NINES_DEPOSIT_PROVIDER_WEBHOOK_SECRET`. Missing, invalid, or malformed
callbacks are rejected before provider events are persisted, so they cannot
credit accounts.

The existing guarded `POST /provider-events/deposits` endpoint remains for
operator/dev simulation.

## Review Resolution

Operator commands are deliberately narrow:

- `POST /deposits/provider-events/:depositEventId/mark-reviewed-no-credit`
- `POST /deposits/provider-events/:depositEventId/reject`
- `POST /deposits/provider-events/:depositEventId/link-intent`
- `POST /deposits/provider-events/:depositEventId/approve-credit`
- `POST /deposits/provider-events/:depositEventId/retry-credit`

All commands use the existing operator guard and command idempotency metadata.
Approval and retry still credit through Accounting Core and still enforce
provider/external transaction uniqueness.

`reviewed_no_credit` and `rejected` block normal approval. Risky link or
approval paths require `overrideReason`; duplicate external transactions and
already credited intents are not overridable.

## Reconciliation Additions

Deposit reconciliation now distinguishes:

- confirmed uncredited provider events
- credited rows missing ledger transactions
- review-required provider events
- reviewed/no-credit and rejected events
- duplicate external transaction attempts
- expired intents with late provider events
- ledger-posted or ledger-attached events that are not finalized as credited

Reconciliation remains detection-only and does not mutate financial truth.

## PostgreSQL Drills

The real PostgreSQL drill suite includes deposit scenarios for:

- concurrent identical signed callbacks
- concurrent different provider event IDs sharing one external transaction
- interruption after provider event record creation but before credit
- interruption after ledger posting but before final deposit state
- concurrent operator retry credit

Run with:

```sh
NINES_FINANCIAL_REAL_PG_URL=postgres://...
NINES_FINANCIAL_REAL_PG_ALLOW_RESET=1
npm run test:real-postgres
```

The harness resets the target schema. Use only disposable local databases.

## Remaining Production Work

- real provider adapters and provider-specific signature/finality policy
- webhook replay-window checks and provider timestamp validation
- address/memo allocation from a custody/provider system
- provider polling against real transaction state
- production RBAC replacing trusted operator headers
