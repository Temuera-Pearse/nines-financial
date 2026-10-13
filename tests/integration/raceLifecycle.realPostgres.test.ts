import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { toUserId } from '../../src/domains/account/types/identifiers.js'
import { toOwnerId } from '../../src/domains/accounting/types/identifiers.js'
import { NINES_PLACE_BET_PATH, NINES_PLACE_BET_SCHEMA_VERSION,
  NINES_PLAYER_ASSERTION_SCHEMA_VERSION, ninesPlaceBetEvidenceHash,
  type NinesPlaceBetCommandV1 } from '../../src/domains/betting/dto/NinesPlaceBetCommand.js'
import type { NinesIssuanceAuthorizationV1 } from '../../src/domains/issuance-authorizations/dto/NinesIssuanceAuthorization.js'
import { NINES_RACE_LIFECYCLE_PATH, NINES_RACE_LIFECYCLE_SCHEMA_VERSION,
  raceLifecycleEvidenceHash, type NinesRaceLifecycleEventV1 } from '../../src/domains/race-lifecycle/dto/RaceLifecycleEvent.js'
import { RaceLifecycleProjectionService } from '../../src/domains/race-lifecycle/services/RaceLifecycleProjectionService.js'
import { NINES_RACE_RESULT_SCHEMA_VERSION, raceResultEvidenceHash,
  type NinesRaceResultV1 } from '../../src/domains/race-results/dto/NinesRaceResult.js'
import { hashCanonicalJson } from '../../src/shared/contracts/canonicalJson.js'
import type { FaultInjector, FaultPoint } from '../../src/shared/faults/FaultInjector.js'
import { toIdempotencyKey } from '../../src/shared/idempotency/types.js'
import { signServiceMessage } from '../../src/shared/security/ServiceMessageAuthentication.js'
import type { Clock } from '../../src/shared/time/Clock.js'
import type { JsonValue } from '../../src/shared/types/Json.js'
import { createRealPostgresRestartedApplication, createRealPostgresTestApplication,
  realPostgresDrillsEnabled, type RealPostgresTestApplicationHarness } from '../support/realPostgresTestApp.js'

const secret = 'w2-real-postgres-backend-secret-at-least-32-characters'
const keyId = 'backend-lifecycle-v1'
const credentials = { 'nines-back-end': { [keyId]: secret } }
const realDescribe = realPostgresDrillsEnabled() ? describe : describe.skip

class MutableClock implements Clock {
  constructor(private value: Date) {}
  now(): Date { return new Date(this.value) }
  set(value: Date): void { this.value = new Date(value) }
}

class ReservationBarrier implements FaultInjector {
  private releaseBarrier!: () => void
  private reachedBarrier!: () => void
  private armed = true
  readonly reached = new Promise<void>((resolve) => { this.reachedBarrier = resolve })
  private readonly released = new Promise<void>((resolve) => { this.releaseBarrier = resolve })

  async trigger(point: FaultPoint): Promise<void> {
    if (!this.armed || point !== 'place_bet.after_reservation_before_bet_persist') return
    this.armed = false
    this.reachedBarrier()
    await this.released
  }

  release(): void { this.releaseBarrier() }
}

const policy = Object.freeze({ policyId: 'nines-parimutuel.v1' as const, policyVersion: 1 as const,
  houseTakeBps: 1000, carryoverPolicyId: 'nines-carryover.v1' as const,
  carryoverPolicyVersion: 1 as const,
  settlementAllocationPolicyId: 'nines-proportional-allocation.v1' as const,
  settlementAllocationPolicyVersion: 1 as const,
  roundingPolicyId: 'nines-largest-remainder.v1' as const, roundingPolicyVersion: 1 as const })

