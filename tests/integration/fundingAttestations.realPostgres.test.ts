import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ConfirmedFundingAttestationV1 } from '../../src/domains/funding-attestations/dto/ConfirmedFundingAttestation.js'
import { createRealPostgresTestApplication, realPostgresDrillsEnabled,
  type RealPostgresTestApplicationHarness } from '../support/realPostgresTestApp.js'
import { toIdempotencyKey } from '../../src/shared/idempotency/types.js'
import { toUserId } from '../../src/domains/account/types/identifiers.js'
import type { NinesIssuanceAuthorizationV1 } from '../../src/domains/issuance-authorizations/dto/NinesIssuanceAuthorization.js'

const suite = realPostgresDrillsEnabled() ? describe : describe.skip

function issuanceAuthorization(overrides: Partial<NinesIssuanceAuthorizationV1> = {}):
NinesIssuanceAuthorizationV1 {
  const authorizationId = randomUUID()
  const fundingIntentId = randomUUID()
  const confirmationEventId = randomUUID()
  const completedValuationId = randomUUID()
  return {
    schemaVersion: 1, eventType: 'nines_issuance_authorized', authorizationId,
    issuer: 'nines-api', audience: 'nines-financial', environment: 'test',
    playerId: randomUUID(),
    funding: { intentId: fundingIntentId, confirmationEventId,
      evidenceIdentity: `crypto-funding-confirmation:v1:${fundingIntentId}:${confirmationEventId}`,
      requestHash: 'a'.repeat(64), confirmationPayloadHash: 'b'.repeat(64),
      provider: 'fake', paymentReference: `payment-${randomUUID()}` },
    valuation: { workflowId: randomUUID(), completedValuationId,
      completionKey: `funding-nzd-valuation:v1:test:${fundingIntentId}`,
      evidenceFingerprint: 'c'.repeat(64), valuedAt: '2026-04-22T11:58:00.000Z',
      profileVersion: 'funding-nzd-valuation-profile-v1', finalNzdAmount: '123.45',
      finalNzdMinorUnits: '12345', calculationPolicyVersion: 'nzd-valuation-calculation-v1',
      roundingPolicyVersion: 'nzd-valuation-rounding-v1' },
    issuance: { policyVersion: 'nzd-valuation-to-nines-par-v1', currency: 'NINES',
      scale: 6, minorUnits: '123450000' },
    authorizedAt: '2026-04-22T11:59:00.000Z', correlationId: `corr-${authorizationId}`,
    causationId: completedValuationId,
    ...overrides,
  }
}

function requestContext() {
  return { serviceId: 'nines-api', requestId: randomUUID(),
    sentAt: new Date('2026-04-22T12:00:00.000Z'),
    receivedAt: new Date('2026-04-22T12:00:00.000Z') }
}

