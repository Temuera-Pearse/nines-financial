import type { Database, DatabaseTransaction, QueryResultRow } from '../../../shared/db/Database.js'
import { AppError } from '../../../shared/types/AppError.js'
import type { JsonObject } from '../../../shared/types/Json.js'
import {
  NINES_RACE_LIFECYCLE_ACK_SCHEMA_VERSION,
  raceLifecyclePolicyHash,
  raceLifecycleSelectionSetHash,
  type NinesRaceLifecycleAckV1,
  type NinesRaceLifecycleEventV1,
} from '../dto/RaceLifecycleEvent.js'

interface EvidenceRow extends QueryResultRow {
  lifecycle_event_id: string
  evidence_hash: string
  event_type: NinesRaceLifecycleEventV1['eventType']
  lifecycle_sequence: number
  occurred_at: Date | string
}

interface PoolProjectionRow extends QueryResultRow {
  race_id: string
  race_ref: string | null
  status: string
  betting_opens_at: Date | string | null
  betting_closes_at: Date | string | null
  selection_set_hash: string | null
  economic_policy_hash: string | null
  last_lifecycle_sequence: number
  last_lifecycle_event_id: string | null
  last_lifecycle_evidence_hash: string | null
}

function iso(value: Date | string | null): string | null {
  return value === null ? null : (value instanceof Date ? value : new Date(value)).toISOString()
}

function conflict(code: string, message: string, details: JsonObject): AppError {
  return new AppError({ category: 'conflict', code, message, details })
}

export class RaceLifecycleProjectionService {
  constructor(private readonly database: Database) {}

  async ingest(event: NinesRaceLifecycleEventV1): Promise<NinesRaceLifecycleAckV1> {
    return this.database.tx(async (transaction) => {
      const replay = await this.findEvidence(event.lifecycleEventId, transaction)
      if (replay) {
        if (replay.evidence_hash !== event.evidenceHash) {
          throw conflict('RACE_LIFECYCLE_IDENTITY_CONFLICT',
            'Lifecycle event identity was reused with different evidence',
            { lifecycleEventId: event.lifecycleEventId })
        }
        const pool = await this.requirePool(event.raceId, transaction)
        return this.ack(event, pool.status === 'open' ? 'open' : 'frozen', 'replayed')
      }
      return event.eventType === 'nines_race_opened.v1'
        ? this.open(event, transaction)
        : this.close(event, transaction)
    })
  }

  private async open(event: NinesRaceLifecycleEventV1,
    transaction: DatabaseTransaction): Promise<NinesRaceLifecycleAckV1> {
    const existing = await this.findPool(event.raceId, transaction)
    if (existing) throw conflict(
      Number(existing.last_lifecycle_sequence) >= event.lifecycleSequence
        ? 'RACE_LIFECYCLE_STALE_EVENT' : 'RACE_LIFECYCLE_OPEN_CONFLICT',
      'The authoritative race identity already has a newer or conflicting Financial pool',
      { raceId: event.raceId, existingRaceRef: existing.race_ref, raceRef: event.raceRef,
        currentSequence: existing.last_lifecycle_sequence,
        receivedSequence: event.lifecycleSequence })
    const raceRefOwner = await transaction.query<{ race_id: string }>(
      'select race_id from race_pools where race_ref=$1 limit 1 for update', [event.raceRef])
    if (raceRefOwner.rows[0]) throw conflict('RACE_REF_IDENTITY_CONFLICT',
      'The public race reference is already bound to another economic race identity',
      { raceRef: event.raceRef, existingRaceId: raceRefOwner.rows[0].race_id })

    const policyHash = raceLifecyclePolicyHash(event.economicPolicy)
    const selectionSetHash = raceLifecycleSelectionSetHash(event.selections)
    await transaction.query(`insert into race_pools (
      race_id,currency,status,betting_opens_at,betting_closes_at,created_at,updated_at,frozen_at,
      race_ref,lifecycle_managed,open_lifecycle_event_id,open_evidence_hash,
      last_lifecycle_event_id,last_lifecycle_sequence,last_lifecycle_evidence_hash,
      selection_set_hash,economic_policy_hash,economic_policy_id,economic_policy_version,
      house_take_bps,carryover_policy_id,carryover_policy_version,
      settlement_allocation_policy_id,settlement_allocation_policy_version,
      rounding_policy_id,rounding_policy_version)
      values ($1,'NINES','open',$2,$3,$4,$4,null,$5,true,$6,$7,$6,1,$7,$8,$9,
      $10,$11,$12,$13,$14,$15,$16,$17,$18)`, [event.raceId, event.bettingOpensAt,
      event.bettingClosesAt, event.occurredAt, event.raceRef, event.lifecycleEventId,
      event.evidenceHash, selectionSetHash, policyHash, event.economicPolicy.policyId,
      event.economicPolicy.policyVersion, event.economicPolicy.houseTakeBps,
      event.economicPolicy.carryoverPolicyId, event.economicPolicy.carryoverPolicyVersion,
      event.economicPolicy.settlementAllocationPolicyId,
      event.economicPolicy.settlementAllocationPolicyVersion,
      event.economicPolicy.roundingPolicyId, event.economicPolicy.roundingPolicyVersion])
    for (const selection of event.selections) {
      await transaction.query(`insert into race_pool_selections
        (race_id,selection_id,currency,status,display_name,created_at,updated_at,
         authoritative_runner_id,source_lifecycle_event_id)
        values ($1,$2,'NINES','active',$3,$4,$4,$2,$5)`,
      [event.raceId, selection.selectionId, selection.displayName, event.occurredAt,
        event.lifecycleEventId])
    }
    await this.insertEvidence(event, transaction)
    return this.ack(event, 'open', 'projected')
  }

