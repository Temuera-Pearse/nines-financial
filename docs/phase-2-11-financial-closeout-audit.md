# Phase 2.11 Financial Closeout Audit

Date: 2026-04-28

Verdict: ready for Phase 3 with tracked alpha-only deviations. Phase 2 has
closed the main financial-authority gap: `nines-financial` is now the authority
for ledger writes, balances, reservations, account controls, and settlement
posting on the primary bet and settlement paths.

## Scope Checked

- `nines-financial`
- `nines-back-end`
- `nines-front-end`
- `nines-admin`

The audit searched for wallet balance mutation, ledger writes, stake debit,
payout, settlement, funding, withdrawal, reservation, and account-control logic
outside `nines-financial`.

## Authority Status

- Main bet placement in `nines-back-end` now calls
  `financialClient.reserveStake` before accepting a bet. The backend stores the
  local bet workflow record, but it does not debit or lock the backend wallet on
  the primary path.
- Main race settlement in `nines-back-end` sends one race-level
  `financialClient.settleBet` command with `raceId`, `winningSelectionId`,
  accepted bet facts, `totalPoolMinor`, `houseTakeBps`, and idempotency
  metadata. The backend may determine the race winner, but payout truth is
  delegated to `nines-financial`.
- `nines-financial` exposes the Phase 2.7 command routes used by the backend:
  reserve stake, release reservation, settle bet, apply house take, account
  summary, and balance reads.
- Pool-proration settlement is the main `nines-financial` settlement path. It
  calculates gross pool, house take, net pool, winner shares, deterministic
  rounding, ledger postings, and outbox events using integer `BigInt` math.
- Cross-service DTOs use USDC as the canonical currency and minor-unit strings
  for money amounts. Loose decimal command amounts and non-USDC command
  currencies are rejected.
- Account controls, restrictions, suspensions, freezes, command metadata,
  idempotency, audit, outbox, and reconciliation scaffolding are represented in
  `nines-financial`.

## Remaining Alpha-Only Deviations

- `nines-back-end/src/services/walletService.ts` and
  `nines-back-end/src/api/userRoutes.ts` still support legacy wallet credits and
  debits for local alpha continuity. These paths are documented as alpha-only;
  real funding and account mutation must route through `nines-financial`.
- `nines-back-end` keeps legacy financial fallback code for bet placement and
  settlement. It requires explicit opt-in with
  `NINES_ENABLE_LEGACY_ALPHA_FINANCIAL_FALLBACK=true`, and can be hard-blocked
  with `NINES_DISABLE_LEGACY_ALPHA_FINANCIAL_MUTATIONS=true`.
- The backend legacy settlement fallback still contains the old `2x stakeMinor`
  payout rule, but that rule is no longer on the main settlement path.
- `nines-front-end/src/state/fundingStore.ts` and the add-funds UI are
  documented as alpha mock funding. They are not financial truth.
- `nines-admin` currently models financial read surfaces, including wallet,
  ledger, deposit, settlement, and withdrawal DTOs. No live admin mutation path
  was found in this audit, but the admin dependency/toolchain issue blocks local
  verification in this checkout.
- Backend wallet tables remain for legacy read/demo continuity. They are not the
  source of truth for new financial mutations.
- Withdrawals remain late-phase and must not be treated as live/mature product
  behavior.
- `nines-back-end` currently sends `houseTakeBps = 0` until a real house-take
  configuration source is defined. `nines-financial` supports non-zero
  `houseTakeBps`.
- No-winning-bet settlement is rejected in Phase 2.10 until the business rule is
  defined.
- Settlement side effects are idempotent through command and ledger semantics,
  but a production-grade settlement run state machine, operator recovery flow,
  and end-to-end saga visibility remain Phase 3 hardening work.

## Verification Status

Standard verification commands:

| Repo | Command | Phase 2.11 expectation |
| --- | --- | --- |
| `nines-financial` | `npm run verify` | Must pass. |
| `nines-back-end` | `npm run verify` | Must pass. |
| `nines-front-end` | `npm run verify` | Must pass. |
| `nines-admin` | `npm run verify` | Expected blocker in this checkout if dependencies are unavailable (`tsc: command not found`). |

Latest Phase 2.11 run:

- `nines-financial`: passed typecheck, 52 Vitest tests, and build.
- `nines-back-end`: passed typecheck, 57 Vitest tests, and build; 6
  integration tests remain intentionally skipped when external integration
  dependencies are absent.
- `nines-front-end`: passed typecheck and Vite build.
- `nines-admin`: blocked at `tsc -b --noEmit` because `tsc` is not installed
  in this checkout.

Generated artifacts checked with `git ls-files`:

- `dist`
- `node_modules`
- `.vite`
- `coverage`
- `.vitest`
- `test-results`
- `vitest-results.json`

No tracked generated artifact paths remain after the Phase 2.9 index cleanup.
The backend and frontend repositories still show staged deletions for previously
tracked generated files until that cleanup is committed.

## Phase 3 Readiness Checklist

- [x] `nines-financial` is the primary ledger and balance authority.
- [x] Main bet placement reserves stake through `nines-financial`.
- [x] Main settlement sends a race-level settlement instruction to
  `nines-financial`.
- [x] Pool-proration settlement has replaced the temporary 2x payout on the main
  path.
- [x] Contracts use USDC and minor-unit strings.
- [x] Command idempotency and retry behavior are covered by tests.
- [x] Cross-service contract tests cover backend client expectations and
  financial route responses.
- [x] Repository-level `verify` scripts exist.
- [ ] Commit the generated-artifact index cleanup from Phase 2.9.
- [ ] Resolve the `nines-admin` local dependency/toolchain blocker.
- [ ] Disable or remove legacy alpha financial mutation fallback before any
  non-local environment treats the system as money-bearing.
- [ ] Replace admin wallet credit and frontend mock funding with real
  `nines-financial` funding flows.
- [ ] Define the no-winning-bets settlement rule.
- [ ] Define the real `houseTakeBps` source.
- [ ] Add production settlement run state, recovery, and operator review
  workflow if required before real-money operation.

## Follow-Up Tickets

- P3-001: Deployment guardrails for legacy alpha financial fallback environment
  variables.
- P3-002: Real funding/deposit command flow in `nines-financial`, replacing
  backend admin wallet credit.
- P3-003: Frontend balance and funding wiring to live `nines-financial`
  contracts.
- P3-004: Admin dependency repair and live financial read/control integration.
- P3-005: No-winning-bets settlement policy.
- P3-006: House-take configuration source and audit trail.
- P3-007: Settlement run state machine, recovery, and manual-review tooling.
- P3-008: Withdrawal design when the late-phase withdrawal scope begins.

## Recommendation

Proceed to Phase 3 only with the alpha deviations above carried as explicit
work items. There is no remaining Phase 2 blocker in the main bet or settlement
financial-authority paths, but the system is not production-money-ready until
the listed alpha fallbacks, funding mocks, admin dependency issue, and settlement
operations policies are closed.
