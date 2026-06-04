# Phase 4 Deposit Rails

Date: 2026-05-01

Phase 4 adds alpha-safe external deposit rail scaffolding. It does not add
withdrawals, real chain/provider integration, custody movement, or automatic
repair.

## Lifecycle

Deposit intents are player-owned records created through `POST
/deposit-intents`. They provision or reuse the player's primary USDC account and
return a simulated destination reference.

Intent statuses:

- `created`
- `awaiting_external_payment`
- `detected`
- `confirmed`
- `credited`
- `expired`
- `cancelled`
- `failed`
- `review_required`

Provider deposit events are ingested through `POST /provider-events/deposits`.
For Phase 4 these are simulated callbacks supplied by an operator/provider
adapter, not a real on-chain listener.

Provider event statuses:

- `received`
- `awaiting_confirmation`
- `credited`
- `duplicate`
- `review_required`
- `reviewed_no_credit`
- `rejected`

## Crediting Rule

A confirmed provider event credits the player only when it matches a valid
deposit intent by `depositIntentId` or destination reference, has matching
provider, amount, and currency, and the intent is not expired or already
terminal.

Crediting always goes through Accounting Core:

- Dr `deposit_clearing` for the provider
- Cr the player's `user_available` account
- transaction type `deposit_confirmed_credit`
- reference type `deposit`
- reference id `depositIntentId`

Deposit records never store authoritative balances.

## Idempotency

Idempotency protects:

- deposit intent creation
- provider event ingestion
- deposit credit posting through deterministic provider/external transaction
  identity

Duplicate provider callbacks with the same provider event return the original
logical result. A provider/external transaction can produce at most one credited
event. A repeated external transaction aimed at another intent goes to
`review_required` and does not credit.

If an event was recorded but interrupted before crediting, a later confirmed
callback with a new request idempotency key can re-drive the existing event
safely.

## Review And Reconciliation

Operator endpoints:

```http
GET /deposits/review
GET /admin/operations/deposits/reconciliation
POST /provider-events/deposits
POST /provider-events/deposits/webhook/:provider
POST /deposits/provider-events/:depositEventId/mark-reviewed-no-credit
POST /deposits/provider-events/:depositEventId/reject
POST /deposits/provider-events/:depositEventId/link-intent
POST /deposits/provider-events/:depositEventId/approve-credit
POST /deposits/provider-events/:depositEventId/retry-credit
```

They use the existing trusted operator header guard:

- `x-nines-authenticated-user-id`
- `x-nines-operator-role` or `x-nines-admin-role`
- optional `x-nines-operator-secret` when configured

Reconciliation currently detects:

- expired intents with no credited payment
- confirmed provider events that are not credited
- credited provider events missing their ledger transaction
- credited intents missing their ledger transaction
- confirmed provider events already routed to review
- reviewed/no-credit and rejected provider events for audit visibility
- duplicate external transaction attempts
- late provider events for expired intents
- ledger-attached or ledger-posted deposit credits whose provider event is not
  finalized as credited

Detection is read-only. Operators must not patch rows directly; remediation is
performed through explicit guarded commands.

## Provider Boundary And Webhook Authenticity

Phase 4.1 introduces `DepositProviderAdapter` as the boundary for provider
logic. The core deposit service receives normalized provider events only; it
does not parse provider-specific payloads or verify signatures.

The simulated adapter implements:

- `verifyWebhookSignature`
- `parseDepositWebhook`
- `normalizeProviderDepositEvent`
- `getProviderTransaction`

Signed webhooks use an alpha HMAC-SHA256 shared-secret scheme over a stable JSON
payload representation. The signature is supplied in
`x-nines-provider-signature`, and the secret is configured with
`NINES_DEPOSIT_PROVIDER_WEBHOOK_SECRET`.

Rejected webhooks do not persist provider events and cannot credit balances:

- missing signature -> rejected
- invalid signature -> rejected
- malformed payload -> rejected

`getProviderTransaction` is a simulated polling boundary only. It returns a
provider transaction shape for future provider-backed reconciliation without
coupling the deposit domain to chain/provider calls.

## Operator Review Resolution

Review resolution is explicit and idempotent:

- no-credit marks a provider event `reviewed_no_credit`
- reject marks a provider event `rejected`
- manual link connects a provider event to a deposit intent but leaves approval
  separate
- approve/retry credit posts through Accounting Core and remains protected by
  provider/external transaction uniqueness

Risky manual links or approvals require an `overrideReason`. Examples include
amount mismatch, currency mismatch, destination mismatch, or expired intent.
Duplicate external transactions and already-credited intents are not
overridable by these commands.

`reviewed_no_credit` and `rejected` are terminal for normal crediting. A later
credit requires a future explicit remediation command, not a retry of the normal
approval path.

## Alpha Provider Assumptions

The provider is simulated. The service accepts provider event fields such as
`providerEventId`, `externalTransactionId`, `depositIntentId`,
`destinationReference`, `amountMinor`, `currency`, confirmation count/boolean,
and raw payload. Webhook signatures are alpha shared-secret HMAC checks, not a
real provider signature scheme, and provider polling is an interface with a
simulated implementation.

Before real crypto/provider integration, Phase 4 still needs:

- provider-specific signature verification and replay-window policy
- provider event source authentication beyond alpha shared secrets
- chain/provider finality policy per asset
- address/memo allocation backed by a real provider adapter
- provider-vs-ledger reconciliation inputs from the real provider
