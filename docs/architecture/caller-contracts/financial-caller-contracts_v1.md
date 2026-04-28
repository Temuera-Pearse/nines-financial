---
Title: Financial Caller Contracts
Version: v1
Status: Locked
Last Updated: 2026-04-23
Owner: Nines Financial
---

## Changelog

- v1: Initial locked authoritative caller contract spec structured from the legacy monolithic contract document

# Duplicate-Reference And Caller Contract Policy

## Step 1

Duplicate-reference policy defines how Accounting Core interprets the caller's business identity for a money-moving operation. The business reference is the identifier of the real financial fact being posted, such as a provider deposit ID, a platform withdrawal ID, a bet ID, a `payoutInstructionId`, a `houseTakeInstructionId`, or a manual adjustment ID.

This policy is separate from idempotency because the two mechanisms solve different failure modes.

- Business reference answers: what real-world operation does this command represent?
- Idempotency key answers: is this caller attempt a safe retry of the same command?

The document solves an integration problem between Phase 1.5 and Phase 2. Upstream domains already know how to call Accounting Core technically, but they still need explicit rules for when a reference is reusable, when a retry is safe, when a second request is a legitimate follow-up action, when a lifecycle transition is valid, and when Accounting Core must reject the call as a duplicate or conflict.

## Step 2

### General Policy Principles

1. Accounting Core remains the only service allowed to write ledger entries. Treasury, Bet Intake, and Settlement submit commands; they do not mutate balances or ledger rows directly.
2. Every state-changing request sent to Accounting Core must carry a caller-generated idempotency key. The key is mandatory for retry safety but does not replace business reference rules.
3. Idempotency uniqueness is scoped to service, environment, and command type. The same raw idempotency key value may only be considered unique inside that boundary.
4. Every money-moving request must carry a canonical business reference that identifies the business operation or instruction being posted.
5. Business reference and idempotency key are independent controls. A caller must not reuse one as a substitute for the other.
6. Exact replay with the same idempotency key and materially identical payload must be safe and must return the same accepted result.
7. Reuse of the same idempotency key with materially different payload must be rejected as an idempotency conflict.
8. Once a business reference or action reference is first accepted, the material payload for that accepted meaning is immutable. Any later request reusing that reference with materially different payload must be rejected as conflict.
9. Reuse of the same business reference with materially different payload must be rejected as a duplicate-reference conflict unless the flow explicitly models that request as a distinct follow-up action.
10. Lifecycle flows may share one business-reference family across multiple actions, but each financial action inside that family must still be distinguishable and independently deduplicated.
11. Cross-flow reference isolation is mandatory. A business or action reference accepted for one flow or instruction type must not later be reused as the identifier for a different flow or instruction type.
12. Flow-specific reference scope must be explicit. Different flows may use different uniqueness boundaries, and some action references are only unique inside an additional declared scope such as provider, action type, or instruction type.
13. Follow-up actions must be represented as new append-only postings or explicit non-posting business states. They must never overwrite prior financial history.
14. Accounting Core should treat exact duplicate business actions as deterministic replay, not as a second money movement.
15. Invalid state transitions must be rejected explicitly. Examples include deposit confirmation before accepted pending deposit, capture after release, release after capture, second completion of the same reservation, or settlement correction targeting another correction.
16. Minimal required metadata must always be sufficient to answer audit questions about origin, intent, linkage, scope, and timing.
17. Caller responsibilities must be explicit: who generates the identifier, which fields become immutable after first acceptance, which later actions must reference the prior accepted operation, and which reference scope governs duplicate detection.

### Shared Definitions

- Canonical business reference: the stable identifier for the business operation or instruction family. Example: `providerDepositId`, `withdrawalId`, `betId`, `payoutInstructionId`, `houseTakeInstructionId`, `manualAdjustmentId`.
- Action reference: a distinct identifier for a specific posting action inside one business-reference family when multiple lifecycle actions are valid. Example: provider event ID, `withdrawalPayoutId`, release instruction ID, `payoutInstructionId`, `houseTakeInstructionId`, correction instruction ID.
- Action reference scope: the declared uniqueness boundary for an action reference. This boundary is flow-specific. For deposit lifecycle actions, the safe conceptual scope is `(provider, providerEventId, depositActionType)`. Other flows may use different scopes such as `(provider, withdrawalPayoutId)` or settlement instruction type plus instruction ID.
- Typed original instruction linkage: the settlement correction linkage object `originalInstruction`, which contains `type` with value `"payout"` or `"house_take"` and `instructionId` as the accepted original instruction identifier. This object references exactly one original settlement instruction.
- Idempotency scope: the persisted uniqueness boundary for an idempotency key is service + environment + command type.
- Material payload: the fields that change financial or audit meaning. At minimum: transaction type, reference fields, linked prior operation, amount, currency, intended accounts, required metadata, and caller-controlled effective time.
- Exact replay: same command type, same idempotency key, same material payload.
- Duplicate same payload: same business action arrives again, usually with a different idempotency key, but with no material change.
- Duplicate different payload: same business reference or action reference arrives again with a material change and must be rejected.

## Step 3

### Flow Policy Matrix

