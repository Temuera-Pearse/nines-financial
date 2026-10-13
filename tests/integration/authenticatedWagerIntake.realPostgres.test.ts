import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { createApp } from '../../src/app.js'
import type { NinesIssuanceAuthorizationV1 } from '../../src/domains/issuance-authorizations/dto/NinesIssuanceAuthorization.js'
import {
  NINES_PLACE_BET_PATH,
  NINES_PLACE_BET_SCHEMA_VERSION,
  NINES_PLAYER_ASSERTION_SCHEMA_VERSION,
  ninesPlaceBetEvidenceHash,
  type NinesPlaceBetCommandV1,
} from '../../src/domains/betting/dto/NinesPlaceBetCommand.js'
import { toUserId } from '../../src/domains/account/types/identifiers.js'
import { toOwnerId } from '../../src/domains/accounting/types/identifiers.js'
import type { FaultInjector, FaultPoint } from '../../src/shared/faults/FaultInjector.js'
import { hashCanonicalJson } from '../../src/shared/contracts/canonicalJson.js'
import { toIdempotencyKey } from '../../src/shared/idempotency/types.js'
import { signServiceMessage } from '../../src/shared/security/ServiceMessageAuthentication.js'
import type { JsonObject, JsonValue } from '../../src/shared/types/Json.js'
import {
  createRealPostgresRestartedApplication,
  createRealPostgresTestApplication,
  realPostgresDrillsEnabled,
  type RealPostgresTestApplicationHarness,
} from '../support/realPostgresTestApp.js'

const secret = 'w1-real-postgres-backend-secret-at-least-32-characters'
const credentials = { 'nines-back-end': { 'backend-wager-v1': secret } }
const realDescribe = realPostgresDrillsEnabled() ? describe : describe.skip

class SelectableFaultInjector implements FaultInjector {
  point: FaultPoint | null = null
  trigger(point: FaultPoint): void {
    if (point === this.point) throw new Error(`injected:${point}`)
  }
}

async function fundPlayer(harness: RealPostgresTestApplicationHarness, playerId: string,
  amountMinor: string) {
  const account = await harness.container.services.playerAccountProvisioningService.provisionIfNeeded({
    idempotencyKey: toIdempotencyKey(`provision-${playerId}`), userId: toUserId(playerId),
    currency: 'NINES', correlationId: `corr_provision_${playerId}`,
    causationId: `cause_provision_${playerId}` })
  const source = await harness.container.services.accountService.createAccount({
    accountType: 'deposit_clearing', ownerType: 'platform', ownerId: toOwnerId(`source-${playerId}`),
    currency: 'NINES', correlationId: `corr_source_${playerId}`,
    causationId: `cause_source_${playerId}`,
    idempotencyKey: toIdempotencyKey(`source-${playerId}`) })
  await harness.container.services.postingEngineService.postTransfer({
    transactionType: 'deposit_confirmed_credit', referenceType: 'deposit',
    referenceId: `fund-${playerId}`, debitAccountId: source.accountId,
    creditAccountId: account.availableAccountId, amountMinor, currency: 'NINES',
    correlationId: `corr_fund_${playerId}`, causationId: `cause_fund_${playerId}`,
    idempotencyKey: toIdempotencyKey(`fund-${playerId}`) })
  return account
}

async function openPool(harness: RealPostgresTestApplicationHarness, raceId = 'race-w1-real') {
  await harness.container.services.bettingIntakeService.createRacePool({ raceId,
    currency: 'NINES', idempotencyKey: `pool-${raceId}`, correlationId: `corr_pool_${raceId}`,
    causationId: `cause_pool_${raceId}` })
  await harness.container.services.bettingIntakeService.registerPoolSelection({ raceId,
    selectionId: 'horse-7', currency: 'NINES', idempotencyKey: `selection-${raceId}`,
    correlationId: `corr_selection_${raceId}`, causationId: `cause_selection_${raceId}` })
}