function lifecyclePair(raceId: string, raceRef: string, opensAt: Date, closesAt: Date) {
  const selections = [1, 2, 3].map((index) => ({ runnerId: `horse-${index}`,
    selectionId: `horse-${index}`, displayName: `Horse ${index}` }))
  const openEvidence = { schemaVersion: NINES_RACE_LIFECYCLE_SCHEMA_VERSION as typeof NINES_RACE_LIFECYCLE_SCHEMA_VERSION,
    eventType: 'nines_race_opened.v1' as const, issuer: 'nines-back-end' as const,
    audience: 'nines-financial' as const, environment: 'test' as const, raceId, raceRef,
    lifecycleEventId: randomUUID(), lifecycleSequence: 1 as const,
    bettingOpensAt: opensAt.toISOString(), bettingClosesAt: closesAt.toISOString(),
    selections, currency: 'NINES' as const, economicPolicy: policy, correlationId: raceId,
    causationId: `race-seeded:${raceId}`, occurredAt: opensAt.toISOString() }
  const open: NinesRaceLifecycleEventV1 = { ...openEvidence,
    evidenceHash: raceLifecycleEvidenceHash(openEvidence) }
  const closeEvidence = { ...openEvidence, eventType: 'nines_race_betting_closed.v1' as const,
    lifecycleEventId: randomUUID(), lifecycleSequence: 2 as const,
    causationId: open.lifecycleEventId, occurredAt: closesAt.toISOString() }
  const close: NinesRaceLifecycleEventV1 = { ...closeEvidence,
    evidenceHash: raceLifecycleEvidenceHash(closeEvidence) }
  return { open, close }
}

function raceResult(close: NinesRaceLifecycleEventV1): NinesRaceResultV1 {
  const evidence={schemaVersion:NINES_RACE_RESULT_SCHEMA_VERSION as typeof NINES_RACE_RESULT_SCHEMA_VERSION,
    eventType:'nines_race_completed.v1' as const,issuer:'nines-back-end' as const,
    audience:'nines-financial' as const,environment:'test' as const,raceId:close.raceId,
    raceRef:close.raceRef,resultId:randomUUID(),resultVersion:1 as const,
    completedAt:new Date(Date.parse(close.occurredAt)+20_000).toISOString(),
    winningRunnerId:'horse-1',winningSelectionId:'horse-1',
    finishOrder:['horse-1','horse-2','horse-3'],raceChecksum:'d'.repeat(64),
    closeLifecycleEventId:close.lifecycleEventId,closeLifecycleEvidenceHash:close.evidenceHash,
    correlationId:close.correlationId,causationId:close.lifecycleEventId}
  return {...evidence,evidenceHash:raceResultEvidenceHash(evidence)}
}

function authHeaders(path: string, body: JsonValue, now: Date) {
  const requestId = randomUUID(); const sentAt = now.toISOString()
  const contentHash = hashCanonicalJson(body)
  return { 'x-nines-service-id': 'nines-back-end', 'x-nines-key-id': keyId,
    'x-nines-request-id': requestId, 'x-nines-sent-at': sentAt,
    'x-nines-content-sha256': contentHash,
    'x-nines-signature': signServiceMessage({ method: 'POST', path, environment: 'test',
      serviceId: 'nines-back-end', keyId, requestId, sentAt, contentHash, secret }) }
}

function wager(playerId: string, lifecycle: NinesRaceLifecycleEventV1,
  requestedAt: Date, stakeMinor = '20000000'): NinesPlaceBetCommandV1 {
  const payload = { schemaVersion: NINES_PLACE_BET_SCHEMA_VERSION as typeof NINES_PLACE_BET_SCHEMA_VERSION,
    commandType: 'nines_place_bet' as const, issuer: 'nines-back-end' as const,
    audience: 'nines-financial' as const, environment: 'test' as const,
    betId: randomUUID(), playerId, raceId: lifecycle.raceId, raceRef: lifecycle.raceRef,
    selectionId: lifecycle.selections[0]!.selectionId,
    stake: { currency: 'NINES' as const, scale: 6 as const, minorUnits: stakeMinor },
    idempotencyKey: `wager-${randomUUID()}`, requestedAt: requestedAt.toISOString(),
    correlationId: `corr_${randomUUID()}`, causationId: `cause_${randomUUID()}`,
    playerIdentity: { schemaVersion: NINES_PLAYER_ASSERTION_SCHEMA_VERSION as typeof NINES_PLAYER_ASSERTION_SCHEMA_VERSION,
      assertionId: randomUUID(), subjectPlayerId: playerId, assertedBy: 'nines-back-end' as const,
      authenticationMethod: 'upstream_access_token' as const,
      authenticatedAt: new Date(requestedAt.getTime() - 1_000).toISOString(),
      expiresAt: new Date(requestedAt.getTime() + 60_000).toISOString() } }
  return { ...payload, evidenceHash: ninesPlaceBetEvidenceHash(payload) }
}

