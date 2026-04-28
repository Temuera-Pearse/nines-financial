---
Title: NINES Financial v0.1 Implementation Spec
Version: v0.1
Status: Build Contract Draft
Last Updated: 2026-04-26
Owner: NINES Financial
Source Blueprint: ../architecture/nines-financial-blueprint.md
---

# NINES Financial v0.1 Implementation Spec

This document is the v0.1 build contract for `nines-financial`.

It converts the broad architecture blueprint into implementation decisions that
are specific enough to build against. If this document conflicts with the older
blueprint, this document wins for v0.1.

## Locked V0.1 Decisions

1. V1 is a modular monolith, not four deployed services.
2. `nines-financial` is the only authority for ledger writes, balances,
   reservations, funding, withdrawals, and settlement.
3. Active bet stakes remain in `user_locked`.
4. Live pool totals are derived from accepted bets.
5. Selection-level pool ledger accounts are settlement-stage accounts only.
6. Withdrawals remain a late-phase capability.
7. USDC is the canonical front-of-house balance currency.

## Related Locked Decisions

This spec adopts the existing ADRs as binding:

- ADR-0001 Ledger Ownership
- ADR-0002 Idempotency Scope
- ADR-0003 Reference Immutability
- ADR-0004 Settlement Instruction Naming
- ADR-0005 Deposit Lifecycle Pending Before Confirmed

## Source-Of-Truth Rules

### Financial Authority

`nines-financial` is the sole authority for all financial truth in NINES.

No other repository, service, admin tool, worker, script, or UI may directly
create or mutate:

- ledger transactions
- ledger entries
- account balances
- wallet reservations
- bet financial effects
- pool settlement postings
- deposit credits
- withdrawal reservations or completions
- house revenue postings
- financial corrections

External systems may request financial actions. Only `nines-financial` decides
whether those actions are valid and persists their effects.

### Ledger Authority

Inside the modular monolith, the Accounting module is the only module allowed to
write:

- `ledger_accounts`
- `ledger_transactions`
- `ledger_entries`
- balance projection rows derived from the ledger

Other modules submit posting instructions through Accounting module ports. They
must not write ledger rows directly.

### Balance Authority

Balances are derived from ledger entries and account classes.

The system may maintain balance projections for performance, but projections are
not financial truth. If a projection conflicts with ledger-derived balance, the
ledger wins and the projection must be rebuilt or quarantined.

### Pool Authority

For live races before settlement:

- accepted bets are the source of live pool totals
- live selection totals are derived from `bets where status = accepted`
- active stakes remain in `user_locked`
- race selection pool ledger accounts are not populated during bet placement
  or pool freeze

For settlement:

- selection-level pool ledger accounts are populated as part of settlement
- settlement reads settlement-stage ledger balances after accepted stakes have
  been moved from `user_locked`
- selection-level pool accounts must drain to zero before settlement completes

### Currency Authority

USDC is the canonical front-of-house balance currency for v0.1.

All money values are stored as integer minor units. For USDC, minor units use
USDC's six-decimal base:

- `1 USDC = 1_000_000 amount_minor`

Floating point values are forbidden in financial storage, posting logic, request
validation, settlement calculation, and tests.

## Internal Module Boundaries

V1 is a modular monolith. Modules have strict ownership boundaries, but they are
deployed together and may share one database and one transactional boundary
where appropriate.

### Modules

| Module | Owns | Must Not Do |
| --- | --- | --- |
| `application` | command dispatch, transaction orchestration, request fingerprinting, correlation context | own domain rules |
| `accounting` | accounts, ledger posting, balance projection, posting invariants, idempotency enforcement for postings | decide race winners, approve withdrawals, bypass command rules |
| `wallet` | wallet identity, wallet status, wallet read APIs | mutate balances outside Accounting |
| `betting` | bet intake, bet state, accepted bet records, bet validation against race pool state | calculate settlement payouts, write ledger rows directly |
| `pool` | race pool lifecycle, valid selections, freeze and void rules, live pool totals from accepted bets | own balances or ledger posting |
| `settlement` | settlement runs, payout calculation, bet finalization, settlement posting instructions | generate race results, write ledger rows directly |
| `treasury` | deposit lifecycle, withdrawal lifecycle, provider references, chain/provider adapters | write ledger rows directly, place bets, settle races |
| `audit` | audit records, audit queries, operator evidence | mutate financial state |
| `reconciliation` | reconciliation runs, discrepancy records, projection checks, provider-vs-ledger checks | silently repair financial state |
| `infrastructure` | database transactions, migrations, outbox publisher, clocks, config | own business rules |

### Internal Dependency Rules

- Accounting may be called by domain modules through explicit ports.
- Domain modules may not import Accounting persistence internals.
- No module may write another module's domain tables except through an
  application command transaction that invokes the owning module.
- Financial commands that change domain state and ledger state should commit in
  one database transaction when they share the monolith database.
- Async events are facts after commit, not the primary way to complete internal
  financial state changes.

### Public API Rule

HTTP endpoints are not the primary build contract for v0.1. Commands are.

Endpoints may wrap commands later, but every money-affecting endpoint must map
to exactly one command in the Command Catalogue or to an explicitly approved
read-only query.

## Canonical Account Model

### Account Classes And Normal Balances

| Account Class | Normal Balance | Increase With | Decrease With | Examples |
| --- | --- | --- | --- | --- |
| `asset` | debit | debit | credit | treasury USDC, deposit receivable |
| `liability` | credit | credit | debit | user available, user locked, withdrawal reserved, pool clearing |
| `revenue` | credit | credit | debit | house revenue, rounding residual revenue |
| `expense` | debit | debit | credit | optional fee subsidy or correction expense |
| `equity` | credit | credit | debit | optional platform capital or adjustment reserve |

