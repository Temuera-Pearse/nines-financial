export type MinorUnitString = string

export type FinancialCurrency = 'USDC'

export interface PlayerAccountSummaryContract {
  playerAccountId: string
  userId: string
  currency: FinancialCurrency
  effectiveStatus: 'active' | 'restricted' | 'suspended' | 'frozen'
  displayBalanceMinor: MinorUnitString
  spendableBalanceMinor: MinorUnitString
  asOf: string
}

export interface PlayerBalanceContract {
  playerAccountId: string
  currency: FinancialCurrency
  spendableBalanceMinor: MinorUnitString
  lockedBalanceMinor: MinorUnitString
  restrictedBalanceMinor: MinorUnitString
  displayBalanceMinor: MinorUnitString
  asOf: string
}

export interface ReserveStakeCommandContract {
  userId: string
  betId: string
  raceId: string
  selectionId: string
  stakeMinor: MinorUnitString
  currency: FinancialCurrency
  idempotencyKey: string
  correlationId: string
  causationId: string
}

export interface ReserveStakeResultContract {
  reservationId: string
  acceptedAt: string
}

export interface ReleaseReservationCommandContract {
  reservationId: string
  reasonCode: string
  idempotencyKey: string
  correlationId: string
  causationId: string
}

export interface ReleaseReservationResultContract {
  reservationId: string
  releasedAt: string
}

export interface SettleBetCommandContract {
  raceId: string
  winningSelectionId: string
  houseTakeBps: number
  currency: FinancialCurrency
  idempotencyKey: string
  correlationId: string
  causationId: string
}

export interface SettledBetResultContract {
  betId: string
  userId: string
  selectionId: string
  resultStatus: 'won' | 'lost' | 'void'
  stakeMinor: MinorUnitString
  payoutMinor: MinorUnitString
  captureTransactionId: string
  payoutTransactionId: string | null
}

export interface SettleBetResultContract {
  settlementRunId: string
  status: 'completed' | 'manual_review'
  reasonCode: string | null
  raceId: string
  winningSelectionId: string
  totalPoolMinor: MinorUnitString
  acceptedStakeMinor: MinorUnitString
  appliedCarryoverMinor: MinorUnitString
  houseTakeMinor: MinorUnitString
  netPoolMinor: MinorUnitString
  roundingResidualMinor: MinorUnitString
  carryoverMinor: MinorUnitString
  settledBets: readonly SettledBetResultContract[]
  settledAt: string
}

export interface ApplyHouseTakeCommandContract {
  raceId: string
  amountMinor: MinorUnitString
  currency: FinancialCurrency
  idempotencyKey: string
  correlationId: string
  causationId: string
}

export interface ApplyHouseTakeResultContract {
  raceId: string
  amountMinor: MinorUnitString
  appliedAt: string
}

