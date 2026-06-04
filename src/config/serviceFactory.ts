import type { Database } from '../shared/db/Database.js'
import {
  NoopFaultInjector,
  type FaultInjector,
} from '../shared/faults/FaultInjector.js'
import { createLogger, type Logger } from '../shared/observability/logger.js'
import { SystemClock, type Clock } from '../shared/time/Clock.js'
import { AccountingAccountAdapter } from '../domains/account/adapters/AccountingAccountAdapter.js'
import { AdminOpsReadService } from '../domains/admin/services/AdminOpsReadService.js'
import { AccountAuditService } from '../domains/account/audit/AccountAuditService.js'
import { ApplyFreezeHandler } from '../domains/account/handlers/ApplyFreezeHandler.js'
import { ApplyRestrictionHandler } from '../domains/account/handlers/ApplyRestrictionHandler.js'
import { ApplySuspensionHandler } from '../domains/account/handlers/ApplySuspensionHandler.js'
import { GetAdminAccountInspectionHandler } from '../domains/account/handlers/GetAdminAccountInspectionHandler.js'
import { GetPlayerAccountSummaryHandler } from '../domains/account/handlers/GetPlayerAccountSummaryHandler.js'
import { GetPlayerBalanceHandler } from '../domains/account/handlers/GetPlayerBalanceHandler.js'
import { LiftFreezeHandler } from '../domains/account/handlers/LiftFreezeHandler.js'
import { LiftRestrictionHandler } from '../domains/account/handlers/LiftRestrictionHandler.js'
import { LiftSuspensionHandler } from '../domains/account/handlers/LiftSuspensionHandler.js'
import {
  CreateRacePoolHandler,
  FreezePoolHandler,
  PlaceBetHandler,
  RegisterPoolSelectionHandler,
} from '../domains/betting/handlers/BettingCommandHandlers.js'
import {
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
} from '../domains/betting/handlers/BettingQueryHandlers.js'
import { PostgresBettingRepository } from '../domains/betting/repositories/postgres/PostgresBettingRepository.js'
import { BettingIntakeService } from '../domains/betting/services/BettingIntakeService.js'
import {
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
} from '../domains/deposits/handlers/DepositHandlers.js'
import { PostgresDepositRepository } from '../domains/deposits/repositories/postgres/PostgresDepositRepository.js'
import { DepositService } from '../domains/deposits/services/DepositService.js'
import type { DepositProviderAdapter } from '../domains/deposits/providers/DepositProviderAdapter.js'
import { SimulatedDepositProviderAdapter } from '../domains/deposits/providers/SimulatedDepositProviderAdapter.js'
import {
  ApplyCarryoversToRaceHandler,
  ApplyHouseTakeHandler,
  MarkSettlementManualReviewHandler,
  ReleaseReservationHandler,
  ResolveSettlementManualReviewHandler,
  ReserveStakeHandler,
  SettleBetHandler,
  VoidPoolFromManualReviewHandler,
} from '../domains/financial-commands/handlers/FinancialCommandHandlers.js'
import { FinancialCommandService } from '../domains/financial-commands/services/FinancialCommandService.js'
import { PostgresAccountFreezeRepository } from '../domains/account/repositories/postgres/PostgresAccountFreezeRepository.js'
import { PostgresAccountRestrictionRepository } from '../domains/account/repositories/postgres/PostgresAccountRestrictionRepository.js'
import { PostgresAccountSuspensionRepository } from '../domains/account/repositories/postgres/PostgresAccountSuspensionRepository.js'
import { PostgresPlayerAccountRepository } from '../domains/account/repositories/postgres/PostgresPlayerAccountRepository.js'
import { AccountActionAuthorizationService } from '../domains/account/restrictions/AccountActionAuthorizationService.js'
import { AccountBalancePresentationService } from '../domains/account/services/AccountBalancePresentationService.js'
import { AccountControlService } from '../domains/account/services/AccountControlService.js'
import { EffectiveStatusService } from '../domains/account/services/EffectiveStatusService.js'
import { PlayerAccountProvisioningService } from '../domains/account/services/PlayerAccountProvisioningService.js'
import { PlayerAccountQueryService } from '../domains/account/services/PlayerAccountQueryService.js'
import { PostgresAccountRepository } from '../domains/accounting/repositories/postgres/PostgresAccountRepository.js'
import { PostgresAuditEventRepository } from '../domains/accounting/repositories/postgres/PostgresAuditEventRepository.js'
import { PostgresIdempotencyRepository } from '../domains/accounting/repositories/postgres/PostgresIdempotencyRepository.js'
import { PostgresLedgerRepository } from '../domains/accounting/repositories/postgres/PostgresLedgerRepository.js'
import { AccountService } from '../domains/accounting/services/AccountService.js'
import { BalanceMaintenanceService } from '../domains/accounting/services/BalanceMaintenanceService.js'
import { IdempotencyService } from '../domains/accounting/services/IdempotencyService.js'
import { PostingEngineService } from '../domains/accounting/services/PostingEngineService.js'
import { ReservationService } from '../domains/accounting/services/ReservationService.js'
import { PostgresOutboxRepository } from '../shared/outbox/PostgresOutboxRepository.js'
import {
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
} from '../domains/withdrawals/handlers/WithdrawalHandlers.js'
import { PostgresWithdrawalRepository } from '../domains/withdrawals/repositories/postgres/PostgresWithdrawalRepository.js'
import { WithdrawalService } from '../domains/withdrawals/services/WithdrawalService.js'
import type { WithdrawalProviderAdapter } from '../domains/withdrawals/providers/WithdrawalProviderAdapter.js'
import { SimulatedWithdrawalProviderAdapter } from '../domains/withdrawals/providers/SimulatedWithdrawalProviderAdapter.js'
import {
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
} from '../domains/operations/handlers/OperationsHandlers.js'
import { PostgresOperationsRepository } from '../domains/operations/repositories/postgres/PostgresOperationsRepository.js'
import { OperationsService } from '../domains/operations/services/OperationsService.js'

