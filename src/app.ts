import express from 'express'

import type { AccountService } from './domains/accounting/services/AccountService.js'
import type { BalanceMaintenanceService } from './domains/accounting/services/BalanceMaintenanceService.js'
import type { PostingEngineService } from './domains/accounting/services/PostingEngineService.js'
import type { ReservationService } from './domains/accounting/services/ReservationService.js'
import type { StartupReadinessReport } from './config/startupReadiness.js'
import type { AdminOpsReadService } from './domains/admin/services/AdminOpsReadService.js'
import type { ApplyFreezeHandler } from './domains/account/handlers/ApplyFreezeHandler.js'
import type { ApplyRestrictionHandler } from './domains/account/handlers/ApplyRestrictionHandler.js'
import type { ApplySuspensionHandler } from './domains/account/handlers/ApplySuspensionHandler.js'
import type { GetAdminAccountInspectionHandler } from './domains/account/handlers/GetAdminAccountInspectionHandler.js'
import type { GetPlayerAccountSummaryHandler } from './domains/account/handlers/GetPlayerAccountSummaryHandler.js'
import type { GetPlayerBalanceHandler } from './domains/account/handlers/GetPlayerBalanceHandler.js'
import type { LiftFreezeHandler } from './domains/account/handlers/LiftFreezeHandler.js'
import type { LiftRestrictionHandler } from './domains/account/handlers/LiftRestrictionHandler.js'
import type { LiftSuspensionHandler } from './domains/account/handlers/LiftSuspensionHandler.js'
import type {
  CreateRacePoolHandler,
  FreezePoolHandler,
  PlaceBetHandler,
  RegisterPoolSelectionHandler,
} from './domains/betting/handlers/BettingCommandHandlers.js'
import type {
  DetectSettlementReconciliationHandler,
  GetFinancialBetHandler,
  GetLivePoolTotalHandler,
  GetRacePoolHandler,
  ListCarryoversHandler,
  ListFinancialBetsByRaceHandler,
  ListFinancialBetsByUserHandler,
  ListManualReviewItemsHandler,
  ListSettlementReconciliationRunsHandler,
  ListSelectionTotalsHandler,
  RunSettlementReconciliationHandler,
} from './domains/betting/handlers/BettingQueryHandlers.js'
import type {
  ApplyCarryoversToRaceHandler,
  ApplyHouseTakeHandler,
  MarkSettlementManualReviewHandler,
  ReleaseReservationHandler,
  ResolveSettlementManualReviewHandler,
  ReserveStakeHandler,
  SettleBetHandler,
  VoidPoolFromManualReviewHandler,
} from './domains/financial-commands/handlers/FinancialCommandHandlers.js'
import type {
  CreateDepositIntentHandler,
  ApproveProviderDepositCreditHandler,
  DetectDepositReconciliationHandler,
  GetDepositIntentHandler,
  IngestProviderDepositEventHandler,
  LinkProviderDepositEventHandler,
  ListDepositReviewItemsHandler,
  MarkDepositReviewedNoCreditHandler,
  RejectProviderDepositEventHandler,
  RetryProviderDepositCreditHandler,
} from './domains/deposits/handlers/DepositHandlers.js'
import type { DepositProviderAdapter } from './domains/deposits/providers/DepositProviderAdapter.js'
import type {
  ApproveWithdrawalRequestHandler,
  CancelWithdrawalRequestHandler,
  CreateWithdrawalRequestHandler,
  DetectWithdrawalReconciliationHandler,
  FinalizeWithdrawalRequestHandler,
  GetWithdrawalRequestHandler,
  IngestWithdrawalProviderWebhookHandler,
  ListWithdrawalReviewItemsHandler,
  MarkWithdrawalProviderFailureTerminalHandler,
  MarkWithdrawalProviderUnknownReviewedHandler,
  RejectWithdrawalRequestHandler,
  ReleaseWithdrawalProviderFailureHandler,
  SubmitWithdrawalRequestHandler,
  SyncWithdrawalProviderStatusHandler,
} from './domains/withdrawals/handlers/WithdrawalHandlers.js'
import type { WithdrawalProviderAdapter } from './domains/withdrawals/providers/WithdrawalProviderAdapter.js'
import type {
  AccountingIntegrityHandler,
  AcknowledgeDiscrepancyHandler,
  AssignDiscrepancyHandler,
  DepositTimelineHandler,
  FreezeRiskAccountHandler,
  GetDiscrepancyHandler,
  GetRiskAccountHandler,
  LedgerBalanceCheckHandler,
  ListDiscrepanciesHandler,
  PlayerFinancialTimelineHandler,
  RebuildBalancesOperationalHandler,
  ReopenDiscrepancyHandler,
  ResolveDiscrepancyHandler,
  RunOperationalReconciliationHandler,
  SuppressDiscrepancyHandler,
  TreasurySummaryHandler,
  UnfreezeRiskAccountHandler,
  WithdrawalTimelineHandler,
} from './domains/operations/handlers/OperationsHandlers.js'
import { createAdminAccountsRouter } from './handlers/http/adminAccountsRoutes.js'
import { createAdminOperationsRouter } from './handlers/http/adminOperationsRoutes.js'
import { createAdminReadOnlyRouter } from './handlers/http/adminReadOnlyRoutes.js'
import { createAccountsRouter } from './handlers/http/accountsRoutes.js'
import { createBettingQueryRouter } from './handlers/http/bettingQueryRoutes.js'
import { createDepositRouter } from './handlers/http/depositRoutes.js'
import { errorHandler } from './handlers/http/errorHandler.js'
import { createFinancialCommandRouter } from './handlers/http/financialCommandRoutes.js'
import { createLedgerRouter } from './handlers/http/ledgerRoutes.js'
import { createPlayerAccountsRouter } from './handlers/http/playerAccountsRoutes.js'
import { createSystemRouter } from './handlers/http/systemRoutes.js'
import { createWithdrawalRouter } from './handlers/http/withdrawalRoutes.js'
import { createFundingAttestationRouter } from './handlers/http/fundingAttestationRoutes.js'
import type { FundingAttestationService } from './domains/funding-attestations/services/FundingAttestationService.js'
import type { Database } from './shared/db/Database.js'