| Flow                              | Caller domain                         | Accounting action                                                                   | Canonical business reference                                                                   | Unique? / scope                                                                                                                                                               | Idempotency key                                  | Duplicate same payload                                                                                                                                            | Duplicate different payload                                                                                                                                                                           | Required metadata                                                                                                                                                             | Response / audit                                                                                                                                                                                    | Notes                                                                                                                                                                                                                                                                   |
| --------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deposit initiated                 | Treasury                              | `deposit_pending_credit`                                                            | `providerDepositId`                                                                            | Yes, per provider for the family; pending action reference conceptually unique as `(provider, providerEventId, depositActionType=pending)`                                    | Required                                         | Exact replay returns same accepted transaction. Same pending action reference in its declared scope with new idempotency key is duplicate-reference replay.       | Reject if provider, user, amount, currency, or pending action reference meaning changes inside the declared pending-action scope.                                                                     | `provider`, `providerDepositId`, pending action ref such as `providerEventId`, `userId`, `occurredAt`, correlation ID, causation ID                                           | Return original transaction on replay. Audit must link provider, deposit family, pending action ref, pending action scope, caller correlation, and idempotency key.                                 | Pending is the mandatory first accepted posting for a deposit family. Confirmation may only follow an accepted pending deposit family. Cross-flow reuse of deposit action references is invalid.                                                                        |
| Deposit confirmed                 | Treasury                              | `deposit_confirmed_credit`                                                          | `providerDepositId`                                                                            | Yes, per provider for the family; confirmation action reference conceptually unique as `(provider, providerEventId, depositActionType=confirmed)`                             | Required                                         | Exact replay returns same confirmed transaction. Same confirmation action reference in its declared scope with new idempotency key is duplicate-reference replay. | Reject if provider, user, amount, currency, confirmation action reference meaning changes, or the request does not exactly match the accepted pending family on provider, user, amount, and currency. | `provider`, `providerDepositId`, confirm action ref such as `providerEventId`, `userId`, `confirmedAt`, correlation ID, causation ID                                          | Return original confirmed transaction on replay. Audit must link deposit family, required pending linkage, confirmation action ref, exact pending-match values, and provider confirmation metadata. | `providerDepositId` is the lifecycle family reference. Confirmation cannot be the first accepted posting in the deposit family and must match the accepted pending deposit on provider, user, amount, and currency.                                                     |
| Deposit failed or reversed        | Treasury                              | Compensating instruction, currently `manual_adjustment` until dedicated flow exists | `providerDepositId` with reversal action ref                                                   | Reversal action ref conceptually unique as `(provider, providerEventId, depositActionType=reversal)` when provider event IDs exist; original deposit family reused by linkage | Required                                         | Exact replay returns same compensating result.                                                                                                                    | Reject if original deposit linkage, amount, currency, user, reason, or reversal action reference meaning changes inside the declared reversal-action scope.                                           | `provider`, `providerDepositId`, reversal action ref, `userId`, `reversalReason`, `occurredAt`, correlation ID, causation ID                                                  | Return original compensating transaction on replay. Audit must record original deposit reference, reversal action ref, reversal action scope, and reason for reversal.                              | No mutation of original deposit rows. Deposit action references remain scoped by provider plus deposit action type.                                                                                                                                                     |
| Withdrawal requested              | Treasury                              | No Accounting Core posting yet                                                      | `withdrawalId`                                                                                 | Yes, global within platform withdrawal domain                                                                                                                                 | Required in Treasury before Accounting Core call | Treasury-local replay only.                                                                                                                                       | Treasury-local conflict if amount, currency, user, or destination changes for same `withdrawalId`.                                                                                                    | `withdrawalId`, `userId`, `amountMinor`, `currency`, `destinationType`, `requestedAt`                                                                                         | Not an Accounting Core response yet. Audit expectation starts in Treasury and must carry forward into later reserve and resolution calls.                                                           | Included because later Accounting Core actions must stay anchored to the same withdrawal family reference.                                                                                                                                                              |
| Withdrawal reserved               | Treasury                              | `withdrawal_reserve`                                                                | `withdrawalId`                                                                                 | Yes, global within platform withdrawal domain                                                                                                                                 | Required                                         | Exact replay returns same reservation transaction. Same reserve request with new idempotency key is duplicate-reference replay.                                   | Reject if user, amount, currency, reserve target, or destination intent changes.                                                                                                                      | `withdrawalId`, `userId`, `amountMinor`, `currency`, `requestedAt`, `destinationType`, correlation ID, causation ID                                                           | Return reservation transaction and reservation handle on success or replay. Audit must capture withdrawal family reference and reservation linkage.                                                 | `withdrawalId` is the lifecycle family reference. Reservation transaction ID is the handle for completion or reversal.                                                                                                                                                  |
| Withdrawal completed              | Treasury                              | `withdrawal_complete`                                                               | `withdrawalId` family with provider-scoped action ref `withdrawalPayoutId`                     | `withdrawalId` unique per platform withdrawal; `(provider, withdrawalPayoutId)` unique for completion actions; one completion per reservation                                 | Required                                         | Exact replay returns same completion transaction. Same `(provider, withdrawalPayoutId)` action with new idempotency key is duplicate-reference replay.            | Reject if provider-scoped payout action ref, reservation linkage, amount, currency, provider, or destination metadata changes.                                                                        | `withdrawalId`, `withdrawalPayoutId`, `provider`, reservation handle, `completedAt`, correlation ID, causation ID                                                             | Return original completion transaction on replay. Audit must record withdrawal family plus `(provider, withdrawalPayoutId)`.                                                                        | Completion is a follow-up action against a reservation, not a second reserve.                                                                                                                                                                                           |
| Withdrawal failed or reversed     | Treasury                              | `withdrawal_reversal`                                                               | `withdrawalId` family with failure or reversal action ref                                      | `withdrawalId` unique per platform withdrawal; failure or reversal action ref unique per provider or Treasury; one reversal per reservation                                   | Required                                         | Exact replay returns same reversal transaction.                                                                                                                   | Reject if failure action ref, reservation linkage, amount, currency, provider, or failure reason changes.                                                                                             | `withdrawalId`, failure or reversal action ref, `provider`, reservation handle, `failureCode`, `failureReason`, `failedAt`, correlation ID, causation ID                      | Return original reversal transaction on replay. Audit must record reservation linkage and external failure cause.                                                                                   | If provider has no stable failure event ID, Treasury must generate and persist one.                                                                                                                                                                                     |
| Bet reserve                       | Bet Intake                            | `bet_reserve`                                                                       | `betId`                                                                                        | Yes, global within betting domain                                                                                                                                             | Required                                         | Exact replay returns same reservation transaction. Same bet reserve with new idempotency key is duplicate-reference replay.                                       | Reject if user, race, selection, stake, currency, or source account intent changes.                                                                                                                   | `betId`, `userId`, `raceId`, `selectionId`, `stakeMinor`, `currency`, `acceptedAt`, correlation ID, causation ID                                                              | Return reservation transaction and reservation handle on success or replay. Audit must link bet, race, user, and stake intent.                                                                      | One bet may reserve once.                                                                                                                                                                                                                                               |
| Bet release                       | Bet Intake                            | `bet_release`                                                                       | `betId` family with action ref `betReleaseInstructionId`                                       | `betId` unique within betting domain; release action ref unique within bet-intake domain; one release per reservation                                                         | Required                                         | Exact replay returns same release transaction.                                                                                                                    | Reject if release action ref, reservation linkage, amount, currency, or release reason changes.                                                                                                       | `betId`, `betReleaseInstructionId`, reservation handle, `releaseReason`, `releasedAt`, correlation ID, causation ID                                                           | Return original release transaction on replay. Audit must record why reserved funds were released and which reservation was resolved.                                                               | Release is a follow-up action, not a second reserve.                                                                                                                                                                                                                    |
| Bet capture                       | Bet Intake                            | `bet_capture`                                                                       | `betId` family with action ref `betCaptureInstructionId`                                       | `betId` unique within betting domain; capture action ref unique within bet-intake domain; one capture per reservation                                                         | Required                                         | Exact replay returns same capture transaction.                                                                                                                    | Reject if capture action ref, reservation linkage, amount, currency, or destination intent changes.                                                                                                   | `betId`, `betCaptureInstructionId`, reservation handle, `raceId`, `capturedAt`, correlation ID, causation ID                                                                  | Return original capture transaction on replay. Audit must record resolved reservation, bet, and destination holding account intent.                                                                 | Capture and release are mutually exclusive resolutions of the same reservation.                                                                                                                                                                                         |
| Settlement payout                 | Settlement                            | `settlement_payout`                                                                 | `payoutInstructionId`                                                                          | Yes, global within settlement payout instruction type                                                                                                                         | Required                                         | Exact replay returns same payout transaction. Same payout instruction with new idempotency key is duplicate-reference replay.                                     | Reject if bet, race, user, amount, currency, outcome, or target account intent changes.                                                                                                               | `payoutInstructionId`, `settlementRunId`, `betId`, `raceId`, `userId`, `outcome`, `amountMinor`, `currency`, `settledAt`, correlation ID, causation ID                        | Return original payout transaction on replay. Audit must record settlement run, payout instruction ID, outcome source, and target user.                                                             | `payoutInstructionId` is isolated to payout flow and must not be reused for house-take, correction, withdrawal, deposit, or manual-adjustment actions.                                                                                                                  |
| Settlement house take             | Settlement                            | `settlement_house_take`                                                             | `houseTakeInstructionId`                                                                       | Yes, global within settlement house-take instruction type                                                                                                                     | Required                                         | Exact replay returns same house-take transaction. Same house-take instruction with new idempotency key is duplicate-reference replay.                             | Reject if bet, race, amount, currency, take type, or account intent changes.                                                                                                                          | `houseTakeInstructionId`, `settlementRunId`, `betId`, `raceId`, `takeType`, `amountMinor`, `currency`, `settledAt`, correlation ID, causation ID                              | Return original house-take transaction on replay. Audit must record settlement run, house-take instruction ID, take type, and account routing intent.                                               | `houseTakeInstructionId` is isolated to house-take flow and must not be reused for payout, correction, withdrawal, deposit, or manual-adjustment actions.                                                                                                               |
| Settlement reversal or correction | Settlement                            | Compensating instruction, currently `manual_adjustment` until dedicated flow exists | `settlementCorrectionInstructionId` with linkage `originalInstruction { type, instructionId }` | Correction instruction unique within settlement correction instruction type                                                                                                   | Required                                         | Exact replay returns same compensating result.                                                                                                                    | Reject if `originalInstruction`, amount, currency, target, or reason changes.                                                                                                                         | `settlementCorrectionInstructionId`, `originalInstruction { type, instructionId }`, `reasonCode`, `reasonText`, `raceId`, `betId` if applicable, correlation ID, causation ID | Return original compensating transaction on replay. Audit must record correction reason and typed original instruction linkage.                                                                     | Corrections must be compensating entries, not mutation of prior settlement history. `originalInstruction` must reference exactly one accepted original payout or house-take instruction and may never target another correction. Cross-flow reference reuse is invalid. |
| Manual adjustment                 | Restricted internal operator workflow | `manual_adjustment`                                                                 | `manualAdjustmentId`                                                                           | Yes, global                                                                                                                                                                   | Required                                         | Exact replay returns same adjustment transaction.                                                                                                                 | Reject if amount, currency, affected entity, requested-by, approved-by, ticket, or reason changes.                                                                                                    | `manualAdjustmentId`, `reasonCode`, `reasonText`, `requestedBy`, `approvedBy`, `ticketId`, `affectedEntityType`, `affectedEntityId`, correlation ID, causation ID             | Return original adjustment transaction on replay. Audit must capture full operator chain, approval chain, and case linkage.                                                                         | Highest audit burden. Manual adjustment must not become a hidden substitute for normal Treasury, Bet Intake, or Settlement flows and must not recursively cite another manual adjustment as its origin or target basis.                                                 |