Every ledger account must have:

- an account class
- an account type
- a normal balance
- an owner scope
- a currency
- a status

### Canonical Account Types

#### User Accounts

| Account Type | Class | Scope | Purpose |
| --- | --- | --- | --- |
| `user_available` | liability | wallet | spendable user balance |
| `user_locked` | liability | wallet | accepted bet stakes awaiting settlement or void |
| `user_withdrawal_reserved` | liability | wallet | funds reserved for an approved withdrawal flow |

#### Settlement Accounts

| Account Type | Class | Scope | Purpose |
| --- | --- | --- | --- |
| `race_selection_pool` | liability | race + selection | settlement-stage holding for accepted stakes by selection |
| `settlement_clearing` | liability | race | settlement-stage clearing account for pool distribution |

Selection-level pool accounts are not live pool accounts. They are populated
only after settlement starts.

#### House Accounts

| Account Type | Class | Scope | Purpose |
| --- | --- | --- | --- |
| `house_revenue` | revenue | platform | house take from settled races |
| `house_rounding_residual` | revenue | platform | deterministic settlement rounding residual |
| `adjustment_reserve` | equity | platform | controlled correction funding, if enabled |

#### Treasury Accounts

| Account Type | Class | Scope | Purpose |
| --- | --- | --- | --- |
| `treasury_usdc_cash` | asset | platform/provider | confirmed USDC controlled by the platform |
| `deposit_receivable` | asset | provider deposit family | observed inbound deposit awaiting final confirmation |
| `deposit_pending` | liability | provider deposit family | pending deposit suspense before user credit |
| `withdrawal_clearing` | liability | withdrawal | outgoing funds after reservation and before final completion |

Treasury accounts may be introduced after Phase 1, but their account classes are
locked now so deposit and withdrawal flows do not need redesign later.

### Account Code Format

Account codes must be deterministic and unique.

Recommended forms:

- `user_available:<walletId>`
- `user_locked:<walletId>`
- `user_withdrawal_reserved:<walletId>`
- `race_selection_pool:<raceId>:<selectionId>`
- `settlement_clearing:<raceId>`
- `house_revenue:usdc`
- `house_rounding_residual:usdc`
- `treasury_usdc_cash:<providerOrTreasuryId>`
- `deposit_receivable:<provider>:<providerDepositId>`
- `deposit_pending:<provider>:<providerDepositId>`
- `withdrawal_clearing:<withdrawalId>`
- `adjustment_reserve:usdc`

## Debit/Credit Posting Templates

All templates below are conceptual posting instructions. The implementation must
create one balanced `ledger_transaction` with two or more `ledger_entries`.

`Dr` means debit. `Cr` means credit.

### Wallet Funding For Tests Or Admin-Approved Sandbox Credit

Allowed only in non-production or controlled operator flows.

| Entry | Account | Meaning |
| --- | --- | --- |
| Dr | `adjustment_reserve` or approved expense account | platform-funded source of value |
| Cr | `user_available:<walletId>` | increase user spendable liability |

### Deposit Pending

Required before deposit confirmation.

| Entry | Account | Meaning |
| --- | --- | --- |
| Dr | `deposit_receivable:<provider>:<providerDepositId>` | observed inbound asset claim |
| Cr | `deposit_pending:<provider>:<providerDepositId>` | pending deposit suspense liability |

No user balance changes at pending stage.

### Deposit Confirmed

Requires an accepted pending deposit family matching provider, user, amount, and
currency.

| Entry | Account | Meaning |
| --- | --- | --- |
| Dr | `treasury_usdc_cash:<providerOrTreasuryId>` | confirmed platform-controlled asset |
| Cr | `deposit_receivable:<provider>:<providerDepositId>` | clear pending asset claim |
| Dr | `deposit_pending:<provider>:<providerDepositId>` | clear pending suspense liability |
| Cr | `user_available:<walletId>` | credit confirmed user balance |

### Deposit Failed Before Confirmation

| Entry | Account | Meaning |
| --- | --- | --- |
| Dr | `deposit_pending:<provider>:<providerDepositId>` | clear pending suspense liability |
| Cr | `deposit_receivable:<provider>:<providerDepositId>` | remove unconfirmed asset claim |

### Bet Place / Reserve

Active bet stakes remain locked to the user.

| Entry | Account | Meaning |
| --- | --- | --- |
| Dr | `user_available:<walletId>` | reduce spendable user liability |
| Cr | `user_locked:<walletId>` | increase locked user liability |

### Bet Void / Refund

Used when an accepted bet is voided before settlement-stage pool movement.

| Entry | Account | Meaning |
| --- | --- | --- |
| Dr | `user_locked:<walletId>` | reduce locked user liability |
| Cr | `user_available:<walletId>` | restore spendable user liability |

### Settlement: Move Accepted Stakes Into Selection Pools

For each accepted bet in the race:

| Entry | Account | Meaning |
| --- | --- | --- |
| Dr | `user_locked:<walletId>` | release locked stake from user |
| Cr | `race_selection_pool:<raceId>:<selectionId>` | move stake into settlement-stage selection pool |

### Settlement: Move Selection Pools Into Clearing

For each selection account with a positive balance:

| Entry | Account | Meaning |
| --- | --- | --- |
| Dr | `race_selection_pool:<raceId>:<selectionId>` | drain selection pool |
| Cr | `settlement_clearing:<raceId>` | aggregate pool value for distribution |

### Settlement: House Take

| Entry | Account | Meaning |
| --- | --- | --- |
| Dr | `settlement_clearing:<raceId>` | reduce distributable settlement liability |
| Cr | `house_revenue:usdc` | record platform house take |