export interface HttpApplicationServices {
  accountService: AccountService
  balanceMaintenanceService: BalanceMaintenanceService
  postingEngineService: PostingEngineService
  reservationService: ReservationService
  adminOpsReadService: AdminOpsReadService
  getPlayerAccountSummaryHandler: GetPlayerAccountSummaryHandler
  getPlayerBalanceHandler: GetPlayerBalanceHandler
  getAdminAccountInspectionHandler: GetAdminAccountInspectionHandler
  applyRestrictionHandler: ApplyRestrictionHandler
  liftRestrictionHandler: LiftRestrictionHandler
  applySuspensionHandler: ApplySuspensionHandler
  liftSuspensionHandler: LiftSuspensionHandler
  applyFreezeHandler: ApplyFreezeHandler
  liftFreezeHandler: LiftFreezeHandler
  reserveStakeHandler: ReserveStakeHandler
  releaseReservationHandler: ReleaseReservationHandler
  settleBetHandler: SettleBetHandler
  applyHouseTakeHandler: ApplyHouseTakeHandler
  applyCarryoversToRaceHandler: ApplyCarryoversToRaceHandler
  markSettlementManualReviewHandler: MarkSettlementManualReviewHandler
  resolveSettlementManualReviewHandler: ResolveSettlementManualReviewHandler
  voidPoolFromManualReviewHandler: VoidPoolFromManualReviewHandler
  createRacePoolHandler: CreateRacePoolHandler
  registerPoolSelectionHandler: RegisterPoolSelectionHandler
  freezePoolHandler: FreezePoolHandler
  placeBetHandler: PlaceBetHandler
  detectSettlementReconciliationHandler: DetectSettlementReconciliationHandler
  getRacePoolHandler: GetRacePoolHandler
  getFinancialBetHandler: GetFinancialBetHandler
  listFinancialBetsByRaceHandler: ListFinancialBetsByRaceHandler
  listFinancialBetsByUserHandler: ListFinancialBetsByUserHandler
  listCarryoversHandler: ListCarryoversHandler
  listManualReviewItemsHandler: ListManualReviewItemsHandler
  runSettlementReconciliationHandler: RunSettlementReconciliationHandler
  listSettlementReconciliationRunsHandler: ListSettlementReconciliationRunsHandler
  getLivePoolTotalHandler: GetLivePoolTotalHandler
  listSelectionTotalsHandler: ListSelectionTotalsHandler
  createDepositIntentHandler: CreateDepositIntentHandler
  getDepositIntentHandler: GetDepositIntentHandler
  ingestProviderDepositEventHandler: IngestProviderDepositEventHandler
  listDepositReviewItemsHandler: ListDepositReviewItemsHandler
  detectDepositReconciliationHandler: DetectDepositReconciliationHandler
  markDepositReviewedNoCreditHandler: MarkDepositReviewedNoCreditHandler
  rejectProviderDepositEventHandler: RejectProviderDepositEventHandler
  linkProviderDepositEventHandler: LinkProviderDepositEventHandler
  approveProviderDepositCreditHandler: ApproveProviderDepositCreditHandler
  retryProviderDepositCreditHandler: RetryProviderDepositCreditHandler
  depositProviderAdapter: DepositProviderAdapter
  createWithdrawalRequestHandler: CreateWithdrawalRequestHandler
  getWithdrawalRequestHandler: GetWithdrawalRequestHandler
  listWithdrawalReviewItemsHandler: ListWithdrawalReviewItemsHandler
  detectWithdrawalReconciliationHandler: DetectWithdrawalReconciliationHandler
  approveWithdrawalRequestHandler: ApproveWithdrawalRequestHandler
  rejectWithdrawalRequestHandler: RejectWithdrawalRequestHandler
  cancelWithdrawalRequestHandler: CancelWithdrawalRequestHandler
  submitWithdrawalRequestHandler: SubmitWithdrawalRequestHandler
  syncWithdrawalProviderStatusHandler: SyncWithdrawalProviderStatusHandler
  ingestWithdrawalProviderWebhookHandler: IngestWithdrawalProviderWebhookHandler
  finalizeWithdrawalRequestHandler: FinalizeWithdrawalRequestHandler
  releaseWithdrawalProviderFailureHandler: ReleaseWithdrawalProviderFailureHandler
  markWithdrawalProviderFailureTerminalHandler: MarkWithdrawalProviderFailureTerminalHandler
  markWithdrawalProviderUnknownReviewedHandler: MarkWithdrawalProviderUnknownReviewedHandler
  withdrawalProviderAdapter: WithdrawalProviderAdapter
  runOperationalReconciliationHandler: RunOperationalReconciliationHandler
  listDiscrepanciesHandler: ListDiscrepanciesHandler
  getDiscrepancyHandler: GetDiscrepancyHandler
  acknowledgeDiscrepancyHandler: AcknowledgeDiscrepancyHandler
  assignDiscrepancyHandler: AssignDiscrepancyHandler
  resolveDiscrepancyHandler: ResolveDiscrepancyHandler
  suppressDiscrepancyHandler: SuppressDiscrepancyHandler
  reopenDiscrepancyHandler: ReopenDiscrepancyHandler
  ledgerBalanceCheckHandler: LedgerBalanceCheckHandler
  accountingIntegrityHandler: AccountingIntegrityHandler
  treasurySummaryHandler: TreasurySummaryHandler
  freezeRiskAccountHandler: FreezeRiskAccountHandler
  unfreezeRiskAccountHandler: UnfreezeRiskAccountHandler
  getRiskAccountHandler: GetRiskAccountHandler
  rebuildBalancesOperationalHandler: RebuildBalancesOperationalHandler
  playerFinancialTimelineHandler: PlayerFinancialTimelineHandler
  depositTimelineHandler: DepositTimelineHandler
  withdrawalTimelineHandler: WithdrawalTimelineHandler
  fundingAttestationService: FundingAttestationService
}

