import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { NINES_RACE_LIFECYCLE_PATH, raceLifecycleEvidenceHash,
  type NinesRaceLifecycleEventV1 } from '../../src/domains/race-lifecycle/dto/RaceLifecycleEvent.js'
import { hashCanonicalJson } from '../../src/shared/contracts/canonicalJson.js'
import { signServiceMessage } from '../../src/shared/security/ServiceMessageAuthentication.js'
import type { JsonValue } from '../../src/shared/types/Json.js'
import { createTestApplication, type TestApplicationHarness } from '../support/testApp.js'

interface LifecycleFixture { validOpen:NinesRaceLifecycleEventV1; validClose:NinesRaceLifecycleEventV1;
  replay:NinesRaceLifecycleEventV1; conflict:NinesRaceLifecycleEventV1 }
const fixture = JSON.parse(fs.readFileSync(path.resolve(process.cwd(),
  'contracts/nines-race-lifecycle-v1.fixtures.json'), 'utf8')) as LifecycleFixture
const secret = 'w2-backend-financial-test-secret-at-least-32-characters'
const keyId = 'backend-lifecycle-v1'
const credentials = { 'nines-back-end': { [keyId]: secret } }

function headers(body: NinesRaceLifecycleEventV1, requestId = randomUUID(),
  signatureOverride?: string) {
  const sentAt = new Date().toISOString()
  const contentHash = hashCanonicalJson(body as unknown as JsonValue)
  return { 'x-nines-service-id': 'nines-back-end', 'x-nines-key-id': keyId,
    'x-nines-request-id': requestId, 'x-nines-sent-at': sentAt,
    'x-nines-content-sha256': contentHash,
    'x-nines-signature': signatureOverride ?? signServiceMessage({ method: 'POST',
      path: NINES_RACE_LIFECYCLE_PATH, environment: 'test', serviceId: 'nines-back-end',
      keyId, requestId, sentAt, contentHash, secret }) }
}

function rehash(overrides: Partial<NinesRaceLifecycleEventV1>): NinesRaceLifecycleEventV1 {
  const { evidenceHash: _hash, ...base } = fixture.validOpen
  const evidence = { ...base, ...overrides }
  return { ...evidence, evidenceHash: raceLifecycleEvidenceHash(evidence) } as NinesRaceLifecycleEventV1
}

describe('authenticated race lifecycle projection', () => {
  let harness: TestApplicationHarness | undefined
  afterEach(async () => { await harness?.close(); harness = undefined })

  it('projects open, runners, policy, replay, close, and duplicate close', async () => {
    harness = await createTestApplication(undefined, { raceLifecycleEnabled: true,
      backendServiceAuthCredentials: credentials })
    const opened = await request(harness.app).post(NINES_RACE_LIFECYCLE_PATH)
      .set(headers(fixture.validOpen)).send(fixture.validOpen)
    expect(opened.status, JSON.stringify(opened.body)).toBe(201)
    expect(opened.body).toMatchObject({ result: 'projected', poolStatus: 'open',
      raceId: fixture.validOpen.raceId, raceRef: fixture.validOpen.raceRef })
    const replay = await request(harness.app).post(NINES_RACE_LIFECYCLE_PATH)
      .set(headers(fixture.replay)).send(fixture.replay)
    expect(replay.status).toBe(200)
    expect(replay.body.result).toBe('replayed')
    const projection = await harness.database.query<{
      race_ref:string;status:string;house_take_bps:number
    }>('select race_ref,status,house_take_bps from race_pools where race_id=$1',
    [fixture.validOpen.raceId])
    const selectionCount = await harness.database.query<{ count: number }>(
      'select count(*)::int count from race_pool_selections where race_id=$1',
      [fixture.validOpen.raceId])
    const evidenceCount = await harness.database.query<{ count: number }>(
      'select count(*)::int count from race_lifecycle_evidence where race_id=$1',
      [fixture.validOpen.raceId])
    expect(projection.rows[0]).toMatchObject({ race_ref: fixture.validOpen.raceRef,
      status: 'open', house_take_bps: 1000 })
    expect(selectionCount.rows[0]?.count).toBe(3)
    expect(evidenceCount.rows[0]?.count).toBe(1)
    const closed = await request(harness.app).post(NINES_RACE_LIFECYCLE_PATH)
      .set(headers(fixture.validClose)).send(fixture.validClose)
    expect(closed.status, JSON.stringify(closed.body)).toBe(201)
    expect(closed.body).toMatchObject({ result: 'projected', poolStatus: 'frozen' })
    const duplicate = await request(harness.app).post(NINES_RACE_LIFECYCLE_PATH)
      .set(headers(fixture.validClose)).send(fixture.validClose)
    expect(duplicate.status).toBe(200)
    expect(duplicate.body).toMatchObject({ result: 'replayed', poolStatus: 'frozen' })
  })

  it('rejects forged transport, malformed authority/evidence, conflict, stale, and close-before-open', async () => {
    harness = await createTestApplication(undefined, { raceLifecycleEnabled: true,
      backendServiceAuthCredentials: credentials })
    expect((await request(harness.app).post(NINES_RACE_LIFECYCLE_PATH)
      .set(headers(fixture.validOpen, randomUUID(), '0'.repeat(64))).send(fixture.validOpen)).status)
      .toBe(403)
    for (const malformed of [
      rehash({ issuer: 'forged' as never }), rehash({ audience: 'forged' as never }),
      rehash({ environment: 'production' }),
      { ...fixture.validOpen, evidenceHash: '0'.repeat(64) } as NinesRaceLifecycleEventV1,
    ]) {
      const response = await request(harness.app).post(NINES_RACE_LIFECYCLE_PATH)
        .set(headers(malformed)).send(malformed)
      expect([400, 403]).toContain(response.status)
    }
    const beforeOpen = await request(harness.app).post(NINES_RACE_LIFECYCLE_PATH)
      .set(headers(fixture.validClose)).send(fixture.validClose)
    expect(beforeOpen.status).toBe(409)
    expect(beforeOpen.body.error.code).toBe('RACE_LIFECYCLE_CLOSE_BEFORE_OPEN')
    await request(harness.app).post(NINES_RACE_LIFECYCLE_PATH)
      .set(headers(fixture.validOpen)).send(fixture.validOpen)
    const conflict = await request(harness.app).post(NINES_RACE_LIFECYCLE_PATH)
      .set(headers(fixture.conflict)).send(fixture.conflict)
    expect(conflict.status).toBe(409)
    expect(conflict.body.error.code).toBe('RACE_LIFECYCLE_IDENTITY_CONFLICT')
    await request(harness.app).post(NINES_RACE_LIFECYCLE_PATH)
      .set(headers(fixture.validClose)).send(fixture.validClose)
    const staleIdentity = rehash({ lifecycleEventId: randomUUID() })
    const stale = await request(harness.app).post(NINES_RACE_LIFECYCLE_PATH)
      .set(headers(staleIdentity)).send(staleIdentity)
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('RACE_LIFECYCLE_STALE_EVENT')
  })
})