## Step 4

### Deposit initiated

Purpose:
Treasury uses this flow to record a pending inbound deposit before final provider confirmation when pending-state financial visibility is required.

Required fields:

- `idempotencyKey`
- `provider`
- `providerDepositId`
- pending action reference such as `providerEventId`
- `userId`
- `amountMinor`
- `currency`
- `occurredAt`
- `correlationId`
- `causationId`

Optional fields:

- `fundingSourceType`
- `effectiveAt`
- non-financial provider metadata

Caller-generated identifiers:

- Treasury must preserve the provider-supplied `providerDepositId` as the canonical deposit family reference.
- Treasury must preserve or mint one stable pending action reference per pending event inside the provider + `pending` deposit action scope.
- Treasury must generate the idempotency key for each outbound request attempt.

Immutable after first acceptance:

- `provider`
- `providerDepositId`
- pending action reference
- `userId`
- `amountMinor`
- `currency`

Accounting Core validates before posting:

- all required metadata is present
- this is the first accepted posting for the deposit family
- the pending action reference has not already been accepted with a different material payload inside the provider + `pending` deposit action scope
- the canonical deposit family reference is not being reused for a materially different pending action
- source and destination account intent resolves to a valid posting configuration

Allowed retry behaviour:

- same idempotency key and same material payload must replay the accepted result
- same pending action reference with a new idempotency key but identical material payload may be treated as duplicate-reference replay

Duplicate and conflict rules:

- same pending action reference inside the provider + `pending` deposit action scope plus same payload is replay, not a second posting
- same pending action reference inside the provider + `pending` deposit action scope plus different amount, currency, user, or provider is conflict
- same `providerDepositId` later used for deposit confirmation is valid because confirmation is a distinct lifecycle action under a different deposit action type

Accounting Core guarantees:

- on success: one append-only pending deposit transaction is created and returned
- on replay: the originally accepted transaction is returned without new money movement
- on conflict: no new ledger rows are written

Audit expectations:

- the accepted transaction must be traceable to provider, deposit family reference, pending action reference, pending action scope, idempotency key, and correlation metadata

Example acceptance reasoning:

- duplicate provider pending webhook delivery with the same deposit family reference and same pending event reference replays the accepted transaction

