import { AppError } from '../../../../shared/types/AppError.js'
import type {
  Database,
  DatabaseTransaction,
  Queryable,
  QueryResultRow,
} from '../../../../shared/db/Database.js'
import type {
  FinancialBetDto,
  PoolSelectionDto,
  PoolTotalDto,
  RacePoolDto,
  SelectionTotalDto,
} from '../../dto/bettingDtos.js'
import type {
  BettingRepository,
  CreateBetRecord,
  CreatePoolSelectionRecord,
  CreateRacePoolRecord,
  CreateCarryoverApplicationRecord,
  CreateSettlementCarryoverRecord,
  CreateSettlementRemediationActionRecord,
  CreateSettlementReconciliationRunRecord,
  CreateSettlementRunRecord,
  CarryoverApplicationRecord,
  SettlementManualReviewItemRecord,
  SettlementCarryoverRecord,
  SettlementRemediationActionRecord,
  SettlementReconciliationIssueRecord,
  SettlementReconciliationRunSummaryRecord,
  SettlementRunRecord,
  UpdateSettlementRunRecord,
} from '../BettingRepository.js'
import type { JsonObject } from '../../../../shared/types/Json.js'

interface RacePoolRow extends QueryResultRow {
  race_id: string
  currency: 'USDC'
  status: RacePoolDto['status']
  betting_opens_at: Date | string | null
  betting_closes_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
  frozen_at: Date | string | null
}

interface PoolSelectionRow extends QueryResultRow {
  race_id: string
  selection_id: string
  currency: 'USDC'
  status: 'active' | 'inactive'
  display_name: string | null
  created_at: Date | string
  updated_at: Date | string
}

interface BetRow extends QueryResultRow {
  bet_id: string
  user_id: string
  race_id: string
  selection_id: string
  stake_minor: string | number
  currency: 'USDC'
  status: FinancialBetDto['status']
  rejection_code: string | null
  rejection_reason: string | null
  reservation_transaction_id: string | null
  accepted_at: Date | string | null
  rejected_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}

interface SettlementRunRow extends QueryResultRow {
  settlement_run_id: string
  race_id: string
  currency: 'USDC'
  status: SettlementRunRecord['status']
  winning_selection_id: string
  house_take_bps: number
  idempotency_key: string
  command_fingerprint: string
  total_pool_minor: string | number
  house_take_minor: string | number
  net_pool_minor: string | number
  rounding_residual_minor: string | number
  carryover_minor: string | number
  reason_code: string | null
  error_code: string | null
  error_message: string | null
  result_snapshot: JsonObject | string | null
  started_at: Date | string | null
  completed_at: Date | string | null
  failed_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}

interface SettlementCarryoverRow extends QueryResultRow {
  carryover_id: string
  settlement_run_id: string
  race_id: string
  currency: 'USDC'
  amount_minor: string | number
  status: SettlementCarryoverRecord['status']
  reason_code: string
  applied_to_race_id: string | null
  application_id: string | null
  application_transaction_id: string | null
  applied_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}

interface CarryoverApplicationRow extends QueryResultRow {
  application_id: string
  target_race_id: string
  currency: 'USDC'
  idempotency_key: string
  command_fingerprint: string
  total_amount_minor: string | number
  applied_carryover_ids: string[] | string
  result_snapshot: JsonObject | string
  created_at: Date | string
  completed_at: Date | string
}

interface SettlementRemediationActionRow extends QueryResultRow {
  remediation_action_id: string
  action_type: SettlementRemediationActionRecord['actionType']
  race_id: string
  currency: 'USDC'
  idempotency_key: string
  command_fingerprint: string
  operator_id: string
  reason_code: string
  reason_text: string | null
  result_snapshot: JsonObject | string
  created_at: Date | string
}

interface SettlementManualReviewItemRow extends QueryResultRow {
  race_id: string
  currency: 'USDC'
  pool_status: RacePoolDto['status']
  pool_updated_at: Date | string
  settlement_run_id: string | null
  settlement_run_status: SettlementRunRecord['status'] | null
  settlement_run_updated_at: Date | string | null
  reason_code: string | null
  error_code: string | null
  error_message: string | null
}

interface SettlementReconciliationRunRow extends QueryResultRow {
  reconciliation_run_id: string
  race_id: string
  currency: 'USDC'
  status: 'completed' | 'failed'
  classification: 'informational' | 'discrepancy' | 'actionable_incident'
  action_required: boolean
  issue_count: string | number
  error_count: string | number
  warning_count: string | number
  issues_snapshot: SettlementReconciliationIssueRecord[] | string
  requested_by_operator_id: string
  idempotency_key: string
  correlation_id: string
  causation_id: string
  created_at: Date | string
  completed_at: Date | string
}

interface PoolTotalRow extends QueryResultRow {
  total_accepted_stake_minor: string | number
  accepted_bet_count: string | number
}

interface AppliedCarryoverTotalRow extends QueryResultRow {
  applied_carryover_minor: string | number
  applied_carryover_count: string | number
}

interface SelectionTotalRow extends QueryResultRow {
  selection_id: string
  total_accepted_stake_minor: string | number
  accepted_bet_count: string | number
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null
  return (value instanceof Date ? value : new Date(value)).toISOString()
}

function poolEligibilityTime(pool: RacePoolDto): Date {
  return new Date(pool.bettingOpensAt ?? pool.createdAt)
}

function nextEligiblePoolAfterSource(
  sourcePool: RacePoolDto,
  pools: RacePoolDto[],
): RacePoolDto | null {
  const sourceTime = poolEligibilityTime(sourcePool).getTime()
  const eligiblePools = pools
    .filter((pool) => {
      if (pool.currency !== sourcePool.currency) return false
      if (pool.raceId === sourcePool.raceId) return false
      if (
        pool.status !== 'open' &&
        pool.status !== 'frozen'
      ) {
        return false
      }

      const poolTime = poolEligibilityTime(pool).getTime()

      return (
        poolTime > sourceTime ||
        (poolTime === sourceTime &&
          pool.raceId.localeCompare(sourcePool.raceId) > 0)
      )
    })
    .sort((left, right) => {
      const timeDelta =
        poolEligibilityTime(left).getTime() -
        poolEligibilityTime(right).getTime()

      return timeDelta === 0 ? left.raceId.localeCompare(right.raceId) : timeDelta
    })

  return eligiblePools[0] ?? null
}

