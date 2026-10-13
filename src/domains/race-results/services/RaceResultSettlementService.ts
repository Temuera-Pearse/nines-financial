import { randomUUID } from 'node:crypto'

import type { Database, DatabaseTransaction, QueryResultRow } from '../../../shared/db/Database.js'
import type { FaultInjector } from '../../../shared/faults/FaultInjector.js'
import { SystemClock, type Clock } from '../../../shared/time/Clock.js'
import type { JsonObject } from '../../../shared/types/Json.js'
import { AppError } from '../../../shared/types/AppError.js'
import type { FinancialCommandService } from '../../financial-commands/services/FinancialCommandService.js'
import type { SettleBetResultDto } from '../../financial-commands/dto/financialCommandDtos.js'
import {
  NINES_RACE_RESULT_ACK_SCHEMA_VERSION,
  type NinesRaceResultAckV1,
  type NinesRaceResultV1,
} from '../dto/NinesRaceResult.js'

interface ResultRow extends QueryResultRow {
  result_id: string
  race_id: string
  race_ref: string
  evidence_hash: string
  settlement_status: 'pending' | 'running' | 'completed' | 'manual_review'
  settlement_lease_token: string | null
  settlement_run_id: string | null
  acknowledgement: NinesRaceResultAckV1 | null
}

interface PoolRow extends QueryResultRow {
  race_id: string
  race_ref: string | null
  status: string
  lifecycle_managed: boolean
  last_lifecycle_sequence: number
  last_lifecycle_event_id: string | null
  last_lifecycle_evidence_hash: string | null
  house_take_bps: number | null
  economic_policy_id: string | null
  economic_policy_version: number | null
  carryover_policy_id: string | null
  carryover_policy_version: number | null
  settlement_allocation_policy_id: string | null
  settlement_allocation_policy_version: number | null
  rounding_policy_id: string | null
  rounding_policy_version: number | null
}

function conflict(code: string, message: string, details: JsonObject,
  retryable = false): AppError {
  return new AppError({ category: 'conflict', code, message, details, retryable })
}

const settlementIdempotencyKey = (resultId: string) => `race-result:${resultId}`

export class RaceResultSettlementService {
  constructor(
    private readonly database: Database,
    private readonly financialCommandService: FinancialCommandService,
    private readonly faultInjector: FaultInjector,
    private readonly clock: Clock = new SystemClock(),
    private readonly leaseMs = 30_000,
  ) {
    if (!Number.isInteger(leaseMs) || leaseMs <= 0) {
      throw new Error('Race result settlement lease must be a positive integer')
    }
  }

  async ingest(event: NinesRaceResultV1): Promise<NinesRaceResultAckV1> {
    const accepted = await this.acceptOrReplay(event)
    if (accepted.row.settlement_status === 'completed') {
      return this.replayAck(accepted.row, event)
    }
    if (accepted.row.settlement_status === 'manual_review') {
      throw conflict('RACE_RESULT_SETTLEMENT_MANUAL_REVIEW',
        'Authoritative result settlement requires operator review',
        { raceId: event.raceId, resultId: event.resultId })
    }

    const leaseToken = await this.claimSettlement(event.resultId)
    if (!leaseToken) return this.waitForConcurrentSettlement(event)

    try {
      const ack = await this.settleClaimed(event, accepted.houseTakeBps, leaseToken,
        accepted.inserted ? 'settled' : 'replayed')
      await this.faultInjector.trigger('race_result.after_completion_before_response', {
        raceId: event.raceId, resultId: event.resultId,
        settlementRunId: ack.settlementRunId,
      })
      return ack
    } catch (error) {
      await this.releaseClaim(event.resultId, leaseToken).catch(() => {})
      throw error
    }
  }

  async recoverClaimed(event: NinesRaceResultV1, leaseToken: string): Promise<NinesRaceResultAckV1> {
    const accepted = await this.acceptOrReplay(event)
    if (accepted.row.settlement_status === 'completed') return this.replayAck(accepted.row, event)
    if (accepted.row.settlement_status === 'manual_review') throw conflict(
      'RACE_RESULT_SETTLEMENT_MANUAL_REVIEW',
      'Authoritative result settlement requires operator review',
      { raceId: event.raceId, resultId: event.resultId })
    if (accepted.row.settlement_status !== 'running' ||
        accepted.row.settlement_lease_token !== leaseToken) {
      throw conflict('RACE_RESULT_SETTLEMENT_LEASE_LOST',
        'Authoritative result settlement lease is no longer owned by this worker',
        { raceId: event.raceId, resultId: event.resultId }, true)
    }
    return this.settleClaimed(event, accepted.houseTakeBps, leaseToken, 'replayed')
  }