  private async close(event: NinesRaceLifecycleEventV1,
    transaction: DatabaseTransaction): Promise<NinesRaceLifecycleAckV1> {
    const pool = await this.findPool(event.raceId, transaction)
    if (!pool) throw conflict('RACE_LIFECYCLE_CLOSE_BEFORE_OPEN',
      'A race cannot close before its authenticated open projection', { raceId: event.raceId })
    if (Number(pool.last_lifecycle_sequence) >= event.lifecycleSequence) {
      throw conflict('RACE_LIFECYCLE_STALE_EVENT', 'Lifecycle event is older than the projected state',
        { raceId: event.raceId, currentSequence: pool.last_lifecycle_sequence,
          receivedSequence: event.lifecycleSequence })
    }
    if (Number(pool.last_lifecycle_sequence) + 1 !== event.lifecycleSequence) {
      throw conflict('RACE_LIFECYCLE_SEQUENCE_GAP', 'Lifecycle event sequence is not contiguous',
        { raceId: event.raceId, currentSequence: pool.last_lifecycle_sequence,
          receivedSequence: event.lifecycleSequence })
    }
    const mismatches = pool.race_ref !== event.raceRef ||
      iso(pool.betting_opens_at) !== event.bettingOpensAt ||
      iso(pool.betting_closes_at) !== event.bettingClosesAt ||
      pool.selection_set_hash !== raceLifecycleSelectionSetHash(event.selections) ||
      pool.economic_policy_hash !== raceLifecyclePolicyHash(event.economicPolicy)
    if (mismatches) throw conflict('RACE_LIFECYCLE_EVIDENCE_CONFLICT',
      'Race-close evidence conflicts with the immutable open projection',
      { raceId: event.raceId, lifecycleEventId: event.lifecycleEventId })
    if (pool.status !== 'open') throw conflict('RACE_LIFECYCLE_ILLEGAL_TRANSITION',
      'Only an open lifecycle-projected pool can be frozen', { raceId: event.raceId, status: pool.status })
    await this.insertEvidence(event, transaction)
    await transaction.query(`update race_pools set status='frozen', frozen_at=$2, updated_at=$2,
      last_lifecycle_event_id=$3,last_lifecycle_sequence=2,last_lifecycle_evidence_hash=$4
      where race_id=$1 and currency='NINES'`,
    [event.raceId, event.occurredAt, event.lifecycleEventId, event.evidenceHash])
    return this.ack(event, 'frozen', 'projected')
  }

  private async findEvidence(eventId: string, queryable: DatabaseTransaction): Promise<EvidenceRow | null> {
    const result = await queryable.query<EvidenceRow>(
      'select * from race_lifecycle_evidence where lifecycle_event_id=$1 limit 1', [eventId])
    return result.rows[0] ?? null
  }

  private async findPool(raceId: string, queryable: DatabaseTransaction): Promise<PoolProjectionRow | null> {
    const result = await queryable.query<PoolProjectionRow>(
      "select * from race_pools where race_id=$1 and currency='NINES' limit 1 for update", [raceId])
    return result.rows[0] ?? null
  }

  private async requirePool(raceId: string, queryable: DatabaseTransaction): Promise<PoolProjectionRow> {
    const pool = await this.findPool(raceId, queryable)
    if (!pool) throw conflict('RACE_LIFECYCLE_PROJECTION_MISSING',
      'Lifecycle evidence exists without its Financial pool projection', { raceId })
    return pool
  }

  private async insertEvidence(event: NinesRaceLifecycleEventV1,
    transaction: DatabaseTransaction): Promise<void> {
    await transaction.query(`insert into race_lifecycle_evidence
      (lifecycle_event_id,race_id,race_ref,event_type,lifecycle_sequence,evidence_hash,
       payload,occurred_at,received_at,correlation_id,causation_id)
      values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,current_timestamp,$9,$10)`,
    [event.lifecycleEventId, event.raceId, event.raceRef, event.eventType,
      event.lifecycleSequence, event.evidenceHash, JSON.stringify(event), event.occurredAt,
      event.correlationId, event.causationId])
  }

  private ack(event: NinesRaceLifecycleEventV1, poolStatus: 'open' | 'frozen',
    result: 'projected' | 'replayed'): NinesRaceLifecycleAckV1 {
    return { schemaVersion: NINES_RACE_LIFECYCLE_ACK_SCHEMA_VERSION,
      resultType: 'nines_race_lifecycle_ack', result, raceId: event.raceId,
      raceRef: event.raceRef, lifecycleEventId: event.lifecycleEventId,
      lifecycleSequence: event.lifecycleSequence, eventType: event.eventType,
      poolStatus, effectiveAt: event.occurredAt, correlationId: event.correlationId }
  }
}
