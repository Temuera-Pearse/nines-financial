import type { DatabaseTransaction, Queryable } from '../../../shared/db/Database.js'
import type {
  FinancialBetDto,
  PoolSelectionDto,
  PoolTotalDto,
  RacePoolDto,
  SelectionTotalDto,
  SettlementManualReviewItemDto,
  SettlementCarryoverDto,
  SettlementReconciliationRunSummaryDto,
} from '../dto/bettingDtos.js'
import type { JsonObject } from '../../../shared/types/Json.js'

export type RacePoolStatus = RacePoolDto['status']
export type SettlementRunStatus =
  | 'pending'
  | 'running'
  | 'posting_required'
  | 'completed'
  | 'failed'
  | 'manual_review'

export interface CreateRacePoolRecord {
  raceId: string
  currency: 'USDC'
  status: RacePoolStatus
  bettingOpensAt: Date | null
  bettingClosesAt: Date | null
  createdAt: Date
  updatedAt: Date
  frozenAt: Date | null
}

export interface SettlementRunRecord {
  settlementRunId: string
  raceId: string
  currency: 'USDC'
  status: SettlementRunStatus
  winningSelectionId: string
  houseTakeBps: number
  idempotencyKey: string
  commandFingerprint: string
  totalPoolMinor: string
  houseTakeMinor: string
  netPoolMinor: string
  roundingResidualMinor: string
  carryoverMinor: string
  reasonCode: string | null
  errorCode: string | null
  errorMessage: string | null
  resultSnapshot: JsonObject | null
  startedAt: Date | null
  completedAt: Date | null
  failedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateSettlementRunRecord {
  settlementRunId: string
  raceId: string
  currency: 'USDC'
  status: SettlementRunStatus
  winningSelectionId: string
  houseTakeBps: number
  idempotencyKey: string
  commandFingerprint: string
  createdAt: Date
  updatedAt: Date
  startedAt: Date | null
}

export interface UpdateSettlementRunRecord {
  settlementRunId: string
  status: SettlementRunStatus
  totalPoolMinor: string
  houseTakeMinor: string
  netPoolMinor: string
  roundingResidualMinor: string
  carryoverMinor: string
  reasonCode: string | null
  errorCode: string | null
  errorMessage: string | null
  resultSnapshot: JsonObject | null
  completedAt: Date | null
  failedAt: Date | null
  updatedAt: Date
}

export interface CreateSettlementCarryoverRecord {
  carryoverId: string
  settlementRunId: string
  raceId: string
  currency: 'USDC'
  amountMinor: string
  status: 'pending' | 'applied' | 'voided'
  reasonCode: string
  createdAt: Date
  updatedAt: Date
}

export interface SettlementCarryoverRecord extends SettlementCarryoverDto {}

export interface CarryoverApplicationRecord {
  applicationId: string
  targetRaceId: string
  currency: 'USDC'
  idempotencyKey: string
  commandFingerprint: string
  totalAmountMinor: string
  appliedCarryoverIds: string[]
  resultSnapshot: JsonObject
  createdAt: Date
  completedAt: Date
}

export interface CreateCarryoverApplicationRecord {
  applicationId: string
  targetRaceId: string
  currency: 'USDC'
  idempotencyKey: string
  commandFingerprint: string
  totalAmountMinor: string
  appliedCarryoverIds: string[]
  resultSnapshot: JsonObject
  createdAt: Date
  completedAt: Date
}

export type SettlementRemediationActionType =
  | 'mark_manual_review'
  | 'resolve_manual_review'
  | 'void_pool_from_manual_review'

export interface SettlementRemediationActionRecord {
  remediationActionId: string
  actionType: SettlementRemediationActionType
  raceId: string
  currency: 'USDC'
  idempotencyKey: string
  commandFingerprint: string
  operatorId: string
  reasonCode: string
  reasonText: string | null
  resultSnapshot: JsonObject
  createdAt: Date
}

export interface CreateSettlementRemediationActionRecord {
  remediationActionId: string
  actionType: SettlementRemediationActionType
  raceId: string
  currency: 'USDC'
  idempotencyKey: string
  commandFingerprint: string
  operatorId: string
  reasonCode: string
  reasonText: string | null
  resultSnapshot: JsonObject
  createdAt: Date
}

export interface SettlementReconciliationIssueRecord {
  code: string
  severity: 'warning' | 'error'
  message: string
  details: JsonObject
}

export interface SettlementManualReviewItemRecord
  extends SettlementManualReviewItemDto {}

export interface SettlementReconciliationRunSummaryRecord
  extends SettlementReconciliationRunSummaryDto {}

export interface CreateSettlementReconciliationRunRecord {
  reconciliationRunId: string
  raceId: string
  currency: 'USDC'
  status: 'completed' | 'failed'
  classification: 'informational' | 'discrepancy' | 'actionable_incident'
  actionRequired: boolean
  issueCount: number
  errorCount: number
  warningCount: number
  issues: SettlementReconciliationIssueRecord[]
  requestedByOperatorId: string
  idempotencyKey: string
  correlationId: string
  causationId: string
  createdAt: Date
  completedAt: Date
}

export interface CreatePoolSelectionRecord {
  raceId: string
  selectionId: string
  currency: 'USDC'
  status: 'active' | 'inactive'
  displayName: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateBetRecord {
  betId: string
  userId: string
  raceId: string
  selectionId: string
  stakeMinor: string
  currency: 'USDC'
  status: FinancialBetDto['status']
  rejectionCode: string | null
  rejectionReason: string | null
  reservationId: string | null
  acceptedAt: Date | null
  rejectedAt: Date | null
  idempotencyKey: string
  correlationId: string
  causationId: string
  createdAt: Date
  updatedAt: Date
}

export interface BettingRepository {
  createRacePool(
    pool: CreateRacePoolRecord,
    transaction: DatabaseTransaction,
  ): Promise<void>
  getRacePool(
    raceId: string,
    currency: 'USDC',
    queryable?: Queryable,
  ): Promise<RacePoolDto | null>
  getRacePoolForUpdate(
    raceId: string,
    currency: 'USDC',
    transaction: DatabaseTransaction,
  ): Promise<RacePoolDto | null>
  updateRacePool(
    pool: RacePoolDto,
    transaction: DatabaseTransaction,
  ): Promise<void>
  listRacePools(
    currency: 'USDC',
    queryable?: Queryable,
  ): Promise<RacePoolDto[]>
  createPoolSelection(
    selection: CreatePoolSelectionRecord,
    transaction: DatabaseTransaction,
  ): Promise<void>
  getPoolSelection(
    raceId: string,
    selectionId: string,
    currency: 'USDC',
    queryable?: Queryable,
  ): Promise<PoolSelectionDto | null>
  listPoolSelections(
    raceId: string,
    currency: 'USDC',
    queryable?: Queryable,
  ): Promise<PoolSelectionDto[]>
  createBet(bet: CreateBetRecord, transaction: DatabaseTransaction): Promise<void>
  getBetById(
    betId: string,
    queryable?: Queryable,
  ): Promise<FinancialBetDto | null>
  listBetsByRaceId(
    raceId: string,
    queryable?: Queryable,
  ): Promise<FinancialBetDto[]>
  listBetsByRaceIdForUpdate(
    raceId: string,
    transaction: DatabaseTransaction,
  ): Promise<FinancialBetDto[]>
  listBetsByUserId(
    userId: string,
    queryable?: Queryable,
  ): Promise<FinancialBetDto[]>
  updateBetSettlementStatus(
    input: {
      betId: string
      status: FinancialBetDto['status']
      settlementRunId: string
      updatedAt: Date
    },
    transaction: DatabaseTransaction,
  ): Promise<void>
  createSettlementRun(
    run: CreateSettlementRunRecord,
    transaction: DatabaseTransaction,
  ): Promise<void>
  getSettlementRunByIdempotencyKey(
    idempotencyKey: string,
    queryable?: Queryable,
  ): Promise<SettlementRunRecord | null>
  getCompletedSettlementRunByRace(
    raceId: string,
    currency: 'USDC',
    queryable?: Queryable,
  ): Promise<SettlementRunRecord | null>
  getActiveSettlementRunByRace(
    raceId: string,
    currency: 'USDC',
    queryable?: Queryable,
  ): Promise<SettlementRunRecord | null>
  updateSettlementRun(
    run: UpdateSettlementRunRecord,
    transaction: DatabaseTransaction,
  ): Promise<void>
  createSettlementCarryover(
    carryover: CreateSettlementCarryoverRecord,
    transaction: DatabaseTransaction,
  ): Promise<void>
  listCarryovers(
    criteria: {
      status?: SettlementCarryoverDto['status']
      sourceRaceId?: string
      targetRaceId?: string
    },
    queryable?: Queryable,
  ): Promise<SettlementCarryoverDto[]>
  listPendingCarryoversForUpdate(
    currency: 'USDC',
    transaction: DatabaseTransaction,
  ): Promise<SettlementCarryoverDto[]>
  markCarryoverApplied(
    input: {
      carryoverId: string
      targetRaceId: string
      applicationId: string
      applicationTransactionId: string
      appliedAt: Date
      updatedAt: Date
    },
    transaction: DatabaseTransaction,
  ): Promise<void>
  getCarryoverApplicationByIdempotencyKey(
    idempotencyKey: string,
    queryable?: Queryable,
  ): Promise<CarryoverApplicationRecord | null>
  createCarryoverApplication(
    application: CreateCarryoverApplicationRecord,
    transaction: DatabaseTransaction,
  ): Promise<void>
  getSettlementRunById(
    settlementRunId: string,
    queryable?: Queryable,
  ): Promise<SettlementRunRecord | null>
  getLatestSettlementRunByRaceAndStatus(
    raceId: string,
    currency: 'USDC',
    status: SettlementRunStatus,
    queryable?: Queryable,
  ): Promise<SettlementRunRecord | null>
  getSettlementRemediationActionByIdempotencyKey(
    idempotencyKey: string,
    queryable?: Queryable,
  ): Promise<SettlementRemediationActionRecord | null>
  createSettlementRemediationAction(
    action: CreateSettlementRemediationActionRecord,
    transaction: DatabaseTransaction,
  ): Promise<void>
  detectSettlementReconciliationIssues(
    raceId: string,
    currency: 'USDC',
    queryable?: Queryable,
  ): Promise<SettlementReconciliationIssueRecord[]>
  listManualReviewItems(
    currency: 'USDC',
    queryable?: Queryable,
  ): Promise<SettlementManualReviewItemRecord[]>
  getSettlementReconciliationRunByIdempotencyKey(
    idempotencyKey: string,
    queryable?: Queryable,
  ): Promise<SettlementReconciliationRunSummaryRecord | null>
  createSettlementReconciliationRun(
    run: CreateSettlementReconciliationRunRecord,
    transaction: DatabaseTransaction,
  ): Promise<void>
  listSettlementReconciliationRuns(
    criteria: {
      raceId?: string
    },
    queryable?: Queryable,
  ): Promise<SettlementReconciliationRunSummaryRecord[]>
  getLivePoolTotal(
    raceId: string,
    currency: 'USDC',
    queryable?: Queryable,
  ): Promise<PoolTotalDto>
  listSelectionTotals(
    raceId: string,
    currency: 'USDC',
    queryable?: Queryable,
  ): Promise<SelectionTotalDto[]>
}
