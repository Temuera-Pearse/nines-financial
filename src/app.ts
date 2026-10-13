import express from 'express'

import type { AccountService } from './domains/accounting/services/AccountService.js'
import type { BalanceMaintenanceService } from './domains/accounting/services/BalanceMaintenanceService.js'
import type { PostingEngineService } from './domains/accounting/services/PostingEngineService.js'
import type { ReservationService } from './domains/accounting/services/ReservationService.js'
import {
  assertReadinessReportReady,
  type StartupReadinessReport,
} from './config/startupReadiness.js'
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
import { createNinesIssuanceAuthorizationRouter } from './handlers/http/ninesIssuanceAuthorizationRoutes.js'
import type { NinesIssuanceAuthorizationService } from './domains/issuance-authorizations/services/NinesIssuanceAuthorizationService.js'
import type { Database } from './shared/db/Database.js'
import type { BettingIntakeService } from './domains/betting/services/BettingIntakeService.js'
import { createNinesPlaceBetRouter } from './handlers/http/ninesPlaceBetRoutes.js'
import { createRaceLifecycleRouter } from './handlers/http/raceLifecycleRoutes.js'
import { RaceLifecycleProjectionService } from './domains/race-lifecycle/services/RaceLifecycleProjectionService.js'
import { createRaceResultRouter } from './handlers/http/raceResultRoutes.js'
import type { RaceResultSettlementService } from './domains/race-results/services/RaceResultSettlementService.js'
import { createPlayerGameplayRouter, PLAYER_GAMEPLAY_STATE_PATH } from './handlers/http/playerGameplayRoutes.js'

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
  ninesIssuanceAuthorizationService: NinesIssuanceAuthorizationService
  bettingIntakeService: BettingIntakeService
  raceResultSettlementService: RaceResultSettlementService
}

export interface CreateAppOptions {
  environment: 'development' | 'test' | 'production'
  readinessCheck?: () => Promise<StartupReadinessReport>
  database?: Database
  fundingAttestationsEnabled?: boolean
  legacyDepositProviderEnabled?: boolean
  serviceAuthCredentials?: Readonly<Record<string, Readonly<Record<string, string>>>>
  serviceAuthReplayWindowSeconds?: number
  wagerIntakeEnabled?: boolean
  raceLifecycleEnabled?: boolean
  raceResultEnabled?: boolean
  playerGameplayReadEnabled?: boolean
  backendServiceAuthCredentials?: Readonly<Record<string, Readonly<Record<string, string>>>>
  boundaryClock?: () => Date
}

export type HttpRouteProfile =
  | 'production-funding-only'
  | 'full-simulation'

export function resolveHttpRouteProfile(
  environment: CreateAppOptions['environment'],
): HttpRouteProfile {
  if (environment === 'production') return 'production-funding-only'
  if (environment === 'development' || environment === 'test') {
    return 'full-simulation'
  }
  throw new Error('HTTP application environment must be explicitly configured')
}

export const productionHttpRoutes = Object.freeze([
  Object.freeze({ method: 'GET', path: '/health' }),
  Object.freeze({ method: 'GET', path: '/ready' }),
  Object.freeze({ method: 'POST', path: '/internal/v1/funding-attestations' }),
  Object.freeze({ method: 'POST', path: '/internal/v1/nines-issuance-authorizations' }),
  Object.freeze({ method: 'POST', path: '/internal/v1/wagers/place-bet' }),
  Object.freeze({ method: 'POST', path: '/internal/v1/race-lifecycle-events' }),
  Object.freeze({ method: 'POST', path: '/internal/v1/race-results' }),
  Object.freeze({ method: 'POST', path: PLAYER_GAMEPLAY_STATE_PATH }),
] as const)

