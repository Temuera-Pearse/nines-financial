import { randomUUID } from 'node:crypto'

import type { Database, QueryResultRow } from '../../../shared/db/Database.js'
import type { FaultInjector } from '../../../shared/faults/FaultInjector.js'
import { NoopFaultInjector } from '../../../shared/faults/FaultInjector.js'
import type { Logger } from '../../../shared/observability/logger.js'
import { SystemClock, type Clock } from '../../../shared/time/Clock.js'
import { AppError } from '../../../shared/types/AppError.js'
import {
  ninesRaceResultV1Schema,
  raceResultEvidenceHash,
  type NinesRaceResultV1,
} from '../dto/NinesRaceResult.js'
import type { RaceResultSettlementService } from './RaceResultSettlementService.js'

interface RecoveryRow extends QueryResultRow {
  result_id: string
  race_id: string
  evidence_hash: string
  payload: unknown
  settlement_attempt_count: number
  settlement_lease_token: string
}

interface EscalatedRow extends QueryResultRow {
  result_id: string
  race_id: string
  settlement_attempt_count: number
}

export interface RaceResultRecoveryOptions {
  pollIntervalMs: number
  leaseMs: number
  maxAttempts: number
  batchSize?: number
  baseRetryMs?: number
  maxRetryMs?: number
  clock?: Clock
  faultInjector?: FaultInjector
}

export interface RaceResultRecoverySnapshot {
  claimed: number
  completed: number
  retried: number
  escalated: number
  leaseLost: number
  lastRunAt: string | null
}

export type RaceResultRecoveryOutcome =
  | { outcome: 'idle' }
  | { outcome: 'completed' | 'retry_scheduled' | 'escalated' | 'lease_lost'; resultId: string }

type SettlementRecoveryPort = Pick<RaceResultSettlementService, 'recoverClaimed'>

type FailureClassification = { kind: 'transient' | 'immutable'; code: string; message: string }

function failureText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.slice(0, 2_000)
}

export function classifyRaceResultRecoveryFailure(error: unknown): FailureClassification {
  if (error instanceof AppError) return {
    kind: error.retryable ? 'transient' : 'immutable',
    code: error.code,
    message: failureText(error),
  }
  const databaseCode = typeof error === 'object' && error !== null && 'code' in error &&
    typeof error.code === 'string' ? error.code : null
  if (databaseCode && ['23502','23503','23505','23514','22P02'].includes(databaseCode)) return {
    kind: 'immutable', code: `POSTGRES_${databaseCode}`, message: failureText(error),
  }
  return { kind: 'transient', code: databaseCode ? `POSTGRES_${databaseCode}` : 'UNEXPECTED_ERROR',
    message: failureText(error) }
}

export class RaceResultRecoveryWorker {
  private readonly clock: Clock
  private readonly faultInjector: FaultInjector
  private readonly batchSize: number
  private readonly baseRetryMs: number
  private readonly maxRetryMs: number
  private interval: NodeJS.Timeout | null = null
  private tickInFlight: Promise<void> | null = null
  private started = false
  private snapshot: RaceResultRecoverySnapshot = {
    claimed: 0, completed: 0, retried: 0, escalated: 0, leaseLost: 0, lastRunAt: null,
  }

  constructor(
    private readonly database: Database,
    private readonly settlementService: SettlementRecoveryPort,
    private readonly logger: Logger,
    private readonly options: RaceResultRecoveryOptions,
  ) {
    for (const [name,value] of Object.entries({
      pollIntervalMs: options.pollIntervalMs,
      leaseMs: options.leaseMs,
      maxAttempts: options.maxAttempts,
      batchSize: options.batchSize ?? 25,
      baseRetryMs: options.baseRetryMs ?? 500,
      maxRetryMs: options.maxRetryMs ?? 60_000,
    })) {
      if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
    }
    this.clock = options.clock ?? new SystemClock()
    this.faultInjector = options.faultInjector ?? new NoopFaultInjector()
    this.batchSize = options.batchSize ?? 25
    this.baseRetryMs = options.baseRetryMs ?? 500
    this.maxRetryMs = options.maxRetryMs ?? 60_000
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    this.logger.info('authoritative result recovery starting', {
      leaseMs: this.options.leaseMs, maxAttempts: this.options.maxAttempts,
      pollIntervalMs: this.options.pollIntervalMs,
    })
    try {
      await this.drainAvailable()
    } catch (error) {
      this.started = false
      throw error
    }
    this.interval = setInterval(() => this.scheduleTick(), this.options.pollIntervalMs)
    this.interval.unref()
  }

  async stop(): Promise<void> {
    this.started = false
    if (this.interval) clearInterval(this.interval)
    this.interval = null
    await this.tickInFlight
  }

  getSnapshot(): RaceResultRecoverySnapshot {
    return { ...this.snapshot }
  }

