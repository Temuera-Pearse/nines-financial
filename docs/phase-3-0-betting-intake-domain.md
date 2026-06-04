# Phase 3.0 Betting Intake Domain Foundation

Date: 2026-04-28

Phase 3.0 moves primary bet intake into `nines-financial`. The backend may
request a bet placement, but `nines-financial` owns betting-domain validation,
stake reservation, accepted/rejected bet state, live pool totals, audit, and
outbox rows.

## Added Command Surface

- `POST /commands/create-race-pool`
- `POST /commands/register-pool-selection`
- `POST /commands/freeze-pool`
- `POST /commands/place-bet`

All state-changing commands require `idempotencyKey`, `correlationId`, and
`causationId`. Money amounts are USDC minor-unit strings only.

## Added Query Surface

- `GET /bets/:betId`
- `GET /races/:raceId/bets`
- `GET /players/:userId/bets`
- `GET /races/:raceId/pool-totals`
- `GET /races/:raceId/selection-totals`

Live pool totals are derived from `financial_bets` rows with `status =
'accepted'`. Ledger pool accounts are not used for live pool totals.

## Persistence

Migration `004_phase_3_0_betting_intake_domain.sql` adds:

- `race_pools`
- `race_pool_selections`
- `financial_bets`
- indexes for pool status, selections, bet race/status, bet user, bet
  selection/status, and reservation lookup

Accepted bets store the reservation transaction id created by the accounting
core. Rejected bets store rejection code and reason and do not create ledger
transactions.

## Betting Rules

`PlaceBet` accepts a bet only when:

- currency is `USDC`
- `stakeMinor` is a positive minor-unit integer string
- the pool exists and is open
- the selection exists and is active
- the betting window allows placement
- the player account is authorized for `bet_reserve`
- sufficient spendable balance exists

An accepted bet creates exactly one `bet_reserve` transfer from
`user_available` to `user_locked`. Rejected betting-rule outcomes are persisted
as rejected bets with no ledger movement.

## Audit And Outbox

Phase 3.0 persists audit and outbox rows for:

- `financial.pool.opened`
- `financial.pool.selection_registered`
- `financial.pool.frozen`
- `financial.bet.accepted`
- `financial.bet.rejected`
- `financial.wallet.balance_changed`

The outbox publisher is still out of scope.

## Backend Boundary

`nines-back-end` now calls `POST /commands/place-bet` through its
`NinesFinancialClient` on the main bet placement path. The older
`reserveStake` command remains available as a lower-level/internal financial
command for compatibility and targeted tests, but backend bet intake should
prefer `PlaceBet`.

Backend wallet tables remain alpha read/demo support because the local backend
bet table still has a wallet foreign key. They are not the financial source of
truth, and the main path does not mutate backend wallet balances.

## Remaining Deviations

- Backend race-state checks still gate whether a request is sent to
  `nines-financial`; financial pool validation is the authoritative betting
  financial rule check.
- If `nines-financial` accepts a bet and backend local bet persistence then
  fails, the backend still needs a recovery/reconciliation path. This existed in
  the prior reserve-stake bridge and remains a Phase 3 hardening item.
- `PlaceBet` uses Postgres row locks through the accounting core for spend
  protection. A small per-player in-process serialization guard is also present
  so local alpha and pg-mem tests cannot overspend where database lock behavior
  is not fully representative.
- Real deposits, withdrawals, fiat/crypto movement, outbox publishing, and CI/CD
  remain out of scope.

## Phase 3.1 Follow-up

Phase 3.1 implemented backend race lifecycle orchestration for pool creation,
selection registration, and freeze. It also added settlement validation against
financial pool state and canonical accepted `financial_bets`.

Remaining hardening is tracked in
`docs/phase-3-1-race-lifecycle-pool-orchestration.md`.
