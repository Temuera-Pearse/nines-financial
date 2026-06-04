import { Router, type RequestHandler } from 'express'

import type { AdminOpsReadService } from '../../domains/admin/services/AdminOpsReadService.js'

type AsyncRouteHandler = RequestHandler

function asyncHandler(handler: AsyncRouteHandler): AsyncRouteHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next)
  }
}

function optionalCurrency(value: unknown): string {
  if (Array.isArray(value)) return optionalCurrency(value[0])
  return typeof value === 'string' && value.trim()
    ? value.trim().toUpperCase()
    : 'USDC'
}

export function createAdminReadOnlyRouter(
  adminOpsReadService: AdminOpsReadService,
): Router {
  const router = Router()

  router.get(
    '/admin/health',
    asyncHandler(async (_request, response) => {
      response.status(200).json(await adminOpsReadService.getHealth())
    }),
  )

  router.get(
    '/admin/treasury/summary',
    asyncHandler(async (request, response) => {
      response.status(200).json(
        await adminOpsReadService.getTreasurySummary(
          optionalCurrency(request.query.currency),
        ),
      )
    }),
  )

  router.get(
    '/admin/settlements/recent',
    asyncHandler(async (_request, response) => {
      response.status(200).json(await adminOpsReadService.getRecentSettlements())
    }),
  )

  router.get(
    '/admin/deposits/pending',
    asyncHandler(async (request, response) => {
      response.status(200).json(
        await adminOpsReadService.getPendingDeposits(
          optionalCurrency(request.query.currency),
        ),
      )
    }),
  )

  router.get(
    '/admin/withdrawals/pending',
    asyncHandler(async (request, response) => {
      response.status(200).json(
        await adminOpsReadService.getPendingWithdrawals(
          optionalCurrency(request.query.currency),
        ),
      )
    }),
  )

  router.get(
    '/admin/reconciliation/summary',
    asyncHandler(async (_request, response) => {
      response.status(200).json(
        await adminOpsReadService.getReconciliationSummary(),
      )
    }),
  )

  return router
}
