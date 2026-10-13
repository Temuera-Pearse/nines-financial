import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import {
  hashNinesIssuanceAuthorization,
  type NinesIssuanceAuthorizationV1,
} from '../../src/domains/issuance-authorizations/dto/NinesIssuanceAuthorization.js'
import { signServiceMessage } from '../../src/shared/security/ServiceMessageAuthentication.js'
import { createTestApplication, type TestApplicationHarness } from '../support/testApp.js'

const secret = 'stage4-financial-test-secret-at-least-32-characters'
const credentials = { 'nines-api': { 'development-hmac-v1': secret } }
const now = new Date('2026-04-22T12:00:00.000Z')
const path = '/internal/v1/nines-issuance-authorizations'

function authorization(): NinesIssuanceAuthorizationV1 {
  const id=randomUUID(); const fundingId=randomUUID(); const confirmationId=randomUUID()
  const completedId=randomUUID()
  return { schemaVersion:1,eventType:'nines_issuance_authorized',authorizationId:id,
    issuer:'nines-api',audience:'nines-financial',environment:'test',playerId:randomUUID(),
    funding:{intentId:fundingId,confirmationEventId:confirmationId,
      evidenceIdentity:`crypto-funding-confirmation:v1:${fundingId}:${confirmationId}`,
      requestHash:'a'.repeat(64),confirmationPayloadHash:'b'.repeat(64),provider:'fake',
      paymentReference:`payment-${randomUUID()}`},valuation:{workflowId:randomUUID(),
      completedValuationId:completedId,completionKey:`funding-nzd-valuation:v1:test:${fundingId}`,
      evidenceFingerprint:'c'.repeat(64),valuedAt:'2026-04-22T11:58:00.000Z',
      profileVersion:'funding-nzd-valuation-profile-v1',finalNzdAmount:'123.45',
      finalNzdMinorUnits:'12345',calculationPolicyVersion:'nzd-valuation-calculation-v1',
      roundingPolicyVersion:'nzd-valuation-rounding-v1'},issuance:{
      policyVersion:'nzd-valuation-to-nines-par-v1',currency:'NINES',scale:6,
      minorUnits:'123450000'},authorizedAt:'2026-04-22T11:59:00.000Z',
    correlationId:`corr-${id}`,causationId:completedId }
}

function headers(body: NinesIssuanceAuthorizationV1, requestId=randomUUID(),
  overrides: { signature?: string; path?: string; environment?: string } = {}) {
  const sentAt=new Date().toISOString(); const contentHash=hashNinesIssuanceAuthorization(body)
  const keyId='development-hmac-v1'; const serviceId='nines-api'
  return {'x-nines-service-id':serviceId,'x-nines-key-id':keyId,
    'x-nines-request-id':requestId,'x-nines-sent-at':sentAt,
    'x-nines-content-sha256':contentHash,'x-nines-signature':overrides.signature ??
      signServiceMessage({method:'POST',path:overrides.path ?? path,
        environment:overrides.environment ?? 'test',serviceId,keyId,requestId,sentAt,
        contentHash,secret})}
}

describe('authenticated NINES issuance authorization boundary', () => {
  let harness: TestApplicationHarness | undefined
  afterEach(async()=>{await harness?.close();harness=undefined})

  it('authenticates, consumes, and returns deterministic already-consumed acknowledgement', async()=>{
    harness=await createTestApplication(now)
    const app=createApp({...harness.container.services,...harness.container.handlers},{
      database:harness.database,environment:'test',fundingAttestationsEnabled:true,
      serviceAuthCredentials:credentials})
    const body=authorization()
    const accepted=await request(app).post(path).set(headers(body)).send(body)
    expect(accepted.status,JSON.stringify(accepted.body)).toBe(201)
    expect(accepted.body).toMatchObject({authorizationId:body.authorizationId,
      authorizationPayloadHash:hashNinesIssuanceAuthorization(body),playerId:body.playerId,
      issuance:{currency:'NINES',scale:6,minorUnits:'123450000'},result:'accepted'})
    const replay=await request(app).post(path).set(headers(body)).send(body)
    expect(replay.status).toBe(200)
    expect(replay.body).toMatchObject({result:'already_consumed',
      financialConsumptionId:accepted.body.financialConsumptionId,
      ledgerTransactionId:accepted.body.ledgerTransactionId})
  })

  it('rejects transport tampering and unsupported contract evidence without ledger effects', async()=>{
    harness=await createTestApplication(now)
    const app=createApp({...harness.container.services,...harness.container.handlers},{
      database:harness.database,environment:'test',fundingAttestationsEnabled:true,
      serviceAuthCredentials:credentials})
    const body=authorization()
    expect((await request(app).post(path).set(headers(body,randomUUID(),
      {signature:'0'.repeat(64)})).send(body)).status).toBe(403)
    const unsupported={...body,issuance:{...body.issuance,policyVersion:'other-policy'}}
    const response=await request(app).post(path)
      .set(headers(unsupported as NinesIssuanceAuthorizationV1)).send(unsupported)
    expect(response.status).toBe(400)
    const ledger=await harness.database.query<{count:number}>(
      `SELECT COUNT(*)::int count FROM ledger_transactions WHERE reference_id=$1`,[body.authorizationId])
    expect(ledger.rows[0]?.count).toBe(0)
  })
})