Example rejection reasoning:

- Treasury reuses the same pending event reference for a different amount or different user and Accounting Core rejects it as same-reference different-payload

### Deposit confirmed

Purpose:
Treasury uses this flow to record the final confirmed deposit after provider success is established for a deposit family that already has an accepted pending posting.

Required fields:

- `idempotencyKey`
- `provider`
- `providerDepositId`
- confirmation action reference such as `providerEventId`
- `userId`
- `amountMinor`
- `currency`
- `confirmedAt`
- `correlationId`
- `causationId`

Optional fields:

- `providerSettlementStatus`
- `effectiveAt`
- non-financial provider metadata

Caller-generated identifiers:

- Treasury must preserve `providerDepositId` as the canonical deposit family reference across the mandatory pending and confirmed stages
- Treasury must preserve or mint one stable confirmation action reference per confirmed event inside the provider + `confirmed` deposit action scope
- Treasury must generate the idempotency key for each outbound request attempt

Immutable after first acceptance:

- `provider`
- `providerDepositId`
- confirmation action reference
- `userId`
- `amountMinor`
- `currency`

Accounting Core validates before posting:

- required metadata is present
- a matching accepted pending deposit exists for the same provider and `providerDepositId` before confirmation is allowed
- the confirmation matches the accepted pending deposit on `provider`, `userId`, `amountMinor`, and `currency`
- confirmation action reference has not already been accepted with a different material payload inside the provider + `confirmed` deposit action scope
- confirmation is not being expressed as mutation of an earlier pending posting and cannot be the first accepted posting in the deposit family

Allowed retry behaviour:

- same idempotency key and same material payload replays the accepted result
- same confirmation action reference with a new idempotency key and identical material payload may be duplicate-reference replay

Duplicate and conflict rules:

- same confirmation action reference inside the provider + `confirmed` deposit action scope plus same payload is replay
- same confirmation action reference inside the provider + `confirmed` deposit action scope plus different amount, currency, user, or provider is conflict
- a confirmation request without a matching accepted pending deposit family is invalid state
- a confirmation request that does not exactly match the accepted pending deposit on `provider`, `userId`, `amountMinor`, and `currency` is invalid state
- a new confirmation request must not silently replace an earlier confirmed deposit for the same deposit family

Accounting Core guarantees:

- on success: one append-only confirmed deposit transaction is created and returned as a lifecycle transition on top of the accepted pending deposit family
- on replay: the original confirmed transaction is returned unchanged
- on conflict: no new money movement occurs

Audit expectations:

- accepted postings must link deposit family reference, confirmation action reference, provider, exact pending-match values, idempotency key, and caller correlation metadata

Example acceptance reasoning:

- duplicate confirmed webhook delivery for the same provider event replays the original confirmed deposit transaction

Example rejection reasoning:

- Treasury retries confirmation for the same action reference but changes the amount from the original accepted value, attempts confirmation before a pending posting exists, or sends a confirmation whose provider, user, amount, or currency does not match the accepted pending deposit, and Accounting Core rejects the request

### Deposit failed or reversed

Purpose:
Treasury uses this flow to apply a compensating financial correction when a previously recognized deposit must be reversed.

Required fields:

- `idempotencyKey`
- `provider`
- `providerDepositId`
- reversal action reference
- `userId`
- `amountMinor`
- `currency`
- `reversalReason`
- `occurredAt`
- `correlationId`
- `causationId`

Optional fields:

- `effectiveAt`
- provider failure metadata

Caller-generated identifiers:

- Treasury must preserve the original `providerDepositId`
- Treasury must preserve or mint one stable reversal action reference per reversal event inside the provider + `reversal` deposit action scope
- Treasury must generate the idempotency key

Immutable after first acceptance:

- original deposit family linkage
- reversal action reference
- `userId`
- `amountMinor`
- `currency`
- `reversalReason`

Accounting Core validates before posting:

- all required reversal metadata is present
- the reversal action reference is not already associated with different material payload inside the provider + `reversal` deposit action scope
- the request is a compensating instruction and not an attempt to mutate prior deposit history

Allowed retry behaviour:

- same idempotency key and same material payload replays the accepted compensating result
- same reversal action reference with different idempotency key but identical material payload may be treated as duplicate-reference replay

Duplicate and conflict rules:

- same reversal action reference inside the provider + `reversal` deposit action scope plus same payload is replay
- same reversal action reference inside the provider + `reversal` deposit action scope plus different original deposit linkage, amount, currency, user, or reason is conflict

Accounting Core guarantees:

- on success: one compensating append-only transaction is created and returned
- on replay: the original accepted compensating transaction is returned
- on conflict: no new ledger rows are created

Audit expectations:

- audit trail must link reversal action reference, reversal action scope, original deposit family reference, reason, provider, idempotency key, and caller correlation metadata

Example acceptance reasoning:

- duplicate delivery of the same provider reversal event replays the original compensating transaction

Example rejection reasoning:

- Treasury uses the same reversal action reference to reverse a different deposit family or a different amount and Accounting Core rejects it

### Withdrawal requested

Purpose:
Treasury creates a platform withdrawal request before funds are reserved. This is a caller contract prerequisite rather than an immediate Accounting Core posting.

Required fields:

- `withdrawalId`
- `userId`
- `amountMinor`
- `currency`
- `destinationType`
- `requestedAt`
- Treasury-local `idempotencyKey`

Optional fields:

- destination metadata
- provider routing metadata

Caller-generated identifiers:

- Treasury must generate `withdrawalId`
- Treasury must generate and retain the Treasury-local idempotency key for the external request that created the withdrawal request

Immutable after first acceptance in Treasury:

- `withdrawalId`
- `userId`
- `amountMinor`
- `currency`
- destination intent

Treasury validates before later calling Accounting Core:

- the same `withdrawalId` is reused for reserve and later resolution calls
- reservation and resolution requests do not drift from the originally accepted withdrawal intent

Allowed retry behaviour:

- replay is handled inside Treasury before Accounting Core is called

Duplicate and conflict rules:

- same `withdrawalId` and same request payload is Treasury-local replay
- same `withdrawalId` and different amount, currency, user, or destination is Treasury-local conflict and must not reach Accounting Core

Accounting Core guarantees:

- none at this stage because no posting call is made yet

Audit expectations:

- Treasury must preserve `withdrawalId`, external request identity, and correlation metadata so later Accounting Core calls can be tied back to the original request

Example acceptance reasoning:

- Treasury retries creation of a withdrawal request after timeout and reuses the same `withdrawalId`

Example rejection reasoning:

- Treasury attempts to reserve funds using a new `withdrawalId` for an already accepted withdrawal request and must reject that internally before calling Accounting Core

### Withdrawal reserved

Purpose:
Treasury uses this flow to reserve user funds for an accepted withdrawal request.

Required fields:

- `idempotencyKey`
- `withdrawalId`
- `userId`
- `amountMinor`
- `currency`
- `requestedAt`
- `destinationType`
- `correlationId`
- `causationId`

Optional fields:

- `effectiveAt`
- destination metadata

Caller-generated identifiers:

- Treasury must reuse the previously accepted `withdrawalId`
- Treasury must generate the Accounting Core idempotency key for this reserve request

Immutable after first acceptance:

- `withdrawalId`
- `userId`
- `amountMinor`
- `currency`
- destination intent

Accounting Core validates before posting:

- all required metadata is present
- `withdrawalId` has not already been reserved with a different material payload
- user funds are sufficient and the posting state is valid

Allowed retry behaviour:

- same idempotency key and same material payload replays the accepted reservation transaction
- same `withdrawalId` with a new idempotency key but identical material payload may be duplicate-reference replay

Duplicate and conflict rules:

- same `withdrawalId` plus same payload is replay
- same `withdrawalId` plus different user, amount, currency, or destination intent is conflict
- a second reserve for the same `withdrawalId` is invalid once the reservation has already been resolved

Accounting Core guarantees:

- on success: one reservation transaction is created and a reservation handle is returned
- on replay: the original reservation transaction and handle are returned
- on conflict: no additional reservation is created

Audit expectations:

- accepted transaction must link withdrawal family reference, reservation handle, idempotency key, and caller correlation metadata

Example acceptance reasoning:

- Treasury retries the reserve request after a network timeout with the same business payload and Accounting Core returns the original reservation transaction

Example rejection reasoning:

- Treasury reuses `withdrawalId` but changes the amount after first acceptance and Accounting Core rejects the request

### Withdrawal completed

Purpose:
Treasury uses this flow to finalize a previously reserved withdrawal after payout succeeds.

Required fields:

- `idempotencyKey`
- `withdrawalId`
- `withdrawalPayoutId`
- reservation handle
- `provider`
- `completedAt`
- `correlationId`
- `causationId`

Optional fields:

- `effectiveAt`
- provider payout metadata

Caller-generated identifiers:

- Treasury must reuse the original `withdrawalId`
- Treasury must preserve the provider-scoped payout action reference `withdrawalPayoutId` together with `provider`
- Treasury must generate the Accounting Core idempotency key for the completion request

Immutable after first acceptance:

- `withdrawalId`
- `provider`
- `withdrawalPayoutId`
- reservation linkage

Accounting Core validates before posting:

- reservation handle exists and is still open
- the `(provider, withdrawalPayoutId)` pair is not already accepted with a different material payload
- completion request matches the reserved amount and currency

Allowed retry behaviour:

- same idempotency key and same material payload replays the accepted completion transaction
- same `(provider, withdrawalPayoutId)` pair with different idempotency key but identical material payload may be duplicate-reference replay

Duplicate and conflict rules:

- same `(provider, withdrawalPayoutId)` pair plus same payload is replay
- same `(provider, withdrawalPayoutId)` pair plus different reservation linkage, amount, currency, or provider metadata is conflict
- second completion for the same reservation is invalid state

Accounting Core guarantees:

- on success: one completion transaction is created and returned
- on replay: the original completion transaction is returned
- on invalid state or conflict: no second completion is posted

Audit expectations:

- accepted transaction must link withdrawal family reference, `(provider, withdrawalPayoutId)`, reservation handle, idempotency key, and correlation metadata

Example acceptance reasoning:

- duplicate provider payout-success delivery for the same `(provider, withdrawalPayoutId)` pair replays the original completion transaction

Example rejection reasoning:

- Treasury reuses the same `(provider, withdrawalPayoutId)` pair for a different reservation handle or a different payout amount and Accounting Core rejects it

### Withdrawal failed or reversed

Purpose:
Treasury uses this flow to release a withdrawal reservation after payout failure or explicit reversal.

Required fields:

- `idempotencyKey`
- `withdrawalId`
- failure or reversal action reference
- reservation handle
- `provider`
- `failureCode`
- `failureReason`
- `failedAt`
- `correlationId`
- `causationId`

Optional fields:

- `effectiveAt`
- provider failure metadata

Caller-generated identifiers:

- Treasury must reuse the original `withdrawalId`
- Treasury must preserve one stable failure or reversal action reference per failure event
- Treasury must generate the Accounting Core idempotency key

Immutable after first acceptance:

- `withdrawalId`
- failure or reversal action reference
- reservation linkage
- `provider`
- `failureCode`

Accounting Core validates before posting:

- reservation handle exists and is still open
- failure action reference is not already accepted with a different material payload
- reversal request is not attempting to resolve an already completed reservation

Allowed retry behaviour:

- same idempotency key and same material payload replays the accepted reversal transaction
- same failure or reversal action reference with a new idempotency key but identical material payload may be duplicate-reference replay

Duplicate and conflict rules:

- same failure or reversal action reference plus same payload is replay
- same action reference plus different reservation linkage, amount, currency, provider, or failure metadata is conflict
- reversal after completion is invalid state

Accounting Core guarantees:

- on success: one reversal transaction is created and returned
- on replay: the original reversal transaction is returned
- on conflict or invalid state: no second resolution is posted

Audit expectations:

- accepted transaction must capture withdrawal family reference, failure action reference, reservation handle, external failure metadata, idempotency key, and correlation metadata

Example acceptance reasoning:

- Treasury receives the same payout-failed event twice and Accounting Core replays the first accepted reversal transaction

Example rejection reasoning:

- Treasury reuses the same failure action reference but points it at a different reservation and Accounting Core rejects the request

### Bet reserve

Purpose:
Bet Intake uses this flow to reserve stake at the moment a bet is accepted.

Required fields:

- `idempotencyKey`
- `betId`
- `userId`
- `raceId`
- `selectionId`
- `stakeMinor`
- `currency`
- `acceptedAt`
- `correlationId`
- `causationId`

Optional fields:

- `effectiveAt`
- non-financial bet channel metadata

Caller-generated identifiers:

- Bet Intake must generate `betId`
- Bet Intake must generate the Accounting Core idempotency key for the reserve request