### Settlement: Winner Payout

One entry pair per winning bet, or a grouped transaction with one clearing debit
and many winner credits.

| Entry | Account | Meaning |
| --- | --- | --- |
| Dr | `settlement_clearing:<raceId>` | reduce settlement liability |
| Cr | `user_available:<walletId>` | credit winner payout including returned stake |

### Settlement: Rounding Residual

Default v0.1 rule: residual minor units go to house rounding residual revenue.

| Entry | Account | Meaning |
| --- | --- | --- |
| Dr | `settlement_clearing:<raceId>` | clear remaining residual |
| Cr | `house_rounding_residual:usdc` | record deterministic residual |

### Withdrawal Request / Reserve

Withdrawals are late phase. When enabled:

| Entry | Account | Meaning |
| --- | --- | --- |
| Dr | `user_available:<walletId>` | reduce spendable user liability |
| Cr | `user_withdrawal_reserved:<walletId>` | reserve funds for withdrawal |

### Withdrawal Broadcast / Move To Clearing

Mandatory if the withdrawal enters `broadcasted`.

| Entry | Account | Meaning |
| --- | --- | --- |
| Dr | `user_withdrawal_reserved:<walletId>` | reduce reserved user liability |
| Cr | `withdrawal_clearing:<withdrawalId>` | hold outgoing liability pending external finality |

### Withdrawal Confirmed

Requires external finality evidence.

| Entry | Account | Meaning |
| --- | --- | --- |
| Dr | `withdrawal_clearing:<withdrawalId>` | clear outgoing liability |
| Cr | `treasury_usdc_cash:<providerOrTreasuryId>` | reduce platform-controlled asset |

### Withdrawal Cancelled Or Failed Before Broadcast

| Entry | Account | Meaning |
| --- | --- | --- |
| Dr | `user_withdrawal_reserved:<walletId>` | clear withdrawal reservation |
| Cr | `user_available:<walletId>` | restore spendable user balance |

### Withdrawal Failed After Broadcast Without External Completion

Allowed only when provider evidence proves no external value left the platform.

| Entry | Account | Meaning |
| --- | --- | --- |
| Dr | `withdrawal_clearing:<withdrawalId>` | clear outgoing liability |
| Cr | `user_available:<walletId>` | restore spendable user balance |

If external status is ambiguous, do not release funds. Move the withdrawal to
manual review.

## Command Catalogue

All state-changing commands require:

- authenticated actor
- authorization check
- idempotency key
- request fingerprint
- correlation ID
- audit record
- outbox events when state changes

### Wallet Commands

| Command | Owner | Preconditions | State Effect | Posting Template | Events |
| --- | --- | --- | --- | --- | --- |
| `CreateWallet` | wallet | user exists, wallet absent | creates wallet and user accounts | none | `financial.wallet.created` |
| `RestrictWallet` | wallet | authorized operator, wallet active | wallet becomes restricted | none | `financial.wallet.restricted` |
| `UnrestrictWallet` | wallet | authorized operator, wallet restricted | wallet becomes active | none | `financial.wallet.unrestricted` |
| `RebuildWalletBalanceProjection` | accounting | operator/system, ledger available | projection rebuilt from ledger | none | `financial.projection.wallet_rebuilt` |

### Pool And Betting Commands

| Command | Owner | Preconditions | State Effect | Posting Template | Events |
| --- | --- | --- | --- | --- | --- |
| `CreateRacePool` | pool | race reference accepted, pool absent | pool `open` | none | `financial.pool.opened` |
| `RegisterPoolSelection` | pool | pool open, selection absent | selection active | none | `financial.pool.selection_registered` |
| `FreezePool` | pool | pool open, cutoff reached or authorized trigger | pool `frozen` | none | `financial.pool.frozen` |
| `PlaceBet` | betting | wallet active, pool open, selection active, cutoff not passed, sufficient available balance | bet `accepted` or `rejected` | Bet Place / Reserve | `financial.bet.accepted`, `financial.bet.rejected`, `financial.wallet.balance_changed` |
| `VoidPool` | pool/settlement | pool open or frozen, not settled, authorized reason | pool `voided`, accepted bets voided | Bet Void / Refund for each accepted bet | `financial.pool.voided`, `financial.bet.voided`, `financial.wallet.balance_changed` |

### Settlement Commands

| Command | Owner | Preconditions | State Effect | Posting Template | Events |
| --- | --- | --- | --- | --- | --- |
| `StartSettlement` | settlement | pool frozen, official result authorized, race not already settled | settlement run `running` | none yet, or all settlement postings in one transaction | `financial.settlement.started` |
| `CompleteSettlement` | settlement | settlement run running, payout calculation valid | bets terminal, pool settled, run completed | settlement templates | `financial.bet.settled_win`, `financial.bet.settled_loss`, `financial.pool.settled`, `financial.settlement.completed`, `financial.wallet.balance_changed` |
| `FailSettlementRun` | settlement | running/posting state cannot safely complete | run `failed` or `manual_review` | none unless compensating command is explicit | `financial.settlement.failed` |
| `ApplySettlementCorrection` | settlement/accounting | restricted operator flow, original typed instruction exists | correction record created | compensating posting template approved by Accounting | `financial.settlement.corrected` |

Implementation may combine `StartSettlement` and `CompleteSettlement` into one
transactional command for v0.1 if the command remains idempotent and no partial
financial state can be committed silently.

### Deposit Commands

