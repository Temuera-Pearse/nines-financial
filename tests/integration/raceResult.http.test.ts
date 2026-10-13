import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterEach,describe,expect,it } from 'vitest'

import { raceLifecycleEvidenceHash,type NinesRaceLifecycleEventV1 } from '../../src/domains/race-lifecycle/dto/RaceLifecycleEvent.js'
import { RaceLifecycleProjectionService } from '../../src/domains/race-lifecycle/services/RaceLifecycleProjectionService.js'
import { NINES_RACE_RESULT_PATH,raceResultEvidenceHash,
  type NinesRaceResultV1 } from '../../src/domains/race-results/dto/NinesRaceResult.js'
import { hashCanonicalJson } from '../../src/shared/contracts/canonicalJson.js'
import { signServiceMessage } from '../../src/shared/security/ServiceMessageAuthentication.js'
import type { JsonValue } from '../../src/shared/types/Json.js'
import { createTestApplication,type TestApplicationHarness } from '../support/testApp.js'

const secret='w3-http-backend-secret-at-least-32-characters',keyId='backend-result-v1'
const credentials={'nines-back-end':{[keyId]:secret}}
const lifecycleFixture=JSON.parse(fs.readFileSync(path.resolve(process.cwd(),
  'contracts/nines-race-lifecycle-v1.fixtures.json'),'utf8')) as Record<string,NinesRaceLifecycleEventV1>
const resultFixture=JSON.parse(fs.readFileSync(path.resolve(process.cwd(),
  'contracts/nines-race-result-v1.fixtures.json'),'utf8')) as Record<string,NinesRaceResultV1>
const now=new Date('2026-04-22T12:01:00.000Z')

function headers(body:JsonValue,overrides:Record<string,string>={}){
  const requestId=randomUUID(),sentAt=now.toISOString(),contentHash=hashCanonicalJson(body)
  return {'x-nines-service-id':'nines-back-end','x-nines-key-id':keyId,
    'x-nines-request-id':requestId,'x-nines-sent-at':sentAt,
    'x-nines-content-sha256':contentHash,
    'x-nines-signature':signServiceMessage({method:'POST',path:NINES_RACE_RESULT_PATH,
      environment:'test',serviceId:'nines-back-end',keyId,requestId,sentAt,contentHash,secret}),
    ...overrides}
}
function rehash(value:NinesRaceResultV1):NinesRaceResultV1{
  const {evidenceHash:_hash,...evidence}=value
  return {...evidence,evidenceHash:raceResultEvidenceHash(evidence)}
}