Immutable after first acceptance:

- `betId`
- `userId`
- `raceId`
- `selectionId`
- `stakeMinor`
- `currency`

Accounting Core validates before posting:

- all required metadata is present
- `betId` is not already accepted with a different material payload
- source and reserve account intent resolves correctly
- sufficient funds exist and the account is postable

Allowed retry behaviour:

- same idempotency key and same material payload replays the accepted reservation transaction
- same `betId` with different idempotency key but identical material payload may be duplicate-reference replay

Duplicate and conflict rules:

- same `betId` plus same payload is replay
- same `betId` plus different user, race, selection, amount, or currency is conflict
- a second reserve for an already resolved bet is invalid state

Accounting Core guarantees:

- on success: one reservation transaction is created and reservation handle is returned
- on replay: the original reservation transaction and handle are returned
- on conflict: no new money movement is created

Audit expectations:

- accepted transaction must link bet, race, user, stake, reservation handle, idempotency key, and correlation metadata

Example acceptance reasoning:

- Bet Intake retries the same reserve after timeout and Accounting Core returns the original reservation transaction

Example rejection reasoning:

- Bet Intake reuses `betId` for a different stake amount and Accounting Core rejects it

### Bet release

Purpose:
Bet Intake uses this flow to release a previously reserved stake when the bet must not remain financially committed.

Required fields:

- `idempotencyKey`
- `betId`
- `betReleaseInstructionId`
- reservation handle
- `releaseReason`
- `releasedAt`
- `correlationId`
- `causationId`

Optional fields:

- `effectiveAt`
- rule or operator metadata

Caller-generated identifiers:

- Bet Intake must reuse `betId`
- Bet Intake must generate or preserve one stable release instruction ID per release decision
- Bet Intake must generate the Accounting Core idempotency key

Immutable after first acceptance:

- `betId`
- `betReleaseInstructionId`
- reservation linkage
- `releaseReason`

Accounting Core validates before posting:

- reservation handle exists and is still open
- release instruction ID is not already associated with a different material payload
- release is not being attempted after capture

Allowed retry behaviour:

- same idempotency key and same material payload replays the accepted release transaction
- same release instruction ID with different idempotency key but identical material payload may be duplicate-reference replay

Duplicate and conflict rules:

- same release instruction ID plus same payload is replay
- same release instruction ID plus different reservation linkage, amount, currency, or reason is conflict
- second release for the same reservation is invalid state

Accounting Core guarantees:

- on success: one release transaction is created and returned
- on replay: the original release transaction is returned
- on invalid state or conflict: no second resolution is posted

Audit expectations:

- accepted transaction must link bet family reference, release instruction ID, reservation handle, release reason, idempotency key, and correlation metadata

Example acceptance reasoning:

- Bet Intake retries the same cancellation instruction after timeout and Accounting Core returns the original release transaction

Example rejection reasoning:

- Bet Intake reuses one release instruction ID for two different reservations and Accounting Core rejects it

### Bet capture

Purpose:
Bet Intake uses this flow to capture reserved stake into the betting holding account once the bet is financially committed.

Required fields:

- `idempotencyKey`
- `betId`
- `betCaptureInstructionId`
- reservation handle
- `raceId`
- `capturedAt`
- `correlationId`
- `causationId`

Optional fields:

- `effectiveAt`
- non-financial bet engine metadata

Caller-generated identifiers:

- Bet Intake must reuse `betId`
- Bet Intake must generate or preserve one stable capture instruction ID per capture decision
- Bet Intake must generate the Accounting Core idempotency key

Immutable after first acceptance:

- `betId`
- `betCaptureInstructionId`
- reservation linkage
- `raceId`

Accounting Core validates before posting:

- reservation handle exists and is still open
- capture instruction ID is not already associated with a different material payload
- capture is not being attempted after release

Allowed retry behaviour:

- same idempotency key and same material payload replays the accepted capture transaction
- same capture instruction ID with a different idempotency key but identical material payload may be duplicate-reference replay

Duplicate and conflict rules:

- same capture instruction ID plus same payload is replay
- same capture instruction ID plus different reservation linkage, amount, currency, or destination intent is conflict
- second capture for the same reservation is invalid state

Accounting Core guarantees:

- on success: one capture transaction is created and returned
- on replay: the original capture transaction is returned
- on invalid state or conflict: no second resolution is posted

Audit expectations:

- accepted transaction must link bet family reference, capture instruction ID, reservation handle, race, idempotency key, and correlation metadata

Example acceptance reasoning:

- Bet Intake retries the same capture request after a timeout and Accounting Core returns the original capture transaction

Example rejection reasoning:

- Bet Intake reuses the same capture instruction ID for a different reservation or different amount and Accounting Core rejects it

### Settlement payout

Purpose:
Settlement uses this flow to credit the winner for one payout instruction.

Required fields:

- `idempotencyKey`
- `payoutInstructionId`
- `settlementRunId`
- `betId`
- `raceId`
- `userId`
- `outcome`
- `amountMinor`
- `currency`
- `settledAt`
- `correlationId`
- `causationId`

Optional fields:

- `effectiveAt`
- pricing metadata that does not alter posting meaning

Caller-generated identifiers:

- Settlement must generate or preserve one stable `payoutInstructionId` per payout instruction
- Settlement must keep `payoutInstructionId` isolated from house-take, correction, withdrawal, deposit, and manual-adjustment reference spaces
- Settlement must preserve `settlementRunId` for batch traceability
- Settlement must generate the Accounting Core idempotency key

Immutable after first acceptance:

- `payoutInstructionId`
- `settlementRunId`
- `betId`
- `raceId`
- `userId`
- `outcome`
- `amountMinor`
- `currency`

Accounting Core validates before posting:

- all required metadata is present
- `payoutInstructionId` is not already associated with different material payload
- `payoutInstructionId` is not already accepted in another flow or instruction type
- target account intent resolves correctly

Allowed retry behaviour:

- same idempotency key and same material payload replays the accepted payout transaction
- same `payoutInstructionId` with a different idempotency key but identical material payload may be duplicate-reference replay

Duplicate and conflict rules:

- same `payoutInstructionId` plus same payload is replay
- same `payoutInstructionId` plus different bet, race, user, outcome, amount, currency, or account intent is conflict
- reusing a previously accepted house-take, correction, withdrawal, deposit, or manual-adjustment reference value as `payoutInstructionId` is invalid cross-flow reuse
- corrected financial meaning must use a new correction instruction, not reuse the original `payoutInstructionId`