| Command | Owner | Preconditions | State Effect | Posting Template | Events |
| --- | --- | --- | --- | --- | --- |
| `CreateDepositIntent` | treasury | wallet active, supported provider/asset | deposit `intent_created` | none | `financial.deposit.intent_created` |
| `MarkDepositPending` | treasury/accounting | intent exists or allowed unmatched tracking path, provider event verified | deposit `pending_confirmation` | Deposit Pending | `financial.deposit.pending_confirmation` |
| `ConfirmDeposit` | treasury/accounting | matching pending deposit exists, provider finality verified | deposit `confirmed` | Deposit Confirmed | `financial.deposit.confirmed`, `financial.wallet.balance_changed` |
| `FailDeposit` | treasury/accounting | deposit not confirmed | deposit `failed` or `manual_review` | Deposit Failed Before Confirmation when pending was posted | `financial.deposit.failed` |

### Withdrawal Commands

Withdrawals are not Phase 1. These commands are locked for later phases.

| Command | Owner | Preconditions | State Effect | Posting Template | Events |
| --- | --- | --- | --- | --- | --- |
| `CreateWithdrawalRequest` | treasury | wallet active, withdrawals enabled, sufficient available balance, destination valid | withdrawal `requested` | Withdrawal Request / Reserve | `financial.withdrawal.requested`, `financial.wallet.balance_changed` |
| `ApproveWithdrawal` | treasury | requested, policy checks passed | withdrawal `approved` | none | `financial.withdrawal.approved` |
| `CancelWithdrawal` | treasury | requested or approved, not broadcasted | withdrawal `cancelled` | Withdrawal Cancelled Or Failed Before Broadcast | `financial.withdrawal.cancelled`, `financial.wallet.balance_changed` |
| `MarkWithdrawalBroadcasted` | treasury/accounting | approved, external transaction reference present | withdrawal `broadcasted` | Withdrawal Broadcast / Move To Clearing | `financial.withdrawal.broadcasted` |
| `ConfirmWithdrawal` | treasury/accounting | broadcasted, external finality verified | withdrawal `confirmed` | Withdrawal Confirmed | `financial.withdrawal.confirmed` |
| `FailWithdrawal` | treasury/accounting | requested, approved, broadcasted, or external unknown | withdrawal `failed` or `manual_review` | failure template only when no external completion occurred | `financial.withdrawal.failed`, `financial.wallet.balance_changed` when released |
| `MarkWithdrawalExternalUnknown` | treasury | provider result ambiguous | withdrawal `external_status_unknown` | none | `financial.withdrawal.external_status_unknown` |

### Reconciliation And Audit Commands

| Command | Owner | Preconditions | State Effect | Posting Template | Events |
| --- | --- | --- | --- | --- | --- |
| `RunLedgerReconciliation` | reconciliation | authorized system/operator | reconciliation run recorded | none | `financial.reconciliation.started`, `financial.reconciliation.completed` |
| `RecordDiscrepancy` | reconciliation | discrepancy detected | discrepancy open | none | `financial.discrepancy.detected` |
| `ResolveDiscrepancy` | reconciliation | authorized operator, resolution evidence | discrepancy resolved | none unless separate correction command | `financial.discrepancy.resolved` |

## State Machines

State transitions must be enforced by domain guards and backed by persistence
constraints where practical.

### Wallet

States:

- `active`
- `restricted`
- `closed`
- `manual_review`

Valid transitions:

- `active -> restricted`
- `restricted -> active`
- `active -> closed`
- `restricted -> closed`
- `active -> manual_review`
- `restricted -> manual_review`
- `manual_review -> active`
- `manual_review -> restricted`

Rules:

- restricted wallets cannot place bets or request withdrawals
- closed wallets cannot receive normal new activity
- manual review blocks spendable actions until resolved

### Bet

States:

- `accepted`
- `rejected`
- `settlement_pending`
- `settled_win`
- `settled_loss`
- `voided`
- `manual_review`

Valid transitions:

- request accepted by command -> `accepted`
- request rejected by command -> `rejected`
- `accepted -> settlement_pending`
- `settlement_pending -> settled_win`
- `settlement_pending -> settled_loss`
- `accepted -> voided`
- `settlement_pending -> manual_review`

Rules:

- v0.1 does not require persisting `pending` bet requests
- rejected bets have no ledger effect
- accepted bets must have exactly one reservation posting
- accepted stakes remain in `user_locked` until settlement or void
- terminal normal states are `rejected`, `settled_win`, `settled_loss`, and `voided`

### Race Pool

States:

- `open`
- `frozen`
- `settlement_running`
- `settled`
- `voided`
- `manual_review`

Valid transitions:

- `open -> frozen`
- `open -> voided`
- `frozen -> settlement_running`
- `frozen -> voided`
- `settlement_running -> settled`
- `settlement_running -> manual_review`
- `manual_review -> settled` only through approved remediation
- `manual_review -> voided` only through approved remediation

Rules:

- bets may be accepted only when pool is `open`
- freeze creates no ledger movement
- live pool totals are derived from accepted bets
- settlement-stage selection pool accounts may receive funds only after the pool
  enters `settlement_running`
- settled and voided pools are terminal outside remediation

### Settlement Run

States:

- `pending`
- `running`
- `posting_required`
- `completed`
- `failed`
- `manual_review`

Valid transitions:

- `pending -> running`
- `running -> completed`
- `running -> posting_required`
- `running -> failed`
- `running -> manual_review`
- `posting_required -> completed`
- `posting_required -> manual_review`
- `manual_review -> completed` only through approved remediation
- `manual_review -> failed` only through approved remediation

Rules:

- one completed settlement per race
- no concurrent active settlement runs for one race
- failed run instances do not permit duplicate payout
- financial posting and terminal bet updates should commit atomically
- if atomic commit is impossible, use `posting_required` or `manual_review`