  async drainAvailable(): Promise<number> {
    let processed = 0
    while (processed < this.batchSize) {
      const result = await this.runOnce()
      if (result.outcome === 'idle') break
      processed += 1
    }
    return processed
  }

  async runOnce(): Promise<RaceResultRecoveryOutcome> {
    const now = this.clock.now()
    this.snapshot.lastRunAt = now.toISOString()
    const escalated = await this.escalateExhausted(now)
    if (escalated) return { outcome: 'escalated', resultId: escalated.result_id }

    const claimed = await this.claimNext(now)
    if (!claimed) return { outcome: 'idle' }
    this.snapshot.claimed += 1
    this.logger.info('authoritative result recovery claimed', {
      resultId: claimed.result_id, raceId: claimed.race_id,
      attempt: Number(claimed.settlement_attempt_count),
    })

    // This point intentionally sits outside failure handling: a process crash
    // must leave the durable lease for a later worker to reclaim after expiry.
    await this.faultInjector.trigger('race_result_recovery.after_claim', {
      resultId: claimed.result_id, raceId: claimed.race_id,
      leaseToken: claimed.settlement_lease_token,
    })

    try {
      const event = this.parseEvidence(claimed)
      await this.settlementService.recoverClaimed(event, claimed.settlement_lease_token)
      this.snapshot.completed += 1
      this.logger.info('authoritative result recovery completed', {
        resultId: claimed.result_id, raceId: claimed.race_id,
        attempt: Number(claimed.settlement_attempt_count),
      })
      return { outcome: 'completed', resultId: claimed.result_id }
    } catch (error) {
      const classification = classifyRaceResultRecoveryFailure(error)
      if (classification.kind === 'immutable') {
        return this.escalateClaim(claimed, classification, now)
      }
      const settlementCommitted = await this.hasCompletedSettlement(claimed.result_id)
      if (Number(claimed.settlement_attempt_count) >= this.options.maxAttempts &&
          !settlementCommitted) {
        return this.escalateClaim(claimed, {
          ...classification,
          code: 'RACE_RESULT_RECOVERY_ATTEMPTS_EXHAUSTED',
        }, now)
      }
      return this.scheduleRetry(claimed, classification, now)
    }
  }

  private scheduleTick(): void {
    if (!this.started || this.tickInFlight) return
    this.tickInFlight = this.drainAvailable().then(() => undefined).catch((error: unknown) => {
      this.logger.error('authoritative result recovery tick failed', {
        error: failureText(error),
      })
    }).finally(() => { this.tickInFlight = null })
  }

  private parseEvidence(row: RecoveryRow): NinesRaceResultV1 {
    const parsed = ninesRaceResultV1Schema.safeParse(row.payload)
    if (!parsed.success) throw new AppError({ category: 'invariant_violation',
      code: 'RACE_RESULT_DURABLE_EVIDENCE_INVALID',
      message: 'Persisted authoritative result payload is invalid',
      details: { resultId: row.result_id, raceId: row.race_id } })
    const { evidenceHash: _evidenceHash, ...evidence } = parsed.data
    const computedHash = raceResultEvidenceHash(evidence)
    if (parsed.data.resultId !== row.result_id || parsed.data.raceId !== row.race_id ||
        parsed.data.evidenceHash !== row.evidence_hash || computedHash !== row.evidence_hash) {
      throw new AppError({ category: 'invariant_violation',
        code: 'RACE_RESULT_DURABLE_EVIDENCE_CONFLICT',
        message: 'Persisted authoritative result identity or checksum does not match its row',
        details: { resultId: row.result_id, raceId: row.race_id } })
    }
    return parsed.data
  }

  private async claimNext(now: Date): Promise<RecoveryRow | null> {
    const leaseToken = randomUUID()
    const result = await this.database.query<RecoveryRow>(`with candidate as (
      select result_id from authoritative_race_results r
      where ((r.settlement_status='pending' and r.settlement_next_attempt_at <= $1)
          or (r.settlement_status='running' and r.settlement_locked_at <
            $1::timestamptz - $2 * interval '1 millisecond'))
        and (r.settlement_attempt_count < $3 or exists (
          select 1 from settlement_runs s
          where s.idempotency_key='race-result:' || r.result_id::text and s.status='completed'))
      order by r.settlement_next_attempt_at,r.received_at,r.result_id
      for update skip locked limit 1
    )
    update authoritative_race_results r
    set settlement_status='running',settlement_attempt_count=r.settlement_attempt_count+1,
        settlement_locked_at=$1,settlement_lease_token=$4,updated_at=greatest(r.updated_at,$1)
    from candidate where r.result_id=candidate.result_id
    returning r.result_id,r.race_id,r.evidence_hash,r.payload,
      r.settlement_attempt_count,r.settlement_lease_token`,
    [now,this.options.leaseMs,this.options.maxAttempts,leaseToken])
    return result.rows[0] ?? null
  }