  private async settleClaimed(event: NinesRaceResultV1, houseTakeBps: number,
    leaseToken: string, result: 'settled' | 'replayed'): Promise<NinesRaceResultAckV1> {
    const recovered = await this.findCompletedSettlement(event.resultId)
    if (recovered) return this.completeResult(event, recovered, 'replayed', leaseToken)
    await this.faultInjector.trigger('race_result.after_accept_before_settlement', {
      raceId: event.raceId, resultId: event.resultId,
    })
    const settlement = await this.financialCommandService.settleBet({
      raceId: event.raceId,
      winningSelectionId: event.winningSelectionId,
      houseTakeBps,
      currency: 'NINES',
      idempotencyKey: settlementIdempotencyKey(event.resultId),
      correlationId: event.correlationId,
      causationId: event.resultId,
      authoritativeResultId: event.resultId,
    })
    await this.faultInjector.trigger('race_result.after_settlement_before_result_completion', {
      raceId: event.raceId, resultId: event.resultId,
      settlementRunId: settlement.settlementRunId,
    })
    return this.completeResult(event, settlement, result, leaseToken)
  }

  private async acceptOrReplay(event: NinesRaceResultV1): Promise<{
    row: ResultRow; houseTakeBps: number; inserted: boolean
  }> {
    return this.database.tx(async (transaction) => {
      // The W2 pool is the per-race serialization point. Lock it before looking
      // for result evidence so concurrent first deliveries cannot all observe
      // an absent result and race each other into the unique constraint.
      const pool = await this.requireValidPool(event, transaction, true)
      const byId = await this.findResultById(event.resultId, transaction, true)
      if (byId) {
        if (byId.evidence_hash !== event.evidenceHash) throw conflict(
          'RACE_RESULT_IDENTITY_CONFLICT', 'Result identity was reused with different evidence',
          { resultId: event.resultId })
        return { row: byId, houseTakeBps: this.requireSupportedPolicy(pool), inserted: false }
      }
      const byRace = await this.findResultByRace(event.raceId, transaction, true)
      if (byRace) throw conflict('RACE_RESULT_RACE_CONFLICT',
        'This race already has different authoritative result evidence',
        { raceId: event.raceId, existingResultId: byRace.result_id, resultId: event.resultId })
      if (pool.status !== 'frozen') throw conflict('RACE_RESULT_POOL_NOT_FROZEN',
        'New authoritative result evidence requires a W2-managed frozen pool',
        { raceId: event.raceId, status: pool.status,
          lifecycleSequence: pool.last_lifecycle_sequence })
      const houseTakeBps = this.requireSupportedPolicy(pool)
      await transaction.query(`insert into authoritative_race_results
        (result_id,race_id,currency,race_ref,result_version,event_type,environment,
         winning_runner_id,winning_selection_id,finish_order,race_checksum,
         close_lifecycle_event_id,close_lifecycle_evidence_hash,evidence_hash,payload,
         occurred_at,received_at,correlation_id,causation_id,settlement_status,
         settlement_attempt_count,created_at,updated_at)
        values ($1,$2,'NINES',$3,1,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13::jsonb,
                $14,current_timestamp,$15,$16,'pending',0,current_timestamp,current_timestamp)`,
      [event.resultId,event.raceId,event.raceRef,event.eventType,event.environment,
        event.winningRunnerId,event.winningSelectionId,JSON.stringify(event.finishOrder),
        event.raceChecksum,event.closeLifecycleEventId,event.closeLifecycleEvidenceHash,
        event.evidenceHash,JSON.stringify(event),event.completedAt,event.correlationId,event.causationId])
      const inserted = await this.findResultById(event.resultId, transaction, true)
      if (!inserted) throw new Error('Authoritative result insert did not return durable evidence')
      return { row: inserted, houseTakeBps, inserted: true }
    })
  }

