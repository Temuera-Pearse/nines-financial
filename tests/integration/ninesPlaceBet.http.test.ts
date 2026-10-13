import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import {
  NINES_PLACE_BET_PATH,
  NINES_PLACE_BET_SCHEMA_VERSION,
  NINES_PLAYER_ASSERTION_SCHEMA_VERSION,
  ninesPlaceBetEvidenceHash,
  type NinesPlaceBetCommandV1,
} from '../../src/domains/betting/dto/NinesPlaceBetCommand.js'
import { toUserId } from '../../src/domains/account/types/identifiers.js'
import { toOwnerId } from '../../src/domains/accounting/types/identifiers.js'
import { hashCanonicalJson } from '../../src/shared/contracts/canonicalJson.js'
import { toIdempotencyKey } from '../../src/shared/idempotency/types.js'
import { signServiceMessage } from '../../src/shared/security/ServiceMessageAuthentication.js'
import type { JsonValue } from '../../src/shared/types/Json.js'
import { createTestApplication, type TestApplicationHarness } from '../support/testApp.js'

const secret = 'w1-backend-financial-test-secret-at-least-32-characters'
const keyId = 'backend-wager-v1'
const credentials = { 'nines-back-end': { [keyId]: secret } }

function command(overrides: Record<string, unknown> = {}): NinesPlaceBetCommandV1 {
  const requestedAt = new Date()
  const playerId = String(overrides.playerId ?? '22222222-2222-4222-8222-222222222222')
  const payload = {
    schemaVersion: NINES_PLACE_BET_SCHEMA_VERSION as typeof NINES_PLACE_BET_SCHEMA_VERSION,
    commandType: 'nines_place_bet' as const,
    issuer: 'nines-back-end' as const,
    audience: 'nines-financial' as const,
    environment: 'test' as const,
    betId: randomUUID(), playerId,
    raceId: 'race-w1', raceRef: 'N9-ABCDE-FGHJK', selectionId: 'horse-7',
    stake: { currency: 'NINES' as const, scale: 6 as const, minorUnits: '20000000' },
    idempotencyKey: `wager-${randomUUID()}`, requestedAt: requestedAt.toISOString(),
    correlationId: `corr_${randomUUID()}`, causationId: `cause_${randomUUID()}`,
    playerIdentity: { schemaVersion: NINES_PLAYER_ASSERTION_SCHEMA_VERSION as typeof NINES_PLAYER_ASSERTION_SCHEMA_VERSION,
      assertionId: randomUUID(), subjectPlayerId: playerId,
      assertedBy: 'nines-back-end' as const, authenticationMethod: 'upstream_access_token' as const,
      authenticatedAt: new Date(requestedAt.getTime() - 1_000).toISOString(),
      expiresAt: new Date(requestedAt.getTime() + 60_000).toISOString() },
    ...overrides,
  }
  return { ...payload, evidenceHash: ninesPlaceBetEvidenceHash(payload) } as NinesPlaceBetCommandV1
}

function headers(body: NinesPlaceBetCommandV1, requestId = randomUUID(),
  signatureOverride?: string) {
  const sentAt = new Date().toISOString()
  const contentHash = hashCanonicalJson(body as unknown as JsonValue)
  return { 'x-nines-service-id': 'nines-back-end', 'x-nines-key-id': keyId,
    'x-nines-request-id': requestId, 'x-nines-sent-at': sentAt,
    'x-nines-content-sha256': contentHash,
    'x-nines-signature': signatureOverride ?? signServiceMessage({ method: 'POST',
      path: NINES_PLACE_BET_PATH, environment: 'test', serviceId: 'nines-back-end',
      keyId, requestId, sentAt, contentHash, secret }) }
}