export function createApp(
  services: HttpApplicationServices,
  options: CreateAppOptions,
) {
  if (!options || !options.environment) {
    throw new Error('HTTP application environment must be explicitly configured')
  }
  const app = express()
  const routeProfile = resolveHttpRouteProfile(options.environment)
  const readinessCheck =
    options.readinessCheck ??
    (async () => ({
      checkedAt: new Date(),
      latestAvailableMigration: null,
      latestAppliedMigration: null,
      pendingMigrations: [],
    }))

  if (routeProfile === 'production-funding-only') {
    const approvedRequests = new Set(
      productionHttpRoutes
        .filter((route) => {
          if (['/internal/v1/funding-attestations',
            '/internal/v1/nines-issuance-authorizations'].includes(route.path)) {
            return options.fundingAttestationsEnabled
          }
          if (route.path === '/internal/v1/wagers/place-bet') return options.wagerIntakeEnabled
          if (route.path === '/internal/v1/race-lifecycle-events') return options.raceLifecycleEnabled
          if (route.path === '/internal/v1/race-results') return options.raceResultEnabled
          if (route.path === PLAYER_GAMEPLAY_STATE_PATH) return options.playerGameplayReadEnabled
          return true
        })
        .map((route) => `${route.method} ${route.path}`),
    )
    app.use((request, response, next) => {
      const rawPath = request.originalUrl.split('?', 1)[0]
      if (rawPath && approvedRequests.has(`${request.method} ${rawPath}`)) {
        next()
        return
      }
      response.status(404).end()
    })
  }

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
  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' })
  })

  app.get('/ready', async (_request, response) => {
    try {
      const readiness = await readinessCheck()
      assertReadinessReportReady(readiness)

      if (routeProfile === 'production-funding-only') {
        response.status(200).json({ status: 'ready' })
        return
      }

      response.status(200).json({
        status: 'ready',
        checkedAt: readiness.checkedAt.toISOString(),
        latestAvailableMigration: readiness.latestAvailableMigration,
        latestAppliedMigration: readiness.latestAppliedMigration,
        pendingMigrations: readiness.pendingMigrations,
      })
    } catch (error) {
      if (routeProfile === 'production-funding-only') {
        response.status(503).json({ status: 'not_ready' })
        return
      }

      response.status(503).json({
        status: 'not_ready',
        message:
          error instanceof Error ? error.message : 'Readiness check failed',
      })
    }
  })

  if (options.fundingAttestationsEnabled) {
    if (!options.database || !options.serviceAuthCredentials || !options.environment) {
      throw new Error('Funding attestation HTTP boundary requires database, environment, and service authentication secret')
    }
    app.use(createFundingAttestationRouter({ database: options.database,
      service: services.fundingAttestationService, environment: options.environment,
      credentials: options.serviceAuthCredentials,
      ...(options.serviceAuthReplayWindowSeconds === undefined ? {} : {
        replayWindowSeconds: options.serviceAuthReplayWindowSeconds,
      }) }))
    app.use(createNinesIssuanceAuthorizationRouter({
      service: services.ninesIssuanceAuthorizationService,
      environment: options.environment,
      credentials: options.serviceAuthCredentials,
      ...(options.serviceAuthReplayWindowSeconds === undefined ? {} : {
        replayWindowSeconds: options.serviceAuthReplayWindowSeconds,
      }),
      ...(options.boundaryClock === undefined ? {} : { clock: options.boundaryClock }),
    }))
  }

  if (options.wagerIntakeEnabled) {
    if (!options.database || !options.backendServiceAuthCredentials) {
      throw new Error('Wager intake HTTP boundary requires database and backend service authentication credentials')
    }
    app.use(createNinesPlaceBetRouter({
      service: services.bettingIntakeService,
      database: options.database,
      environment: options.environment,
      credentials: options.backendServiceAuthCredentials,
      ...(options.serviceAuthReplayWindowSeconds === undefined ? {} : {
        replayWindowSeconds: options.serviceAuthReplayWindowSeconds,
      }),
      ...(options.boundaryClock === undefined ? {} : { clock: options.boundaryClock }),
    }))
  }

  if (options.raceLifecycleEnabled) {
    if (!options.database || !options.backendServiceAuthCredentials) {
      throw new Error('Race lifecycle HTTP boundary requires database and backend service authentication credentials')
    }
    app.use(createRaceLifecycleRouter({
      service: new RaceLifecycleProjectionService(options.database),
      database: options.database,
      environment: options.environment,
      credentials: options.backendServiceAuthCredentials,
      ...(options.serviceAuthReplayWindowSeconds === undefined ? {} : {
        replayWindowSeconds: options.serviceAuthReplayWindowSeconds,
      }),
      ...(options.boundaryClock === undefined ? {} : { clock: options.boundaryClock }),
    }))
  }

  if (options.raceResultEnabled) {
    if (!options.database || !options.backendServiceAuthCredentials) {
      throw new Error('Race result HTTP boundary requires database and backend service authentication credentials')
    }
    app.use(createRaceResultRouter({
      service: services.raceResultSettlementService,
      database: options.database,
      environment: options.environment,
      credentials: options.backendServiceAuthCredentials,
      ...(options.serviceAuthReplayWindowSeconds === undefined ? {} : {
        replayWindowSeconds: options.serviceAuthReplayWindowSeconds,
      }),
      ...(options.boundaryClock === undefined ? {} : { clock: options.boundaryClock }),
    }))
  }

  if (options.playerGameplayReadEnabled) {
    if (!options.database || !options.serviceAuthCredentials) {
      throw new Error('Player gameplay read boundary requires database and API service authentication credentials')
    }
    app.use(createPlayerGameplayRouter({
      database: options.database,
      getPlayerBalanceHandler: services.getPlayerBalanceHandler,
      environment: options.environment,
      credentials: options.serviceAuthCredentials,
      ...(options.serviceAuthReplayWindowSeconds === undefined ? {} : {
        replayWindowSeconds: options.serviceAuthReplayWindowSeconds,
      }),
      ...(options.boundaryClock === undefined ? {} : { clock: options.boundaryClock }),
    }))
  }

  // Production terminates composition here. Future routers added below remain
  // unavailable until they are deliberately added to the production allowlist.
  if (routeProfile === 'production-funding-only') {
    app.use(errorHandler)
    return app
  }

  app.use((request, response, next) => {
    const authenticatedUserId = request.header('x-nines-authenticated-user-id')

    if (authenticatedUserId?.trim()) {
      response.locals.authenticatedUserId = authenticatedUserId.trim()
    }

    next()
  })

  app.use('/accounts', createAccountsRouter(services.accountService))
  app.use(
    createPlayerAccountsRouter({
      getPlayerAccountSummaryHandler:
        services.getPlayerAccountSummaryHandler,
      getPlayerBalanceHandler: services.getPlayerBalanceHandler,
    }),
  )
  app.use(createAdminReadOnlyRouter(services.adminOpsReadService))
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
      listFinancialBetsByRaceHandler:
        services.listFinancialBetsByRaceHandler,
      listFinancialBetsByUserHandler:
        services.listFinancialBetsByUserHandler,
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
