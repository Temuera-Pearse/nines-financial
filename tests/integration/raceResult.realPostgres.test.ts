import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterEach,describe,expect,it } from 'vitest'

import { toUserId } from '../../src/domains/account/types/identifiers.js'
import { NINES_PLACE_BET_PATH,NINES_PLACE_BET_SCHEMA_VERSION,
  NINES_PLAYER_ASSERTION_SCHEMA_VERSION,ninesPlaceBetEvidenceHash,
  type NinesPlaceBetCommandV1 } from '../../src/domains/betting/dto/NinesPlaceBetCommand.js'
import type { NinesIssuanceAuthorizationV1 } from '../../src/domains/issuance-authorizations/dto/NinesIssuanceAuthorization.js'
import { NINES_RACE_LIFECYCLE_PATH,NINES_RACE_LIFECYCLE_SCHEMA_VERSION,
  raceLifecycleEvidenceHash,type NinesRaceLifecycleEventV1 } from '../../src/domains/race-lifecycle/dto/RaceLifecycleEvent.js'
import { NINES_RACE_RESULT_PATH,NINES_RACE_RESULT_SCHEMA_VERSION,
  raceResultEvidenceHash,type NinesRaceResultV1 } from '../../src/domains/race-results/dto/NinesRaceResult.js'
import { RaceResultRecoveryWorker } from '../../src/domains/race-results/services/RaceResultRecoveryWorker.js'
import { hashCanonicalJson } from '../../src/shared/contracts/canonicalJson.js'
import type { FaultInjector,FaultPoint } from '../../src/shared/faults/FaultInjector.js'
import type { Logger } from '../../src/shared/observability/logger.js'
import { signServiceMessage } from '../../src/shared/security/ServiceMessageAuthentication.js'
import type { Clock } from '../../src/shared/time/Clock.js'
import type { JsonValue } from '../../src/shared/types/Json.js'
import { createRealPostgresTestApplication,realPostgresDrillsEnabled,
  type RealPostgresTestApplicationHarness } from '../support/realPostgresTestApp.js'

const secret='w3-real-postgres-backend-secret-at-least-32-characters'
const keyId='backend-result-v1'
const credentials={'nines-back-end':{[keyId]:secret}}
const realDescribe=realPostgresDrillsEnabled()?describe:describe.skip

class MutableClock implements Clock{
  constructor(private value:Date){} now():Date{return new Date(this.value)}
  set(value:Date):void{this.value=new Date(value)}
}
class SelectableFaultInjector implements FaultInjector{
  point:FaultPoint|null=null
  trigger(point:FaultPoint):void{if(point===this.point)throw new Error(`injected:${point}`)}
}
class RecordingLogger implements Logger{
  readonly entries:Array<{level:string;message:string;context:unknown}>=[]
  debug(message:string,context?:Record<string,unknown>):void{this.entries.push({level:'debug',message,context})}
  info(message:string,context?:Record<string,unknown>):void{this.entries.push({level:'info',message,context})}
  warn(message:string,context?:Record<string,unknown>):void{this.entries.push({level:'warn',message,context})}
  error(message:string,context?:Record<string,unknown>):void{this.entries.push({level:'error',message,context})}
  child():Logger{return this}
}

const policy=Object.freeze({policyId:'nines-parimutuel.v1' as const,policyVersion:1 as const,
  houseTakeBps:1000,carryoverPolicyId:'nines-carryover.v1' as const,
  carryoverPolicyVersion:1 as const,
  settlementAllocationPolicyId:'nines-proportional-allocation.v1' as const,
  settlementAllocationPolicyVersion:1 as const,
  roundingPolicyId:'nines-largest-remainder.v1' as const,roundingPolicyVersion:1 as const})