async function establishFundsAndPool(harness: TestApplicationHarness, playerId: string) {
  const account = await harness.container.services.playerAccountProvisioningService.provisionIfNeeded({
    idempotencyKey: toIdempotencyKey(`provision-${playerId}`), userId: toUserId(playerId),
    currency: 'NINES', correlationId: 'corr_provision_w1', causationId: 'cause_provision_w1' })
  const source = await harness.container.services.accountService.createAccount({
    accountType: 'deposit_clearing', ownerType: 'platform', ownerId: toOwnerId(`source-${playerId}`),
    currency: 'NINES', correlationId: 'corr_source_w1', causationId: 'cause_source_w1',
    idempotencyKey: toIdempotencyKey(`source-${playerId}`) })
  await harness.container.services.postingEngineService.postTransfer({
    transactionType: 'deposit_confirmed_credit', referenceType: 'deposit',
    referenceId: `fund-${playerId}`, debitAccountId: source.accountId,
    creditAccountId: account.availableAccountId, amountMinor: '123450000', currency: 'NINES',
    correlationId: 'corr_fund_w1', causationId: 'cause_fund_w1',
    idempotencyKey: toIdempotencyKey(`fund-${playerId}`) })
  await harness.container.services.bettingIntakeService.createRacePool({ raceId: 'race-w1',
    currency: 'NINES', idempotencyKey: 'pool-w1', correlationId: 'corr_pool_w1',
    causationId: 'cause_pool_w1' })
  await harness.container.services.bettingIntakeService.registerPoolSelection({ raceId: 'race-w1',
    selectionId: 'horse-7', currency: 'NINES', idempotencyKey: 'selection-w1',
    correlationId: 'corr_selection_w1', causationId: 'cause_selection_w1' })
  return account
}