function toPool(row: RacePoolRow): RacePoolDto {
  return {
    raceId: row.race_id,
    currency: row.currency,
    status: row.status,
    bettingOpensAt: toIso(row.betting_opens_at),
    bettingClosesAt: toIso(row.betting_closes_at),
    createdAt: toIso(row.created_at) as string,
    updatedAt: toIso(row.updated_at) as string,
    frozenAt: toIso(row.frozen_at),
  }
}

function toSelection(row: PoolSelectionRow): PoolSelectionDto {
  return {
    raceId: row.race_id,
    selectionId: row.selection_id,
    currency: row.currency,
    status: row.status,
    displayName: row.display_name,
    createdAt: toIso(row.created_at) as string,
    updatedAt: toIso(row.updated_at) as string,
  }
}

function toBet(row: BetRow): FinancialBetDto {
  return {
    betId: row.bet_id,
    userId: row.user_id,
    raceId: row.race_id,
    selectionId: row.selection_id,
    stakeMinor: row.stake_minor.toString(),
    currency: row.currency,
    status: row.status,
    rejectionCode: row.rejection_code,
    rejectionReason: row.rejection_reason,
    reservationId: row.reservation_transaction_id,
    acceptedAt: toIso(row.accepted_at),
    rejectedAt: toIso(row.rejected_at),
    createdAt: toIso(row.created_at) as string,
    updatedAt: toIso(row.updated_at) as string,
  }
}

function toJsonObject(value: JsonObject | string | null): JsonObject | null {
  if (value === null) return null
  if (typeof value === 'string') return JSON.parse(value) as JsonObject
  return value
}

function toSettlementRun(row: SettlementRunRow): SettlementRunRecord {
  return {
    settlementRunId: row.settlement_run_id,
    raceId: row.race_id,
    currency: row.currency,
    status: row.status,
    winningSelectionId: row.winning_selection_id,
    houseTakeBps: Number(row.house_take_bps),
    idempotencyKey: row.idempotency_key,
    commandFingerprint: row.command_fingerprint,
    totalPoolMinor: row.total_pool_minor.toString(),
    houseTakeMinor: row.house_take_minor.toString(),
    netPoolMinor: row.net_pool_minor.toString(),
    roundingResidualMinor: row.rounding_residual_minor.toString(),
    carryoverMinor: row.carryover_minor.toString(),
    reasonCode: row.reason_code,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    resultSnapshot: toJsonObject(row.result_snapshot),
    startedAt:
      row.started_at === null
        ? null
        : row.started_at instanceof Date
          ? new Date(row.started_at)
          : new Date(row.started_at),
    completedAt:
      row.completed_at === null
        ? null
        : row.completed_at instanceof Date
          ? new Date(row.completed_at)
          : new Date(row.completed_at),
    failedAt:
      row.failed_at === null
        ? null
        : row.failed_at instanceof Date
          ? new Date(row.failed_at)
          : new Date(row.failed_at),
    createdAt:
      row.created_at instanceof Date
        ? new Date(row.created_at)
        : new Date(row.created_at),
    updatedAt:
      row.updated_at instanceof Date
        ? new Date(row.updated_at)
        : new Date(row.updated_at),
  }
}

function toStringArray(value: string[] | string): string[] {
  if (Array.isArray(value)) return value
  return JSON.parse(value) as string[]
}

function toSettlementCarryover(
  row: SettlementCarryoverRow,
): SettlementCarryoverRecord {
  return {
    carryoverId: row.carryover_id,
    sourceRaceId: row.race_id,
    targetRaceId: row.applied_to_race_id,
    currency: row.currency,
    amountMinor: row.amount_minor.toString(),
    status: row.status,
    reasonCode: row.reason_code,
    applicationId: row.application_id,
    applicationTransactionId: row.application_transaction_id,
    appliedAt: toIso(row.applied_at),
    createdAt: toIso(row.created_at) as string,
    updatedAt: toIso(row.updated_at) as string,
  }
}

function toCarryoverApplication(
  row: CarryoverApplicationRow,
): CarryoverApplicationRecord {
  return {
    applicationId: row.application_id,
    targetRaceId: row.target_race_id,
    currency: row.currency,
    idempotencyKey: row.idempotency_key,
    commandFingerprint: row.command_fingerprint,
    totalAmountMinor: row.total_amount_minor.toString(),
    appliedCarryoverIds: toStringArray(row.applied_carryover_ids),
    resultSnapshot: toJsonObject(row.result_snapshot) ?? {},
    createdAt:
      row.created_at instanceof Date
        ? new Date(row.created_at)
        : new Date(row.created_at),
    completedAt:
      row.completed_at instanceof Date
        ? new Date(row.completed_at)
        : new Date(row.completed_at),
  }
}

function toSettlementRemediationAction(
  row: SettlementRemediationActionRow,
): SettlementRemediationActionRecord {
  return {
    remediationActionId: row.remediation_action_id,
    actionType: row.action_type,
    raceId: row.race_id,
    currency: row.currency,
    idempotencyKey: row.idempotency_key,
    commandFingerprint: row.command_fingerprint,
    operatorId: row.operator_id,
    reasonCode: row.reason_code,
    reasonText: row.reason_text,
    resultSnapshot: toJsonObject(row.result_snapshot) ?? {},
    createdAt:
      row.created_at instanceof Date
        ? new Date(row.created_at)
        : new Date(row.created_at),
  }
}

function toReconciliationIssues(
  value: SettlementReconciliationIssueRecord[] | string,
): SettlementReconciliationIssueRecord[] {
  if (Array.isArray(value)) return value
  return JSON.parse(value) as SettlementReconciliationIssueRecord[]
}