export interface ApplicationContainer {
  repositories: {
    accountRepository: PostgresAccountRepository
    auditEventRepository: PostgresAuditEventRepository
    idempotencyRepository: PostgresIdempotencyRepository
    ledgerRepository: PostgresLedgerRepository
    playerAccountRepository: PostgresPlayerAccountRepository
    accountRestrictionRepository: PostgresAccountRestrictionRepository
    accountSuspensionRepository: PostgresAccountSuspensionRepository
    accountFreezeRepository: PostgresAccountFreezeRepository
    outboxRepository: PostgresOutboxRepository
    bettingRepository: PostgresBettingRepository
    depositRepository: PostgresDepositRepository
    withdrawalRepository: PostgresWithdrawalRepository
    operationsRepository: PostgresOperationsRepository
    depositProviderAdapter: DepositProviderAdapter
    withdrawalProviderAdapter: WithdrawalProviderAdapter
  }
  services: {
    accountService: AccountService
    balanceMaintenanceService: BalanceMaintenanceService
    postingEngineService: PostingEngineService
    reservationService: ReservationService
    adminOpsReadService: AdminOpsReadService
    playerAccountProvisioningService: PlayerAccountProvisioningService
    playerAccountQueryService: PlayerAccountQueryService
    accountControlService: AccountControlService
    financialCommandService: FinancialCommandService
    bettingIntakeService: BettingIntakeService
    depositService: DepositService
    withdrawalService: WithdrawalService
    operationsService: OperationsService
    depositProviderAdapter: DepositProviderAdapter
    withdrawalProviderAdapter: WithdrawalProviderAdapter
  }
  handlers: {
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
  }
}

export interface BuildApplicationContainerOptions {
  database: Database
  clock?: Clock
  faultInjector?: FaultInjector | undefined
  depositProviderWebhookSecret?: string | undefined
  depositWebhookReplayWindowSeconds?: number | undefined
  withdrawalProviderWebhookSecret?: string | undefined
  withdrawalWebhookReplayWindowSeconds?: number | undefined
  depositProviderAdapter?: DepositProviderAdapter | undefined
  withdrawalProviderAdapter?: WithdrawalProviderAdapter | undefined
  logger?: Logger
}