Accounting Core guarantees:

- on success: one payout transaction is created and returned
- on replay: the original payout transaction is returned
- on conflict: no second payout is posted

Audit expectations:

- accepted transaction must link `payoutInstructionId`, settlement run ID, bet, race, outcome, target user, idempotency key, and correlation metadata

Example acceptance reasoning:

- Settlement republishes the same `payoutInstructionId` after transport failure and Accounting Core returns the original payout transaction

Example rejection reasoning:

- Settlement reuses the same `payoutInstructionId` but changes the payout amount after the first acceptance, or reuses a reference value already accepted in another instruction type, and Accounting Core rejects it

### Settlement house take

Purpose:
Settlement uses this flow to record the platform's house-side financial outcome for one settlement instruction.

Required fields:

- `idempotencyKey`
- `houseTakeInstructionId`
- `settlementRunId`
- `betId`
- `raceId`
- `takeType`
- `amountMinor`
- `currency`
- `settledAt`
- `correlationId`
- `causationId`

Optional fields:

- `effectiveAt`
- pricing metadata

Caller-generated identifiers:

- Settlement must generate or preserve one stable `houseTakeInstructionId` per house-take instruction
- Settlement must keep `houseTakeInstructionId` isolated from payout, correction, withdrawal, deposit, and manual-adjustment reference spaces
- Settlement must generate the Accounting Core idempotency key

Immutable after first acceptance:

- `houseTakeInstructionId`
- `settlementRunId`
- `betId`
- `raceId`
- `takeType`
- `amountMinor`
- `currency`

Accounting Core validates before posting:

- required metadata is present
- `houseTakeInstructionId` is not already associated with different material payload
- `houseTakeInstructionId` is not already accepted in another flow or instruction type
- account routing intent is valid for the requested take type

Allowed retry behaviour:

- same idempotency key and same material payload replays the accepted house-take transaction
- same `houseTakeInstructionId` with a different idempotency key but identical material payload may be duplicate-reference replay

Duplicate and conflict rules:

- same `houseTakeInstructionId` plus same payload is replay
- same `houseTakeInstructionId` plus different race, bet, amount, currency, take type, or account intent is conflict
- reusing a previously accepted payout, correction, withdrawal, deposit, or manual-adjustment reference value as `houseTakeInstructionId` is invalid cross-flow reuse

Accounting Core guarantees:

- on success: one house-take transaction is created and returned
- on replay: the original house-take transaction is returned
- on conflict: no second posting is created

Audit expectations:

- accepted transaction must link `houseTakeInstructionId`, settlement run ID, take type, amount, account-routing intent, idempotency key, and correlation metadata

Example acceptance reasoning:

- Settlement retries the same `houseTakeInstructionId` after network failure and Accounting Core returns the original transaction

Example rejection reasoning:

- Settlement reuses a `payoutInstructionId` value or any reference value already accepted in another instruction type for a house-take posting and Accounting Core rejects it

### Settlement reversal or correction

Purpose:
Settlement uses this flow to apply a compensating correction when a prior original payout or house-take settlement instruction was financially wrong.

Required fields:

- `idempotencyKey`
- `settlementCorrectionInstructionId`
- `originalInstruction`
- `originalInstruction.type` with value `"payout"` or `"house_take"`
- `originalInstruction.instructionId`
- `reasonCode`
- `reasonText`
- `amountMinor`
- `currency`
- `raceId`
- `correlationId`
- `causationId`

Optional fields:

- `betId`
- `effectiveAt`
- approval metadata if the workflow requires it

Caller-generated identifiers:

- Settlement must generate one stable correction instruction ID per correction action
- Settlement must preserve one typed `originalInstruction` object that references exactly one original payout or house-take instruction being corrected
- Settlement must not point `originalInstruction` at another correction instruction or any non-settlement flow reference
- Settlement must generate the Accounting Core idempotency key

Immutable after first acceptance:

- correction instruction ID
- `originalInstruction.type`
- `originalInstruction.instructionId`
- `reasonCode`
- `reasonText`
- `amountMinor`
- `currency`

Accounting Core validates before posting:

- all required correction metadata is present
- `originalInstruction.type` is either `"payout"` or `"house_take"`
- `originalInstruction.instructionId` identifies an existing accepted original instruction of the declared type
- the target instruction is an original settlement payout or house-take instruction and is not itself a correction
- correction instruction ID is not already associated with different material payload
- request is expressed as a compensating entry and not as a rewrite of prior settlement history

Allowed retry behaviour:

- same idempotency key and same material payload replays the accepted correction transaction
- same correction instruction ID with a different idempotency key but identical material payload may be duplicate-reference replay

Duplicate and conflict rules:

- same correction instruction ID plus same payload is replay
- same correction instruction ID plus different `originalInstruction`, amount, currency, or reason is conflict
- `originalInstruction` that points to a missing instruction, another correction, or any non-settlement or non-matching flow reference is invalid state
- corrected financial outcome must not reuse the original payout or house-take instruction ID

Accounting Core guarantees:

- on success: one compensating transaction is created and returned
- on replay: the original correction transaction is returned
- on conflict: no second correction posting is created

Audit expectations:

- accepted transaction must link correction instruction ID, `originalInstruction.type`, `originalInstruction.instructionId`, reason, idempotency key, and correlation metadata

Example acceptance reasoning:

- Settlement retries the same correction instruction after timeout and Accounting Core returns the original compensating transaction

Example rejection reasoning:

- Settlement changes the correction amount while reusing the same correction instruction ID, or points `originalInstruction` at another correction or a non-existent accepted instruction, and Accounting Core rejects it

### Manual adjustment

Purpose:
An authorized internal workflow uses this flow to post a strictly controlled financial adjustment that does not belong to a normal Treasury, Bet Intake, or Settlement flow.

Required fields:

- `idempotencyKey`
- `manualAdjustmentId`
- `reasonCode`
- `reasonText`
- `requestedBy`
- `approvedBy`
- `ticketId`
- `amountMinor`
- `currency`
- source and destination account intent
- `affectedEntityType`
- `affectedEntityId`
- `correlationId`
- `causationId`
- explicit admin override flag

Optional fields:

- `effectiveAt`
- supporting case metadata

Caller-generated identifiers:

- the internal operator workflow must generate one globally unique `manualAdjustmentId`
- the workflow must generate the Accounting Core idempotency key

Immutable after first acceptance:

- `manualAdjustmentId`
- `reasonCode`
- `reasonText`
- `requestedBy`
- `approvedBy`
- `ticketId`
- `amountMinor`
- `currency`
- affected entity linkage

Accounting Core validates before posting:

- all required operator, approval, and case metadata is present
- admin-only override requirements are satisfied
- `manualAdjustmentId` is not already associated with different material payload
- the request does not cite another manual adjustment as its origin, target basis, or recursive correction chain
- requested posting shape is balanced and valid

Allowed retry behaviour:

- same idempotency key and same material payload replays the accepted adjustment transaction
- same `manualAdjustmentId` with a different idempotency key but identical material payload may be duplicate-reference replay

Duplicate and conflict rules:

- same `manualAdjustmentId` plus same payload is replay
- same `manualAdjustmentId` plus different amount, currency, reason, operator identity, approval identity, ticket, or affected entity is conflict
- missing required approval data is validation failure, not replay or duplicate handling
- a manual adjustment must reference the underlying approved business case directly and must not use another manual adjustment as the financial target or origin basis

Accounting Core guarantees:

- on success: one adjustment transaction is created and returned
- on replay: the original adjustment transaction is returned
- on conflict: no second adjustment is posted

Audit expectations:

- accepted transaction must capture full operator identity, approval identity, case linkage, affected entity linkage, idempotency key, correlation metadata, and evidence that the adjustment is not a recursive manual-adjustment chain

Example acceptance reasoning:

- the same approved adjustment request is retried after timeout and Accounting Core returns the original manual adjustment transaction

Example rejection reasoning:

- an operator reuses the same `manualAdjustmentId` for a different ticket or different amount, or attempts to base one manual adjustment on another manual adjustment, and Accounting Core rejects it

## Step 5

### Recommended enforcement model

What should be enforced in the database:

- idempotency uniqueness by `service + environment + command_type + idempotency_key` in Accounting Core-owned persistence
- non-blank canonical reference fields and non-blank action reference fields where the flow requires them
- database-level uniqueness for action references that must identify one and only one accepted financial action inside their declared scope
- database-level uniqueness for deposit action references within `(provider, deposit_action_type, provider_event_id)` or equivalent normalized scope when provider event references exist
- database-level uniqueness for `(provider, withdrawalPayoutId)` on withdrawal completion actions
- separate persisted uniqueness for `payoutInstructionId`, `houseTakeInstructionId`, and `settlementCorrectionInstructionId` rather than one shared settlement instruction field
- typed settlement correction linkage storage that persists `originalInstruction.type` and `originalInstruction.instructionId` together with referential integrity to accepted original payout or house-take instructions
- relation integrity for follow-up actions that resolve prior operations, especially reservation-based flows
- one-resolution-per-reservation constraints for reserve-follow-up flows where only one terminal action is valid

What should be enforced in application logic:

- material-payload comparison for idempotency replay versus idempotency conflict
- material-payload comparison for same business action reference versus duplicate-reference conflict
- lifecycle transition rules, including mandatory pending-before-confirmed deposit progression, explicit match between confirmation and the accepted pending deposit on provider, user, amount, and currency, reserve before release or capture, no second resolution of the same reservation, and no silent overwrite of prior financial meaning
- deposit action-reference scope validation inside provider + deposit action type before replay or conflict decisions are made
- typed settlement correction validation so `originalInstruction.type` is constrained to payout or house_take, the target instruction exists and is accepted, and the target is an original payout or house-take instruction rather than another correction
- cross-flow reference isolation checks so a reference accepted in one flow or instruction type cannot be reused in another
- reference immutability after first acceptance for the accepted meaning of a business or action reference
- family-level consistency rules where the same canonical business reference can legitimately appear across multiple lifecycle actions but must remain consistent on user, amount, currency, and linked business identity
- flow-specific metadata completeness and immutability checks before posting
- admin-only gatekeeping and richer approval validation for manual adjustments, including manual-adjustment anti-recursion validation

Where idempotency keys should be stored:

- in the Accounting Core idempotency store as the authoritative replay and payload-mismatch control, keyed within service + environment + command type
- on the accepted ledger transaction record for audit traceability after a posting succeeds
- in the upstream receiving service for its own external request boundary when Accounting Core is not the first service to receive the user-facing command

Where business reference uniqueness should be checked:

- first in Accounting Core application logic at command acceptance time, because some flows permit multiple lifecycle actions under one family reference while others do not
- then reinforced in database uniqueness constraints for the specific action reference or scoped business reference once the request shape is explicit and stable enough to persist as a first-class field
- deposit action references must be evaluated inside provider + deposit action type scope rather than as one global provider event ID namespace
- cross-flow reference reuse must always be rejected once a reference meaning is established for a different flow or instruction type
- reference reuse with materially different payload must always be rejected after the first accepted meaning is established
- never inferred from idempotency key reuse alone

Where follow-up action uniqueness should be checked:

- at the reservation or original-instruction relationship level when only one terminal action is allowed
- in Accounting Core service logic when follow-up validity depends on business state, not just static uniqueness, including deposit confirmation requiring an existing accepted pending deposit family and exact match on provider, user, amount, and currency
- settlement correction target validation against the accepted original instruction, including rejection of correction-on-correction targeting
- in database constraints for reservation resolution and other one-successor relationships so bypassing service logic still cannot create duplicate money movement

Recommended implementation posture:

- keep enforcement inside Accounting Core-owned tables and services
- add explicit persisted business action references for flows that currently only have generic `referenceId` semantics
- persist declared action-reference scope alongside the reference where the flow depends on scoped uniqueness, especially provider + deposit action type for deposit event references
- persist distinct settlement action fields for payout, house take, and correction, and persist `originalInstruction { type, instructionId }` as the correction linkage shape
- enforce cross-flow reference isolation explicitly; do not rely on accidental string collisions or one shared reference namespace
- treat duplicate same-payload as deterministic replay and duplicate different-payload as explicit conflict, never as silent overwrite

## Step 6

### Open questions that must be answered before implementation

1. Do all deposit and withdrawal providers supply stable action identifiers for confirm, fail, and reverse events, or must Treasury generate platform-stable action references for some providers?
2. Will Settlement always emit one stable `payoutInstructionId` per payout and one stable `houseTakeInstructionId` per house-take action, or are there cases where one higher-level outcome must expand into child instructions inside Accounting Core?
3. Should deposit reversal and settlement correction receive dedicated transaction types in the next phase, or should they remain temporary compensating instructions routed through tightly controlled adjustment semantics?