function toSettlementManualReviewItem(
  row: SettlementManualReviewItemRow,
): SettlementManualReviewItemRecord {
  return {
    raceId: row.race_id,
    currency: row.currency,
    poolStatus: row.pool_status,
    poolUpdatedAt: toIso(row.pool_updated_at) as string,
    settlementRunId: row.settlement_run_id,
    settlementRunStatus: row.settlement_run_status,
    settlementRunUpdatedAt: toIso(row.settlement_run_updated_at),
    reasonCode: row.reason_code,
    errorCode: row.error_code,
    errorMessage: row.error_message,
  }
}

function toSettlementReconciliationRun(
  row: SettlementReconciliationRunRow,
): SettlementReconciliationRunSummaryRecord {
  return {
    reconciliationRunId: row.reconciliation_run_id,
    raceId: row.race_id,
    currency: row.currency,
    status: row.status,
    classification: row.classification,
    actionRequired: row.action_required,
    issueCount: Number(row.issue_count),
    errorCount: Number(row.error_count),
    warningCount: Number(row.warning_count),
    issues: toReconciliationIssues(row.issues_snapshot),
    requestedByOperatorId: row.requested_by_operator_id,
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    createdAt: toIso(row.created_at) as string,
    completedAt: toIso(row.completed_at) as string,
  }
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  )
}

export class PostgresBettingRepository implements BettingRepository {
  constructor(private readonly database: Database) {}