function issuance(playerId: string, now: Date): NinesIssuanceAuthorizationV1 {
  const authorizationId=randomUUID(); const intentId=randomUUID(); const confirmationEventId=randomUUID()
  const completedValuationId=randomUUID()
  return { schemaVersion:1,eventType:'nines_issuance_authorized',authorizationId,
    issuer:'nines-api',audience:'nines-financial',environment:'test',playerId,
    funding:{intentId,confirmationEventId,
      evidenceIdentity:`crypto-funding-confirmation:v1:${intentId}:${confirmationEventId}`,
      requestHash:'a'.repeat(64),confirmationPayloadHash:'b'.repeat(64),provider:'fake',
      paymentReference:`payment-${randomUUID()}`},valuation:{workflowId:randomUUID(),
      completedValuationId,completionKey:`funding-nzd-valuation:v1:test:${intentId}`,
      evidenceFingerprint:'c'.repeat(64),valuedAt:new Date(now.getTime()-120_000).toISOString(),
      profileVersion:'funding-nzd-valuation-profile-v1',finalNzdAmount:'123.45',
      finalNzdMinorUnits:'12345',calculationPolicyVersion:'nzd-valuation-calculation-v1',
      roundingPolicyVersion:'nzd-valuation-rounding-v1'},issuance:{
      policyVersion:'nzd-valuation-to-nines-par-v1',currency:'NINES',scale:6,
      minorUnits:'123450000'},authorizedAt:new Date(now.getTime()-60_000).toISOString(),
    correlationId:`corr-${authorizationId}`,causationId:completedValuationId }
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

async function balance(harness: RealPostgresTestApplicationHarness,
  account: { availableAccountId: string; reservedAccountId: string }) {
  const result = await harness.database.query<{account_id:string;balance_minor:string}>(
    `select a.account_id,coalesce(b.balance_minor,0)::text balance_minor from accounts a
     left join account_balances b using(account_id) where a.account_id in ($1,$2)`,
    [account.availableAccountId, account.reservedAccountId])
  const values = Object.fromEntries(result.rows.map((row) => [row.account_id,row.balance_minor]))
  return { available: values[account.availableAccountId], locked: values[account.reservedAccountId] }
}

async function effects(harness: RealPostgresTestApplicationHarness, betId: string) {
  const result=await harness.database.query<{accepted_bets:string;reservations:string;entries:string}>(
    `select
       (select count(*) from financial_bets where bet_id=$1 and status<>'rejected')::text accepted_bets,
       (select count(*) from ledger_transactions where transaction_type='bet_reserve'
          and reference_id=$1)::text reservations,
       (select count(*) from ledger_entries e join ledger_transactions t using(transaction_id)
          where t.transaction_type='bet_reserve' and t.reference_id=$1)::text entries`,[betId])
  return result.rows[0]
}

async function waitForLockWaiters(harness: RealPostgresTestApplicationHarness,
  minimum: number): Promise<void> {
  const deadline=Date.now()+5_000
  while (Date.now()<deadline) {
    const result=await harness.database.query<{count:string}>(`select count(*)::text count
      from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()
      and wait_event_type='Lock' and state='active'`)
    if (Number(result.rows[0]?.count ?? 0)>=minimum) return
    await new Promise((resolve)=>setTimeout(resolve,10))
  }
  throw new Error(`timed out waiting for ${minimum} PostgreSQL lock waiter(s)`)
}

realDescribe('authenticated race lifecycle on real PostgreSQL', () => {
  let harness: RealPostgresTestApplicationHarness | undefined
  afterEach(async () => { await harness?.close(); harness=undefined })

  it('proves Stage 4 issuance through W1 wager and authenticated authoritative close', async () => {
    const initialNow = new Date()
    const clock = new MutableClock(initialNow)
    harness = await createRealPostgresTestApplication({ wagerIntakeEnabled: true,
      raceLifecycleEnabled: true, backendServiceAuthCredentials: credentials, clock })
    const raceId='race-22222222-2222-4222-a222-222222222222'
    const raceRef='N9-W2RAC-E0001'
    const events=lifecyclePair(raceId,raceRef,new Date(initialNow.getTime()-3_600_000),
      new Date(initialNow.getTime()+82_800_000))
    const opened=await request(harness.app).post(NINES_RACE_LIFECYCLE_PATH)
      .set(authHeaders(NINES_RACE_LIFECYCLE_PATH, events.open as unknown as JsonValue, clock.now()))
      .send(events.open)
    expect(opened.status,JSON.stringify(opened.body)).toBe(201)
    const playerId=randomUUID(); const authorization=issuance(playerId,initialNow)
    await harness.container.services.ninesIssuanceAuthorizationService.consume(authorization,
      { serviceId:'nines-api',requestId:randomUUID(),sentAt:initialNow,receivedAt:initialNow })
    const first=wager(playerId,events.open,clock.now())
    const accepted=await request(harness.app).post(NINES_PLACE_BET_PATH)
      .set(authHeaders(NINES_PLACE_BET_PATH,first as unknown as JsonValue,clock.now())).send(first)
    expect(accepted.status,JSON.stringify(accepted.body)).toBe(201)
    clock.set(new Date(events.close.occurredAt))
    const closed=await request(harness.app).post(NINES_RACE_LIFECYCLE_PATH)
      .set(authHeaders(NINES_RACE_LIFECYCLE_PATH,events.close as unknown as JsonValue,clock.now()))
      .send(events.close)
    expect(closed.status,JSON.stringify(closed.body)).toBe(201)
    const second=wager(playerId,events.open,clock.now(),'10000000')
    const rejected=await request(harness.app).post(NINES_PLACE_BET_PATH)
      .set(authHeaders(NINES_PLACE_BET_PATH,second as unknown as JsonValue,clock.now())).send(second)
    expect(rejected.body).toMatchObject({ result:'rejected',rejectionCode:'POOL_NOT_OPEN' })
    const summary=await harness.container.services.playerAccountQueryService.getPlayerBalance({
      userId:toUserId(playerId),currency:'NINES' })
    expect(summary.balance).toMatchObject({ spendableBalanceMinor:'103450000',
      reservedBalanceMinor:'20000000',displayBalanceMinor:'123450000' })
    const projection=await harness.database.query<{status:string;last_lifecycle_sequence:number;
      bets:string;reservations:string}>(`select p.status,p.last_lifecycle_sequence,
      (select count(*) from financial_bets b where b.race_id=p.race_id and b.status<>'rejected')::text bets,
      (select count(*) from ledger_transactions t where t.transaction_type='bet_reserve'
       and t.reference_id=$2)::text reservations from race_pools p where p.race_id=$1`,
    [raceId,first.betId])
    expect(projection.rows[0]).toEqual({ status:'frozen',last_lifecycle_sequence:2,
      bets:'1',reservations:'1' })
  })

  it('serializes a race close against wager placement without partial economics', async () => {
    const now=new Date(); const clock=new MutableClock(now)
    harness=await createRealPostgresTestApplication({ clock })
    const events=lifecyclePair('race-33333333-3333-4333-a333-333333333333','N9-W2RAC-E0002',
      new Date(now.getTime()-60_000),new Date(now.getTime()+3_600_000))
    const lifecycle=new RaceLifecycleProjectionService(harness.database)
    await lifecycle.ingest(events.open)
    const player=randomUUID(); const account=await fundPlayer(harness,player,'100000000')
    const restarted=createRealPostgresRestartedApplication(harness,{ clock })
    const command={betId:randomUUID(),userId:player,raceId:events.open.raceId,
      selectionId:'horse-1',stakeMinor:'20000000',currency:'NINES' as const,
      idempotencyKey:`race-close-${randomUUID()}`,correlationId:`corr_${randomUUID()}`,
      causationId:`cause_${randomUUID()}`}
    const [betResult]=await Promise.all([
      restarted.container.services.bettingIntakeService.placeBet(command),
      lifecycle.ingest(events.close),
    ])
    const finalBalance=await balance(harness,account)
    if (betResult.accepted) expect(finalBalance).toEqual({available:'80000000',locked:'20000000'})
    else expect(finalBalance).toEqual({available:'100000000',locked:'0'})
    const integrity=await harness.database.query<{orphan_bets:string;orphan_reservations:string;status:string}>(
      `select (select count(*) from financial_bets b where b.status<>'rejected'
         and b.reservation_transaction_id is null)::text orphan_bets,
       (select count(*) from ledger_transactions t where t.transaction_type='bet_reserve'
         and not exists(select 1 from financial_bets b where b.reservation_transaction_id=t.transaction_id))::text orphan_reservations,
       (select status from race_pools where race_id=$1)::text status`,[events.open.raceId])
    expect(integrity.rows[0]).toEqual({orphan_bets:'0',orphan_reservations:'0',status:'frozen'})
  })

  it('accepts immediately before the immutable cutoff and rejects exactly at it while still open', async () => {
    const base=new Date(); const closesAt=new Date(base.getTime()+3_600_000)
    const clock=new MutableClock(new Date(closesAt.getTime()-1))
    harness=await createRealPostgresTestApplication({ clock })
    const events=lifecyclePair('race-51111111-1111-4111-a111-111111111111','N9-ABCDE-10001',
      new Date(base.getTime()-60_000),closesAt)
    const lifecycle=new RaceLifecycleProjectionService(harness.database)
    await lifecycle.ingest(events.open)
    const player=randomUUID(); const account=await fundPlayer(harness,player,'100000000')
    const before={betId:randomUUID(),userId:player,raceId:events.open.raceId,
      selectionId:'horse-1',stakeMinor:'20000000',currency:'NINES' as const,
      idempotencyKey:`before-${randomUUID()}`,correlationId:`corr_${randomUUID()}`,
      causationId:`cause_${randomUUID()}`}
    const accepted=await harness.container.services.bettingIntakeService.placeBet(before)
    expect(accepted.accepted).toBe(true)
    expect(await effects(harness,before.betId)).toEqual({accepted_bets:'1',reservations:'1',entries:'2'})
    expect(await balance(harness,account)).toEqual({available:'80000000',locked:'20000000'})

    clock.set(closesAt)
    const atCutoff={...before,betId:randomUUID(),stakeMinor:'10000000',
      idempotencyKey:`at-cutoff-${randomUUID()}`}
    const rejected=await harness.container.services.bettingIntakeService.placeBet(atCutoff)
    expect(rejected).toMatchObject({accepted:false,bet:{rejectionCode:'BETTING_WINDOW_CLOSED'}})
    expect(await effects(harness,atCutoff.betId)).toEqual({accepted_bets:'0',reservations:'0',entries:'0'})
    expect(await balance(harness,account)).toEqual({available:'80000000',locked:'20000000'})
    const pool=await harness.database.query<{status:string}>(
      'select status from race_pools where race_id=$1',[events.open.raceId])
    expect(pool.rows[0]?.status).toBe('open')
    expect((await harness.container.services.balanceMaintenanceService.verifyBalances()).mismatchCount).toBe(0)
  })

  it('rejects after cutoff despite delayed close and a stale pre-cutoff client timestamp', async () => {
    const base=new Date(); const closesAt=new Date(base.getTime()+3_600_000)
    const clock=new MutableClock(new Date(closesAt.getTime()+1))
    harness=await createRealPostgresTestApplication({ clock,wagerIntakeEnabled:true,
      raceLifecycleEnabled:true,backendServiceAuthCredentials:credentials })
    const events=lifecyclePair('race-52222222-2222-4222-a222-222222222222','N9-ABCDE-10002',
      new Date(base.getTime()-60_000),closesAt)
    const lifecycle=new RaceLifecycleProjectionService(harness.database)
    await lifecycle.ingest(events.open)
    const player=randomUUID(); const account=await fundPlayer(harness,player,'100000000')
    const stale=wager(player,events.open,new Date(closesAt.getTime()-30_000))
    const response=await request(harness.app).post(NINES_PLACE_BET_PATH)
      .set(authHeaders(NINES_PLACE_BET_PATH,stale as unknown as JsonValue,clock.now())).send(stale)
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({result:'rejected',rejectionCode:'BETTING_WINDOW_CLOSED'})
    expect(await effects(harness,stale.betId)).toEqual({accepted_bets:'0',reservations:'0',entries:'0'})
    expect(await balance(harness,account)).toEqual({available:'100000000',locked:'0'})
    expect((await harness.database.query<{status:string}>(
      'select status from race_pools where race_id=$1',[events.open.raceId])).rows[0]?.status).toBe('open')
    expect(await lifecycle.ingest(events.close)).toMatchObject({poolStatus:'frozen',result:'projected'})
  })

  it('lets a before-cutoff bet holding the pool lock commit before close and settle once', async () => {
    const base=new Date(); const closesAt=new Date(base.getTime()+3_600_000)
    const clock=new MutableClock(new Date(closesAt.getTime()-1)); const barrier=new ReservationBarrier()
    harness=await createRealPostgresTestApplication({ clock,faultInjector:barrier })
    const events=lifecyclePair('race-53333333-3333-4333-a333-333333333333','N9-ABCDE-10003',
      new Date(base.getTime()-60_000),closesAt)
    const lifecycle=new RaceLifecycleProjectionService(harness.database)
    await lifecycle.ingest(events.open)
    const player=randomUUID(); const account=await fundPlayer(harness,player,'100000000')
    const command={betId:randomUUID(),userId:player,raceId:events.open.raceId,
      selectionId:'horse-1',stakeMinor:'20000000',currency:'NINES' as const,
      idempotencyKey:`bet-first-${randomUUID()}`,correlationId:`corr_${randomUUID()}`,
      causationId:`cause_${randomUUID()}`}
    const betPromise=harness.container.services.bettingIntakeService.placeBet(command)
    await barrier.reached
    const closePromise=lifecycle.ingest(events.close)
    await waitForLockWaiters(harness,1)
    barrier.release()
    const [accepted,closed]=await Promise.all([betPromise,closePromise])
    expect(accepted.accepted).toBe(true)
    expect(closed).toMatchObject({poolStatus:'frozen'})
    expect(await effects(harness,command.betId)).toEqual({accepted_bets:'1',reservations:'1',entries:'2'})
    const result=raceResult(events.close)
    clock.set(new Date(result.completedAt))
    const settlement=await harness.container.services.raceResultSettlementService.ingest(result)
    expect(settlement).toMatchObject({result:'settled',poolStatus:'settled',
      acceptedStakeMinor:'20000000',houseTakeMinor:'2000000',netPoolMinor:'18000000'})
    const settledBet=await harness.database.query<{status:string;stake_minor:string}>(
      'select status,stake_minor::text from financial_bets where bet_id=$1',[command.betId])
    expect(settledBet.rows[0]).toEqual({status:'settled_win',stake_minor:'20000000'})
    expect(await balance(harness,account)).toEqual({available:'98000000',locked:'0'})
    expect((await harness.container.services.balanceMaintenanceService.verifyBalances()).mismatchCount).toBe(0)
  })

  it('rejects at cutoff after taking the bet path first, then permits normal close', async () => {
    const base=new Date(); const closesAt=new Date(base.getTime()+3_600_000)
    const clock=new MutableClock(closesAt)
    harness=await createRealPostgresTestApplication({ clock })
    const events=lifecyclePair('race-54444444-4444-4444-a444-444444444444','N9-ABCDE-10004',
      new Date(base.getTime()-60_000),closesAt)
    const lifecycle=new RaceLifecycleProjectionService(harness.database)
    await lifecycle.ingest(events.open)
    const player=randomUUID(); const account=await fundPlayer(harness,player,'100000000')
    const command={betId:randomUUID(),userId:player,raceId:events.open.raceId,
      selectionId:'horse-1',stakeMinor:'20000000',currency:'NINES' as const,
      idempotencyKey:`late-bet-first-${randomUUID()}`,correlationId:`corr_${randomUUID()}`,
      causationId:`cause_${randomUUID()}`}
    const rejected=await harness.container.services.bettingIntakeService.placeBet(command)
    expect(rejected).toMatchObject({accepted:false,bet:{rejectionCode:'BETTING_WINDOW_CLOSED'}})
    expect(await effects(harness,command.betId)).toEqual({accepted_bets:'0',reservations:'0',entries:'0'})
    expect(await balance(harness,account)).toEqual({available:'100000000',locked:'0'})
    expect((await harness.database.query<{status:string}>(
      'select status from race_pools where race_id=$1',[events.open.raceId])).rows[0]?.status).toBe('open')
    expect(await lifecycle.ingest(events.close)).toMatchObject({poolStatus:'frozen'})
  })

  it('rejects when close is queued first before cutoff and leaves no economic effect', async () => {
    const base=new Date(); const closesAt=new Date(base.getTime()+3_600_000)
    const clock=new MutableClock(new Date(closesAt.getTime()-1))
    harness=await createRealPostgresTestApplication({ clock })
    const events=lifecyclePair('race-55555555-5555-4555-a555-555555555555','N9-ABCDE-10005',
      new Date(base.getTime()-60_000),closesAt)
    const lifecycle=new RaceLifecycleProjectionService(harness.database)
    await lifecycle.ingest(events.open)
    const player=randomUUID(); const account=await fundPlayer(harness,player,'100000000')
    const command={betId:randomUUID(),userId:player,raceId:events.open.raceId,
      selectionId:'horse-1',stakeMinor:'20000000',currency:'NINES' as const,
      idempotencyKey:`close-first-${randomUUID()}`,correlationId:`corr_${randomUUID()}`,
      causationId:`cause_${randomUUID()}`}
    let closePromise:ReturnType<RaceLifecycleProjectionService['ingest']>|undefined
    let betPromise:ReturnType<typeof harness.container.services.bettingIntakeService.placeBet>|undefined
    await harness.database.tx(async (blocker) => {
      await blocker.query(`select race_id from race_pools where race_id=$1 and currency='NINES'
        for update`,[events.open.raceId])
      closePromise=lifecycle.ingest(events.close)
      await waitForLockWaiters(harness!,1)
      betPromise=harness!.container.services.bettingIntakeService.placeBet(command)
      await waitForLockWaiters(harness!,2)
    })
    const [closed,rejected]=await Promise.all([closePromise!,betPromise!])
    expect(closed).toMatchObject({poolStatus:'frozen'})
    expect(rejected).toMatchObject({accepted:false,bet:{rejectionCode:'POOL_NOT_OPEN'}})
    expect(await effects(harness,command.betId)).toEqual({accepted_bets:'0',reservations:'0',entries:'0'})
    expect(await balance(harness,account)).toEqual({available:'100000000',locked:'0'})
  })

  it('replays a pre-cutoff acceptance after cutoff and never upgrades a cutoff rejection', async () => {
    const base=new Date(); const closesAt=new Date(base.getTime()+3_600_000)
    const clock=new MutableClock(new Date(closesAt.getTime()-1))
    harness=await createRealPostgresTestApplication({ clock,wagerIntakeEnabled:true,
      backendServiceAuthCredentials:credentials })
    const events=lifecyclePair('race-56666666-6666-4666-a666-666666666666','N9-ABCDE-10006',
      new Date(base.getTime()-60_000),closesAt)
    const lifecycle=new RaceLifecycleProjectionService(harness.database)
    await lifecycle.ingest(events.open)
    const player=randomUUID(); const account=await fundPlayer(harness,player,'100000000')
    const acceptedCommand=wager(player,events.open,clock.now())
    const accepted=await request(harness.app).post(NINES_PLACE_BET_PATH)
      .set(authHeaders(NINES_PLACE_BET_PATH,acceptedCommand as unknown as JsonValue,clock.now()))
      .send(acceptedCommand)
    expect(accepted.status).toBe(201)
    clock.set(new Date(closesAt.getTime()+1))
    const acceptedReplay=await request(harness.app).post(NINES_PLACE_BET_PATH)
      .set(authHeaders(NINES_PLACE_BET_PATH,acceptedCommand as unknown as JsonValue,clock.now()))
      .send(acceptedCommand)
    expect(acceptedReplay.body).toMatchObject({result:'replayed',
      reservationTransactionId:accepted.body.reservationTransactionId})

    const rejectedCommand=wager(player,events.open,clock.now(),'10000000')
    const rejected=await request(harness.app).post(NINES_PLACE_BET_PATH)
      .set(authHeaders(NINES_PLACE_BET_PATH,rejectedCommand as unknown as JsonValue,clock.now()))
      .send(rejectedCommand)
    expect(rejected.body).toMatchObject({result:'rejected',rejectionCode:'BETTING_WINDOW_CLOSED'})
    const {evidenceHash:_hash,...rejectedEvidence}=rejectedCommand
    const earlierEvidence={...rejectedEvidence,requestedAt:new Date(closesAt.getTime()-500).toISOString()}
    const earlierClaim={...earlierEvidence,evidenceHash:ninesPlaceBetEvidenceHash(earlierEvidence)}
    const rejectedReplay=await request(harness.app).post(NINES_PLACE_BET_PATH)
      .set(authHeaders(NINES_PLACE_BET_PATH,earlierClaim as unknown as JsonValue,clock.now()))
      .send(earlierClaim)
    expect(rejectedReplay.body).toMatchObject({result:'replayed',
      rejectionCode:'BETTING_WINDOW_CLOSED',reservationTransactionId:null})
    expect(await effects(harness,acceptedCommand.betId)).toEqual({accepted_bets:'1',reservations:'1',entries:'2'})
    expect(await effects(harness,rejectedCommand.betId)).toEqual({accepted_bets:'0',reservations:'0',entries:'0'})
    expect(await balance(harness,account)).toEqual({available:'80000000',locked:'20000000'})
  })

  it('enforces append-only lifecycle, immutable runners/window/policy, ordering, and DB close guards', async () => {
    const now=new Date(); const clock=new MutableClock(now)
    harness=await createRealPostgresTestApplication({ clock })
    const events=lifecyclePair('race-44444444-4444-4444-a444-444444444444','N9-W2RAC-E0003',
      new Date(now.getTime()-60_000),new Date(now.getTime()+3_600_000))
    const lifecycle=new RaceLifecycleProjectionService(harness.database)
    await expect(lifecycle.ingest(events.close)).rejects.toMatchObject({
      code:'RACE_LIFECYCLE_CLOSE_BEFORE_OPEN' })
    await lifecycle.ingest(events.open)
    await expect(harness.database.query(`update race_pools set betting_closes_at=betting_closes_at+
      interval '1 second' where race_id=$1`,[events.open.raceId])).rejects.toThrow()
    await expect(harness.database.query(`update race_pools set house_take_bps=0 where race_id=$1`,
      [events.open.raceId])).rejects.toThrow()
    await expect(harness.database.query(`update race_pool_selections set selection_id='other'
      where race_id=$1 and selection_id='horse-1'`,[events.open.raceId])).rejects.toThrow()
    await expect(harness.database.query(`delete from race_lifecycle_evidence where race_id=$1`,
      [events.open.raceId])).rejects.toThrow()
    await lifecycle.ingest(events.close)
    const stale={...events.open,lifecycleEventId:randomUUID()}
    await expect(lifecycle.ingest({ ...stale,evidenceHash:raceLifecycleEvidenceHash(
      (({evidenceHash:_hash,...rest})=>rest)(stale)) })).rejects.toMatchObject({
      code:'RACE_LIFECYCLE_STALE_EVENT' })
    await expect(harness.database.query(`insert into financial_bets
      (bet_id,user_id,race_id,selection_id,stake_minor,currency,status,reservation_transaction_id,
       accepted_at,idempotency_key,correlation_id,causation_id,created_at,updated_at)
      values($1,$2,$3,'horse-1',1,'NINES','accepted',$4,now(),$5,$6,$7,now(),now())`,
    [randomUUID(),randomUUID(),events.open.raceId,randomUUID(),`direct-${randomUUID()}`,
      `corr_${randomUUID()}`,`cause_${randomUUID()}`])).rejects.toThrow(/closed for betting/)
    const triggers=await harness.database.query<{tgname:string}>(`select tgname from pg_trigger
      where tgname in ('race_lifecycle_evidence_append_only','race_pools_lifecycle_immutability',
      'race_pool_selections_lifecycle_immutability','financial_bets_lifecycle_pool_guard')
      and not tgisinternal order by tgname`)
    expect(triggers.rows.map((row)=>row.tgname)).toHaveLength(4)
  })
})