function lifecyclePair(raceId:string,raceRef:string,opensAt:Date,closesAt:Date){
  const selections=[1,2,3].map(index=>({runnerId:`horse-${index}`,
    selectionId:`horse-${index}`,displayName:`Horse ${index}`}))
  const openEvidence={schemaVersion:NINES_RACE_LIFECYCLE_SCHEMA_VERSION as typeof NINES_RACE_LIFECYCLE_SCHEMA_VERSION,
    eventType:'nines_race_opened.v1' as const,issuer:'nines-back-end' as const,
    audience:'nines-financial' as const,environment:'test' as const,raceId,raceRef,
    lifecycleEventId:randomUUID(),lifecycleSequence:1 as const,
    bettingOpensAt:opensAt.toISOString(),bettingClosesAt:closesAt.toISOString(),selections,
    currency:'NINES' as const,economicPolicy:policy,correlationId:raceId,
    causationId:`race-seeded:${raceId}`,occurredAt:opensAt.toISOString()}
  const open:NinesRaceLifecycleEventV1={...openEvidence,
    evidenceHash:raceLifecycleEvidenceHash(openEvidence)}
  const closeEvidence={...openEvidence,eventType:'nines_race_betting_closed.v1' as const,
    lifecycleEventId:randomUUID(),lifecycleSequence:2 as const,causationId:open.lifecycleEventId,
    occurredAt:closesAt.toISOString()}
  const close:NinesRaceLifecycleEventV1={...closeEvidence,
    evidenceHash:raceLifecycleEvidenceHash(closeEvidence)}
  return {open,close}
}

function resultEvent(close:NinesRaceLifecycleEventV1,winner='horse-1',resultId=randomUUID()):NinesRaceResultV1{
  const order=winner==='horse-1'?['horse-1','horse-2','horse-3']:
    winner==='horse-2'?['horse-2','horse-1','horse-3']:['horse-3','horse-1','horse-2']
  const evidence={schemaVersion:NINES_RACE_RESULT_SCHEMA_VERSION as typeof NINES_RACE_RESULT_SCHEMA_VERSION,
    eventType:'nines_race_completed.v1' as const,issuer:'nines-back-end' as const,
    audience:'nines-financial' as const,environment:'test' as const,raceId:close.raceId,
    raceRef:close.raceRef,resultId,resultVersion:1 as const,
    completedAt:new Date(Date.parse(close.occurredAt)+20_000).toISOString(),
    winningRunnerId:winner,winningSelectionId:winner,finishOrder:order,
    raceChecksum:'d'.repeat(64),closeLifecycleEventId:close.lifecycleEventId,
    closeLifecycleEvidenceHash:close.evidenceHash,correlationId:close.correlationId,
    causationId:close.lifecycleEventId}
  return {...evidence,evidenceHash:raceResultEvidenceHash(evidence)}
}

function authHeaders(path:string,body:JsonValue,now:Date){
  const requestId=randomUUID(),sentAt=now.toISOString(),contentHash=hashCanonicalJson(body)
  return {'x-nines-service-id':'nines-back-end','x-nines-key-id':keyId,
    'x-nines-request-id':requestId,'x-nines-sent-at':sentAt,
    'x-nines-content-sha256':contentHash,
    'x-nines-signature':signServiceMessage({method:'POST',path,environment:'test',
      serviceId:'nines-back-end',keyId,requestId,sentAt,contentHash,secret})}
}

function wager(playerId:string,lifecycle:NinesRaceLifecycleEventV1,selectionId:string,
  stakeMinor:string,requestedAt:Date):NinesPlaceBetCommandV1{
  const payload={schemaVersion:NINES_PLACE_BET_SCHEMA_VERSION as typeof NINES_PLACE_BET_SCHEMA_VERSION,commandType:'nines_place_bet' as const,
    issuer:'nines-back-end' as const,audience:'nines-financial' as const,environment:'test' as const,
    betId:randomUUID(),playerId,raceId:lifecycle.raceId,raceRef:lifecycle.raceRef,selectionId,
    stake:{currency:'NINES' as const,scale:6 as const,minorUnits:stakeMinor},
    idempotencyKey:`wager-${randomUUID()}`,requestedAt:requestedAt.toISOString(),
    correlationId:`corr_${randomUUID()}`,causationId:`cause_${randomUUID()}`,
    playerIdentity:{schemaVersion:NINES_PLAYER_ASSERTION_SCHEMA_VERSION as typeof NINES_PLAYER_ASSERTION_SCHEMA_VERSION,
      assertionId:randomUUID(),subjectPlayerId:playerId,assertedBy:'nines-back-end' as const,
      authenticationMethod:'upstream_access_token' as const,
      authenticatedAt:new Date(requestedAt.getTime()-1000).toISOString(),
      expiresAt:new Date(requestedAt.getTime()+60_000).toISOString()}}
  return {...payload,evidenceHash:ninesPlaceBetEvidenceHash(payload)}
}