export interface CreateAppOptions {
  readinessCheck?: () => Promise<StartupReadinessReport>
  database?: Database
  environment?: 'development' | 'test' | 'production'
  fundingAttestationsEnabled?: boolean
  legacyDepositProviderEnabled?: boolean
  serviceAuthHmacSecret?: string
  serviceAuthKeyId?: string
  serviceAuthReplayWindowSeconds?: number
}

export function createApp(
  services: HttpApplicationServices,
  options: CreateAppOptions = {},
) {
  const app = express()
  const readinessCheck =
    options.readinessCheck ??
    (async () => ({
      checkedAt: new Date(),
      latestAvailableMigration: null,
      latestAppliedMigration: null,
      pendingMigrations: [],
    }))

  app.use(
    express.json({
      verify: (request, _response, buffer) => {
        const requestWithRawBody = request as typeof request & {
          rawBody?: Buffer
        }
        requestWithRawBody.rawBody = Buffer.from(buffer)
      },
    }),
  )
  app.use((request, response, next) => {
    const authenticatedUserId = request.header('x-nines-authenticated-user-id')

    if (authenticatedUserId?.trim()) {
      response.locals.authenticatedUserId = authenticatedUserId.trim()
    }

    next()
  })

  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' })
  })

  app.get('/ready', async (_request, response) => {
    try {
      const readiness = await readinessCheck()

      response.status(200).json({
        status: 'ready',
        checkedAt: readiness.checkedAt.toISOString(),
        latestAvailableMigration: readiness.latestAvailableMigration,
        latestAppliedMigration: readiness.latestAppliedMigration,
        pendingMigrations: readiness.pendingMigrations,
      })
    } catch (error) {
      response.status(503).json({
        status: 'not_ready',
        message:
          error instanceof Error ? error.message : 'Readiness check failed',
      })
    }
  })

  app.use('/accounts', createAccountsRouter(services.accountService))
  app.use(
    createPlayerAccountsRouter({
      getPlayerAccountSummaryHandler: services.getPlayerAccountSummaryHandler,
      getPlayerBalanceHandler: services.getPlayerBalanceHandler,
    }),
  )
  app.use(
    createAdminReadOnlyRouter(services.adminOpsReadService),
  )
  app.use(
    createAdminAccountsRouter({
      getAdminAccountInspectionHandler:
        services.getAdminAccountInspectionHandler,
      applyRestrictionHandler: services.applyRestrictionHandler,
      liftRestrictionHandler: services.liftRestrictionHandler,
      applySuspensionHandler: services.applySuspensionHandler,
      liftSuspensionHandler: services.liftSuspensionHandler,
      applyFreezeHandler: services.applyFreezeHandler,
      liftFreezeHandler: services.liftFreezeHandler,
    }),
  )
  app.use(
    createAdminOperationsRouter({
      listCarryoversHandler: services.listCarryoversHandler,
      listManualReviewItemsHandler: services.listManualReviewItemsHandler,
      detectSettlementReconciliationHandler:
        services.detectSettlementReconciliationHandler,
      runSettlementReconciliationHandler:
        services.runSettlementReconciliationHandler,
      listSettlementReconciliationRunsHandler:
        services.listSettlementReconciliationRunsHandler,
      runOperationalReconciliationHandler:
        services.runOperationalReconciliationHandler,
      listDiscrepanciesHandler: services.listDiscrepanciesHandler,
      getDiscrepancyHandler: services.getDiscrepancyHandler,
      acknowledgeDiscrepancyHandler:
        services.acknowledgeDiscrepancyHandler,
      assignDiscrepancyHandler: services.assignDiscrepancyHandler,
      resolveDiscrepancyHandler: services.resolveDiscrepancyHandler,
      suppressDiscrepancyHandler: services.suppressDiscrepancyHandler,
      reopenDiscrepancyHandler: services.reopenDiscrepancyHandler,
      ledgerBalanceCheckHandler: services.ledgerBalanceCheckHandler,
      accountingIntegrityHandler: services.accountingIntegrityHandler,
      treasurySummaryHandler: services.treasurySummaryHandler,
      freezeRiskAccountHandler: services.freezeRiskAccountHandler,
      unfreezeRiskAccountHandler: services.unfreezeRiskAccountHandler,
      getRiskAccountHandler: services.getRiskAccountHandler,
      rebuildBalancesOperationalHandler:
        services.rebuildBalancesOperationalHandler,
      playerFinancialTimelineHandler:
        services.playerFinancialTimelineHandler,
      depositTimelineHandler: services.depositTimelineHandler,
      withdrawalTimelineHandler: services.withdrawalTimelineHandler,
    }),
  )
  app.use(
    '/ledger',
    createLedgerRouter(
      services.postingEngineService,
      services.reservationService,
    ),
  )
  app.use(
    '/commands',
    createFinancialCommandRouter({
      reserveStakeHandler: services.reserveStakeHandler,
      releaseReservationHandler: services.releaseReservationHandler,
      settleBetHandler: services.settleBetHandler,
      applyHouseTakeHandler: services.applyHouseTakeHandler,
      applyCarryoversToRaceHandler: services.applyCarryoversToRaceHandler,
      markSettlementManualReviewHandler:
        services.markSettlementManualReviewHandler,
      resolveSettlementManualReviewHandler:
        services.resolveSettlementManualReviewHandler,
      voidPoolFromManualReviewHandler:
        services.voidPoolFromManualReviewHandler,
      createRacePoolHandler: services.createRacePoolHandler,
      registerPoolSelectionHandler: services.registerPoolSelectionHandler,
      freezePoolHandler: services.freezePoolHandler,
      placeBetHandler: services.placeBetHandler,
    }),
  )
  app.use(
    createBettingQueryRouter({
      detectSettlementReconciliationHandler:
        services.detectSettlementReconciliationHandler,
      getRacePoolHandler: services.getRacePoolHandler,
      getFinancialBetHandler: services.getFinancialBetHandler,
      listFinancialBetsByRaceHandler: services.listFinancialBetsByRaceHandler,
      listFinancialBetsByUserHandler: services.listFinancialBetsByUserHandler,
      listCarryoversHandler: services.listCarryoversHandler,
      getLivePoolTotalHandler: services.getLivePoolTotalHandler,
      listSelectionTotalsHandler: services.listSelectionTotalsHandler,
    }),
  )
  if (options.legacyDepositProviderEnabled !== false) {
    app.use(createDepositRouter({
      createDepositIntentHandler: services.createDepositIntentHandler,
      getDepositIntentHandler: services.getDepositIntentHandler,
      ingestProviderDepositEventHandler:
        services.ingestProviderDepositEventHandler,
      listDepositReviewItemsHandler: services.listDepositReviewItemsHandler,
      detectDepositReconciliationHandler:
        services.detectDepositReconciliationHandler,
      markDepositReviewedNoCreditHandler:
        services.markDepositReviewedNoCreditHandler,
      rejectProviderDepositEventHandler:
        services.rejectProviderDepositEventHandler,
      linkProviderDepositEventHandler: services.linkProviderDepositEventHandler,
      approveProviderDepositCreditHandler:
        services.approveProviderDepositCreditHandler,
      retryProviderDepositCreditHandler:
        services.retryProviderDepositCreditHandler,
      depositProviderAdapter: services.depositProviderAdapter,
    }))
  }
  if (options.fundingAttestationsEnabled) {
    if (!options.database || !options.serviceAuthHmacSecret || !options.environment) {
      throw new Error('Funding attestation HTTP boundary requires database, environment, and service authentication secret')
    }
    app.use(createFundingAttestationRouter({ database: options.database,
      service: services.fundingAttestationService, environment: options.environment,
      hmacSecret: options.serviceAuthHmacSecret,
      expectedKeyId: options.serviceAuthKeyId ?? 'development-hmac-v1',
      ...(options.serviceAuthReplayWindowSeconds === undefined ? {} : {
        replayWindowSeconds: options.serviceAuthReplayWindowSeconds,
      }) }))
  }
  app.use(
    createWithdrawalRouter(
      {
        createWithdrawalRequestHandler:
          services.createWithdrawalRequestHandler,
        getWithdrawalRequestHandler: services.getWithdrawalRequestHandler,
        listWithdrawalReviewItemsHandler:
          services.listWithdrawalReviewItemsHandler,
        detectWithdrawalReconciliationHandler:
          services.detectWithdrawalReconciliationHandler,
        approveWithdrawalRequestHandler:
          services.approveWithdrawalRequestHandler,
        rejectWithdrawalRequestHandler:
          services.rejectWithdrawalRequestHandler,
        cancelWithdrawalRequestHandler:
          services.cancelWithdrawalRequestHandler,
        submitWithdrawalRequestHandler:
          services.submitWithdrawalRequestHandler,
        syncWithdrawalProviderStatusHandler:
          services.syncWithdrawalProviderStatusHandler,
        ingestWithdrawalProviderWebhookHandler:
          services.ingestWithdrawalProviderWebhookHandler,
        finalizeWithdrawalRequestHandler:
          services.finalizeWithdrawalRequestHandler,
        releaseWithdrawalProviderFailureHandler:
          services.releaseWithdrawalProviderFailureHandler,
        markWithdrawalProviderFailureTerminalHandler:
          services.markWithdrawalProviderFailureTerminalHandler,
        markWithdrawalProviderUnknownReviewedHandler:
          services.markWithdrawalProviderUnknownReviewedHandler,
      },
      services.withdrawalProviderAdapter,
    ),
  )
  app.use('/system', createSystemRouter(services.balanceMaintenanceService))
  app.use(errorHandler)

  return app
}