suite('NINES issuance real PostgreSQL proof', () => {
  let harness: RealPostgresTestApplicationHarness
  beforeAll(async () => { harness = await createRealPostgresTestApplication() }, 30_000)
  afterAll(async () => { await harness?.close() })

  it('serializes concurrent attestation retries to one immutable posting', async () => {
    const id = randomUUID()
    const playerId = randomUUID()
    const body: ConfirmedFundingAttestationV1 = { schemaVersion: 1,
      eventType: 'external_funding_confirmed', fundingAttestationId: id,
      issuer: 'nines-api', audience: 'nines-financial', environment: 'test',
      playerId, fundingIntentId: randomUUID(), provider: { name: 'fake',
        paymentReference: `payment-${randomUUID()}`, confirmationEventId: `event-${randomUUID()}` },
      externalPayment: { asset: 'USDC', atomicUnits: '9000001', scale: 6 },
      confirmedAt: '2026-04-22T11:59:00.000Z', issuedAt: '2026-04-22T11:59:00.000Z',
      automaticProcessingUntil: '2026-04-23T11:59:00.000Z',
      purchaseEligibility: { decisionId: randomUUID(), policyVersion: 'eligibility-v1',
        evaluatedAt: '2026-04-22T11:58:00.000Z' }, correlationId: `corr-${id}`, causationId: `cause-${id}` }
    await harness.container.services.playerAccountProvisioningService.provisionIfNeeded({
      idempotencyKey: toIdempotencyKey(`proof-${playerId}`), userId: toUserId(playerId),
      currency: 'NINES', correlationId: `corr-provision-${id}`, causationId: `cause-provision-${id}` })
    const results = await Promise.all(Array.from({ length: 10 }, () =>
      harness.container.services.fundingAttestationService.consume(body)))
    expect(results.filter((result) => result.outcome === 'accepted')).toHaveLength(1)
    expect(results.filter((result) => result.outcome === 'duplicate')).toHaveLength(9)
    expect(new Set(results.map((result) => result.ledgerTransactionId)).size).toBe(1)
    const counts = await harness.database.query<{ ledger_count: string; evidence_count: string }>(
      `SELECT (SELECT count(*) FROM ledger_transactions WHERE reference_id=$1::text) AS ledger_count,
        (SELECT count(*) FROM security_evidence_outbox WHERE funding_attestation_id=$1::uuid) AS evidence_count`, [id])
    expect(counts.rows[0]).toMatchObject({ ledger_count: '1', evidence_count: '1' })
    const transactionId = results[0]!.ledgerTransactionId!
    const entries = await harness.database.query<{ entry_id: string }>(
      `SELECT entry_id FROM ledger_entries WHERE transaction_id=$1 ORDER BY entry_id`,[transactionId])
    const transactionMutations = [
      [`UPDATE ledger_transactions SET transaction_type='manual_adjustment' WHERE transaction_id=$1`,[transactionId]],
      [`UPDATE ledger_transactions SET reference_id=$2 WHERE transaction_id=$1`,[transactionId,randomUUID()]],
      [`UPDATE ledger_transactions SET status='rejected' WHERE transaction_id=$1`,[transactionId]],
    ] as const
    for (const [sql,parameters] of transactionMutations) {
      await expect(harness.database.query(sql,[...parameters])).rejects.toThrow('append only')
    }
    const entryMutations = [
      [`UPDATE ledger_entries SET account_id=(SELECT account_id FROM ledger_entries WHERE transaction_id=$2 AND entry_id<>$1 LIMIT 1) WHERE entry_id=$1`,[entries.rows[0]!.entry_id,transactionId]],
      [`UPDATE ledger_entries SET currency='USDC' WHERE entry_id=$1`,[entries.rows[0]!.entry_id]],
      [`UPDATE ledger_entries SET direction=CASE direction WHEN 'debit' THEN 'credit' ELSE 'debit' END WHERE entry_id=$1`,[entries.rows[0]!.entry_id]],
      [`UPDATE ledger_entries SET amount_minor=amount_minor+1 WHERE entry_id=$1`,[entries.rows[0]!.entry_id]],
    ] as const
    for (const [sql,parameters] of entryMutations) {
      await expect(harness.database.query(sql,[...parameters])).rejects.toThrow('append only')
    }
    await expect(harness.database.query('DELETE FROM ledger_entries WHERE entry_id=$1',[entries.rows[0]!.entry_id]))
      .rejects.toThrow('append only')
    await expect(harness.database.query('DELETE FROM ledger_transactions WHERE transaction_id=$1',[transactionId]))
      .rejects.toThrow('append only')
    const preserved = await harness.database.query<{ entries: string; amount: string }>(
      `SELECT count(*) AS entries,min(amount_minor)::text AS amount FROM ledger_entries WHERE transaction_id=$1`,[transactionId])
    expect(preserved.rows[0]).toMatchObject({ entries: '2', amount: '9000001' })
    await expect(harness.database.query(`INSERT INTO ledger_transactions
      (transaction_id,transaction_type,reference_type,reference_id,status,
       correlation_id,causation_id,created_at)
      VALUES ($1,'token_purchase_issuance','funding_attestation',$2,'posted',$3,$4,NOW())`,
    [`txn_${randomUUID()}`, randomUUID(), 'corr-rogue', 'cause-rogue']))
      .rejects.toThrow('not exactly coupled')
  })

  it('rolls the ledger posting back if consumption persistence fails', async () => {
    const id = randomUUID(); const playerId = randomUUID()
    const body: ConfirmedFundingAttestationV1 = { schemaVersion: 1,
      eventType: 'external_funding_confirmed', fundingAttestationId: id,
      issuer: 'nines-api', audience: 'nines-financial', environment: 'test',
      playerId, fundingIntentId: randomUUID(), provider: { name: 'fake',
        paymentReference: `payment-${randomUUID()}`, confirmationEventId: `event-${randomUUID()}` },
      externalPayment: { asset: 'USDC', atomicUnits: '1000000', scale: 6 },
      confirmedAt: '2026-04-22T11:59:00.000Z', issuedAt: '2026-04-22T11:59:00.000Z',
      automaticProcessingUntil: '2026-04-23T11:59:00.000Z',
      purchaseEligibility: { decisionId: randomUUID(), policyVersion: 'eligibility-v1',
        evaluatedAt: '2026-04-22T11:58:00.000Z' }, correlationId: `corr-${id}`, causationId: `cause-${id}` }
    await harness.container.services.playerAccountProvisioningService.provisionIfNeeded({
      idempotencyKey: toIdempotencyKey(`rollback-${playerId}`), userId: toUserId(playerId),
      currency: 'NINES', correlationId: `corr-provision-${id}`, causationId: `cause-provision-${id}` })
    await harness.database.query(`ALTER TABLE funding_attestation_consumptions
      ADD CONSTRAINT proof_force_consumption_failure CHECK (outcome='review_required') NOT VALID`)
    try {
      await expect(harness.container.services.fundingAttestationService.consume(body)).rejects.toThrow()
    } finally {
      await harness.database.query(`ALTER TABLE funding_attestation_consumptions
        DROP CONSTRAINT proof_force_consumption_failure`)
    }
    const count = await harness.database.query<{ count: string }>(
      `SELECT count(*) FROM ledger_transactions WHERE reference_id=$1`, [id])
    expect(count.rows[0]?.count).toBe('0')
  })

  it('allows only one concurrent economic effect for one provider payment reference', async () => {
    const playerId=randomUUID(); const paymentReference=`payment-${randomUUID()}`
    await harness.container.services.playerAccountProvisioningService.provisionIfNeeded({
      idempotencyKey:toIdempotencyKey(`source-race-${playerId}`),userId:toUserId(playerId),currency:'NINES',
      correlationId:`corr-${playerId}`,causationId:`cause-${playerId}` })
    const bodies=Array.from({length:10},()=>({ schemaVersion:1 as const,
      eventType:'external_funding_confirmed' as const,fundingAttestationId:randomUUID(),
      issuer:'nines-api' as const,audience:'nines-financial' as const,environment:'test' as const,
      playerId,fundingIntentId:randomUUID(),provider:{name:'fake',paymentReference,
        confirmationEventId:`event-${randomUUID()}`},
      externalPayment:{asset:'USDC',atomicUnits:'1000000',scale:6},
      confirmedAt:'2026-04-22T11:59:00.000Z',issuedAt:'2026-04-22T11:59:00.000Z',
      automaticProcessingUntil:'2026-04-23T11:59:00.000Z',
      purchaseEligibility:{decisionId:randomUUID(),policyVersion:'eligibility-v1',
        evaluatedAt:'2026-04-22T11:58:00.000Z'},correlationId:`corr-${randomUUID()}`,
      causationId:`cause-${randomUUID()}` })) satisfies ConfirmedFundingAttestationV1[]
    const results=await Promise.allSettled(bodies.map((body)=>
      harness.container.services.fundingAttestationService.consume(body)))
    expect(results.filter((result)=>result.status==='fulfilled')).toHaveLength(1)
    expect(results.filter((result)=>result.status==='rejected')).toHaveLength(9)
    const effects=await harness.database.query<{ consumptions:string; ledgers:string }>(
      `SELECT count(*) AS consumptions,count(ledger_transaction_id) AS ledgers
       FROM funding_attestation_consumptions WHERE provider_name='fake' AND provider_payment_reference=$1`,
    [paymentReference])
    expect(effects.rows[0]).toMatchObject({consumptions:'1',ledgers:'1'})
  })

  it('rejects direct accepted rows that violate the locked v1 policy economics', async () => {
    await expect(harness.database.query(`INSERT INTO funding_attestation_consumptions
      (consumption_id,funding_attestation_id,attestation_payload_hash,issuer,environment,player_id,
       funding_intent_id,provider_name,provider_payment_reference,provider_confirmation_event_id,
       external_asset,external_atomic_units,external_scale,issuance_policy_version,issued_currency,
       issued_scale,issued_minor_units,ledger_transaction_id,outcome,reason_code,correlation_id,
       causation_id,attestation_payload,received_at,processed_at)
      VALUES ($1,$2,$3,'nines-api','test',$4,$5,'fake',$6,$7,'BTC',1000000,8,
       'usdc-to-nines-par-v1','NINES',6,999999,$8,'accepted',NULL,'corr','cause','{}'::jsonb,NOW(),NOW())`,
    [randomUUID(),randomUUID(),'a'.repeat(64),randomUUID(),randomUUID(),`payment-${randomUUID()}`,
      `event-${randomUUID()}`,`txn_${randomUUID()}`])).rejects.toThrow('funding_attestation_v1_policy_economics')
  })

  it('rolls replay nonce persistence back with a failed protected transaction', async () => {
    const id=randomUUID(); const playerId=randomUUID(); const requestId=randomUUID()
    const body:ConfirmedFundingAttestationV1={schemaVersion:1,eventType:'external_funding_confirmed',
      fundingAttestationId:id,issuer:'nines-api',audience:'nines-financial',environment:'test',
      playerId,fundingIntentId:randomUUID(),provider:{name:'fake',paymentReference:`payment-${randomUUID()}`,
        confirmationEventId:`event-${randomUUID()}`},externalPayment:{asset:'USDC',atomicUnits:'1000000',scale:6},
      confirmedAt:'2026-04-22T11:59:00.000Z',issuedAt:'2026-04-22T11:59:00.000Z',
      automaticProcessingUntil:'2026-04-23T11:59:00.000Z',purchaseEligibility:{decisionId:randomUUID(),
        policyVersion:'eligibility-v1',evaluatedAt:'2026-04-22T11:58:00.000Z'},
      correlationId:`corr-${id}`,causationId:`cause-${id}`}
    const requestContext={serviceId:'nines-api',requestId,
      sentAt:new Date('2026-04-22T12:00:00.000Z'),receivedAt:new Date('2026-04-22T12:00:00.000Z')}
    await harness.database.query(`ALTER TABLE funding_attestation_consumptions
      ADD CONSTRAINT proof_force_nonce_rollback CHECK (outcome='review_required') NOT VALID`)
    try {
      await expect(harness.container.services.fundingAttestationService.consume(body,requestContext)).rejects.toThrow()
      const rolledBack=await harness.database.query<{count:string}>(
        'SELECT count(*) FROM service_request_nonces WHERE request_id=$1',[requestId])
      expect(rolledBack.rows[0]?.count).toBe('0')
    } finally {
      await harness.database.query(`ALTER TABLE funding_attestation_consumptions
        DROP CONSTRAINT proof_force_nonce_rollback`)
    }
    await expect(harness.container.services.fundingAttestationService.consume(body,requestContext))
      .resolves.toMatchObject({outcome:'accepted'})
    const persisted=await harness.database.query<{count:string}>(
      'SELECT count(*) FROM service_request_nonces WHERE request_id=$1',[requestId])
    expect(persisted.rows[0]?.count).toBe('1')
  })

  it('consumes one valuation authorization into one exact clearing-to-player posting under concurrency', async () => {
    const body = issuanceAuthorization()
    const results = await Promise.all(Array.from({ length: 8 }, () =>
      harness.container.services.ninesIssuanceAuthorizationService.consume(body, requestContext())))
    expect(results.filter((result) => result.result === 'accepted')).toHaveLength(1)
    expect(results.filter((result) => result.result === 'already_consumed')).toHaveLength(7)
    expect(new Set(results.map((result) => result.financialConsumptionId)).size).toBe(1)
    expect(new Set(results.map((result) => result.ledgerTransactionId)).size).toBe(1)
    const evidence = await harness.database.query<{
      consumptions: string; transactions: string; entries: string; balance: string
    }>(`SELECT
      (SELECT COUNT(*) FROM nines_issuance_authorization_consumptions WHERE authorization_id=$1::uuid) consumptions,
      (SELECT COUNT(*) FROM ledger_transactions WHERE reference_type='issuance_authorization' AND reference_id=$1::text) transactions,
      (SELECT COUNT(*) FROM ledger_entries WHERE transaction_id=$2) entries,
      (SELECT balance_minor::TEXT FROM account_balances balance JOIN accounts account
       ON account.account_id=balance.account_id WHERE account.owner_type='user'
       AND account.owner_id=$3 AND account.account_type='user_available' AND account.currency='NINES') balance`,
    [body.authorizationId, results[0]!.ledgerTransactionId, body.playerId])
    expect(evidence.rows[0]).toEqual({ consumptions: '1', transactions: '1', entries: '2',
      balance: '123450000' })
    const posting = await harness.database.query<{ direction: string; account_type: string;
      owner_type: string; amount_minor: string }>(`SELECT entry.direction,account.account_type,
      account.owner_type,entry.amount_minor::TEXT FROM ledger_entries entry JOIN accounts account
      ON account.account_id=entry.account_id WHERE entry.transaction_id=$1 ORDER BY entry.direction`,
    [results[0]!.ledgerTransactionId])
    expect(posting.rows).toEqual([
      { direction: 'credit', account_type: 'user_available', owner_type: 'user', amount_minor: '123450000' },
      { direction: 'debit', account_type: 'token_purchase_clearing', owner_type: 'platform', amount_minor: '123450000' },
    ])
    await expect(harness.database.query(`UPDATE nines_issuance_authorization_consumptions
      SET issued_minor_units=1 WHERE authorization_id=$1`, [body.authorizationId]))
      .rejects.toThrow('immutable')
  })

  it('rejects conflicting replay and duplicate funding or completed valuation without another credit', async () => {
    const body = issuanceAuthorization()
    await harness.container.services.ninesIssuanceAuthorizationService.consume(body, requestContext())
    await expect(harness.container.services.ninesIssuanceAuthorizationService.consume({ ...body,
      correlationId: `${body.correlationId}-conflict` }, requestContext()))
      .rejects.toMatchObject({ code: 'ISSUANCE_AUTHORIZATION_PAYLOAD_CONFLICT' })
    const duplicateFunding = issuanceAuthorization({ funding: body.funding })
    await expect(harness.container.services.ninesIssuanceAuthorizationService.consume(
      duplicateFunding, requestContext())).rejects.toMatchObject({ code: 'ISSUANCE_FUNDING_ALREADY_CONSUMED' })
    const duplicateValuation = issuanceAuthorization({ valuation: body.valuation,
      causationId: body.valuation.completedValuationId })
    await expect(harness.container.services.ninesIssuanceAuthorizationService.consume(
      duplicateValuation, requestContext())).rejects.toMatchObject({ code: 'ISSUANCE_FUNDING_ALREADY_CONSUMED' })
    const count = await harness.database.query<{ count: string }>(
      `SELECT COUNT(*) FROM ledger_transactions WHERE reference_type='issuance_authorization'
       AND reference_id=$1`, [body.authorizationId])
    expect(count.rows[0]?.count).toBe('1')
  })

  it('rolls back ledger, balance, claim, nonce and evidence when consumption persistence fails', async () => {
    const body = issuanceAuthorization()
    const context = requestContext()
    await harness.database.query(`ALTER TABLE nines_issuance_authorization_consumptions
      ADD CONSTRAINT proof_force_authorization_consumption_failure CHECK (issued_minor_units=1) NOT VALID`)
    try {
      await expect(harness.container.services.ninesIssuanceAuthorizationService.consume(body, context))
        .rejects.toThrow()
    } finally {
      await harness.database.query(`ALTER TABLE nines_issuance_authorization_consumptions
        DROP CONSTRAINT proof_force_authorization_consumption_failure`)
    }
    const counts = await harness.database.query<{ ledger: string; consumption: string;
      claim: string; nonce: string; evidence: string }>(`SELECT
      (SELECT COUNT(*) FROM ledger_transactions WHERE reference_id=$1) ledger,
      (SELECT COUNT(*) FROM nines_issuance_authorization_consumptions WHERE authorization_id=$1::uuid) consumption,
      (SELECT COUNT(*) FROM funding_economic_consumption_claims WHERE source_id=$1::uuid) claim,
      (SELECT COUNT(*) FROM service_request_nonces WHERE request_id=$2) nonce,
      (SELECT COUNT(*) FROM security_evidence_outbox WHERE issuance_authorization_id=$1::uuid) evidence`,
    [body.authorizationId, context.requestId])
    expect(counts.rows[0]).toEqual({ ledger: '0', consumption: '0', claim: '0', nonce: '0', evidence: '0' })
  })
})