  async createRacePool(
    pool: CreateRacePoolRecord,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    try {
      await transaction.query(
        `
          INSERT INTO race_pools (
            race_id,
            currency,
            status,
            betting_opens_at,
            betting_closes_at,
            created_at,
            updated_at,
            frozen_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          pool.raceId,
          pool.currency,
          pool.status,
          pool.bettingOpensAt,
          pool.bettingClosesAt,
          pool.createdAt,
          pool.updatedAt,
          pool.frozenAt,
        ],
      )
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError({
          category: 'conflict',
          code: 'RACE_POOL_ALREADY_EXISTS',
          message: 'A race pool already exists for the requested race',
          details: { raceId: pool.raceId, currency: pool.currency },
        })
      }

      throw error
    }
  }

  async getRacePool(
    raceId: string,
    currency: 'USDC',
    queryable?: Queryable,
  ): Promise<RacePoolDto | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<RacePoolRow>(
      `
        SELECT *
        FROM race_pools
        WHERE race_id = $1 AND currency = $2
        LIMIT 1
      `,
      [raceId, currency],
    )

    return result.rows[0] ? toPool(result.rows[0]) : null
  }

  async getRacePoolForUpdate(
    raceId: string,
    currency: 'USDC',
    transaction: DatabaseTransaction,
  ): Promise<RacePoolDto | null> {
    const result = await transaction.query<RacePoolRow>(
      `
        SELECT *
        FROM race_pools
        WHERE race_id = $1 AND currency = $2
        LIMIT 1
        FOR UPDATE
      `,
      [raceId, currency],
    )

    return result.rows[0] ? toPool(result.rows[0]) : null
  }

  async updateRacePool(
    pool: RacePoolDto,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    const result = await transaction.query(
      `
        UPDATE race_pools
        SET status = $3,
            updated_at = $4,
            frozen_at = $5
        WHERE race_id = $1 AND currency = $2
      `,
      [pool.raceId, pool.currency, pool.status, pool.updatedAt, pool.frozenAt],
    )

    if (result.rowCount !== 1) {
      throw new AppError({
        category: 'not_found',
        code: 'RACE_POOL_NOT_FOUND',
        message: 'Race pool was not found',
        details: { raceId: pool.raceId, currency: pool.currency },
      })
    }
  }

  async listRacePools(
    currency: 'USDC',
    queryable?: Queryable,
  ): Promise<RacePoolDto[]> {
    const executor = queryable ?? this.database
    const result = await executor.query<RacePoolRow>(
      `
        SELECT *
        FROM race_pools
        WHERE currency = $1
        ORDER BY COALESCE(betting_opens_at, created_at) ASC, race_id ASC
      `,
      [currency],
    )

    return result.rows.map((row) => toPool(row))
  }

  async createPoolSelection(
    selection: CreatePoolSelectionRecord,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    try {
      await transaction.query(
        `
          INSERT INTO race_pool_selections (
            race_id,
            selection_id,
            currency,
            status,
            display_name,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          selection.raceId,
          selection.selectionId,
          selection.currency,
          selection.status,
          selection.displayName,
          selection.createdAt,
          selection.updatedAt,
        ],
      )
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError({
          category: 'conflict',
          code: 'POOL_SELECTION_ALREADY_EXISTS',
          message: 'A selection is already registered for this race pool',
          details: {
            raceId: selection.raceId,
            selectionId: selection.selectionId,
          },
        })
      }

      throw error
    }
  }

  async getPoolSelection(
    raceId: string,
    selectionId: string,
    currency: 'USDC',
    queryable?: Queryable,
  ): Promise<PoolSelectionDto | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<PoolSelectionRow>(
      `
        SELECT *
        FROM race_pool_selections
        WHERE race_id = $1
          AND selection_id = $2
          AND currency = $3
        LIMIT 1
      `,
      [raceId, selectionId, currency],
    )

    return result.rows[0] ? toSelection(result.rows[0]) : null
  }

  async listPoolSelections(
    raceId: string,
    currency: 'USDC',
    queryable?: Queryable,
  ): Promise<PoolSelectionDto[]> {
    const executor = queryable ?? this.database
    const result = await executor.query<PoolSelectionRow>(
      `
        SELECT *
        FROM race_pool_selections
        WHERE race_id = $1 AND currency = $2
        ORDER BY selection_id ASC
      `,
      [raceId, currency],
    )

    return result.rows.map((row) => toSelection(row))
  }

  async createBet(
    bet: CreateBetRecord,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    try {
      await transaction.query(
        `
          INSERT INTO financial_bets (
            bet_id,
            user_id,
            race_id,
            selection_id,
            stake_minor,
            currency,
            status,
            rejection_code,
            rejection_reason,
            reservation_transaction_id,
            accepted_at,
            rejected_at,
            idempotency_key,
            correlation_id,
            causation_id,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5::NUMERIC(20, 0), $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        `,
        [
          bet.betId,
          bet.userId,
          bet.raceId,
          bet.selectionId,
          bet.stakeMinor,
          bet.currency,
          bet.status,
          bet.rejectionCode,
          bet.rejectionReason,
          bet.reservationId,
          bet.acceptedAt,
          bet.rejectedAt,
          bet.idempotencyKey,
          bet.correlationId,
          bet.causationId,
          bet.createdAt,
          bet.updatedAt,
        ],
      )
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError({
          category: 'conflict',
          code: 'FINANCIAL_BET_ALREADY_EXISTS',
          message: 'A financial bet already exists for the requested betId',
          details: { betId: bet.betId },
        })
      }

      throw error
    }
  }

  async getBetById(
    betId: string,
    queryable?: Queryable,
  ): Promise<FinancialBetDto | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<BetRow>(
      'SELECT * FROM financial_bets WHERE bet_id = $1',
      [betId],
    )

    return result.rows[0] ? toBet(result.rows[0]) : null
  }

  async listBetsByRaceId(
    raceId: string,
    queryable?: Queryable,
  ): Promise<FinancialBetDto[]> {
    const executor = queryable ?? this.database
    const result = await executor.query<BetRow>(
      `
        SELECT *
        FROM financial_bets
        WHERE race_id = $1
        ORDER BY created_at ASC, bet_id ASC
      `,
      [raceId],
    )

    return result.rows.map((row) => toBet(row))
  }

  async listBetsByRaceIdForUpdate(
    raceId: string,
    transaction: DatabaseTransaction,
  ): Promise<FinancialBetDto[]> {
    const result = await transaction.query<BetRow>(
      `
        SELECT *
        FROM financial_bets
        WHERE race_id = $1
        ORDER BY created_at ASC, bet_id ASC
        FOR UPDATE
      `,
      [raceId],
    )

    return result.rows.map((row) => toBet(row))
  }

  async listBetsByUserId(
    userId: string,
    queryable?: Queryable,
  ): Promise<FinancialBetDto[]> {
    const executor = queryable ?? this.database
    const result = await executor.query<BetRow>(
      `
        SELECT *
        FROM financial_bets
        WHERE user_id = $1
        ORDER BY created_at DESC, bet_id ASC
      `,
      [userId],
    )

    return result.rows.map((row) => toBet(row))
  }

  async updateBetSettlementStatus(
    input: {
      betId: string
      status: FinancialBetDto['status']
      settlementRunId: string
      updatedAt: Date
    },
    transaction: DatabaseTransaction,
  ): Promise<void> {
    const result = await transaction.query(
      `
        UPDATE financial_bets
        SET status = $2,
            settlement_run_id = $3,
            updated_at = $4
        WHERE bet_id = $1
      `,
      [input.betId, input.status, input.settlementRunId, input.updatedAt],
    )

    if (result.rowCount !== 1) {
      throw new AppError({
        category: 'not_found',
        code: 'FINANCIAL_BET_NOT_FOUND',
        message: 'Financial bet was not found while updating settlement state',
        details: { betId: input.betId },
      })
    }
  }

  async createSettlementRun(
    run: CreateSettlementRunRecord,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    try {
      await transaction.query(
        `
          INSERT INTO settlement_runs (
            settlement_run_id,
            race_id,
            currency,
            status,
            winning_selection_id,
            house_take_bps,
            idempotency_key,
            command_fingerprint,
            started_at,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `,
        [
          run.settlementRunId,
          run.raceId,
          run.currency,
          run.status,
          run.winningSelectionId,
          run.houseTakeBps,
          run.idempotencyKey,
          run.commandFingerprint,
          run.startedAt,
          run.createdAt,
          run.updatedAt,
        ],
      )
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError({
          category: 'conflict',
          code: 'SETTLEMENT_RUN_CONFLICT',
          message: 'A settlement run already exists for this command or race',
          details: {
            raceId: run.raceId,
            settlementRunId: run.settlementRunId,
            idempotencyKey: run.idempotencyKey,
          },
        })
      }

      throw error
    }
  }

  async getSettlementRunByIdempotencyKey(
    idempotencyKey: string,
    queryable?: Queryable,
  ): Promise<SettlementRunRecord | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<SettlementRunRow>(
      `
        SELECT *
        FROM settlement_runs
        WHERE idempotency_key = $1
        LIMIT 1
      `,
      [idempotencyKey],
    )

    return result.rows[0] ? toSettlementRun(result.rows[0]) : null
  }

  async getCompletedSettlementRunByRace(
    raceId: string,
    currency: 'USDC',
    queryable?: Queryable,
  ): Promise<SettlementRunRecord | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<SettlementRunRow>(
      `
        SELECT *
        FROM settlement_runs
        WHERE race_id = $1
          AND currency = $2
          AND status = 'completed'
        ORDER BY completed_at DESC, created_at DESC
        LIMIT 1
      `,
      [raceId, currency],
    )

    return result.rows[0] ? toSettlementRun(result.rows[0]) : null
  }

  async getActiveSettlementRunByRace(
    raceId: string,
    currency: 'USDC',
    queryable?: Queryable,
  ): Promise<SettlementRunRecord | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<SettlementRunRow>(
      `
        SELECT *
        FROM settlement_runs
        WHERE race_id = $1
          AND currency = $2
          AND status IN ('pending', 'running', 'posting_required')
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [raceId, currency],
    )

    return result.rows[0] ? toSettlementRun(result.rows[0]) : null
  }

  async updateSettlementRun(
    run: UpdateSettlementRunRecord,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    const result = await transaction.query(
      `
        UPDATE settlement_runs
        SET status = $2,
            total_pool_minor = $3::NUMERIC(20, 0),
            house_take_minor = $4::NUMERIC(20, 0),
            net_pool_minor = $5::NUMERIC(20, 0),
            rounding_residual_minor = $6::NUMERIC(20, 0),
            carryover_minor = $7::NUMERIC(20, 0),
            reason_code = $8,
            error_code = $9,
            error_message = $10,
            result_snapshot = $11,
            completed_at = $12,
            failed_at = $13,
            updated_at = $14
        WHERE settlement_run_id = $1
      `,
      [
        run.settlementRunId,
        run.status,
        run.totalPoolMinor,
        run.houseTakeMinor,
        run.netPoolMinor,
        run.roundingResidualMinor,
        run.carryoverMinor,
        run.reasonCode,
        run.errorCode,
        run.errorMessage,
        run.resultSnapshot,
        run.completedAt,
        run.failedAt,
        run.updatedAt,
      ],
    )

    if (result.rowCount !== 1) {
      throw new AppError({
        category: 'not_found',
        code: 'SETTLEMENT_RUN_NOT_FOUND',
        message: 'Settlement run was not found',
        details: { settlementRunId: run.settlementRunId },
      })
    }
  }

  async createSettlementCarryover(
    carryover: CreateSettlementCarryoverRecord,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    try {
      await transaction.query(
        `
          INSERT INTO settlement_carryovers (
            carryover_id,
            settlement_run_id,
            race_id,
            currency,
            amount_minor,
            status,
            reason_code,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5::NUMERIC(20, 0), $6, $7, $8, $9)
        `,
        [
          carryover.carryoverId,
          carryover.settlementRunId,
          carryover.raceId,
          carryover.currency,
          carryover.amountMinor,
          carryover.status,
          carryover.reasonCode,
          carryover.createdAt,
          carryover.updatedAt,
        ],
      )
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError({
          category: 'conflict',
          code: 'SETTLEMENT_CARRYOVER_ALREADY_EXISTS',
          message: 'A settlement carryover already exists for this run',
          details: { settlementRunId: carryover.settlementRunId },
        })
      }

      throw error
    }
  }

  async listCarryovers(
    criteria: {
      status?: SettlementCarryoverRecord['status']
      sourceRaceId?: string
      targetRaceId?: string
    },
    queryable?: Queryable,
  ): Promise<SettlementCarryoverRecord[]> {
    const executor = queryable ?? this.database
    const clauses: string[] = []
    const params: unknown[] = []

    if (criteria.status) {
      params.push(criteria.status)
      clauses.push(`status = $${params.length}`)
    }

    if (criteria.sourceRaceId) {
      params.push(criteria.sourceRaceId)
      clauses.push(`race_id = $${params.length}`)
    }

    if (criteria.targetRaceId) {
      params.push(criteria.targetRaceId)
      clauses.push(`applied_to_race_id = $${params.length}`)
    }

    const result = await executor.query<SettlementCarryoverRow>(
      `
        SELECT *
        FROM settlement_carryovers
        ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
        ORDER BY created_at ASC, carryover_id ASC
      `,
      params,
    )

    return result.rows.map((row) => toSettlementCarryover(row))
  }

  async listPendingCarryoversForUpdate(
    currency: 'USDC',
    transaction: DatabaseTransaction,
  ): Promise<SettlementCarryoverRecord[]> {
    const result = await transaction.query<SettlementCarryoverRow>(
      `
        SELECT *
        FROM settlement_carryovers
        WHERE currency = $1
          AND status = 'pending'
        ORDER BY created_at ASC, carryover_id ASC
        FOR UPDATE
      `,
      [currency],
    )

    return result.rows.map((row) => toSettlementCarryover(row))
  }

  async markCarryoverApplied(
    input: {
      carryoverId: string
      targetRaceId: string
      applicationId: string
      applicationTransactionId: string
      appliedAt: Date
      updatedAt: Date
    },
    transaction: DatabaseTransaction,
  ): Promise<void> {
    const result = await transaction.query(
      `
        UPDATE settlement_carryovers
        SET status = 'applied',
            applied_to_race_id = $2,
            application_id = $3,
            application_transaction_id = $4,
            applied_at = $5,
            updated_at = $6
        WHERE carryover_id = $1
          AND status = 'pending'
      `,
      [
        input.carryoverId,
        input.targetRaceId,
        input.applicationId,
        input.applicationTransactionId,
        input.appliedAt,
        input.updatedAt,
      ],
    )

    if (result.rowCount !== 1) {
      throw new AppError({
        category: 'conflict',
        code: 'CARRYOVER_NOT_PENDING',
        message: 'Carryover was not pending and cannot be applied',
        details: { carryoverId: input.carryoverId },
      })
    }
  }

  async getCarryoverApplicationByIdempotencyKey(
    idempotencyKey: string,
    queryable?: Queryable,
  ): Promise<CarryoverApplicationRecord | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<CarryoverApplicationRow>(
      `
        SELECT *
        FROM settlement_carryover_applications
        WHERE idempotency_key = $1
        LIMIT 1
      `,
      [idempotencyKey],
    )

    return result.rows[0] ? toCarryoverApplication(result.rows[0]) : null
  }

  async createCarryoverApplication(
    application: CreateCarryoverApplicationRecord,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    try {
      await transaction.query(
        `
          INSERT INTO settlement_carryover_applications (
            application_id,
            target_race_id,
            currency,
            idempotency_key,
            command_fingerprint,
            total_amount_minor,
            applied_carryover_ids,
            result_snapshot,
            created_at,
            completed_at
          )
          VALUES ($1, $2, $3, $4, $5, $6::NUMERIC(20, 0), $7::jsonb, $8, $9, $10)
        `,
        [
          application.applicationId,
          application.targetRaceId,
          application.currency,
          application.idempotencyKey,
          application.commandFingerprint,
          application.totalAmountMinor,
          JSON.stringify(application.appliedCarryoverIds),
          application.resultSnapshot,
          application.createdAt,
          application.completedAt,
        ],
      )
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError({
          category: 'conflict',
          code: 'CARRYOVER_APPLICATION_ALREADY_EXISTS',
          message: 'Carryover application already exists for this command',
          details: { idempotencyKey: application.idempotencyKey },
        })
      }

      throw error
    }
  }

  async getSettlementRunById(
    settlementRunId: string,
    queryable?: Queryable,
  ): Promise<SettlementRunRecord | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<SettlementRunRow>(
      `
        SELECT *
        FROM settlement_runs
        WHERE settlement_run_id = $1
        LIMIT 1
      `,
      [settlementRunId],
    )

    return result.rows[0] ? toSettlementRun(result.rows[0]) : null
  }

  async getLatestSettlementRunByRaceAndStatus(
    raceId: string,
    currency: 'USDC',
    status: SettlementRunRecord['status'],
    queryable?: Queryable,
  ): Promise<SettlementRunRecord | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<SettlementRunRow>(
      `
        SELECT *
        FROM settlement_runs
        WHERE race_id = $1
          AND currency = $2
          AND status = $3
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `,
      [raceId, currency, status],
    )

    return result.rows[0] ? toSettlementRun(result.rows[0]) : null
  }

  async getSettlementRemediationActionByIdempotencyKey(
    idempotencyKey: string,
    queryable?: Queryable,
  ): Promise<SettlementRemediationActionRecord | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<SettlementRemediationActionRow>(
      `
        SELECT *
        FROM settlement_remediation_actions
        WHERE idempotency_key = $1
        LIMIT 1
      `,
      [idempotencyKey],
    )

    return result.rows[0]
      ? toSettlementRemediationAction(result.rows[0])
      : null
  }

  async createSettlementRemediationAction(
    action: CreateSettlementRemediationActionRecord,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    try {
      await transaction.query(
        `
          INSERT INTO settlement_remediation_actions (
            remediation_action_id,
            action_type,
            race_id,
            currency,
            idempotency_key,
            command_fingerprint,
            operator_id,
            reason_code,
            reason_text,
            result_snapshot,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `,
        [
          action.remediationActionId,
          action.actionType,
          action.raceId,
          action.currency,
          action.idempotencyKey,
          action.commandFingerprint,
          action.operatorId,
          action.reasonCode,
          action.reasonText,
          action.resultSnapshot,
          action.createdAt,
        ],
      )
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError({
          category: 'conflict',
          code: 'SETTLEMENT_REMEDIATION_ALREADY_EXISTS',
          message: 'Settlement remediation already exists for this command',
          details: { idempotencyKey: action.idempotencyKey },
        })
      }

      throw error
    }
  }

  async detectSettlementReconciliationIssues(
    raceId: string,
    currency: 'USDC',
    queryable?: Queryable,
  ): Promise<SettlementReconciliationIssueRecord[]> {
    const executor = queryable ?? this.database
    const issues: SettlementReconciliationIssueRecord[] = []
    const pool = await this.getRacePool(raceId, currency, executor)
    const completedRuns = await executor.query<{
      count: string | number
      latest_status: string | null
    }>(
      `
        SELECT COUNT(*)::int AS count, MAX(status) AS latest_status
        FROM settlement_runs
        WHERE race_id = $1
          AND currency = $2
          AND status = 'completed'
      `,
      [raceId, currency],
    )
    const completedCount = Number(completedRuns.rows[0]?.count ?? 0)

    if (pool?.status === 'settled' && completedCount === 0) {
      issues.push({
        code: 'SETTLED_POOL_WITHOUT_COMPLETED_RUN',
        severity: 'error',
        message: 'Race pool is settled but no completed settlement run exists',
        details: { raceId, currency, poolStatus: pool.status },
      })
    }

    if (completedCount > 0 && pool?.status !== 'settled') {
      issues.push({
        code: 'COMPLETED_RUN_WITH_POOL_NOT_SETTLED',
        severity: 'error',
        message: 'A completed settlement run exists but the pool is not settled',
        details: { raceId, currency, poolStatus: pool?.status ?? null },
      })
    }

    if (completedCount > 1) {
      issues.push({
        code: 'DUPLICATE_COMPLETED_SETTLEMENTS',
        severity: 'error',
        message: 'More than one completed settlement run exists for the race',
        details: { raceId, currency, completedCount },
      })
    }

    if (completedCount > 0) {
      const nonTerminalBets = await executor.query<{ bet_id: string; status: string }>(
        `
          SELECT bet_id, status
          FROM financial_bets
          WHERE race_id = $1
            AND currency = $2
            AND status IN ('accepted', 'settlement_pending')
          ORDER BY bet_id ASC
        `,
        [raceId, currency],
      )

      if (nonTerminalBets.rows.length > 0) {
        issues.push({
          code: 'COMPLETED_SETTLEMENT_WITH_NON_TERMINAL_BETS',
          severity: 'error',
          message:
            'A completed settlement exists but financial bets remain non-terminal',
          details: {
            raceId,
            currency,
            betIds: nonTerminalBets.rows.map((row) => row.bet_id),
            statuses: Object.fromEntries(
              nonTerminalBets.rows.map((row) => [row.bet_id, row.status]),
            ),
          },
        })
      }
    }

    const clearingBalance = await executor.query<{ balance_minor: string | number }>(
      `
        SELECT COALESCE(b.balance_minor, 0) AS balance_minor
        FROM accounts a
        LEFT JOIN account_balances b ON b.account_id = a.account_id
        WHERE a.account_type = 'settlement_clearing'
          AND a.owner_type = 'settlement'
          AND a.owner_id = $1
          AND a.currency = $2
        LIMIT 1
      `,
      [`race:${raceId}`, currency],
    )
    const residual = BigInt(clearingBalance.rows[0]?.balance_minor?.toString() ?? '0')

    if (completedCount > 0 && residual !== 0n) {
      const pendingCarryover = await executor.query<{ count: string | number }>(
        `
          SELECT COUNT(*)::int AS count
          FROM settlement_carryovers
          WHERE race_id = $1
            AND currency = $2
            AND status = 'pending'
        `,
        [raceId, currency],
      )

      if (Number(pendingCarryover.rows[0]?.count ?? 0) === 0) {
        issues.push({
          code: 'SETTLEMENT_CLEARING_RESIDUAL_UNHANDLED',
          severity: 'error',
          message:
            'Settlement clearing has a residual balance without a pending carryover',
          details: { raceId, currency, balanceMinor: residual.toString() },
        })
      }
    }

    const now = new Date()
    const manualReviewStaleBefore = new Date(
      now.getTime() - 24 * 60 * 60 * 1000,
    )
    const stuckRunBefore = new Date(now.getTime() - 60 * 60 * 1000)

    if (
      pool?.status === 'manual_review' &&
      new Date(pool.updatedAt) <= manualReviewStaleBefore
    ) {
      issues.push({
        code: 'MANUAL_REVIEW_POOL_STALE',
        severity: 'warning',
        message: 'Race pool has remained in manual review past the threshold',
        details: {
          raceId,
          currency,
          updatedAt: pool.updatedAt,
          thresholdHours: 24,
        },
      })
    }

    const staleManualReviewRuns = await executor.query<{
      settlement_run_id: string
      updated_at: Date | string
    }>(
      `
        SELECT settlement_run_id, updated_at
        FROM settlement_runs
        WHERE race_id = $1
          AND currency = $2
          AND status = 'manual_review'
          AND updated_at <= $3
        ORDER BY updated_at ASC
      `,
      [raceId, currency, manualReviewStaleBefore],
    )

    if (staleManualReviewRuns.rows.length > 0) {
      issues.push({
        code: 'MANUAL_REVIEW_SETTLEMENT_STALE',
        severity: 'warning',
        message:
          'Settlement run has remained in manual review past the threshold',
        details: {
          raceId,
          currency,
          thresholdHours: 24,
          settlementRunIds: staleManualReviewRuns.rows.map(
            (row) => row.settlement_run_id,
          ),
        },
      })
    }

    const stuckRuns = await executor.query<{
      settlement_run_id: string
      status: string
      updated_at: Date | string
    }>(
      `
        SELECT settlement_run_id, status, updated_at
        FROM settlement_runs
        WHERE race_id = $1
          AND currency = $2
          AND status IN ('pending', 'running', 'posting_required')
          AND updated_at <= $3
        ORDER BY updated_at ASC
      `,
      [raceId, currency, stuckRunBefore],
    )

    if (stuckRuns.rows.length > 0) {
      issues.push({
        code: 'SETTLEMENT_RUN_STUCK_NON_TERMINAL',
        severity: 'error',
        message: 'Settlement run has remained non-terminal past the threshold',
        details: {
          raceId,
          currency,
          thresholdMinutes: 60,
          settlementRuns: stuckRuns.rows.map((row) => ({
            settlementRunId: row.settlement_run_id,
            status: row.status,
          })),
        },
      })
    }

    const allPools = await this.listRacePools(currency, executor)
    const pendingCarryovers = await this.listCarryovers(
      { status: 'pending' },
      executor,
    )

    for (const carryover of pendingCarryovers) {
      const sourcePool = allPools.find(
        (candidate) => candidate.raceId === carryover.sourceRaceId,
      )
      const nextPool =
        sourcePool === undefined
          ? null
          : nextEligiblePoolAfterSource(sourcePool, allPools)

      if (
        nextPool &&
        (carryover.sourceRaceId === raceId || nextPool.raceId === raceId)
      ) {
        issues.push({
          code: 'PENDING_CARRYOVER_ELIGIBLE_BUT_UNAPPLIED',
          severity: 'warning',
          message:
            'A pending carryover has an eligible future pool but has not been applied',
          details: {
            raceId,
            currency,
            carryoverId: carryover.carryoverId,
            sourceRaceId: carryover.sourceRaceId,
            eligibleTargetRaceId: nextPool.raceId,
            amountMinor: carryover.amountMinor,
          },
        })
      }
    }

    const appliedCarryovers = await this.listCarryovers(
      { status: 'applied', targetRaceId: raceId },
      executor,
    )

    for (const carryover of appliedCarryovers) {
      if (!carryover.applicationTransactionId) {
        issues.push({
          code: 'APPLIED_CARRYOVER_MISSING_LEDGER_REFERENCE',
          severity: 'error',
          message:
            'Applied carryover is missing the ledger transaction reference',
          details: {
            raceId,
            currency,
            carryoverId: carryover.carryoverId,
          },
        })
        continue
      }

      const ledgerAmount = await executor.query<{
        posted_minor: string | number
      }>(
        `
          SELECT COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount_minor ELSE 0 END), 0) AS posted_minor
          FROM ledger_transactions t
          JOIN ledger_entries e ON e.transaction_id = t.transaction_id
          JOIN accounts a ON a.account_id = e.account_id
          WHERE t.transaction_id = $1
            AND t.transaction_type = 'settlement_carryover_apply'
            AND a.account_type = 'settlement_clearing'
            AND a.owner_type = 'settlement'
            AND a.owner_id = $2
            AND a.currency = $3
        `,
        [
          carryover.applicationTransactionId,
          `race:${carryover.targetRaceId}`,
          currency,
        ],
      )
      const postedMinor =
        ledgerAmount.rows[0]?.posted_minor?.toString() ?? '0'

      if (postedMinor !== carryover.amountMinor) {
        issues.push({
          code: 'CARRYOVER_LEDGER_AMOUNT_MISMATCH',
          severity: 'error',
          message:
            'Applied carryover amount does not match its ledger application posting',
          details: {
            raceId,
            currency,
            carryoverId: carryover.carryoverId,
            expectedMinor: carryover.amountMinor,
            postedMinor,
            applicationTransactionId: carryover.applicationTransactionId,
          },
        })
      }
    }

    return issues
  }

  async listManualReviewItems(
    currency: 'USDC',
    queryable?: Queryable,
  ): Promise<SettlementManualReviewItemRecord[]> {
    const executor = queryable ?? this.database
    const result = await executor.query<SettlementManualReviewItemRow>(
      `
        SELECT
          p.race_id,
          p.currency,
          p.status AS pool_status,
          p.updated_at AS pool_updated_at,
          r.settlement_run_id,
          r.status AS settlement_run_status,
          r.updated_at AS settlement_run_updated_at,
          r.reason_code,
          r.error_code,
          r.error_message
        FROM race_pools p
        LEFT JOIN settlement_runs r
          ON r.race_id = p.race_id
          AND r.currency = p.currency
          AND r.status = 'manual_review'
        WHERE p.currency = $1
          AND (p.status = 'manual_review' OR r.status = 'manual_review')
        ORDER BY p.race_id ASC, r.updated_at DESC
      `,
      [currency],
    )
    const firstByRaceId = new Map<string, SettlementManualReviewItemRecord>()

    for (const row of result.rows) {
      if (!firstByRaceId.has(row.race_id)) {
        firstByRaceId.set(row.race_id, toSettlementManualReviewItem(row))
      }
    }

    return [...firstByRaceId.values()]
  }

  async getSettlementReconciliationRunByIdempotencyKey(
    idempotencyKey: string,
    queryable?: Queryable,
  ): Promise<SettlementReconciliationRunSummaryRecord | null> {
    const executor = queryable ?? this.database
    const result = await executor.query<SettlementReconciliationRunRow>(
      `
        SELECT *
        FROM settlement_reconciliation_runs
        WHERE idempotency_key = $1
        LIMIT 1
      `,
      [idempotencyKey],
    )

    return result.rows[0]
      ? toSettlementReconciliationRun(result.rows[0])
      : null
  }

  async createSettlementReconciliationRun(
    run: CreateSettlementReconciliationRunRecord,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    try {
      await transaction.query(
        `
          INSERT INTO settlement_reconciliation_runs (
            reconciliation_run_id,
            race_id,
            currency,
            status,
            classification,
            action_required,
            issue_count,
            error_count,
            warning_count,
            issues_snapshot,
            requested_by_operator_id,
            idempotency_key,
            correlation_id,
            causation_id,
            created_at,
            completed_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15, $16)
        `,
        [
          run.reconciliationRunId,
          run.raceId,
          run.currency,
          run.status,
          run.classification,
          run.actionRequired,
          run.issueCount,
          run.errorCount,
          run.warningCount,
          JSON.stringify(run.issues),
          run.requestedByOperatorId,
          run.idempotencyKey,
          run.correlationId,
          run.causationId,
          run.createdAt,
          run.completedAt,
        ],
      )
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError({
          category: 'conflict',
          code: 'SETTLEMENT_RECONCILIATION_RUN_ALREADY_EXISTS',
          message:
            'Settlement reconciliation run already exists for this command',
          details: { idempotencyKey: run.idempotencyKey },
        })
      }

      throw error
    }
  }

  async listSettlementReconciliationRuns(
    criteria: {
      raceId?: string
    },
    queryable?: Queryable,
  ): Promise<SettlementReconciliationRunSummaryRecord[]> {
    const executor = queryable ?? this.database
    const clauses: string[] = []
    const params: unknown[] = []

    if (criteria.raceId) {
      params.push(criteria.raceId)
      clauses.push(`race_id = $${params.length}`)
    }

    const result = await executor.query<SettlementReconciliationRunRow>(
      `
        SELECT *
        FROM settlement_reconciliation_runs
        ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
        ORDER BY completed_at DESC, reconciliation_run_id ASC
      `,
      params,
    )

    return result.rows.map((row) => toSettlementReconciliationRun(row))
  }

  async getLivePoolTotal(
    raceId: string,
    currency: 'USDC',
    queryable?: Queryable,
  ): Promise<PoolTotalDto> {
    const executor = queryable ?? this.database
    const result = await executor.query<PoolTotalRow>(
      `
        SELECT
          COALESCE(SUM(stake_minor), 0) AS total_accepted_stake_minor,
          COUNT(*)::int AS accepted_bet_count
        FROM financial_bets
        WHERE race_id = $1
          AND currency = $2
          AND status = 'accepted'
      `,
      [raceId, currency],
    )
    const row = result.rows[0]
    const carryoverResult = await executor.query<AppliedCarryoverTotalRow>(
      `
        SELECT
          COALESCE(SUM(amount_minor), 0) AS applied_carryover_minor,
          COUNT(*)::int AS applied_carryover_count
        FROM settlement_carryovers
        WHERE applied_to_race_id = $1
          AND currency = $2
          AND status = 'applied'
      `,
      [raceId, currency],
    )
    const carryoverRow = carryoverResult.rows[0]
    const acceptedStakeMinor =
      row?.total_accepted_stake_minor.toString() ?? '0'
    const appliedCarryoverMinor =
      carryoverRow?.applied_carryover_minor.toString() ?? '0'

    return {
      raceId,
      currency,
      totalAcceptedStakeMinor: acceptedStakeMinor,
      appliedCarryoverMinor,
      totalDistributableBasisMinor: (
        BigInt(acceptedStakeMinor) + BigInt(appliedCarryoverMinor)
      ).toString(),
      acceptedBetCount: Number(row?.accepted_bet_count ?? 0),
      asOf: new Date().toISOString(),
    }
  }

  async listSelectionTotals(
    raceId: string,
    currency: 'USDC',
    queryable?: Queryable,
  ): Promise<SelectionTotalDto[]> {
    const executor = queryable ?? this.database
    const result = await executor.query<SelectionTotalRow>(
      `
        SELECT
          selection_id,
          COALESCE(SUM(stake_minor), 0) AS total_accepted_stake_minor,
          COUNT(*)::int AS accepted_bet_count
        FROM financial_bets
        WHERE race_id = $1
          AND currency = $2
          AND status = 'accepted'
        GROUP BY selection_id
        ORDER BY selection_id ASC
      `,
      [raceId, currency],
    )
    const asOf = new Date().toISOString()

    return result.rows.map((row) => ({
      raceId,
      selectionId: row.selection_id,
      currency,
      totalAcceptedStakeMinor: row.total_accepted_stake_minor.toString(),
      acceptedBetCount: Number(row.accepted_bet_count),
      asOf,
    }))
  }
}