  private async requireValidPool(event: NinesRaceResultV1,
    transaction: DatabaseTransaction, allowSettled = false): Promise<PoolRow> {
    const result = await transaction.query<PoolRow>(
      "select * from race_pools where race_id=$1 and currency='NINES' limit 1 for update",
      [event.raceId])
    const pool = result.rows[0]
    if (!pool) throw new AppError({ category: 'not_found', code: 'RACE_RESULT_POOL_NOT_FOUND',
      message: 'Authoritative result does not identify a known W2 race', details: { raceId: event.raceId } })
    if (!pool.lifecycle_managed) {
      throw conflict('RACE_RESULT_POOL_NOT_FROZEN',
        'Authoritative result requires a W2-managed pool at the frozen lifecycle state',
        { raceId: event.raceId, status: pool.status, lifecycleSequence: pool.last_lifecycle_sequence })
    }
    const validStatus = pool.status === 'frozen' || (allowSettled && pool.status === 'settled')
    if (!validStatus || Number(pool.last_lifecycle_sequence) !== 2) {
      const temporarilyUnfrozen = pool.status === 'open' &&
        Number(pool.last_lifecycle_sequence) < 2
      throw conflict('RACE_RESULT_POOL_NOT_FROZEN',
        'Authoritative result requires a W2-managed pool at the frozen lifecycle state',
        { raceId: event.raceId, status: pool.status,
          lifecycleSequence: pool.last_lifecycle_sequence }, temporarilyUnfrozen)
    }
    if (pool.race_ref !== event.raceRef || pool.last_lifecycle_event_id !== event.closeLifecycleEventId ||
        pool.last_lifecycle_evidence_hash !== event.closeLifecycleEvidenceHash) {
      throw conflict('RACE_RESULT_LIFECYCLE_CONFLICT',
        'Result does not match the immutable W2 race-close evidence', { raceId: event.raceId })
    }
    const close = await transaction.query(`select 1 from race_lifecycle_evidence
      where lifecycle_event_id=$1 and race_id=$2 and race_ref=$3
        and event_type='nines_race_betting_closed.v1' and lifecycle_sequence=2
        and evidence_hash=$4 limit 1`, [event.closeLifecycleEventId,event.raceId,event.raceRef,
      event.closeLifecycleEvidenceHash])
    if (close.rowCount !== 1) throw conflict('RACE_RESULT_CLOSE_EVIDENCE_MISSING',
      'Matching append-only race-close evidence was not found', { raceId: event.raceId })
    const selections = await transaction.query<{ selection_id: string; authoritative_runner_id: string | null;
      status: string }>(`select selection_id,authoritative_runner_id,status from race_pool_selections
      where race_id=$1 and currency='NINES' order by selection_id`, [event.raceId])
    const selected = selections.rows.find((row) => row.selection_id === event.winningSelectionId)
    if (!selected || selected.status !== 'active' ||
        selected.authoritative_runner_id !== event.winningRunnerId) {
      throw conflict('RACE_RESULT_UNKNOWN_WINNER',
        'Winning runner is not an active member of the immutable W2 selection snapshot',
        { raceId: event.raceId, winningRunnerId: event.winningRunnerId })
    }
    const projected = selections.rows.map((row) => row.selection_id).sort()
    const finished = [...event.finishOrder].sort()
    if (JSON.stringify(projected) !== JSON.stringify(finished)) throw conflict(
      'RACE_RESULT_FINISH_ORDER_CONFLICT',
      'Finish order does not exactly match the immutable W2 runner set', { raceId: event.raceId })
    return pool
  }

  private requireSupportedPolicy(pool: PoolRow): number {
    const supported = pool.economic_policy_id === 'nines-parimutuel.v1' &&
      Number(pool.economic_policy_version) === 1 &&
      pool.carryover_policy_id === 'nines-carryover.v1' &&
      Number(pool.carryover_policy_version) === 1 &&
      pool.settlement_allocation_policy_id === 'nines-proportional-allocation.v1' &&
      Number(pool.settlement_allocation_policy_version) === 1 &&
      pool.rounding_policy_id === 'nines-largest-remainder.v1' &&
      Number(pool.rounding_policy_version) === 1 &&
      Number.isInteger(Number(pool.house_take_bps))
    if (!supported) throw conflict('RACE_RESULT_UNSUPPORTED_FROZEN_POLICY',
      'The W2 frozen economic policy is not supported by this settlement implementation',
      { raceId: pool.race_id })
    return Number(pool.house_take_bps)
  }

  private async claimSettlement(resultId: string): Promise<string | null> {
    const now = this.clock.now()
    const leaseToken = randomUUID()
    const staleBefore = new Date(now.getTime() - this.leaseMs)
    const result = await this.database.query(`update authoritative_race_results
      set settlement_status='running',settlement_attempt_count=settlement_attempt_count+1,
          settlement_locked_at=$2,settlement_lease_token=$3,updated_at=greatest(updated_at,$2)
      where result_id=$1 and (settlement_status='pending' or
        (settlement_status='running' and settlement_locked_at < $4))
      returning result_id`, [resultId,now,leaseToken,staleBefore])
    return result.rowCount === 1 ? leaseToken : null
  }

  private async releaseClaim(resultId: string, leaseToken: string): Promise<void> {
    const now = this.clock.now()
    await this.database.query(`update authoritative_race_results
      set settlement_status='pending',settlement_locked_at=null,settlement_lease_token=null,
          settlement_next_attempt_at=$3,updated_at=greatest(updated_at,$3)
      where result_id=$1 and settlement_status='running' and settlement_lease_token=$2`,
    [resultId,leaseToken,now])
  }

