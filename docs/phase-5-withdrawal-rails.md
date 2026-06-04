# Phase 5 Withdrawal Rails

Date: 2026-05-04

Phase 5 introduces internal treasury withdrawal rails. It reserves player funds,
adds approval/rejection/cancellation workflows, and exposes reconciliation
signals. It intentionally does not submit to any real provider and does not move
money outside the platform.

## Lifecycle

Withdrawal requests are stored in `withdrawal_requests` and move through:

- `reservation_pending`
- `reserved`
- `review_required`
- `submission_pending`
- `rejected`
- `cancelled`

The schema also includes future provider states (`submitted`, `failed`,
`completed`), but Phase 5 does not advance requests into real external
submission.

## Reservation Model

Creation requires an existing player account, supported currency (`USDC`), a
positive minor-unit amount, supported simulated provider, and an alpha-safe
destination kind.

On create, the service posts a `withdrawal_reserve` ledger transaction:

- debit player `user_available`
- credit the player reserved/locked account
- reference type `withdrawal`
- reference id `withdrawalRequestId`

The posting goes through Accounting Core. No balances are directly mutated, and
negative available balances remain blocked by accounting posting policy.

## Approval, Rejection, Cancellation

Operator rules:

- approve requires `treasury_admin` or `financial_admin`
- reject requires `treasury_operator`, `treasury_admin`, or `financial_admin`
- approval does not submit externally; it marks the request
  `submission_pending`
- rejection before external submission posts `withdrawal_reversal`
- player cancellation is allowed before approval/submission and posts
  `withdrawal_reversal`

Rejected and cancelled withdrawals release reserved funds exactly once. Submitted
or completed withdrawals are not cancellable/rejectable in Phase 5.

## Idempotency

The following commands are idempotency protected:

- create withdrawal request
- approve withdrawal
- reject withdrawal
- cancel withdrawal

Reservation and release postings are tied to the withdrawal request and command
identity. Crash/retry paths are safe: if a request exists from an interrupted
create attempt, retry can finalize the reservation state without double
reserving.

## Reconciliation

Withdrawal reconciliation detects:

- `requested_without_reservation`
- `reserved_missing_final_reserved_status`
- `cancelled_with_unreleased_reservation`
- `rejected_with_unreleased_reservation`
- `approved_awaiting_provider_submission`
- `stuck_review_required_withdrawal`
- `impossible_released_nonterminal_withdrawal`

Reconciliation is detection-only. It never submits withdrawals externally and
never repairs balances directly.

## Audit

Audit events are appended for:

- request creation
- approval
- rejection
- cancellation

Operator actions include operator user id, operator role, reason fields,
previous/new status, withdrawal request id, reservation ledger transaction id,
and release ledger transaction id when applicable.

## Real PostgreSQL Drills

The existing real PostgreSQL harness remains opt-in and destructive. Run only
against disposable databases:

```sh
NINES_FINANCIAL_REAL_PG_URL=postgres://...
NINES_FINANCIAL_REAL_PG_ALLOW_RESET=1
npm run test:real-postgres
```

Phase 5 drill coverage should prove:

- concurrent duplicate withdrawal create reserves once
- concurrent cancel/reject releases once
- interruption before reservation can retry safely
- interruption after reservation posting can finalize without double reserve
- concurrent approval attempts remain idempotent
- reconciliation detects interrupted withdrawal states

## Not Implemented

Phase 5 deliberately does not include:

- real provider adapters
- blockchain, bank, or payment network submission
- external transaction ids
- provider polling
- completion/capture of withdrawn funds
- automatic approval

Phase 5.1 adds the simulated provider submission boundary, external idempotency
keys, submission receipts, provider status sync, and submission reconciliation
without weakening the ledger reservation guarantees. See
`docs/phase-5-1-withdrawal-provider-boundary.md`.