function issuance(playerId:string,now:Date,amountMinor='100000000'):NinesIssuanceAuthorizationV1{
  const authorizationId=randomUUID(),intentId=randomUUID(),confirmationEventId=randomUUID(),
    completedValuationId=randomUUID(),nzdMinor=(BigInt(amountMinor)/10_000n).toString()
  return {schemaVersion:1,eventType:'nines_issuance_authorized',authorizationId,
    issuer:'nines-api',audience:'nines-financial',environment:'test',playerId,
    funding:{intentId,confirmationEventId,
      evidenceIdentity:`crypto-funding-confirmation:v1:${intentId}:${confirmationEventId}`,
      requestHash:'a'.repeat(64),confirmationPayloadHash:'b'.repeat(64),provider:'fake',
      paymentReference:`payment-${randomUUID()}`},valuation:{workflowId:randomUUID(),
      completedValuationId,completionKey:`funding-nzd-valuation:v1:test:${intentId}`,
      evidenceFingerprint:'c'.repeat(64),valuedAt:new Date(now.getTime()-120_000).toISOString(),
      profileVersion:'funding-nzd-valuation-profile-v1',finalNzdAmount:`${nzdMinor.slice(0,-2)||'0'}.${nzdMinor.slice(-2).padStart(2,'0')}`,
      finalNzdMinorUnits:nzdMinor,calculationPolicyVersion:'nzd-valuation-calculation-v1',
      roundingPolicyVersion:'nzd-valuation-rounding-v1'},issuance:{
      policyVersion:'nzd-valuation-to-nines-par-v1',currency:'NINES',scale:6,minorUnits:amountMinor},
    authorizedAt:new Date(now.getTime()-60_000).toISOString(),
    correlationId:`corr-${authorizationId}`,causationId:completedValuationId}
}

async function issue(harness:RealPostgresTestApplicationHarness,playerId:string,now:Date){
  await harness.container.services.ninesIssuanceAuthorizationService.consume(issuance(playerId,now),
    {serviceId:'nines-api',requestId:randomUUID(),sentAt:now,receivedAt:now})
}

async function balances(harness:RealPostgresTestApplicationHarness,playerIds:string[]){
  const rows=await harness.database.query<{owner_id:string;account_type:string;balance_minor:string}>(
    `select a.owner_id,a.account_type,coalesce(b.balance_minor,0)::text balance_minor from accounts a
     left join account_balances b using(account_id)
     where a.owner_type='user' and a.owner_id=any($1::text[])
       and a.account_type in ('user_available','user_locked')`,[playerIds])
  return Object.fromEntries(playerIds.map(id=>[id,{available:rows.rows.find(row=>row.owner_id===id&&
    row.account_type==='user_available')?.balance_minor??'0',locked:rows.rows.find(row=>row.owner_id===id&&
    row.account_type==='user_locked')?.balance_minor??'0'}]))
}

async function postLifecycle(harness:RealPostgresTestApplicationHarness,event:NinesRaceLifecycleEventV1,
  clock:MutableClock){return request(harness.app).post(NINES_RACE_LIFECYCLE_PATH)
  .set(authHeaders(NINES_RACE_LIFECYCLE_PATH,event as unknown as JsonValue,clock.now())).send(event)}
async function postResult(harness:RealPostgresTestApplicationHarness,event:NinesRaceResultV1,
  clock:MutableClock){return request(harness.app).post(NINES_RACE_RESULT_PATH)
  .set(authHeaders(NINES_RACE_RESULT_PATH,event as unknown as JsonValue,clock.now())).send(event)}

