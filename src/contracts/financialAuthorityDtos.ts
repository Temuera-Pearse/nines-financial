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
  acceptedBets: readonly SettlementAcceptedBetContract[]
  totalPoolMinor: MinorUnitString
  houseTakeBps: number
  currency: FinancialCurrency
  idempotencyKey: string
  correlationId: string
  causationId: string
}

export interface SettlementAcceptedBetContract {
  betId: string
  userId: string
  selectionId: string
  stakeMinor: MinorUnitString
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
  raceId: string
  winningSelectionId: string
  totalPoolMinor: MinorUnitString
  houseTakeMinor: MinorUnitString
  netPoolMinor: MinorUnitString
  roundingResidualMinor: MinorUnitString
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