### Deposit

States:

- `intent_created`
- `pending_confirmation`
- `confirmed`
- `failed`
- `rejected`
- `posting_required`
- `manual_review`

Valid transitions:

- `intent_created -> pending_confirmation`
- `intent_created -> failed`
- `intent_created -> rejected`
- `pending_confirmation -> confirmed`
- `pending_confirmation -> failed`
- `pending_confirmation -> posting_required`
- `posting_required -> confirmed`
- `pending_confirmation -> manual_review`
- `posting_required -> manual_review`

Rules:

- confirmed cannot be the first accepted financial action in a deposit family
- confirmation must match the pending deposit on provider, user, amount, and
  currency
- duplicate provider events must not duplicate credit
- ambiguous provider evidence moves to `manual_review`

### Withdrawal

Withdrawals are late phase, but states are locked now.

States:

- `requested`
- `approved`
- `broadcasted`
- `external_status_unknown`
- `confirmed`
- `failed`
- `cancelled`
- `manual_review`

Valid transitions:

- `requested -> approved`
- `requested -> cancelled`
- `requested -> failed`
- `approved -> broadcasted`
- `approved -> cancelled`
- `approved -> failed`
- `broadcasted -> confirmed`
- `broadcasted -> failed`
- `broadcasted -> external_status_unknown`
- `external_status_unknown -> confirmed`
- `external_status_unknown -> failed`
- `external_status_unknown -> manual_review`
- `manual_review -> confirmed` only with external evidence
- `manual_review -> failed` only with external evidence

Rules:

- request reserves funds before external action
- broadcast moves reserved funds into withdrawal clearing
- confirmation requires external finality evidence
- ambiguous external status must not release funds
- no withdrawal may create more than one external transfer

## Settlement Edge-Case Rules

### Supported V0.1 Settlement Shape

V0.1 supports:

- one race
- one winning selection
- single-selection bets
- USDC-only pool
- fixed house take basis points configured before settlement

Unsupported settlement inputs must be rejected or moved to manual review.

### Empty Pool

If a frozen pool has no accepted bets:

- settlement may complete with zero total pool
- no ledger postings are created
- no house take is posted
- pool becomes `settled`
- settlement summary records `totalPoolAmount = 0`

### No Winning Stake

If the official winning selection has no accepted stake:

- v0.1 treats the pool as a no-winner refund
- no house take is posted
- all accepted bets are voided/refunded from `user_locked` to `user_available`
- settlement run completes with reason `NO_WINNING_STAKE_REFUND`

This avoids allocating user funds to house revenue when no bettor can receive a
parimutuel payout.

### Invalid Winning Selection

If `winningSelectionId` is not registered as an active selection for the race:

- settlement must not post ledger entries
- settlement run moves to `manual_review`
- pool remains `frozen` or `manual_review`
- an audit event and discrepancy must be recorded

### Multiple Winners Or Dead Heat

Dead heat and multiple-winner payout rules are out of scope for v0.1.

If the race authority submits multiple winners:

- reject the settlement command, or
- move settlement to `manual_review` if the result was already accepted by an
  upstream process

Do not approximate multiple-winner payout logic in v0.1.

### Scratched Or Cancelled Selections

Partial selection voids are out of scope for v0.1.

If a selection is scratched after accepted bets exist:

- before freeze: reject new bets on that selection and move affected accepted
  bets through an explicit void/refund command if supported
- after freeze: move the pool to `manual_review` or void the whole pool through
  `VoidPool`

### House Take Rounding

House take is calculated as:

`floor(totalPoolAmountMinor * houseTakeBps / 10000)`

The result is always integer minor units.

### Winner Payout Rounding

Each winning bet payout is calculated as:

`floor(winningStakeAmountMinor * distributablePoolAmountMinor / winningPoolAmountMinor)`

Payout includes returned stake because settlement clearing holds the full pool.

### Rounding Residual

After winner payouts:

`roundingResidual = distributablePoolAmountMinor - sum(winnerPayoutAmountMinor)`

If `roundingResidual > 0`, post it to `house_rounding_residual:usdc`.

No settlement may overpay. Underpayment is allowed only by deterministic
minor-unit residual handling.

### Settlement Atomicity

The preferred v0.1 implementation posts all settlement ledger entries and
terminal bet/pool/settlement states in one database transaction.

If that cannot be achieved, settlement must use `posting_required` or
`manual_review`; it must not leave bets, pools, and ledger entries silently out
of sync.

## Required DB Enums, Tables, And Indexes

### Required Enums

- `account_class`: `asset`, `liability`, `revenue`, `expense`, `equity`
- `account_normal_balance`: `debit`, `credit`
- `account_type`: values from Canonical Account Types
- `account_status`: `active`, `frozen`, `closed`
- `ledger_entry_direction`: `debit`, `credit`
- `wallet_status`: `active`, `restricted`, `closed`, `manual_review`
- `bet_status`: `accepted`, `rejected`, `settlement_pending`, `settled_win`,
  `settled_loss`, `voided`, `manual_review`
- `pool_status`: `open`, `frozen`, `settlement_running`, `settled`, `voided`,
  `manual_review`
- `settlement_run_status`: `pending`, `running`, `posting_required`,
  `completed`, `failed`, `manual_review`
- `deposit_status`: `intent_created`, `pending_confirmation`, `confirmed`,
  `failed`, `rejected`, `posting_required`, `manual_review`
- `withdrawal_status`: `requested`, `approved`, `broadcasted`,
  `external_status_unknown`, `confirmed`, `failed`, `cancelled`,
  `manual_review`
