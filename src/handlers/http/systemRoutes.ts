import { Router, type RequestHandler } from 'express'

import type { BalanceMaintenanceService } from '../../domains/accounting/services/BalanceMaintenanceService.js'
import {
  mirrorCorrelationHeaders,
  readCorrelatedRequestContext,
  writeCorrelationHeaders,
} from './requestContext.js'

type AsyncRouteHandler = RequestHandler

function asyncHandler(handler: AsyncRouteHandler): AsyncRouteHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next)
  }
}

export function createSystemRouter(
  balanceMaintenanceService: BalanceMaintenanceService,
): Router {
  const router = Router()

  router.get(
    '/balances/verify',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      const verification = await balanceMaintenanceService.verifyBalances()

      response.status(200).json({
        verification: {
          verifiedAt: verification.verifiedAt.toISOString(),
          totalAccounts: verification.totalAccounts,
          mismatchCount: verification.mismatchCount,
          mismatches: verification.mismatches,
        },
      })
    }),
  )

  router.post(
    '/balances/rebuild',
    asyncHandler(async (request, response) => {
      const requestContext = readCorrelatedRequestContext(request)
      writeCorrelationHeaders(response, requestContext)
      const rebuild =
        await balanceMaintenanceService.rebuildBalances(requestContext)

      response.status(200).json({
        rebuild: {
          rebuiltAt: rebuild.rebuiltAt.toISOString(),
          rebuiltAccountCount: rebuild.rebuiltAccountCount,
          mismatchCountBefore: rebuild.mismatchCountBefore,
        },
      })
    }),
  )

  return router
}
