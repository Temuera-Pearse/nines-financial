# Phase 2.10 Pool-Proration Settlement

`nines-financial` is the only authority for payout truth. `nines-back-end` may
send race outcome inputs, accepted bet facts, and pool totals, but it must not
calculate final payouts.

## Settlement Formula

Inputs:

- `raceId`
- `winningSelectionId`
- `acceptedBets[]` with `betId`, `userId`, `selectionId`, and `stakeMinor`
- `totalPoolMinor`
- `houseTakeBps`
- `currency = USDC`
- idempotency, correlation, and causation metadata

Formula:

1. `grossPoolMinor = sum(acceptedBets[].stakeMinor)`
2. Reject if `grossPoolMinor != totalPoolMinor`.
3. `houseTakeMinor = floor(grossPoolMinor * houseTakeBps / 10000)`
4. `netPoolMinor = grossPoolMinor - houseTakeMinor`
5. `winningStakeMinor = sum(stakeMinor for winningSelectionId)`
6. Reject Phase 2.10 settlement if there are no winning accepted bets.
7. Each winning bet starts with:
   `floor(netPoolMinor * betStakeMinor / winningStakeMinor)`
8. Remaining minor units are assigned by largest fractional remainder, then
   lexicographic `betId` order.

All calculations use `BigInt` integer math. No floating point money math is
allowed.

## Ledger Effects

For each accepted bet:

- capture the existing stake reservation from `user_locked` into
  `settlement_clearing`

Then:

- post house take from `settlement_clearing` to `house_take_revenue`
- post each winner payout from `settlement_clearing` to `user_available`

The main settlement path no longer uses the old `2x stakeMinor` payout rule.
That behavior remains only inside the explicitly named legacy alpha fallback in
`nines-back-end`.
