import express from 'express'

import type { AccountService } from './domains/accounting/services/AccountService.js'
import type { BalanceMaintenanceService } from './domains/accounting/services/BalanceMaintenanceService.js'
import type { PostingEngineService } from './domains/accounting/services/PostingEngineService.js'
import type { ReservationService } from './domains/accounting/services/ReservationService.js'
import type { StartupReadinessReport } from './config/startupReadiness.js'
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
  ApplyHouseTakeHandler,
  ReleaseReservationHandler,
  ReserveStakeHandler,
  SettleBetHandler,
} from './domains/financial-commands/handlers/FinancialCommandHandlers.js'
import { createAdminAccountsRouter } from './handlers/http/adminAccountsRoutes.js'
import { createAccountsRouter } from './handlers/http/accountsRoutes.js'
import { errorHandler } from './handlers/http/errorHandler.js'
import { createFinancialCommandRouter } from './handlers/http/financialCommandRoutes.js'
import { createLedgerRouter } from './handlers/http/ledgerRoutes.js'
import { createPlayerAccountsRouter } from './handlers/http/playerAccountsRoutes.js'
import { createSystemRouter } from './handlers/http/systemRoutes.js'

export interface HttpApplicationServices {
  accountService: AccountService
  balanceMaintenanceService: BalanceMaintenanceService
  postingEngineService: PostingEngineService
  reservationService: ReservationService
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

export interface CreateAppOptions {
  readinessCheck?: () => Promise<StartupReadinessReport>
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

  app.use(express.json())
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
    }),
  )
  app.use('/system', createSystemRouter(services.balanceMaintenanceService))
  app.use(errorHandler)

  return app
}