describe('authenticated production NINES wager route', () => {
  let harness: TestApplicationHarness | undefined
  afterEach(async () => { await harness?.close(); harness = undefined })

  it('locks the exact stake once and returns an explicit durable replay', async () => {
    harness = await createTestApplication(undefined, { wagerIntakeEnabled: true,
      backendServiceAuthCredentials: credentials })
    const body = command()
    const account = await establishFundsAndPool(harness, body.playerId)
    const accepted = await request(harness.app).post(NINES_PLACE_BET_PATH)
      .set(headers(body)).send(body)
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201)
    expect(accepted.body).toMatchObject({ result: 'accepted', betId: body.betId,
      playerId: body.playerId, raceId: body.raceId, raceRef: body.raceRef,
      reservationTransactionId: expect.any(String) })
    const replay = await request(harness.app).post(NINES_PLACE_BET_PATH)
      .set(headers(body)).send(body)
    expect(replay.status).toBe(200)
    expect(replay.body).toMatchObject({ result: 'replayed',
      reservationTransactionId: accepted.body.reservationTransactionId })
    const balances = await harness.database.query<{account_id:string;balance_minor:string}>(
      `SELECT account_id,balance_minor::text FROM account_balances
       WHERE account_id IN ($1,$2) ORDER BY account_id`,
      [account.availableAccountId, account.reservedAccountId])
    const byId = Object.fromEntries(balances.rows.map((row) => [row.account_id, row.balance_minor]))
    expect(byId[account.availableAccountId]).toBe('103450000')
    expect(byId[account.reservedAccountId]).toBe('20000000')
    const effects = await harness.database.query<{bets:number;transactions:number;entries:number}>(
      `SELECT (SELECT COUNT(*)::int FROM financial_bets WHERE bet_id=$1) bets,
       (SELECT COUNT(*)::int FROM ledger_transactions WHERE transaction_type='bet_reserve' AND reference_id=$1) transactions,
       (SELECT COUNT(*)::int FROM ledger_entries le JOIN ledger_transactions lt USING(transaction_id)
        WHERE lt.transaction_type='bet_reserve' AND lt.reference_id=$1) entries`, [body.betId])
    const effect = effects.rows[0]
    const scalar = (value: number | number[]) => Array.isArray(value) ? value[0] : value
    expect({ bets: scalar(effect!.bets as unknown as number | number[]),
      transactions: scalar(effect!.transactions as unknown as number | number[]),
      entries: scalar(effect!.entries as unknown as number | number[]) })
      .toEqual({ bets: 1, transactions: 1, entries: 2 })
  })

  it('rejects invalid authentication, forged player binding, evidence, environment, and conflicts', async () => {
    harness = await createTestApplication(undefined, { wagerIntakeEnabled: true,
      backendServiceAuthCredentials: credentials })
    const body = command()
    await establishFundsAndPool(harness, body.playerId)
    expect((await request(harness.app).post(NINES_PLACE_BET_PATH)
      .set(headers(body, randomUUID(), '0'.repeat(64))).send(body)).status).toBe(403)
    const forged = command({ playerId: body.playerId,
      playerIdentity: { ...body.playerIdentity, subjectPlayerId: randomUUID() } })
    expect((await request(harness.app).post(NINES_PLACE_BET_PATH)
      .set(headers(forged)).send(forged)).status).toBe(400)
    const badHash = { ...body, evidenceHash: '0'.repeat(64) } as NinesPlaceBetCommandV1
    expect((await request(harness.app).post(NINES_PLACE_BET_PATH)
      .set(headers(badHash)).send(badHash)).status).toBe(400)
    const wrongEnvironment = command({ environment: 'production' })
    expect((await request(harness.app).post(NINES_PLACE_BET_PATH)
      .set(headers(wrongEnvironment)).send(wrongEnvironment)).status).toBe(403)
    const first = await request(harness.app).post(NINES_PLACE_BET_PATH).set(headers(body)).send(body)
    expect(first.status).toBe(201)
    const conflict = command({ betId: body.betId, idempotencyKey: body.idempotencyKey,
      stake: { currency: 'NINES', scale: 6, minorUnits: '1' } })
    expect((await request(harness.app).post(NINES_PLACE_BET_PATH)
      .set(headers(conflict)).send(conflict)).status).toBe(409)
    const reusedBet = command({ betId: body.betId, idempotencyKey: `other-${randomUUID()}` })
    const reusedResponse = await request(harness.app).post(NINES_PLACE_BET_PATH)
      .set(headers(reusedBet)).send(reusedBet)
    expect(reusedResponse.status).toBe(409)
    expect(reusedResponse.body.error.code).toBe('BET_IDENTITY_CONFLICT')
  })

  it('preserves Financial pool, window, and selection rejection boundaries', async () => {
    harness = await createTestApplication(undefined, { wagerIntakeEnabled: true,
      backendServiceAuthCredentials: credentials })
    const playerId = '22222222-2222-4222-8222-222222222222'
    await establishFundsAndPool(harness, playerId)
    const send = async (body: NinesPlaceBetCommandV1) => request(harness!.app)
      .post(NINES_PLACE_BET_PATH).set(headers(body)).send(body)
    const missingPool = await send(command({ playerId, raceId: 'race-missing' }))
    expect(missingPool.body).toMatchObject({ result: 'rejected', rejectionCode: 'POOL_NOT_FOUND' })
    const missingSelection = await send(command({ playerId, selectionId: 'horse-missing' }))
    expect(missingSelection.body).toMatchObject({ result: 'rejected',
      rejectionCode: 'POOL_SELECTION_NOT_FOUND' })

    await harness.container.services.bettingIntakeService.createRacePool({ raceId: 'race-future',
      currency: 'NINES', bettingOpensAt: '2026-04-22T12:01:00.000Z',
      idempotencyKey: 'pool-future', correlationId: 'corr_pool_future',
      causationId: 'cause_pool_future' })
    await harness.container.services.bettingIntakeService.registerPoolSelection({
      raceId: 'race-future', selectionId: 'horse-7', currency: 'NINES',
      idempotencyKey: 'selection-future', correlationId: 'corr_selection_future',
      causationId: 'cause_selection_future' })
    const beforeOpen = await send(command({ playerId, raceId: 'race-future' }))
    expect(beforeOpen.body).toMatchObject({ result: 'rejected',
      rejectionCode: 'BETTING_WINDOW_CLOSED' })

    await harness.container.services.bettingIntakeService.createRacePool({ raceId: 'race-at-close',
      currency: 'NINES', bettingOpensAt: '2026-04-22T11:00:00.000Z',
      bettingClosesAt: '2026-04-22T12:00:00.000Z', idempotencyKey: 'pool-at-close',
      correlationId: 'corr_pool_at_close', causationId: 'cause_pool_at_close' })
    await harness.container.services.bettingIntakeService.registerPoolSelection({
      raceId: 'race-at-close', selectionId: 'horse-7', currency: 'NINES',
      idempotencyKey: 'selection-at-close', correlationId: 'corr_selection_at_close',
      causationId: 'cause_selection_at_close' })
    const atClose = await send(command({ playerId, raceId: 'race-at-close' }))
    expect(atClose.body).toMatchObject({ result: 'rejected',
      rejectionCode: 'BETTING_WINDOW_CLOSED' })

    await harness.container.services.bettingIntakeService.freezePool({ raceId: 'race-w1',
      currency: 'NINES', reasonCode: 'test-close', idempotencyKey: 'freeze-w1',
      correlationId: 'corr_freeze_w1', causationId: 'cause_freeze_w1' })
    const closed = await send(command({ playerId }))
    expect(closed.body).toMatchObject({ result: 'rejected', rejectionCode: 'POOL_NOT_OPEN' })
  })
})
