import type { Database, DatabaseTransaction, QueryResultRow } from '../../../shared/db/Database.js'
import type { FundingAttestationResponseDto } from '../dto/ConfirmedFundingAttestation.js'

interface ConsumptionRow extends QueryResultRow {
  consumption_id: string
  funding_attestation_id: string
  attestation_payload_hash: string
  outcome: 'accepted' | 'review_required'
  issuance_policy_version: string | null
  issued_currency: 'NINES' | null
  issued_minor_units: string | number | null
  ledger_transaction_id: string | null
  processed_at: Date | string
  reason_code: string | null
}

function response(row: ConsumptionRow, duplicate = false): FundingAttestationResponseDto {
  return {
    fundingAttestationId: row.funding_attestation_id,
    attestationPayloadHash: row.attestation_payload_hash,
    outcome: duplicate ? 'duplicate' : row.outcome,
    financialConsumptionId: row.consumption_id,
    issuancePolicyVersion: row.issuance_policy_version,
    issuedCurrency: row.issued_currency,
    issuedMinorUnits: row.issued_minor_units === null ? null : String(row.issued_minor_units),
    ledgerTransactionId: row.ledger_transaction_id,
    processedAt: new Date(row.processed_at).toISOString(),
    reasonCode: row.reason_code,
  }
}

export class FundingAttestationRepository {
  constructor(private readonly database: Database) {}

  async lock(attestationId: string, transaction: DatabaseTransaction): Promise<void> {
    await transaction.query('SELECT pg_advisory_xact_lock(hashtext($1))', [attestationId])
  }

  async find(attestationId: string, transaction?: DatabaseTransaction): Promise<{ hash: string; result: FundingAttestationResponseDto } | null> {
    const result = await (transaction ?? this.database).query<ConsumptionRow>(
      'SELECT * FROM funding_attestation_consumptions WHERE funding_attestation_id = $1',
      [attestationId],
    )
    const row = result.rows[0]
    return row ? { hash: row.attestation_payload_hash, result: response(row, true) } : null
  }

  async sourceExists(provider: string, paymentReference: string,
    transaction: DatabaseTransaction): Promise<boolean> {
    const result = await transaction.query(
      `SELECT 1 FROM funding_attestation_consumptions
       WHERE provider_name = $1 AND provider_payment_reference = $2`,
      [provider, paymentReference],
    )
    return result.rowCount > 0
  }

  async fundingIntentExists(fundingIntentId: string, transaction: DatabaseTransaction): Promise<boolean> {
    const result = await transaction.query(
      'SELECT 1 FROM funding_attestation_consumptions WHERE funding_intent_id=$1',
      [fundingIntentId],
    )
    return result.rowCount > 0
  }

  async insert(input: {
    consumptionId: string
    attestationId: string
    hash: string
    issuer: string
    environment: string
    playerId: string
    fundingIntentId: string
    provider: string
    paymentReference: string
    confirmationEventId: string
    atomicUnits: string
    outcome: 'accepted' | 'review_required'
    policyVersion: string | null
    issuedMinorUnits: string | null
    ledgerTransactionId: string | null
    reasonCode: string | null
    correlationId: string
    causationId: string
    payload: unknown
    now: Date
  }, transaction: DatabaseTransaction): Promise<FundingAttestationResponseDto> {
    const result = await transaction.query<ConsumptionRow>(
      `INSERT INTO funding_attestation_consumptions
       (consumption_id, funding_attestation_id, attestation_payload_hash, issuer,
        environment, player_id, funding_intent_id, provider_name,
        provider_payment_reference, provider_confirmation_event_id, external_asset,
        external_atomic_units, external_scale, issuance_policy_version, issued_currency,
        issued_scale, issued_minor_units, ledger_transaction_id, outcome, reason_code, correlation_id,
        causation_id, attestation_payload, received_at, processed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'USDC',$11,6,$12,
        CASE WHEN $13::text IS NULL THEN NULL ELSE 'NINES' END,
        CASE WHEN $13::text IS NULL THEN NULL ELSE 6 END,
        $13::numeric,$14,$15,$16,$17,$18,$19::jsonb,$20,$20)
       RETURNING *`,
      [input.consumptionId, input.attestationId, input.hash, input.issuer,
        input.environment, input.playerId, input.fundingIntentId, input.provider,
        input.paymentReference, input.confirmationEventId, input.atomicUnits,
        input.policyVersion, input.issuedMinorUnits, input.ledgerTransactionId,
        input.outcome, input.reasonCode, input.correlationId, input.causationId,
        JSON.stringify(input.payload), input.now],
    )
    return response(result.rows[0]!)
  }
}