function bet(playerId: string, stakeMinor: string, suffix: string = randomUUID()) {
  return { betId: randomUUID(), userId: playerId, raceId: 'race-w1-real',
    selectionId: 'horse-7', stakeMinor, currency: 'NINES' as const,
    idempotencyKey: `bet-${suffix}`, correlationId: `corr_${suffix}`,
    causationId: `cause_${suffix}` }
}

async function balances(harness: RealPostgresTestApplicationHarness,
  account: { availableAccountId: string; reservedAccountId: string }) {
  const result = await harness.database.query<{account_id:string;balance_minor:string}>(
    `SELECT a.account_id,COALESCE(ab.balance_minor,0)::text balance_minor
     FROM accounts a LEFT JOIN account_balances ab USING(account_id)
     WHERE a.account_id IN ($1,$2)`,
    [account.availableAccountId, account.reservedAccountId])
  const byId = Object.fromEntries(result.rows.map((row) => [row.account_id, row.balance_minor]))
  return { available: byId[account.availableAccountId], locked: byId[account.reservedAccountId] }
}

function authenticatedCommand(playerId: string): NinesPlaceBetCommandV1 {
  const now = new Date()
  const payload = { schemaVersion: NINES_PLACE_BET_SCHEMA_VERSION as typeof NINES_PLACE_BET_SCHEMA_VERSION,
    commandType: 'nines_place_bet' as const, issuer: 'nines-back-end' as const,
    audience: 'nines-financial' as const, environment: 'test' as const,
    betId: randomUUID(), playerId, raceId: 'race-w1-real', raceRef: 'N9-ABCDE-FGHJK',
    selectionId: 'horse-7', stake: { currency: 'NINES' as const, scale: 6 as const,
      minorUnits: '20000000' }, idempotencyKey: `wager-${randomUUID()}`,
    requestedAt: now.toISOString(), correlationId: `corr_${randomUUID()}`,
    causationId: `cause_${randomUUID()}`, playerIdentity: {
      schemaVersion: NINES_PLAYER_ASSERTION_SCHEMA_VERSION as typeof NINES_PLAYER_ASSERTION_SCHEMA_VERSION,
      assertionId: randomUUID(), subjectPlayerId: playerId, assertedBy: 'nines-back-end' as const,
      authenticationMethod: 'upstream_access_token' as const,
      authenticatedAt: new Date(now.getTime() - 1_000).toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString() } }
  return { ...payload, evidenceHash: ninesPlaceBetEvidenceHash(payload) }
}

function wagerHeaders(command: NinesPlaceBetCommandV1) {
  const requestId = randomUUID(); const sentAt = new Date().toISOString()
  const contentHash = hashCanonicalJson(command as unknown as JsonValue)
  return { 'x-nines-service-id': 'nines-back-end', 'x-nines-key-id': 'backend-wager-v1',
    'x-nines-request-id': requestId, 'x-nines-sent-at': sentAt,
    'x-nines-content-sha256': contentHash,
    'x-nines-signature': signServiceMessage({ method: 'POST', path: NINES_PLACE_BET_PATH,
      environment: 'test', serviceId: 'nines-back-end', keyId: 'backend-wager-v1',
      requestId, sentAt, contentHash, secret }) }
}

function issuance(playerId: string): NinesIssuanceAuthorizationV1 {
  const authorizationId=randomUUID(); const intentId=randomUUID(); const confirmationEventId=randomUUID()
  const completedValuationId=randomUUID()
  return { schemaVersion:1,eventType:'nines_issuance_authorized',authorizationId,
    issuer:'nines-api',audience:'nines-financial',environment:'test',playerId,
    funding:{intentId,confirmationEventId,
      evidenceIdentity:`crypto-funding-confirmation:v1:${intentId}:${confirmationEventId}`,
      requestHash:'a'.repeat(64),confirmationPayloadHash:'b'.repeat(64),provider:'fake',
      paymentReference:`payment-${randomUUID()}`},valuation:{workflowId:randomUUID(),
      completedValuationId,completionKey:`funding-nzd-valuation:v1:test:${intentId}`,
      evidenceFingerprint:'c'.repeat(64),valuedAt:'2026-04-22T11:58:00.000Z',
      profileVersion:'funding-nzd-valuation-profile-v1',finalNzdAmount:'123.45',
      finalNzdMinorUnits:'12345',calculationPolicyVersion:'nzd-valuation-calculation-v1',
      roundingPolicyVersion:'nzd-valuation-rounding-v1'},issuance:{
      policyVersion:'nzd-valuation-to-nines-par-v1',currency:'NINES',scale:6,
      minorUnits:'123450000'},authorizedAt:'2026-04-22T11:59:00.000Z',
    correlationId:`corr-${authorizationId}`,causationId:completedValuationId }
}