- `idempotency_status`: `processing`, `succeeded`, `failed`, `conflict`
- `outbox_status`: `pending`, `published`, `failed`, `dead_lettered`
- `reconciliation_status`: `running`, `completed`, `failed`
- `discrepancy_status`: `open`, `investigating`, `resolved`, `dismissed`

### Required Tables

#### `wallets`

Required columns:

- `wallet_id` primary key
- `user_id` unique not null
- `currency_code` not null default `USDC`
- `status` not null
- `created_at` not null
- `updated_at` not null

Required indexes:

- unique `(user_id)`
- index `(status)`

#### `ledger_accounts`

Required columns:

- `ledger_account_id` primary key
- `account_code` unique not null
- `account_class` not null
- `normal_balance` not null
- `account_type` not null
- `owner_type` not null
- `owner_id` nullable
- `wallet_id` nullable
- `race_id` nullable
- `selection_id` nullable
- `provider` nullable
- `currency_code` not null
- `status` not null
- `created_at` not null

Required indexes:

- unique `(account_code)`
- index `(wallet_id, account_type)`
- index `(race_id, account_type)`
- index `(race_id, selection_id, account_type)`
- index `(provider, account_type)`

Required constraints:

- account class must match account type
- wallet-owned account types require `wallet_id`
- race selection accounts require `race_id` and `selection_id`
- platform accounts must not have `wallet_id`

#### `ledger_transactions`

Required columns:

- `ledger_transaction_id` primary key
- `transaction_type` not null
- `business_reference` not null
- `action_reference` nullable
- `idempotency_key` not null
- `request_fingerprint` not null
- `entity_type` nullable
- `entity_id` nullable
- `correlation_id` not null
- `causation_id` nullable
- `created_by_actor_type` not null
- `created_by_actor_id` nullable
- `posted_at` not null
- `created_at` not null

Required indexes:

- unique `(transaction_type, business_reference, action_reference)` where
  action reference is present
- unique `(transaction_type, business_reference)` where action reference is not
  present and transaction type is single-action
- index `(entity_type, entity_id)`
- index `(correlation_id)`
- index `(posted_at)`

#### `ledger_entries`

Required columns:

- `ledger_entry_id` primary key
- `ledger_transaction_id` foreign key not null
- `ledger_account_id` foreign key not null
- `direction` not null
- `amount_minor` bigint not null
- `currency_code` not null
- `entry_sequence` integer not null
- `created_at` not null

Required indexes:

- index `(ledger_transaction_id)`
- index `(ledger_account_id, created_at)`

Required constraints:

- `amount_minor > 0`
- one transaction's entries must balance by currency
- entry sequence unique per transaction

If the database cannot enforce transaction balancing with ordinary constraints,
the posting engine must enforce it before commit and reconciliation must verify
it after commit.

#### `account_balances`

Projection table owned by Accounting.

Required columns:

- `ledger_account_id` primary key
- `debit_posted_minor` not null
- `credit_posted_minor` not null
- `balance_minor` not null
- `normal_balance` not null
- `as_of_ledger_entry_id` nullable
- `updated_at` not null

Required indexes:

- index `(updated_at)`

Rule:

- rebuildable from `ledger_entries`
- not financial truth

#### `idempotency_records`

Required columns:

- `idempotency_record_id` primary key
- `service_scope` not null
- `environment` not null
- `command_type` not null
- `idempotency_key` not null
- `request_fingerprint` not null
- `status` not null
- `response_snapshot_json` nullable
- `entity_type` nullable
- `entity_id` nullable
- `error_code` nullable
- `created_at` not null
- `updated_at` not null
- `completed_at` nullable

Required indexes:

- unique `(service_scope, environment, command_type, idempotency_key)`
- index `(entity_type, entity_id)`
- index `(status, updated_at)`

#### `outbox_events`

Required columns:

- `outbox_event_id` primary key
- `event_id` unique not null
- `event_type` not null
- `event_version` not null
- `entity_type` not null
- `entity_id` not null
- `correlation_id` not null
- `causation_id` nullable
- `payload_json` not null
- `status` not null
- `attempt_count` not null default 0
- `created_at` not null
- `published_at` nullable
- `last_attempt_at` nullable

Required indexes:

- unique `(event_id)`
- index `(status, created_at)`
- index `(entity_type, entity_id)`

#### `audit_events`

Required columns:

- `audit_event_id` primary key
- `actor_type` not null
- `actor_id` nullable
- `action_type` not null
- `entity_type` not null
- `entity_id` not null
- `correlation_id` not null
- `causation_id` nullable
- `idempotency_key` nullable
- `before_state_json` nullable
- `after_state_json` nullable
- `details_json` nullable
- `created_at` not null

Required indexes:

- index `(entity_type, entity_id)`
- index `(actor_type, actor_id)`
- index `(correlation_id)`
- index `(created_at)`

#### Domain Tables

Required domain tables:

- `race_pools`
- `pool_selections`
- `bets`
- `settlement_runs`
- `settlement_payouts`
- `deposits`
- `withdrawals`
- `reconciliation_runs`
- `reconciliation_discrepancies`

Required uniqueness:

- `wallets.user_id` unique
- `race_pools.race_id` unique
- `pool_selections (race_id, selection_id)` unique
- `bets.bet_id` unique
- `bets (user_id, idempotency_key)` unique where applicable
- one accepted bet reservation per `bet_id`
- one completed settlement per `race_id`
- no concurrent `running` or `posting_required` settlement run per `race_id`
- `deposits (provider, provider_deposit_id)` unique for family
- deposit action references unique by `(provider, provider_event_id, action_type)`
- `withdrawals.withdrawal_id` unique
- withdrawal external completion references unique by `(provider, external_transaction_reference)`
- reconciliation discrepancies indexable by entity

