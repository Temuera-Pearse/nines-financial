# Phase 2.8 Cross-Service Financial Contract Verification

This pass proves the Phase 2.6 `nines-back-end` financial client and the
Phase 2.7 `nines-financial` command routes agree on paths, DTO shapes,
idempotency metadata, minor-unit string amounts, and canonical `USDC`.

## Automated Coverage

- `nines-back-end/src/financial/ninesFinancialClient.contract.test.ts`
  verifies the backend client emits the expected HTTP requests and maps
  financial error responses.
- `nines-financial/tests/integration/financialBackendContract.http.test.ts`
  verifies the financial service returns the response and error shapes consumed
  by the backend client.

The mirrored fixtures cover:

- `reserveStake`
- `releaseReservation`
- `settleBet`
- `applyHouseTake`
- `getPlayerAccountSummary`
- `getPlayerBalance`

All command amounts are minor-unit strings. Decimal strings such as `12.00`
must be rejected. `USDC` is the only supported front-of-house currency for
these Phase 2.8 contracts.

## Manual Smoke Runbook

1. Start `nines-financial`.

   ```bash
   cd nines-financial
   DATABASE_URL=postgres://... npm run db:migrate
   DATABASE_URL=postgres://... PORT=4100 npm start
   ```

2. Start `nines-back-end` with the financial base URL.

   ```bash
   cd nines-back-end
   NINES_FINANCIAL_BASE_URL=http://localhost:4100 \
   NINES_ENABLE_LEGACY_ALPHA_FINANCIAL_FALLBACK=false \
   npm run dev
   ```

3. Place a bet through `nines-back-end`.

   ```bash
   curl -X POST http://localhost:3001/bets \
     -H 'content-type: application/json' \
     -H 'idempotency-key: smoke-reserve-1' \
     -d '{
       "userId": "smoke-player-1",
       "raceId": "race-open-1",
       "selectionId": "horse-1",
       "stakeMinor": "1200",
       "currency": "USDC"
     }'
   ```

4. Confirm the reservation in `nines-financial`.

   ```bash
   curl http://localhost:4100/player/accounts/smoke-player-1/USDC/balance
   ```

   Expected signal: `lockedBalanceMinor` increases by the reserved stake and
   `spendableBalanceMinor` decreases by the same minor-unit amount.

5. Settle the race through `nines-back-end`.

   ```bash
   curl -X POST http://localhost:3001/settlements/races/race-open-1 \
     -H 'x-api-token: <admin-token-if-configured>'
   ```

6. Confirm settlement command effects in `nines-financial`.

   ```bash
   curl http://localhost:4100/player/accounts/smoke-player-1/USDC/balance
   ```

   Expected signal: the stake leaves `lockedBalanceMinor`. As of Phase 2.10,
   winning bets receive pool-prorated settlement from `nines-financial`.

## Superseded Phase 2.8 Limitation

Phase 2.8 used temporary alpha math where a winning bet received
`2x stakeMinor`. Phase 2.10 replaces that main settlement path with
deterministic pool-proration. Any remaining 2x behavior belongs only to the
explicit `nines-back-end` legacy alpha fallback.