  private async findCompletedSettlement(resultId: string): Promise<SettleBetResultDto | null> {
    const result = await this.database.query<{ result_snapshot: SettleBetResultDto }>(
      `select result_snapshot from settlement_runs where idempotency_key=$1
       and status='completed' limit 1`, [settlementIdempotencyKey(resultId)])
    return result.rows[0]?.result_snapshot ?? null
  }

  private async waitForConcurrentSettlement(event: NinesRaceResultV1): Promise<NinesRaceResultAckV1> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const row = await this.findResultById(event.resultId, this.database, false)
      if (row?.settlement_status === 'completed') return this.replayAck(row, event)
      await new Promise<void>((resolve) => setTimeout(resolve, 25))
    }
    throw new AppError({ category: 'conflict', code: 'RACE_RESULT_SETTLEMENT_IN_PROGRESS',
      message: 'An equivalent authoritative result settlement is still in progress',
      retryable: true, details: { raceId: event.raceId, resultId: event.resultId } })
  }

  private async completeResult(event: NinesRaceResultV1, settlement: SettleBetResultDto,
    result: 'settled' | 'replayed', leaseToken: string): Promise<NinesRaceResultAckV1> {
    const ack: NinesRaceResultAckV1 = {
      schemaVersion: NINES_RACE_RESULT_ACK_SCHEMA_VERSION,
      resultType: 'nines_race_result_ack', result,
      raceId: event.raceId, raceRef: event.raceRef, resultId: event.resultId,
      resultVersion: 1, settlementRunId: settlement.settlementRunId, poolStatus: 'settled',
      totalPoolMinor: settlement.totalPoolMinor,
      acceptedStakeMinor: settlement.acceptedStakeMinor,
      appliedCarryoverMinor: settlement.appliedCarryoverMinor,
      houseTakeMinor: settlement.houseTakeMinor, netPoolMinor: settlement.netPoolMinor,
      roundingResidualMinor: settlement.roundingResidualMinor,
      carryoverMinor: settlement.carryoverMinor, settledAt: settlement.settledAt,
      correlationId: event.correlationId,
    }
    return this.database.tx(async (transaction) => {
      const current = await this.findResultById(event.resultId, transaction, true)
      if (!current || current.evidence_hash !== event.evidenceHash) throw conflict(
        'RACE_RESULT_FINALIZATION_CONFLICT', 'Result evidence changed before settlement finalization',
        { resultId: event.resultId })
      if (current.settlement_status === 'completed') return this.replayAck(current, event)
      if (current.settlement_status !== 'running' ||
          current.settlement_lease_token !== leaseToken) throw conflict(
        'RACE_RESULT_SETTLEMENT_LEASE_LOST',
        'Authoritative result settlement lease was lost before finalization',
        { raceId: event.raceId, resultId: event.resultId }, true)
      const updated = await transaction.query(`update authoritative_race_results
        set settlement_status='completed',settlement_run_id=$2,settlement_locked_at=null,
            settlement_lease_token=null,settled_at=$3,acknowledgement=$4::jsonb,
            settlement_last_error_code=null,settlement_last_error=null,
            settlement_last_error_at=null,updated_at=greatest(updated_at,$6)
        where result_id=$1 and settlement_status='running' and settlement_lease_token=$5`,
      [event.resultId,settlement.settlementRunId,settlement.settledAt,
        JSON.stringify({ ...ack, result: 'settled' }),leaseToken,this.clock.now()])
      if (updated.rowCount !== 1) throw conflict('RACE_RESULT_SETTLEMENT_LEASE_LOST',
        'Authoritative result settlement lease was lost during finalization',
        { raceId: event.raceId, resultId: event.resultId }, true)
      return ack
    })
  }

  private replayAck(row: ResultRow, event: NinesRaceResultV1): NinesRaceResultAckV1 {
    if (!row.acknowledgement) throw conflict('RACE_RESULT_ACKNOWLEDGEMENT_MISSING',
      'Completed result is missing its durable settlement acknowledgement',
      { resultId: event.resultId })
    return { ...row.acknowledgement, result: 'replayed' }
  }

  private async findResultById(resultId: string, queryable: Database | DatabaseTransaction,
    forUpdate: boolean): Promise<ResultRow | null> {
    const result = await queryable.query<ResultRow>(`select * from authoritative_race_results
      where result_id=$1 limit 1${forUpdate ? ' for update' : ''}`, [resultId])
    return result.rows[0] ?? null
  }

  private async findResultByRace(raceId: string, queryable: DatabaseTransaction,
    forUpdate: boolean): Promise<ResultRow | null> {
    const result = await queryable.query<ResultRow>(`select * from authoritative_race_results
      where race_id=$1 and currency='NINES' limit 1${forUpdate ? ' for update' : ''}`, [raceId])
    return result.rows[0] ?? null
  }
}
