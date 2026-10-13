import type { Database, DatabaseTransaction, QueryResultRow } from '../../../shared/db/Database.js'
import type {
  NinesIssuanceAcknowledgementV1,
  NinesIssuanceAuthorizationV1,
} from '../dto/NinesIssuanceAuthorization.js'

interface ConsumptionRow extends QueryResultRow {
  consumption_id: string
  authorization_id: string
  authorization_payload_hash: string
  ledger_transaction_id: string
  player_id: string
  issued_minor_units: string | number
  processed_at: Date | string
  correlation_id: string
}

function acknowledgement(row: ConsumptionRow, environment: NinesIssuanceAcknowledgementV1['environment'],
  duplicate: boolean): NinesIssuanceAcknowledgementV1 {
  return {
    schemaVersion: 1,
    eventType: 'nines_issuance_consumed',
    issuer: 'nines-financial',
    audience: 'nines-api',
    environment,
    authorizationId: row.authorization_id,
    authorizationPayloadHash: row.authorization_payload_hash,
    financialConsumptionId: row.consumption_id,
    ledgerTransactionId: row.ledger_transaction_id,
    playerId: row.player_id,
    issuance: { currency: 'NINES', scale: 6, minorUnits: String(row.issued_minor_units) },
    processedAt: new Date(row.processed_at).toISOString(),
    result: duplicate ? 'already_consumed' : 'accepted',
    correlationId: row.correlation_id,
    causationId: row.authorization_id,
  }
}

export class NinesIssuanceAuthorizationRepository {
  constructor(private readonly database: Database,
    private readonly environment: NinesIssuanceAcknowledgementV1['environment']) {}

  async lock(id: string, transaction: DatabaseTransaction): Promise<void> {
    await transaction.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`issuance:${id}`])
  }

  async find(id: string, transaction?: DatabaseTransaction): Promise<{
    hash: string; acknowledgement: NinesIssuanceAcknowledgementV1
  } | null> {
    const result = await (transaction ?? this.database).query<ConsumptionRow>(
      'SELECT * FROM nines_issuance_authorization_consumptions WHERE authorization_id=$1', [id])
    const row = result.rows[0]
    return row ? { hash: row.authorization_payload_hash,
      acknowledgement: acknowledgement(row, this.environment, true) } : null
  }

  async insert(input: { authorization: NinesIssuanceAuthorizationV1; hash: string;
    consumptionId: string; ledgerTransactionId: string; processedAt: Date },
  transaction: DatabaseTransaction): Promise<NinesIssuanceAcknowledgementV1> {
    const a = input.authorization
    const result = await transaction.query<ConsumptionRow>(`INSERT INTO
      nines_issuance_authorization_consumptions
      (consumption_id,authorization_id,authorization_payload_hash,schema_version,event_type,
       issuer,audience,environment,player_id,funding_intent_id,confirmation_event_id,
       funding_evidence_identity,funding_request_hash,confirmation_payload_hash,provider_name,
       provider_payment_reference,completed_valuation_id,valuation_completion_key,
       valuation_evidence_fingerprint,valued_at,final_nzd_amount,final_nzd_minor_units,
       valuation_profile_version,calculation_policy_version,rounding_policy_version,
       issuance_policy_version,issued_currency,issued_scale,issued_minor_units,authorized_at,
       correlation_id,causation_id,authorization_payload,ledger_transaction_id,processed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
       $21,$22::numeric,$23,$24,$25,$26,$27,$28,$29::numeric,$30,$31,$32,$33::jsonb,$34,$35)
      RETURNING *`, [input.consumptionId,a.authorizationId,input.hash,a.schemaVersion,a.eventType,
      a.issuer,a.audience,a.environment,a.playerId,a.funding.intentId,a.funding.confirmationEventId,
      a.funding.evidenceIdentity,a.funding.requestHash,a.funding.confirmationPayloadHash,
      a.funding.provider,a.funding.paymentReference,a.valuation.completedValuationId,
      a.valuation.completionKey,a.valuation.evidenceFingerprint,a.valuation.valuedAt,
      a.valuation.finalNzdAmount,a.valuation.finalNzdMinorUnits,a.valuation.profileVersion,
      a.valuation.calculationPolicyVersion,a.valuation.roundingPolicyVersion,
      a.issuance.policyVersion,a.issuance.currency,a.issuance.scale,a.issuance.minorUnits,
      a.authorizedAt,a.correlationId,a.causationId,JSON.stringify(a),input.ledgerTransactionId,
      input.processedAt])
    return acknowledgement(result.rows[0]!, this.environment, false)
  }
}