async function prepareRace(harness:RealPostgresTestApplicationHarness,clock:MutableClock,
  raceId:string,raceRef:string,bets:Array<{playerId:string;selectionId:string;stake:string}>){
  const opens=new Date(clock.now().getTime()-60_000),closes=new Date(clock.now().getTime()+3_600_000)
  const lifecycle=lifecyclePair(raceId,raceRef,opens,closes)
  const opened=await postLifecycle(harness,lifecycle.open,clock)
  expect(opened.status,JSON.stringify(opened.body)).toBe(201)
  for(const bet of bets){await issue(harness,bet.playerId,clock.now());const command=wager(bet.playerId,
    lifecycle.open,bet.selectionId,bet.stake,clock.now());const response=await request(harness.app)
      .post(NINES_PLACE_BET_PATH).set(authHeaders(NINES_PLACE_BET_PATH,
        command as unknown as JsonValue,clock.now())).send(command)
    expect(response.status,JSON.stringify(response.body)).toBe(201)}
  clock.set(closes)
  expect((await postLifecycle(harness,lifecycle.close,clock)).status).toBe(201)
  const result=resultEvent(lifecycle.close)
  clock.set(new Date(result.completedAt))
  return {lifecycle,result}
}

async function acceptPending(harness:RealPostgresTestApplicationHarness,event:NinesRaceResultV1,
  clock:MutableClock,faults:SelectableFaultInjector){
  faults.point='race_result.after_accept_before_settlement'
  const response=await postResult(harness,event,clock)
  faults.point=null
  expect(response.status,JSON.stringify(response.body)).toBe(500)
  const row=await harness.database.query<{settlement_status:string}>(
    'select settlement_status from authoritative_race_results where result_id=$1',[event.resultId])
  expect(row.rows[0]?.settlement_status).toBe('pending')
}

function recoveryWorker(harness:RealPostgresTestApplicationHarness,clock:MutableClock,
  logger:Logger,faultInjector?:FaultInjector,overrides:Partial<{
    pollIntervalMs:number;leaseMs:number;maxAttempts:number;batchSize:number;
    baseRetryMs:number;maxRetryMs:number}>= {}){
  return new RaceResultRecoveryWorker(harness.database,
    harness.container.services.raceResultSettlementService,logger,{
      pollIntervalMs:overrides.pollIntervalMs??10,leaseMs:overrides.leaseMs??100,
      maxAttempts:overrides.maxAttempts??5,batchSize:overrides.batchSize??25,
      baseRetryMs:overrides.baseRetryMs??1,maxRetryMs:overrides.maxRetryMs??10,
      clock,...(faultInjector?{faultInjector}:{}),
    })
}

async function resultIntegrity(harness:RealPostgresTestApplicationHarness,result:NinesRaceResultV1){
  const counts=await harness.database.query<{status:string;runs:string;captures:string;house:string}>(
    `select (select settlement_status from authoritative_race_results where result_id=$1) status,
      (select count(*) from settlement_runs where authoritative_result_id=$1 and status='completed')::text runs,
      (select count(*) from ledger_transactions where transaction_type='bet_capture'
        and correlation_id=$2)::text captures,
      (select count(*) from ledger_transactions where transaction_type='settlement_house_take'
        and correlation_id=$2)::text house`,[result.resultId,result.raceId])
  const row=counts.rows[0]
  if(!row)throw new Error('missing result integrity row')
  return row
}