  private async escalateExhausted(now: Date): Promise<EscalatedRow | null> {
    const result = await this.database.query<EscalatedRow>(`with candidate as (
      select result_id from authoritative_race_results r
      where ((r.settlement_status='pending' and r.settlement_next_attempt_at <= $1)
          or (r.settlement_status='running' and r.settlement_locked_at <
            $1::timestamptz - $2 * interval '1 millisecond'))
        and r.settlement_attempt_count >= $3
        and not exists (select 1 from settlement_runs s
          where s.idempotency_key='race-result:' || r.result_id::text and s.status='completed')
      order by r.settlement_next_attempt_at,r.received_at,r.result_id
      for update skip locked limit 1
    )
    update authoritative_race_results r
    set settlement_status='manual_review',settlement_locked_at=null,
        settlement_lease_token=null,settlement_escalated_at=$1,
        settlement_last_error_code='RACE_RESULT_RECOVERY_ATTEMPTS_EXHAUSTED',
        settlement_last_error='Automatic settlement recovery attempts exhausted',
        settlement_last_error_at=$1,updated_at=greatest(r.updated_at,$1)
    from candidate where r.result_id=candidate.result_id
    returning r.result_id,r.race_id,r.settlement_attempt_count`,
    [now,this.options.leaseMs,this.options.maxAttempts])
    const row = result.rows[0]
    if (!row) return null
    this.snapshot.escalated += 1
    this.logger.error('authoritative result recovery escalated for operator review', {
      resultId: row.result_id, raceId: row.race_id,
      attempt: Number(row.settlement_attempt_count),
      errorCode: 'RACE_RESULT_RECOVERY_ATTEMPTS_EXHAUSTED',
    })
    return row
  }

  private async scheduleRetry(row: RecoveryRow, failure: FailureClassification,
    now: Date): Promise<RaceResultRecoveryOutcome> {
    const exponent = Math.max(0, Number(row.settlement_attempt_count) - 1)
    const delayMs = Math.min(this.maxRetryMs, this.baseRetryMs * (2 ** Math.min(exponent, 20)))
    const nextAttemptAt = new Date(now.getTime() + delayMs)
    const updated = await this.database.query(`update authoritative_race_results
      set settlement_status='pending',settlement_locked_at=null,settlement_lease_token=null,
          settlement_next_attempt_at=$3,settlement_last_error_code=$4,
          settlement_last_error=$5,settlement_last_error_at=$6,updated_at=greatest(updated_at,$6)
      where result_id=$1 and settlement_status='running' and settlement_lease_token=$2`,
    [row.result_id,row.settlement_lease_token,nextAttemptAt,failure.code,failure.message,now])
    if (updated.rowCount !== 1) return this.reportLeaseLost(row)
    this.snapshot.retried += 1
    this.logger.warn('authoritative result recovery scheduled retry', {
      resultId: row.result_id, raceId: row.race_id,
      attempt: Number(row.settlement_attempt_count), nextAttemptAt: nextAttemptAt.toISOString(),
      errorCode: failure.code, error: failure.message,
    })
    return { outcome: 'retry_scheduled', resultId: row.result_id }
  }

  private async escalateClaim(row: RecoveryRow, failure: FailureClassification,
    now: Date): Promise<RaceResultRecoveryOutcome> {
    const updated = await this.database.query(`update authoritative_race_results
      set settlement_status='manual_review',settlement_locked_at=null,settlement_lease_token=null,
          settlement_escalated_at=$3,settlement_last_error_code=$4,
          settlement_last_error=$5,settlement_last_error_at=$3,updated_at=greatest(updated_at,$3)
      where result_id=$1 and settlement_status='running' and settlement_lease_token=$2`,
    [row.result_id,row.settlement_lease_token,now,failure.code,failure.message])
    if (updated.rowCount !== 1) return this.reportLeaseLost(row)
    this.snapshot.escalated += 1
    this.logger.error('authoritative result recovery escalated for operator review', {
      resultId: row.result_id, raceId: row.race_id,
      attempt: Number(row.settlement_attempt_count), errorCode: failure.code,
      error: failure.message,
    })
    return { outcome: 'escalated', resultId: row.result_id }
  }

  private reportLeaseLost(row: RecoveryRow): RaceResultRecoveryOutcome {
    this.snapshot.leaseLost += 1
    this.logger.warn('authoritative result recovery lease lost', {
      resultId: row.result_id, raceId: row.race_id,
      attempt: Number(row.settlement_attempt_count),
    })
    return { outcome: 'lease_lost', resultId: row.result_id }
  }

  private async hasCompletedSettlement(resultId: string): Promise<boolean> {
    const result = await this.database.query(`select 1 from settlement_runs
      where idempotency_key=$1 and status='completed' limit 1`, [`race-result:${resultId}`])
    return result.rowCount === 1
  }
}