describe('authenticated authoritative race result HTTP boundary',()=>{
  let harness:TestApplicationHarness|undefined
  afterEach(async()=>{await harness?.close();harness=undefined})

  async function setup(close=true){
    harness=await createTestApplication(now,{raceResultEnabled:true,
      backendServiceAuthCredentials:credentials,boundaryClock:()=>new Date(now)})
    const lifecycle=new RaceLifecycleProjectionService(harness.database)
    await lifecycle.ingest(lifecycleFixture.validOpen!)
    if(close)await lifecycle.ingest(lifecycleFixture.validClose!)
  }

  it('settles a valid result, durably replays it, and rejects identity conflict',async()=>{
    await setup()
    const valid=resultFixture.validResult!
    const first=await request(harness!.app).post(NINES_RACE_RESULT_PATH)
      .set(headers(valid as unknown as JsonValue)).send(valid)
    expect(first.status,JSON.stringify(first.body)).toBe(201)
    expect(first.body).toMatchObject({result:'settled',raceId:valid.raceId,
      resultId:valid.resultId,poolStatus:'settled',totalPoolMinor:'0'})
    const replay=await request(harness!.app).post(NINES_RACE_RESULT_PATH)
      .set(headers(valid as unknown as JsonValue)).send(valid)
    expect(replay.status).toBe(200)
    expect(replay.body).toMatchObject({result:'replayed',settlementRunId:first.body.settlementRunId})
    const conflict=resultFixture.conflict!
    const rejected=await request(harness!.app).post(NINES_RACE_RESULT_PATH)
      .set(headers(conflict as unknown as JsonValue)).send(conflict)
    expect(rejected.status).toBe(409)
    expect(rejected.body.error.code).toBe('RACE_RESULT_IDENTITY_CONFLICT')
  })

  it('rejects forged transport, malformed authority/environment/hash, and caller policy',async()=>{
    await setup()
    const valid=resultFixture.validResult!
    const forged=await request(harness!.app).post(NINES_RACE_RESULT_PATH)
      .set(headers(valid as unknown as JsonValue,{'x-nines-signature':'0'.repeat(64)})).send(valid)
    expect(forged.status).toBe(403)
    const wrongIssuer={...valid,issuer:'other'}
    expect((await request(harness!.app).post(NINES_RACE_RESULT_PATH)
      .set(headers(wrongIssuer as unknown as JsonValue)).send(wrongIssuer)).status).toBe(400)
    const wrongAudience={...valid,audience:'other'}
    expect((await request(harness!.app).post(NINES_RACE_RESULT_PATH)
      .set(headers(wrongAudience as unknown as JsonValue)).send(wrongAudience)).status).toBe(400)
    const wrongEnvironment=rehash({...valid,environment:'production'})
    expect((await request(harness!.app).post(NINES_RACE_RESULT_PATH)
      .set(headers(wrongEnvironment as unknown as JsonValue)).send(wrongEnvironment)).status).toBe(403)
    const badHash={...valid,evidenceHash:'f'.repeat(64)}
    expect((await request(harness!.app).post(NINES_RACE_RESULT_PATH)
      .set(headers(badHash as unknown as JsonValue)).send(badHash)).status).toBe(400)
    const callerPolicy={...valid,houseTakeBps:0}
    expect((await request(harness!.app).post(NINES_RACE_RESULT_PATH)
      .set(headers(callerPolicy as unknown as JsonValue)).send(callerPolicy)).status).toBe(400)
  })

  it('fails closed for unknown/non-frozen races, unknown winners, and stale versions',async()=>{
    await setup(false)
    const valid=resultFixture.validResult!
    const early=await request(harness!.app).post(NINES_RACE_RESULT_PATH)
      .set(headers(valid as unknown as JsonValue)).send(valid)
    expect(early.body.error).toMatchObject({code:'RACE_RESULT_POOL_NOT_FROZEN',retryable:true})
    await new RaceLifecycleProjectionService(harness!.database).ingest(lifecycleFixture.validClose!)
    const unknownWinner=rehash({...valid,winningRunnerId:'horse-9',winningSelectionId:'horse-9',
      finishOrder:['horse-9','horse-2','horse-3']})
    expect((await request(harness!.app).post(NINES_RACE_RESULT_PATH)
      .set(headers(unknownWinner as unknown as JsonValue)).send(unknownWinner)).body.error.code)
      .toBe('RACE_RESULT_UNKNOWN_WINNER')
    const unknownRace=rehash({...valid,raceId:'race-99999999-9999-4999-a999-999999999999',
      resultId:randomUUID()})
    expect((await request(harness!.app).post(NINES_RACE_RESULT_PATH)
      .set(headers(unknownRace as unknown as JsonValue)).send(unknownRace)).status).toBe(404)
    const stale={...valid,resultVersion:0}
    expect((await request(harness!.app).post(NINES_RACE_RESULT_PATH)
      .set(headers(stale as unknown as JsonValue)).send(stale)).status).toBe(400)
    const afterClose=await request(harness!.app).post(NINES_RACE_RESULT_PATH)
      .set(headers(valid as unknown as JsonValue)).send(valid)
    expect(afterClose.status).toBe(201)
    expect(afterClose.body).toMatchObject({result:'settled',poolStatus:'settled'})
  })
})