realDescribe('authenticated authoritative result settlement on real PostgreSQL',()=>{
  let harness:RealPostgresTestApplicationHarness|undefined
  afterEach(async()=>{await harness?.close();harness=undefined})

  it('settles exact multi-bettor economics from frozen W2 policy and replays without movement',async()=>{
    const clock=new MutableClock(new Date());harness=await createRealPostgresTestApplication({
      wagerIntakeEnabled:true,raceLifecycleEnabled:true,raceResultEnabled:true,
      backendServiceAuthCredentials:credentials,clock})
    const players=[randomUUID(),randomUUID(),randomUUID()]
    const {result}=await prepareRace(harness,clock,'race-55555555-5555-4555-a555-555555555555',
      'N9-W3RAC-E0001',[{playerId:players[0]!,selectionId:'horse-1',stake:'20000000'},
        {playerId:players[1]!,selectionId:'horse-1',stake:'30000000'},
        {playerId:players[2]!,selectionId:'horse-2',stake:'50000000'}])
    const settled=await postResult(harness,result,clock)
    expect(settled.status,JSON.stringify(settled.body)).toBe(201)
    expect(settled.body).toMatchObject({result:'settled',poolStatus:'settled',
      totalPoolMinor:'100000000',acceptedStakeMinor:'100000000',appliedCarryoverMinor:'0',
      houseTakeMinor:'10000000',netPoolMinor:'90000000',roundingResidualMinor:'0',carryoverMinor:'0'})
    const firstBalances=await balances(harness,players)
    expect(firstBalances).toEqual({[players[0]!]:{available:'116000000',locked:'0'},
      [players[1]!]:{available:'124000000',locked:'0'},
      [players[2]!]:{available:'50000000',locked:'0'}})
    const system=await harness.database.query<{clearing:string;house:string}>(`select
      coalesce((select b.balance_minor::text from accounts a join account_balances b using(account_id)
        where a.owner_type='settlement' and a.owner_id=$1 and a.account_type='settlement_clearing'),'0') clearing,
      coalesce((select b.balance_minor::text from accounts a join account_balances b using(account_id)
        where a.owner_type='platform' and a.owner_id='house' and a.account_type='house_take_revenue'),'0') house`,
    [`race:${result.raceId}`])
    expect(system.rows[0]).toEqual({clearing:'0',house:'10000000'})
    const replay=await postResult(harness,result,clock)
    expect(replay.status).toBe(200);expect(replay.body).toMatchObject({result:'replayed',
      settlementRunId:settled.body.settlementRunId})
    expect(await balances(harness,players)).toEqual(firstBalances)
  })

  it('creates one exact carryover when the authoritative winner has no wagers',async()=>{
    const clock=new MutableClock(new Date());harness=await createRealPostgresTestApplication({
      wagerIntakeEnabled:true,raceLifecycleEnabled:true,raceResultEnabled:true,
      backendServiceAuthCredentials:credentials,clock})
    const players=[randomUUID(),randomUUID()]
    const prepared=await prepareRace(harness,clock,'race-66666666-6666-4666-a666-666666666666',
      'N9-W3RAC-E0002',[{playerId:players[0]!,selectionId:'horse-2',stake:'40000000'},
        {playerId:players[1]!,selectionId:'horse-3',stake:'60000000'}])
    const result=resultEvent(prepared.lifecycle.close,'horse-1')
    clock.set(new Date(result.completedAt))
    const settled=await postResult(harness,result,clock)
    expect(settled.status).toBe(201)
    expect(settled.body).toMatchObject({houseTakeMinor:'10000000',netPoolMinor:'90000000',
      carryoverMinor:'90000000'})
    const carryover=await harness.database.query<{amount_minor:string;count:string}>(
      `select coalesce(sum(amount_minor),0)::text amount_minor,count(*)::text count
       from settlement_carryovers where race_id=$1`,[result.raceId])
    expect(carryover.rows[0]).toEqual({amount_minor:'90000000',count:'1'})
    expect((await postResult(harness,result,clock)).status).toBe(200)
    expect((await harness.database.query(`select 1 from settlement_carryovers where race_id=$1`,
      [result.raceId])).rowCount).toBe(1)
  })

  it('converges eight deliveries and rejects conflicting or mutable result evidence',async()=>{
    const clock=new MutableClock(new Date());harness=await createRealPostgresTestApplication({
      wagerIntakeEnabled:true,raceLifecycleEnabled:true,raceResultEnabled:true,
      backendServiceAuthCredentials:credentials,clock})
    const player=randomUUID(),prepared=await prepareRace(harness,clock,
      'race-77777777-7777-4777-a777-777777777777','N9-W3RAC-E0003',
      [{playerId:player,selectionId:'horse-1',stake:'25000000'}])
    const deliveries=await Promise.all(Array.from({length:8},()=>postResult(harness!,prepared.result,clock)))
    expect(deliveries.every(response=>[200,201].includes(response.status)),
      JSON.stringify(deliveries.map(response=>({status:response.status,body:response.body})))).toBe(true)
    expect(deliveries.filter(response=>response.status===201)).toHaveLength(1)
    const counts=await harness.database.query<{results:string;runs:string;captures:string;house:string}>(
      `select (select count(*) from authoritative_race_results where race_id=$1)::text results,
       (select count(*) from settlement_runs where race_id=$1 and status='completed')::text runs,
       (select count(*) from ledger_transactions where transaction_type='bet_capture'
         and correlation_id=$1)::text captures,
       (select count(*) from ledger_transactions where transaction_type='settlement_house_take'
         and correlation_id=$1)::text house`,[prepared.result.raceId])
    expect(counts.rows[0]).toEqual({results:'1',runs:'1',captures:'1',house:'1'})
    const conflict={...prepared.result,winningRunnerId:'horse-2',winningSelectionId:'horse-2',
      finishOrder:['horse-2','horse-1','horse-3']}
    const conflictEvent={...conflict,evidenceHash:raceResultEvidenceHash((({evidenceHash:_h,...rest})=>rest)(conflict))}
    expect((await postResult(harness,conflictEvent,clock)).status).toBe(409)
    const different={...conflictEvent,resultId:randomUUID()}
    const differentEvent={...different,evidenceHash:raceResultEvidenceHash((({evidenceHash:_h,...rest})=>rest)(different))}
    expect((await postResult(harness,differentEvent,clock)).status).toBe(409)
    await expect(harness.database.query(`update authoritative_race_results
      set winning_selection_id='horse-2' where result_id=$1`,[prepared.result.resultId])).rejects.toThrow()
    await expect(harness.database.query(`update settlement_runs set house_take_bps=0
      where race_id=$1`,[prepared.result.raceId])).rejects.toThrow()
  })

  it('recovers pending and committed settlement across every W3 crash boundary',async()=>{
    const clock=new MutableClock(new Date()),faults=new SelectableFaultInjector()
    harness=await createRealPostgresTestApplication({wagerIntakeEnabled:true,raceLifecycleEnabled:true,
      raceResultEnabled:true,backendServiceAuthCredentials:credentials,clock,faultInjector:faults})
    const points:FaultPoint[]=['race_result.after_accept_before_settlement',
      'settlement.after_ledger_posting_before_state_finalization',
      'race_result.after_settlement_before_result_completion',
      'race_result.after_completion_before_response']
    const identities=['8','9','A','B']
    for(let index=0;index<points.length;index+=1){
      const hex=identities[index]!,raceId=`race-${hex.repeat(8)}-${hex.repeat(4)}-4${hex.repeat(3)}-a${hex.repeat(3)}-${hex.repeat(12)}`
      const player=randomUUID(),prepared=await prepareRace(harness,clock,raceId,
        `N9-W3RC${hex}-E000${index+4}`,[{playerId:player,selectionId:'horse-1',stake:'10000000'}])
      faults.point=points[index]!
      expect((await postResult(harness,prepared.result,clock)).status).toBe(500)
      faults.point=null
      const retry=await postResult(harness,prepared.result,clock)
      expect([200,201]).toContain(retry.status)
      const integrity=await harness.database.query<{results:string;runs:string;captures:string}>(
        `select (select count(*) from authoritative_race_results where race_id=$1
          and settlement_status='completed')::text results,
         (select count(*) from settlement_runs where race_id=$1 and status='completed')::text runs,
         (select count(*) from financial_bets where race_id=$1 and status='settled_win')::text captures`,
      [raceId])
      expect(integrity.rows[0]).toEqual({results:'1',runs:'1',captures:'1'})
    }
  })

  it('reclaims a stale PostgreSQL lease after a process crash immediately after claim',async()=>{
    const clock=new MutableClock(new Date()),faults=new SelectableFaultInjector(),logger=new RecordingLogger()
    harness=await createRealPostgresTestApplication({wagerIntakeEnabled:true,raceLifecycleEnabled:true,
      raceResultEnabled:true,backendServiceAuthCredentials:credentials,clock,faultInjector:faults})
    const prepared=await prepareRace(harness,clock,'race-cccccccc-cccc-4ccc-accc-cccccccccccc',
      'N9-R4CMA-JM001',[{playerId:randomUUID(),selectionId:'horse-1',stake:'10000000'}])
    await acceptPending(harness,prepared.result,clock,faults)
    faults.point='race_result_recovery.after_claim'
    const crashed=recoveryWorker(harness,clock,logger,faults)
    await expect(crashed.runOnce()).rejects.toThrow('race_result_recovery.after_claim')
    const claimed=await harness.database.query<{settlement_status:string;settlement_lease_token:string|null}>(
      'select settlement_status,settlement_lease_token from authoritative_race_results where result_id=$1',
      [prepared.result.resultId])
    expect(claimed.rows[0]).toMatchObject({settlement_status:'running'})
    expect(claimed.rows[0]?.settlement_lease_token).toBeTruthy()
    faults.point=null
    clock.set(new Date(clock.now().getTime()+101))
    expect(await recoveryWorker(harness,clock,logger).runOnce()).toMatchObject({outcome:'completed'})
    expect(await resultIntegrity(harness,prepared.result)).toEqual({status:'completed',runs:'1',captures:'1',house:'1'})
  })

  it('converges after settlement ledger commit but before authoritative result completion',async()=>{
    const clock=new MutableClock(new Date()),faults=new SelectableFaultInjector(),logger=new RecordingLogger()
    harness=await createRealPostgresTestApplication({wagerIntakeEnabled:true,raceLifecycleEnabled:true,
      raceResultEnabled:true,backendServiceAuthCredentials:credentials,clock,faultInjector:faults})
    const prepared=await prepareRace(harness,clock,'race-dddddddd-dddd-4ddd-addd-dddddddddddd',
      'N9-R4GED-GER01',[{playerId:randomUUID(),selectionId:'horse-1',stake:'10000000'}])
    await acceptPending(harness,prepared.result,clock,faults)
    faults.point='race_result.after_settlement_before_result_completion'
    const worker=recoveryWorker(harness,clock,logger,faults)
    expect(await worker.runOnce()).toMatchObject({outcome:'retry_scheduled'})
    expect(await resultIntegrity(harness,prepared.result)).toEqual({status:'pending',runs:'1',captures:'1',house:'1'})
    faults.point=null
    clock.set(new Date(clock.now().getTime()+10))
    expect(await worker.runOnce()).toMatchObject({outcome:'completed'})
    expect(await resultIntegrity(harness,prepared.result)).toEqual({status:'completed',runs:'1',captures:'1',house:'1'})
  })

  it('allows only one concurrent recovery worker to settle a result',async()=>{
    const clock=new MutableClock(new Date()),faults=new SelectableFaultInjector(),logger=new RecordingLogger()
    harness=await createRealPostgresTestApplication({wagerIntakeEnabled:true,raceLifecycleEnabled:true,
      raceResultEnabled:true,backendServiceAuthCredentials:credentials,clock,faultInjector:faults})
    const prepared=await prepareRace(harness,clock,'race-eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee',
      'N9-R4CNN-CVR01',[{playerId:randomUUID(),selectionId:'horse-1',stake:'10000000'}])
    await acceptPending(harness,prepared.result,clock,faults)
    const outcomes=await Promise.all([recoveryWorker(harness,clock,logger).runOnce(),
      recoveryWorker(harness,clock,logger).runOnce()])
    expect(outcomes.filter(outcome=>outcome.outcome==='completed')).toHaveLength(1)
    expect(outcomes.filter(outcome=>outcome.outcome==='idle')).toHaveLength(1)
    expect(await resultIntegrity(harness,prepared.result)).toEqual({status:'completed',runs:'1',captures:'1',house:'1'})
  })

  it('replays duplicate Backend delivery after autonomous recovery without duplicate economics',async()=>{
    const clock=new MutableClock(new Date()),faults=new SelectableFaultInjector(),logger=new RecordingLogger()
    harness=await createRealPostgresTestApplication({wagerIntakeEnabled:true,raceLifecycleEnabled:true,
      raceResultEnabled:true,backendServiceAuthCredentials:credentials,clock,faultInjector:faults})
    const prepared=await prepareRace(harness,clock,'race-ffffffff-ffff-4fff-afff-ffffffffffff',
      'N9-R4DVP-MJC01',[{playerId:randomUUID(),selectionId:'horse-1',stake:'10000000'}])
    await acceptPending(harness,prepared.result,clock,faults)
    expect(await recoveryWorker(harness,clock,logger).runOnce()).toMatchObject({outcome:'completed'})
    const replay=await postResult(harness,prepared.result,clock)
    expect(replay.status).toBe(200);expect(replay.body.result).toBe('replayed')
    expect(await resultIntegrity(harness,prepared.result)).toEqual({status:'completed',runs:'1',captures:'1',house:'1'})
  })

  it('recovers at startup and periodically using only durable evidence while Backend is unavailable',async()=>{
    const clock=new MutableClock(new Date()),faults=new SelectableFaultInjector(),logger=new RecordingLogger()
    harness=await createRealPostgresTestApplication({wagerIntakeEnabled:true,raceLifecycleEnabled:true,
      raceResultEnabled:true,backendServiceAuthCredentials:credentials,clock,faultInjector:faults})
    const first=await prepareRace(harness,clock,'race-abababab-abab-4aba-abab-abababababab',
      'N9-R4STA-RT001',[{playerId:randomUUID(),selectionId:'horse-1',stake:'10000000'}])
    await acceptPending(harness,first.result,clock,faults)
    const worker=recoveryWorker(harness,clock,logger)
    await worker.start()
    expect((await resultIntegrity(harness,first.result)).status).toBe('completed')

    const second=await prepareRace(harness,clock,'race-acacacac-acac-4aca-acac-acacacacacac',
      'N9-R4PER-JQD01',[{playerId:randomUUID(),selectionId:'horse-1',stake:'10000000'}])
    await acceptPending(harness,second.result,clock,faults)
    const deadline=Date.now()+2_000
    while(Date.now()<deadline&&(await resultIntegrity(harness,second.result)).status!=='completed'){
      await new Promise(resolve=>setTimeout(resolve,20))
    }
    await worker.stop()
    expect(await resultIntegrity(harness,second.result)).toEqual({status:'completed',runs:'1',captures:'1',house:'1'})
    expect(worker.getSnapshot()).toMatchObject({completed:2})
  })

  it('bounds transient retries and emits durable operator escalation',async()=>{
    const clock=new MutableClock(new Date()),faults=new SelectableFaultInjector(),logger=new RecordingLogger()
    harness=await createRealPostgresTestApplication({wagerIntakeEnabled:true,raceLifecycleEnabled:true,
      raceResultEnabled:true,backendServiceAuthCredentials:credentials,clock,faultInjector:faults})
    const prepared=await prepareRace(harness,clock,'race-adadadad-adad-4ada-adad-adadadadadad',
      'N9-R4ESC-AKA01',[{playerId:randomUUID(),selectionId:'horse-1',stake:'10000000'}])
    await acceptPending(harness,prepared.result,clock,faults)
    faults.point='race_result.after_accept_before_settlement'
    const worker=recoveryWorker(harness,clock,logger,faults,{maxAttempts:1})
    expect(await worker.runOnce()).toMatchObject({outcome:'escalated'})
    const row=await harness.database.query<{settlement_status:string;settlement_last_error_code:string;
      settlement_escalated_at:Date|null}>('select settlement_status,settlement_last_error_code,settlement_escalated_at from authoritative_race_results where result_id=$1',
    [prepared.result.resultId])
    expect(row.rows[0]).toMatchObject({settlement_status:'manual_review',
      settlement_last_error_code:'RACE_RESULT_RECOVERY_ATTEMPTS_EXHAUSTED'})
    expect(row.rows[0]?.settlement_escalated_at).not.toBeNull()
    expect(logger.entries.some(entry=>entry.level==='error'&&entry.message.includes('operator review'))).toBe(true)
  })
})