realDescribe('authenticated wager intake on real PostgreSQL', () => {
  let harness: RealPostgresTestApplicationHarness | undefined
  afterEach(async () => { await harness?.close(); harness = undefined })

  it('prevents 70+70 overspend across service instances and permits exact 50+50', async () => {
    harness = await createRealPostgresTestApplication()
    await openPool(harness)
    const firstPlayer = randomUUID(); const firstAccount = await fundPlayer(harness, firstPlayer, '100000000')
    const restarted = createRealPostgresRestartedApplication(harness)
    const results = await Promise.all([
      harness.container.services.bettingIntakeService.placeBet(bet(firstPlayer, '70000000', '70-a')),
      restarted.container.services.bettingIntakeService.placeBet(bet(firstPlayer, '70000000', '70-b')),
    ])
    expect(results.filter((result) => result.accepted)).toHaveLength(1)
    expect(await balances(harness, firstAccount)).toEqual({ available: '30000000', locked: '70000000' })

    const secondPlayer = randomUUID(); const secondAccount = await fundPlayer(harness, secondPlayer, '100000000')
    const exact = await Promise.all([
      harness.container.services.bettingIntakeService.placeBet(bet(secondPlayer, '50000000', '50-a')),
      restarted.container.services.bettingIntakeService.placeBet(bet(secondPlayer, '50000000', '50-b')),
    ])
    expect(exact.every((result) => result.accepted)).toBe(true)
    expect(await balances(harness, secondAccount)).toEqual({ available: '0', locked: '100000000' })

    const replayPlayer = randomUUID(); const replayAccount = await fundPlayer(harness, replayPlayer, '100000000')
    const identical = bet(replayPlayer, '30000000', 'concurrent-identical')
    const concurrentReplay = await Promise.all([
      harness.container.services.bettingIntakeService.placeBetForAuthenticatedBoundary(identical),
      restarted.container.services.bettingIntakeService.placeBetForAuthenticatedBoundary(identical),
    ])
    expect(concurrentReplay.every((execution) => execution.result.accepted)).toBe(true)
    expect(concurrentReplay.filter((execution) => execution.replayed)).toHaveLength(1)
    expect(await balances(harness, replayAccount)).toEqual({ available: '70000000', locked: '30000000' })
    const identicalEffects = await harness.database.query<{bets:string;reservations:string}>(
      `SELECT (SELECT COUNT(*) FROM financial_bets WHERE bet_id=$1)::text bets,
       (SELECT COUNT(*) FROM ledger_transactions WHERE transaction_type='bet_reserve'
        AND reference_id=$1)::text reservations`, [identical.betId])
    expect(identicalEffects.rows[0]).toEqual({ bets: '1', reservations: '1' })
  })

  it('serializes eight-way wagers without overspending', async () => {
    harness = await createRealPostgresTestApplication()
    await openPool(harness)
    const player = randomUUID(); const account = await fundPlayer(harness, player, '100000000')
    const services = Array.from({ length: 8 }, () =>
      createRealPostgresRestartedApplication(harness!).container.services.bettingIntakeService)
    const results = await Promise.all(services.map((service, index) =>
      service.placeBet(bet(player, '20000000', `eight-${index}`))))
    expect(results.filter((result) => result.accepted)).toHaveLength(5)
    expect(await balances(harness, account)).toEqual({ available: '0', locked: '100000000' })
    const reservations = await harness.database.query<{count:string}>(
      `SELECT COUNT(*)::text count FROM ledger_transactions
       WHERE transaction_type='bet_reserve' AND reference_type='bet'`)
    expect(reservations.rows[0]?.count).toBe('5')
  })

  it('rolls back every pre-commit failure point, including idempotency completion', async () => {
    const injector = new SelectableFaultInjector()
    harness = await createRealPostgresTestApplication({ faultInjector: injector })
    await openPool(harness)
    for (const point of ['place_bet.after_reservation_before_bet_persist',
      'place_bet.after_bet_persist_before_commit',
      'place_bet.after_idempotency_complete_before_commit'] as const) {
      const player = randomUUID(); const account = await fundPlayer(harness, player, '50000000')
      const command = bet(player, '20000000', point)
      injector.point = point
      await expect(harness.container.services.bettingIntakeService.placeBet(command))
        .rejects.toThrow(`injected:${point}`)
      injector.point = null
      expect(await balances(harness, account)).toEqual({ available: '50000000', locked: '0' })
      const persisted = await harness.database.query<{bets:string;reservations:string;idempotency:string}>(
        `SELECT (SELECT COUNT(*) FROM financial_bets WHERE bet_id=$1)::text bets,
         (SELECT COUNT(*) FROM ledger_transactions WHERE reference_id=$1)::text reservations,
         (SELECT COUNT(*) FROM idempotency_records WHERE command_type='place_bet' AND idempotency_key=$2)::text idempotency`,
        [command.betId, command.idempotencyKey])
      expect(persisted.rows[0]).toEqual({ bets: '0', reservations: '0', idempotency: '0' })
    }
  })

  it('installs and enforces reservation coupling and accepted economic immutability', async () => {
    harness = await createRealPostgresTestApplication()
    await openPool(harness)
    const player = randomUUID(); await fundPlayer(harness, player, '50000000')
    const command = bet(player, '20000000', 'constraints')
    const accepted = await harness.container.services.bettingIntakeService.placeBet(command)
    expect(accepted.accepted).toBe(true)
    const triggers = await harness.database.query<{tgname:string}>(
      `SELECT tgname FROM pg_trigger WHERE tgname IN
       ('financial_bets_nines_reservation_constraint','financial_bets_economic_immutability')
       AND NOT tgisinternal ORDER BY tgname`)
    expect(triggers.rows.map((row) => row.tgname)).toEqual([
      'financial_bets_economic_immutability', 'financial_bets_nines_reservation_constraint'])
    await expect(harness.database.query(
      `UPDATE financial_bets SET stake_minor=1 WHERE bet_id=$1`, [command.betId])).rejects.toThrow()
    await expect(harness.database.query(
      `INSERT INTO financial_bets (bet_id,user_id,race_id,selection_id,stake_minor,currency,status,
       reservation_transaction_id,accepted_at,idempotency_key,correlation_id,causation_id,created_at,updated_at)
       SELECT $1,user_id,race_id,selection_id,stake_minor,currency,'accepted',reservation_transaction_id,
       accepted_at,$2,$3,$4,created_at,updated_at FROM financial_bets WHERE bet_id=$5`,
      [randomUUID(), 'duplicate-reservation', 'corr_duplicate', 'cause_duplicate', command.betId]))
      .rejects.toThrow()
    await expect(harness.database.tx(async (transaction) => {
      await transaction.query(`INSERT INTO financial_bets
        (bet_id,user_id,race_id,selection_id,stake_minor,currency,status,reservation_transaction_id,
         accepted_at,idempotency_key,correlation_id,causation_id,created_at,updated_at)
        VALUES ($1,$2,'race-w1-real','horse-7',1,'NINES','accepted',$3,NOW(),$4,$5,$6,NOW(),NOW())`,
      [randomUUID(), player, accepted.reservationId, 'malformed-bet', 'corr_malformed', 'cause_malformed'])
    })).rejects.toThrow()
  })

  it('preserves a valid balance when lifetime movement totals exceed NUMERIC(20)', async () => {
    harness = await createRealPostgresTestApplication()
    await openPool(harness)
    const player = randomUUID()
    const account = await fundPlayer(harness, player, '90000000000000000000')
    const placed = await harness.container.services.bettingIntakeService.placeBet(
      bet(player, '80000000000000000000', 'lifetime-total-width'),
    )
    expect(placed.accepted).toBe(true)

    await harness.container.services.financialCommandService.releaseReservation({
      reservationId: placed.reservationId!,
      reasonCode: 'i1-lifetime-total-regression',
      idempotencyKey: 'release-i1-lifetime-total-regression',
      correlationId: 'corr_i1_lifetime_total_regression',
      causationId: 'cause_i1_lifetime_total_regression',
    })

    expect(await balances(harness, account)).toEqual({
      available: '90000000000000000000',
      locked: '0',
    })
    const lifetime = await harness.database.query<{
      balance_minor: string
      total_debits_minor: string
      total_credits_minor: string
    }>(
      `SELECT balance_minor::text,total_debits_minor::text,total_credits_minor::text
       FROM account_balances WHERE account_id=$1`,
      [account.availableAccountId],
    )
    expect(lifetime.rows[0]).toEqual({
      balance_minor: '90000000000000000000',
      total_debits_minor: '80000000000000000000',
      total_credits_minor: '170000000000000000000',
    })
    const verification =
      await harness.container.services.balanceMaintenanceService.verifyBalances()
    expect(verification.mismatchCount).toBe(0)
  })

  it('moves a verified Stage 4 issue of 123450000 to 103450000 available and 20000000 locked exactly once', async () => {
    harness = await createRealPostgresTestApplication()
    const player = randomUUID(); const authorization = issuance(player)
    const acknowledgement = await harness.container.services.ninesIssuanceAuthorizationService.consume(
      authorization, { serviceId: 'nines-api', requestId: randomUUID(),
        sentAt: new Date('2026-04-22T12:00:00.000Z'), receivedAt: new Date('2026-04-22T12:00:00.000Z') })
    expect(acknowledgement).toMatchObject({ result: 'accepted',
      issuance: { currency: 'NINES', scale: 6, minorUnits: '123450000' } })
    await openPool(harness)
    const app = createApp({ ...harness.container.services, ...harness.container.handlers }, {
      database: harness.database, environment: 'test', wagerIntakeEnabled: true,
      backendServiceAuthCredentials: credentials })
    const command = authenticatedCommand(player)
    const accepted = await request(app).post(NINES_PLACE_BET_PATH)
      .set(wagerHeaders(command)).send(command)
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201)
    const replay = await request(app).post(NINES_PLACE_BET_PATH)
      .set(wagerHeaders(command)).send(command)
    expect(replay.status).toBe(200)
    expect(replay.body).toMatchObject({ result: 'replayed',
      reservationTransactionId: accepted.body.reservationTransactionId })
    const summary = await harness.container.services.playerAccountQueryService.getPlayerBalance({
      userId: toUserId(player), currency: 'NINES' })
    expect(summary.balance).toMatchObject({ spendableBalanceMinor: '103450000',
      reservedBalanceMinor: '20000000', displayBalanceMinor: '123450000' })
    const effects = await harness.database.query<{bets:string;transactions:string;entries:string}>(
      `SELECT (SELECT COUNT(*) FROM financial_bets WHERE bet_id=$1)::text bets,
       (SELECT COUNT(*) FROM ledger_transactions WHERE transaction_type='bet_reserve' AND reference_id=$1)::text transactions,
       (SELECT COUNT(*) FROM ledger_entries le JOIN ledger_transactions lt USING(transaction_id)
        WHERE lt.transaction_type='bet_reserve' AND lt.reference_id=$1)::text entries`, [command.betId])
    expect(effects.rows[0]).toEqual({ bets: '1', transactions: '1', entries: '2' })
  })
})