export function buildApplicationContainer(
  options: BuildApplicationContainerOptions,
): ApplicationContainer {
  const clock = options.clock ?? new SystemClock()
  const logger = options.logger ?? createLogger({ service: 'nines-financial' })
  const faultInjector = options.faultInjector ?? new NoopFaultInjector()
  const depositProviderAdapter =
    options.depositProviderAdapter ??
    new SimulatedDepositProviderAdapter({
      webhookSecret: options.depositProviderWebhookSecret ?? null,
      replayWindowSeconds: options.depositWebhookReplayWindowSeconds,
      clock,
    })
  const withdrawalProviderAdapter =
    options.withdrawalProviderAdapter ??
    new SimulatedWithdrawalProviderAdapter({
      webhookSecret: options.withdrawalProviderWebhookSecret ?? null,
      replayWindowSeconds: options.withdrawalWebhookReplayWindowSeconds,
      clock,
    })

  const accountRepository = new PostgresAccountRepository(options.database)
  const auditEventRepository = new PostgresAuditEventRepository(
    options.database,
  )
  const idempotencyRepository = new PostgresIdempotencyRepository(
    options.database,
  )
  const ledgerRepository = new PostgresLedgerRepository(options.database)
  const playerAccountRepository = new PostgresPlayerAccountRepository(
    options.database,
  )
  const accountRestrictionRepository =
    new PostgresAccountRestrictionRepository(options.database)
  const accountSuspensionRepository =
    new PostgresAccountSuspensionRepository(options.database)
  const accountFreezeRepository = new PostgresAccountFreezeRepository(
    options.database,
  )
  const outboxRepository = new PostgresOutboxRepository(options.database)
  const bettingRepository = new PostgresBettingRepository(options.database)
  const depositRepository = new PostgresDepositRepository(options.database)
  const withdrawalRepository = new PostgresWithdrawalRepository(
    options.database,
  )
  const operationsRepository = new PostgresOperationsRepository(options.database)
  const idempotencyService = new IdempotencyService(
    idempotencyRepository,
    clock,
  )
  const accountService = new AccountService(
    options.database,
    accountRepository,
    auditEventRepository,
    idempotencyService,
    clock,
    logger.child({ component: 'account-service' }),
  )
  const balanceMaintenanceService = new BalanceMaintenanceService(
    options.database,
    auditEventRepository,
    clock,
    logger.child({ component: 'balance-maintenance-service' }),
  )
  const postingEngineService = new PostingEngineService(
    options.database,
    accountRepository,
    ledgerRepository,
    auditEventRepository,
    idempotencyService,
    clock,
    logger.child({ component: 'posting-engine-service' }),
  )
  const reservationService = new ReservationService(
    options.database,
    ledgerRepository,
    postingEngineService,
    idempotencyService,
    logger.child({ component: 'reservation-service' }),
  )
  const adminOpsReadService = new AdminOpsReadService(options.database, clock)
  const accountingAccountAdapter = new AccountingAccountAdapter(
    options.database,
    accountRepository,
    clock,
  )
  const effectiveStatusService = new EffectiveStatusService(
    accountRestrictionRepository,
    accountSuspensionRepository,
    accountFreezeRepository,
  )
  const balancePresentationService = new AccountBalancePresentationService()
  const accountActionAuthorizationService =
    new AccountActionAuthorizationService()
  const accountAuditService = new AccountAuditService(auditEventRepository)
  const playerAccountProvisioningService =
    new PlayerAccountProvisioningService(
      options.database,
      playerAccountRepository,
      accountingAccountAdapter,
      clock,
      logger.child({ component: 'player-account-provisioning-service' }),
    )
  const accountControlService = new AccountControlService(
    options.database,
    playerAccountRepository,
    accountRestrictionRepository,
    accountSuspensionRepository,
    accountFreezeRepository,
    accountingAccountAdapter,
    effectiveStatusService,
    clock,
    accountAuditService,
    logger.child({ component: 'account-control-service' }),
  )
  const playerAccountQueryService = new PlayerAccountQueryService(
    playerAccountRepository,
    accountingAccountAdapter,
    effectiveStatusService,
    balancePresentationService,
    accountActionAuthorizationService,
    clock,
    logger.child({ component: 'player-account-query-service' }),
  )
  const getPlayerAccountSummaryHandler = new GetPlayerAccountSummaryHandler(
    playerAccountQueryService,
  )
  const getPlayerBalanceHandler = new GetPlayerBalanceHandler(
    playerAccountQueryService,
  )
  const getAdminAccountInspectionHandler =
    new GetAdminAccountInspectionHandler(playerAccountQueryService)
  const applyRestrictionHandler = new ApplyRestrictionHandler(
    accountControlService,
  )
  const liftRestrictionHandler = new LiftRestrictionHandler(
    accountControlService,
  )
  const applySuspensionHandler = new ApplySuspensionHandler(
    accountControlService,
  )
  const liftSuspensionHandler = new LiftSuspensionHandler(accountControlService)
  const applyFreezeHandler = new ApplyFreezeHandler(accountControlService)
  const liftFreezeHandler = new LiftFreezeHandler(accountControlService)
  const financialCommandService = new FinancialCommandService(
    options.database,
    playerAccountProvisioningService,
    accountRepository,
    ledgerRepository,
    accountService,
    postingEngineService,
    reservationService,
    effectiveStatusService,
    accountActionAuthorizationService,
    bettingRepository,
    outboxRepository,
    clock,
    faultInjector,
  )
  const bettingIntakeService = new BettingIntakeService(
    options.database,
    bettingRepository,
    idempotencyRepository,
    auditEventRepository,
    accountRepository,
    postingEngineService,
    playerAccountProvisioningService,
    effectiveStatusService,
    accountActionAuthorizationService,
    outboxRepository,
    clock,
    faultInjector,
  )
  const depositService = new DepositService(
    options.database,
    depositRepository,
    idempotencyRepository,
    playerAccountRepository,
    accountRepository,
    auditEventRepository,
    postingEngineService,
    playerAccountProvisioningService,
    effectiveStatusService,
    accountActionAuthorizationService,
    outboxRepository,
    clock,
    faultInjector,
  )
  const withdrawalService = new WithdrawalService(
    options.database,
    withdrawalRepository,
    idempotencyRepository,
    playerAccountRepository,
    accountRepository,
    ledgerRepository,
    auditEventRepository,
    postingEngineService,
    withdrawalProviderAdapter,
    effectiveStatusService,
    accountActionAuthorizationService,
    clock,
    faultInjector,
  )
  const operationsService = new OperationsService(
    options.database,
    operationsRepository,
    depositService,
    withdrawalService,
    balanceMaintenanceService,
    auditEventRepository,
    playerAccountRepository,
    accountControlService,
    clock,
  )
  const reserveStakeHandler = new ReserveStakeHandler(financialCommandService)
  const releaseReservationHandler = new ReleaseReservationHandler(
    financialCommandService,
  )
  const settleBetHandler = new SettleBetHandler(financialCommandService)
  const applyHouseTakeHandler = new ApplyHouseTakeHandler(
    financialCommandService,
  )
  const applyCarryoversToRaceHandler = new ApplyCarryoversToRaceHandler(
    financialCommandService,
  )
  const markSettlementManualReviewHandler =
    new MarkSettlementManualReviewHandler(financialCommandService)
  const resolveSettlementManualReviewHandler =
    new ResolveSettlementManualReviewHandler(financialCommandService)
  const voidPoolFromManualReviewHandler =
    new VoidPoolFromManualReviewHandler(financialCommandService)
  const createRacePoolHandler = new CreateRacePoolHandler(bettingIntakeService)
  const registerPoolSelectionHandler = new RegisterPoolSelectionHandler(
    bettingIntakeService,
  )
  const freezePoolHandler = new FreezePoolHandler(bettingIntakeService)
  const placeBetHandler = new PlaceBetHandler(bettingIntakeService)
  const detectSettlementReconciliationHandler =
    new DetectSettlementReconciliationHandler(bettingIntakeService)
  const getFinancialBetHandler = new GetFinancialBetHandler(
    bettingIntakeService,
  )
  const getRacePoolHandler = new GetRacePoolHandler(bettingIntakeService)
  const listFinancialBetsByRaceHandler = new ListFinancialBetsByRaceHandler(
    bettingIntakeService,
  )
  const listFinancialBetsByUserHandler = new ListFinancialBetsByUserHandler(
    bettingIntakeService,
  )
  const listCarryoversHandler = new ListCarryoversHandler(bettingIntakeService)
  const listManualReviewItemsHandler = new ListManualReviewItemsHandler(
    bettingIntakeService,
  )
  const runSettlementReconciliationHandler =
    new RunSettlementReconciliationHandler(bettingIntakeService)
  const listSettlementReconciliationRunsHandler =
    new ListSettlementReconciliationRunsHandler(bettingIntakeService)
  const getLivePoolTotalHandler = new GetLivePoolTotalHandler(
    bettingIntakeService,
  )
  const listSelectionTotalsHandler = new ListSelectionTotalsHandler(
    bettingIntakeService,
  )
  const createDepositIntentHandler = new CreateDepositIntentHandler(
    depositService,
  )
  const getDepositIntentHandler = new GetDepositIntentHandler(depositService)
  const ingestProviderDepositEventHandler =
    new IngestProviderDepositEventHandler(depositService)
  const listDepositReviewItemsHandler = new ListDepositReviewItemsHandler(
    depositService,
  )
  const detectDepositReconciliationHandler =
    new DetectDepositReconciliationHandler(depositService)
  const markDepositReviewedNoCreditHandler =
    new MarkDepositReviewedNoCreditHandler(depositService)
  const rejectProviderDepositEventHandler =
    new RejectProviderDepositEventHandler(depositService)
  const linkProviderDepositEventHandler =
    new LinkProviderDepositEventHandler(depositService)
  const approveProviderDepositCreditHandler =
    new ApproveProviderDepositCreditHandler(depositService)
  const retryProviderDepositCreditHandler =
    new RetryProviderDepositCreditHandler(depositService)
  const createWithdrawalRequestHandler = new CreateWithdrawalRequestHandler(
    withdrawalService,
  )
  const getWithdrawalRequestHandler = new GetWithdrawalRequestHandler(
    withdrawalService,
  )
  const listWithdrawalReviewItemsHandler =
    new ListWithdrawalReviewItemsHandler(withdrawalService)
  const detectWithdrawalReconciliationHandler =
    new DetectWithdrawalReconciliationHandler(withdrawalService)
  const approveWithdrawalRequestHandler =
    new ApproveWithdrawalRequestHandler(withdrawalService)
  const rejectWithdrawalRequestHandler =
    new RejectWithdrawalRequestHandler(withdrawalService)
  const cancelWithdrawalRequestHandler =
    new CancelWithdrawalRequestHandler(withdrawalService)
  const submitWithdrawalRequestHandler =
    new SubmitWithdrawalRequestHandler(withdrawalService)
  const syncWithdrawalProviderStatusHandler =
    new SyncWithdrawalProviderStatusHandler(withdrawalService)
  const ingestWithdrawalProviderWebhookHandler =
    new IngestWithdrawalProviderWebhookHandler(withdrawalService)
  const finalizeWithdrawalRequestHandler =
    new FinalizeWithdrawalRequestHandler(withdrawalService)
  const releaseWithdrawalProviderFailureHandler =
    new ReleaseWithdrawalProviderFailureHandler(withdrawalService)
  const markWithdrawalProviderFailureTerminalHandler =
    new MarkWithdrawalProviderFailureTerminalHandler(withdrawalService)
  const markWithdrawalProviderUnknownReviewedHandler =
    new MarkWithdrawalProviderUnknownReviewedHandler(withdrawalService)
  const runOperationalReconciliationHandler =
    new RunOperationalReconciliationHandler(operationsService)
  const listDiscrepanciesHandler =
    new ListDiscrepanciesHandler(operationsService)
  const getDiscrepancyHandler = new GetDiscrepancyHandler(operationsService)
  const acknowledgeDiscrepancyHandler =
    new AcknowledgeDiscrepancyHandler(operationsService)
  const assignDiscrepancyHandler =
    new AssignDiscrepancyHandler(operationsService)
  const resolveDiscrepancyHandler =
    new ResolveDiscrepancyHandler(operationsService)
  const suppressDiscrepancyHandler =
    new SuppressDiscrepancyHandler(operationsService)
  const reopenDiscrepancyHandler =
    new ReopenDiscrepancyHandler(operationsService)
  const ledgerBalanceCheckHandler =
    new LedgerBalanceCheckHandler(operationsService)
  const accountingIntegrityHandler =
    new AccountingIntegrityHandler(operationsService)
  const treasurySummaryHandler = new TreasurySummaryHandler(operationsService)
  const freezeRiskAccountHandler =
    new FreezeRiskAccountHandler(operationsService)
  const unfreezeRiskAccountHandler =
    new UnfreezeRiskAccountHandler(operationsService)
  const getRiskAccountHandler = new GetRiskAccountHandler(operationsService)
  const rebuildBalancesOperationalHandler =
    new RebuildBalancesOperationalHandler(operationsService)
  const playerFinancialTimelineHandler =
    new PlayerFinancialTimelineHandler(operationsService)
  const depositTimelineHandler = new DepositTimelineHandler(operationsService)
  const withdrawalTimelineHandler =
    new WithdrawalTimelineHandler(operationsService)

  return {
    repositories: {
      accountRepository,
      auditEventRepository,
      idempotencyRepository,
      ledgerRepository,
      playerAccountRepository,
      accountRestrictionRepository,
      accountSuspensionRepository,
      accountFreezeRepository,
      outboxRepository,
      bettingRepository,
      depositRepository,
      withdrawalRepository,
      operationsRepository,
      depositProviderAdapter,
      withdrawalProviderAdapter,
    },
    services: {
      accountService,
      balanceMaintenanceService,
      postingEngineService,
      reservationService,
      adminOpsReadService,
      playerAccountProvisioningService,
      playerAccountQueryService,
      accountControlService,
      financialCommandService,
      bettingIntakeService,
      depositService,
      withdrawalService,
      operationsService,
      depositProviderAdapter,
      withdrawalProviderAdapter,
    },
    handlers: {
      getPlayerAccountSummaryHandler,
      getPlayerBalanceHandler,
      getAdminAccountInspectionHandler,
      applyRestrictionHandler,
      liftRestrictionHandler,
      applySuspensionHandler,
      liftSuspensionHandler,
      applyFreezeHandler,
      liftFreezeHandler,
      reserveStakeHandler,
      releaseReservationHandler,
      settleBetHandler,
      applyHouseTakeHandler,
      applyCarryoversToRaceHandler,
      markSettlementManualReviewHandler,
      resolveSettlementManualReviewHandler,
      voidPoolFromManualReviewHandler,
      createRacePoolHandler,
      registerPoolSelectionHandler,
      freezePoolHandler,
      placeBetHandler,
      detectSettlementReconciliationHandler,
      getRacePoolHandler,
      getFinancialBetHandler,
      listFinancialBetsByRaceHandler,
      listFinancialBetsByUserHandler,
      listCarryoversHandler,
      listManualReviewItemsHandler,
      runSettlementReconciliationHandler,
      listSettlementReconciliationRunsHandler,
      getLivePoolTotalHandler,
      listSelectionTotalsHandler,
      createDepositIntentHandler,
      getDepositIntentHandler,
      ingestProviderDepositEventHandler,
      listDepositReviewItemsHandler,
      detectDepositReconciliationHandler,
      markDepositReviewedNoCreditHandler,
      rejectProviderDepositEventHandler,
      linkProviderDepositEventHandler,
      approveProviderDepositCreditHandler,
      retryProviderDepositCreditHandler,
      createWithdrawalRequestHandler,
      getWithdrawalRequestHandler,
      listWithdrawalReviewItemsHandler,
      detectWithdrawalReconciliationHandler,
      approveWithdrawalRequestHandler,
      rejectWithdrawalRequestHandler,
      cancelWithdrawalRequestHandler,
      submitWithdrawalRequestHandler,
      syncWithdrawalProviderStatusHandler,
      ingestWithdrawalProviderWebhookHandler,
      finalizeWithdrawalRequestHandler,
      releaseWithdrawalProviderFailureHandler,
      markWithdrawalProviderFailureTerminalHandler,
      markWithdrawalProviderUnknownReviewedHandler,
      runOperationalReconciliationHandler,
      listDiscrepanciesHandler,
      getDiscrepancyHandler,
      acknowledgeDiscrepancyHandler,
      assignDiscrepancyHandler,
      resolveDiscrepancyHandler,
      suppressDiscrepancyHandler,
      reopenDiscrepancyHandler,
      ledgerBalanceCheckHandler,
      accountingIntegrityHandler,
      treasurySummaryHandler,
      freezeRiskAccountHandler,
      unfreezeRiskAccountHandler,
      getRiskAccountHandler,
      rebuildBalancesOperationalHandler,
      playerFinancialTimelineHandler,
      depositTimelineHandler,
      withdrawalTimelineHandler,
    },
  }
}