## Idempotency And Request Fingerprint Rules

### Idempotency Scope

Idempotency uniqueness is:

`service_scope + environment + command_type + idempotency_key`

For the modular monolith, `service_scope` should normally be
`nines-financial`.

### Request Fingerprint

Each command must compute a stable request fingerprint over the material payload.

The fingerprint must include fields that change financial or lifecycle meaning:

- command type
- user ID or wallet ID
- amount minor
- currency
- race ID
- selection ID
- deposit provider and provider deposit ID
- provider event/action reference
- withdrawal destination and provider reference
- settlement run ID
- payout, house-take, or correction instruction IDs
- original instruction linkage for corrections
- source and destination account intent
- effective business timestamp when it affects validity

The fingerprint must exclude fields that do not change financial meaning:

- correlation ID
- request ID
- trace ID
- caller retry timestamp
- log-only metadata
- non-material display notes

If optional metadata can change financial interpretation, it is material and must
be included.

### Replay Rules

- same idempotency key plus same fingerprint plus prior success returns the
  original result
- same idempotency key plus same fingerprint plus in-progress command returns
  current processing status
- same idempotency key plus different fingerprint is a conflict
- different idempotency key plus same immutable business/action reference and
  same material payload is duplicate-reference replay
- different idempotency key plus same immutable business/action reference and
  different material payload is conflict

### Business Reference Rules

Idempotency keys do not replace business references.

Required business references:

- deposits: `providerDepositId` family plus provider action reference
- withdrawals: `withdrawalId` family plus provider external action reference
- bets: `betId`
- settlement payout: `payoutInstructionId`
- settlement house take: `houseTakeInstructionId`
- settlement correction: `settlementCorrectionInstructionId` plus typed
  `originalInstruction`
- manual adjustment: `manualAdjustmentId`

Once accepted, the material meaning of a business/action reference is immutable.

## Outbox, Audit, And Reconciliation Requirements

### Outbox

Every command that changes lifecycle state, ledger state, or audit-relevant
financial state must create outbox events in the same transaction as the
canonical state change.

Outbox publication is at-least-once. Consumers must be idempotent.

Event publication failure must not roll back committed financial truth. It must
leave a pending or failed outbox row for retry.

### Audit

Every financial command must create an audit event with:

- actor
- action type
- target entity
- before state when applicable
- after state when applicable
- idempotency key
- business reference
- correlation ID
- causation ID
- ledger transaction IDs when applicable
- reason code for operator actions

Audit records are append-only. Corrections create new audit records.

### Reconciliation

Minimum required reconciliation jobs:

- ledger transaction balancing by currency
- account balance projection vs ledger-derived balance
- wallet available/locked/reserved balances vs account positions
- live pool totals from accepted bets
- settlement totals: pool equals payouts plus house take plus residual
- deposit provider references vs deposit lifecycle rows
- withdrawal provider references vs withdrawal lifecycle rows
- outbox stuck-event scan
- idempotency records stuck in processing

Discrepancies must be stored, visible to operators, and linked to affected
entities. Reconciliation must not silently repair ledger truth.

## Phase 1 Implementation Checklist

Phase 1 builds the accounting foundation. It does not launch withdrawals.

### Documentation And Decisions

- [ ] Mark this spec as the v0.1 build contract.
- [ ] Archive or rewrite stale old-blueprint sections listed below.
- [ ] Confirm USDC minor-unit precision in config and tests.
- [ ] Confirm deployment remains modular monolith for V1.

### Schema

- [ ] Add enum migrations for account classes, account types, ledger directions,
      wallet status, idempotency status, outbox status, and audit categories.
- [ ] Add `wallets`.
- [ ] Add `ledger_accounts`.
- [ ] Add `ledger_transactions`.
- [ ] Add `ledger_entries`.
- [ ] Add `account_balances` projection table.
- [ ] Add `idempotency_records`.
- [ ] Add `outbox_events`.
- [ ] Add `audit_events`.
- [ ] Add reconciliation tables if not already present.
- [ ] Add unique indexes for account code, idempotency scope, and business
      references.

### Accounting Core

- [ ] Implement account creation through Accounting-owned interfaces.
- [ ] Implement posting engine with account class and normal-balance validation.
- [ ] Reject unbalanced postings before commit.
- [ ] Reject unknown account types and invalid owner scopes.
- [ ] Persist ledger transaction, entries, idempotency record, audit event, and
      outbox event atomically.
- [ ] Maintain or rebuild `account_balances` from ledger entries.
- [ ] Add projection verification and rebuild commands.

### Idempotency And References

- [ ] Implement stable request fingerprinting.
- [ ] Enforce idempotency scope:
      `service_scope + environment + command_type + idempotency_key`.
- [ ] Return original result for exact replay.
- [ ] Reject same-key different-payload conflicts.
- [ ] Enforce business reference immutability for posting commands.

### Minimal Wallet Capability

- [ ] Create wallet and user account set.
- [ ] Query wallet balance from projections with ledger fallback/rebuild path.
- [ ] Restrict wallet spendable actions when wallet status is not `active`.

### Phase 1 Test Gate

- [ ] Unit tests for posting math and normal balances.
- [ ] Service tests using real database transactions and unique constraints.
- [ ] Idempotency replay/conflict tests.
- [ ] Projection rebuild tests.
- [ ] Audit and outbox atomicity tests.
- [ ] Migration tests for financial tables and constraints.

## Invariant Test Checklist

These tests are required before real-money flows.

### Ledger Invariants