export interface AppliedCarryoverContract {
  carryoverId: string
  sourceRaceId: string
  targetRaceId: string | null
  currency: FinancialCurrency
  amountMinor: MinorUnitString
  status: 'pending' | 'applied' | 'voided'
  reasonCode: string
  applicationId: string | null
  applicationTransactionId: string | null
  appliedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ApplyCarryoversToRaceCommandContract {
  targetRaceId: string
  currency: FinancialCurrency
  idempotencyKey: string
  correlationId: string
  causationId: string
}

export interface ApplyCarryoversToRaceResultContract {
  applicationId: string
  targetRaceId: string
  currency: FinancialCurrency
  totalAppliedMinor: MinorUnitString
  appliedCarryovers: readonly AppliedCarryoverContract[]
  appliedAt: string
}

export interface MarkSettlementManualReviewCommandContract {
  raceId: string
  currency: FinancialCurrency
  operatorId: string
  reasonCode: string
  reasonText?: string | null
  idempotencyKey: string
  correlationId: string
  causationId: string
}

export interface ResolveSettlementManualReviewCommandContract {
  raceId: string
  currency: FinancialCurrency
  operatorId: string
  resolutionCode: string
  reasonText?: string | null
  idempotencyKey: string
  correlationId: string
  causationId: string
}

export interface VoidPoolFromManualReviewCommandContract {
  raceId: string
  currency: FinancialCurrency
  operatorId: string
  reasonCode: string
  reasonText?: string | null
  idempotencyKey: string
  correlationId: string
  causationId: string
}

export interface SettlementRemediationResultContract {
  remediationActionId: string
  actionType:
    | 'mark_manual_review'
    | 'resolve_manual_review'
    | 'void_pool_from_manual_review'
  raceId: string
  currency: FinancialCurrency
  poolStatus: RacePoolContract['status']
  settlementRunId: string | null
  settlementRunStatus:
    | 'pending'
    | 'running'
    | 'posting_required'
    | 'completed'
    | 'failed'
    | 'manual_review'
    | null
  operatorId: string
  reasonCode: string
  reasonText: string | null
  actedAt: string
}

export interface CreateRacePoolCommandContract {
  raceId: string
  currency: FinancialCurrency
  bettingOpensAt?: string | null
  bettingClosesAt?: string | null
  idempotencyKey: string
  correlationId: string
  causationId: string
}

export interface RacePoolContract {
  raceId: string
  currency: FinancialCurrency
  status:
    | 'open'
    | 'frozen'
    | 'settlement_running'
    | 'settled'
    | 'voided'
    | 'manual_review'
  bettingOpensAt: string | null
  bettingClosesAt: string | null
  createdAt: string
  updatedAt: string
  frozenAt: string | null
}

export interface RegisterPoolSelectionCommandContract {
  raceId: string
  selectionId: string
  currency: FinancialCurrency
  status?: 'active' | 'inactive'
  displayName?: string | null
  idempotencyKey: string
  correlationId: string
  causationId: string
}

export interface PoolSelectionContract {
  raceId: string
  selectionId: string
  currency: FinancialCurrency
  status: 'active' | 'inactive'
  displayName: string | null
  createdAt: string
  updatedAt: string
}

export interface RacePoolWithSelectionsContract {
  pool: RacePoolContract
  selections: PoolSelectionContract[]
  carryoverSummary: {
    appliedCarryoverMinor: MinorUnitString
    appliedCarryoverCount: number
    pendingCarryoverMinor: MinorUnitString
    pendingCarryoverCount: number
  }
}

export interface FreezePoolCommandContract {
  raceId: string
  currency: FinancialCurrency
  reasonCode: string
  idempotencyKey: string
  correlationId: string
  causationId: string
}

export interface PlaceBetCommandContract {
  betId: string
  userId: string
  raceId: string
  selectionId: string
  stakeMinor: MinorUnitString
  currency: FinancialCurrency
  idempotencyKey: string
  correlationId: string
  causationId: string
}

export type FinancialBetStatusContract =
  | 'accepted'
  | 'rejected'
  | 'settlement_pending'
  | 'settled_win'
  | 'settled_loss'
  | 'voided'
  | 'manual_review'

export interface FinancialBetContract {
  betId: string
  userId: string
  raceId: string
  selectionId: string
  stakeMinor: MinorUnitString
  currency: FinancialCurrency
  status: FinancialBetStatusContract
  rejectionCode: string | null
  rejectionReason: string | null
  reservationId: string | null
  acceptedAt: string | null
  rejectedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface PlaceBetResultContract {
  bet: FinancialBetContract
  reservationId: string | null
  accepted: boolean
}

export interface PoolTotalContract {
  raceId: string
  currency: FinancialCurrency
  totalAcceptedStakeMinor: MinorUnitString
  appliedCarryoverMinor: MinorUnitString
  totalDistributableBasisMinor: MinorUnitString
  acceptedBetCount: number
  asOf: string
}

export interface SelectionTotalContract {
  raceId: string
  selectionId: string
  currency: FinancialCurrency
  totalAcceptedStakeMinor: MinorUnitString
  acceptedBetCount: number
  asOf: string
}

export interface SettlementReconciliationIssueContract {
  code: string
  severity: 'warning' | 'error'
  message: string
  details: Record<string, unknown>
}

export interface SettlementReconciliationReportContract {
  raceId: string
  currency: FinancialCurrency
  checkedAt: string
  issues: readonly SettlementReconciliationIssueContract[]
}

export interface SettlementManualReviewItemContract {
  raceId: string
  currency: FinancialCurrency
  poolStatus: RacePoolContract['status']
  poolUpdatedAt: string
  settlementRunId: string | null
  settlementRunStatus:
    | 'pending'
    | 'running'
    | 'posting_required'
    | 'completed'
    | 'failed'
    | 'manual_review'
    | null
  settlementRunUpdatedAt: string | null
  reasonCode: string | null
  errorCode: string | null
  errorMessage: string | null
}

export interface SettlementReconciliationRunSummaryContract {
  reconciliationRunId: string
  raceId: string
  currency: FinancialCurrency
  status: 'completed' | 'failed'
  classification: 'informational' | 'discrepancy' | 'actionable_incident'
  actionRequired: boolean
  issueCount: number
  errorCount: number
  warningCount: number
  issues: readonly SettlementReconciliationIssueContract[]
  requestedByOperatorId: string
  idempotencyKey: string
  correlationId: string
  causationId: string
  createdAt: string
  completedAt: string
}

export interface FundingDepositIntentContract {
  userId: string
  currency: FinancialCurrency
  amountMinor: MinorUnitString
  provider: 'crypto'
  network: string
  idempotencyKey: string
}

export interface AccountRestrictionCommandContract {
  playerAccountId: string
  blockedActions: readonly string[]
  reasonCode: string
  reasonText: string
  ticketId: string
  idempotencyKey: string
}

export interface AccountSuspensionCommandContract {
  playerAccountId: string
  reasonCode: string
  reasonText: string
  ticketId: string
  expiresAt: string | null
  idempotencyKey: string
}

export interface AccountFreezeCommandContract {
  playerAccountId: string
  reasonCode: string
  reasonText: string
  ticketId: string
  idempotencyKey: string
}
