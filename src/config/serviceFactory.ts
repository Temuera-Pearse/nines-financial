import type { Database } from '../shared/db/Database.js'
import { createLogger, type Logger } from '../shared/observability/logger.js'
import { SystemClock, type Clock } from '../shared/time/Clock.js'
import { AccountingAccountAdapter } from '../domains/account/adapters/AccountingAccountAdapter.js'
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
  ApplyHouseTakeHandler,
  ReleaseReservationHandler,
  ReserveStakeHandler,
  SettleBetHandler,
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
  }
  services: {
    accountService: AccountService
    balanceMaintenanceService: BalanceMaintenanceService
    postingEngineService: PostingEngineService
    reservationService: ReservationService
    playerAccountProvisioningService: PlayerAccountProvisioningService
    playerAccountQueryService: PlayerAccountQueryService
    accountControlService: AccountControlService
    financialCommandService: FinancialCommandService
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
  }
}

export interface BuildApplicationContainerOptions {
  database: Database
  clock?: Clock
  logger?: Logger
}

export function buildApplicationContainer(
  options: BuildApplicationContainerOptions,
): ApplicationContainer {
  const clock = options.clock ?? new SystemClock()
  const logger = options.logger ?? createLogger({ service: 'nines-financial' })

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
    playerAccountProvisioningService,
    accountRepository,
    ledgerRepository,
    accountService,
    postingEngineService,
    reservationService,
    effectiveStatusService,
    accountActionAuthorizationService,
    outboxRepository,
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
    },
    services: {
      accountService,
      balanceMaintenanceService,
      postingEngineService,
      reservationService,
      playerAccountProvisioningService,
      playerAccountQueryService,
      accountControlService,
      financialCommandService,
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
    },
  }
}