- [ ] Every posted ledger transaction balances by currency.
- [ ] Ledger entries are append-only.
- [ ] Ledger entries cannot have zero or negative amount.
- [ ] Account class and normal balance are valid for every account type.
- [ ] Balance projection can be rebuilt exactly from ledger entries.
- [ ] Projection mismatch is detected and does not override ledger truth.

### Idempotency Invariants

- [ ] Exact replay returns original result.
- [ ] Same idempotency key with different material payload is rejected.
- [ ] Same business reference with same payload does not duplicate money.
- [ ] Same business reference with different payload is rejected.
- [ ] In-progress replay does not start another execution.

### Wallet And Balance Invariants

- [ ] User available balance cannot go negative.
- [ ] Locked funds cannot be withdrawn or re-bet.
- [ ] Withdrawal reserved funds cannot be spent.
- [ ] Restricted wallets cannot place bets or request withdrawals.

### Betting And Pool Invariants

- [ ] Accepted bet creates exactly one reservation posting.
- [ ] Rejected bet creates no posting.
- [ ] Freeze creates no ledger posting.
- [ ] Live pool totals equal sum of accepted bets.
- [ ] Active bet stakes remain in `user_locked`.
- [ ] No bet is accepted after pool freeze.

### Settlement Invariants

- [ ] One race cannot complete settlement twice.
- [ ] Settlement cannot start unless pool is frozen.
- [ ] Settlement-stage selection accounts are populated only during settlement.
- [ ] Selection pool accounts drain to zero before completed settlement.
- [ ] Settlement clearing drains to zero or to explicit residual handling.
- [ ] Total pool equals winner payouts plus house take plus residual.
- [ ] No winner payout overpays deterministic entitlement.
- [ ] No-winning-stake case refunds all accepted bets.
- [ ] Empty pool settles with zero postings.
- [ ] Invalid result does not post ledger entries.

### Deposit Invariants

- [ ] Deposit confirmation cannot occur before pending.
- [ ] Confirmation must match pending provider, user, amount, and currency.
- [ ] Duplicate provider event cannot duplicate credit.
- [ ] Failed pending deposit clears pending suspense.

### Withdrawal Invariants

- [ ] Withdrawal request reserves available funds exactly once.
- [ ] Broadcast moves reserved funds to withdrawal clearing exactly once.
- [ ] Confirmation requires external finality evidence.
- [ ] Ambiguous provider status does not release funds.
- [ ] One withdrawal cannot create two external transfers.

### Audit, Outbox, And Reconciliation Invariants

- [ ] Every money-affecting command creates an audit event.
- [ ] Outbox events are persisted atomically with canonical state changes.
- [ ] Failed event publication leaves retryable outbox state.
- [ ] Reconciliation detects ledger imbalance.
- [ ] Reconciliation detects projection mismatch.
- [ ] Reconciliation detects settlement total mismatch.
- [ ] Reconciliation detects duplicate or conflicting external references.

## Old Blueprint Sections To Remove Or Rewrite

The old blueprint remains useful background, but these parts are stale or
contradictory for v0.1.

### Remove Placeholder And Formatting Artifacts

- Remove the line that says full detailed content should be pasted later.
- Remove the stray trailing `1`.
- Normalize section numbering.
- Remove non-contract conversational notes.

### Rewrite Table Of Contents

- The old table of contents lists `Command Catalogue`, but the command
  catalogue is not a standalone complete section.
- Replace endpoint-first structure with command-first structure.

### Replace Service Split With Modular Monolith

- Rewrite the section that divides V1 into four deployed services.
- Keep domain boundaries, but express them as modules inside one deployable
  `nines-financial` application.
- Keep Accounting as the only ledger-writing module.

### Collapse Duplicate Account Model Sections

- Remove the earlier account model that leaves selection-level accounts as an
  unresolved choice.
- Keep the locked v0.1 decision:
  selection-level pool accounts are settlement-stage accounts only.

### Rewrite Live Pool Accounting

- Remove any statement implying live selection pool ledger accounts are the
  source of active pre-settlement pool totals.
- Replace with:
  live pool totals are derived from accepted bets, while active stakes remain in
  `user_locked`.

### Rewrite No-Post-Cutoff Pool Mutation Rule

- The old text says selection pool accounts must not receive funds after freeze,
  while later settlement flow moves stakes into selection accounts after freeze.
- Replace with:
  no new accepted bets after freeze; settlement-stage selection accounts may be
  populated only by settlement after the pool enters `settlement_running`.

### Rewrite Withdrawal Clearing Optionality

- The old text treats moving funds into withdrawal clearing at broadcast as
  optional.
- For v0.1+ withdrawal design, make it mandatory once withdrawal reaches
  `broadcasted`.

### Align Deposits With ADR-0005

- Ensure deposit pending is mandatory before confirmed.
- Ensure confirmation cannot be first accepted posting in a deposit family.
- Ensure pending and confirmed action references have distinct scopes.

### Promote Recovery States

- The old blueprint mentions recovery states in failure sections but not in the
  canonical state machines or enums.
- Add `manual_review`, `posting_required`, and `external_status_unknown` where
  required.

### Replace Currency Drift

- Replace `NINES_UNIT` with `USDC`.
- State that all front-of-house balances use USDC minor units in v0.1.

### Narrow Settlement Scope

- Add explicit v0.1 rules for empty pool, no winning stake, invalid winner,
  dead heat, scratched selections, house-take rounding, payout rounding, and
  residual handling.
- Reject or manual-review unsupported result shapes instead of silently
  approximating them.

### Defer Broad Endpoint Catalogue

- The endpoint catalogue is useful but too broad for Phase 1.
- Keep it as API planning material, not the implementation contract.
- Require every future write endpoint to map to a command in this spec.
