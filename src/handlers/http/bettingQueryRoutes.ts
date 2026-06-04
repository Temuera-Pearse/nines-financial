import { Router, type RequestHandler } from 'express'

import type {
  DetectSettlementReconciliationHandler,
  GetFinancialBetHandler,
  GetLivePoolTotalHandler,
  GetRacePoolHandler,
  ListCarryoversHandler,
  ListFinancialBetsByRaceHandler,
  ListFinancialBetsByUserHandler,
  ListSelectionTotalsHandler,
} from '../../domains/betting/handlers/BettingQueryHandlers.js'

type AsyncRouteHandler = RequestHandler

export interface BettingQueryRouteHandlers {
  detectSettlementReconciliationHandler: DetectSettlementReconciliationHandler
  getRacePoolHandler: GetRacePoolHandler
  getFinancialBetHandler: GetFinancialBetHandler
  listFinancialBetsByRaceHandler: ListFinancialBetsByRaceHandler
  listFinancialBetsByUserHandler: ListFinancialBetsByUserHandler
  listCarryoversHandler: ListCarryoversHandler
  getLivePoolTotalHandler: GetLivePoolTotalHandler
  listSelectionTotalsHandler: ListSelectionTotalsHandler
}

function asyncHandler(handler: AsyncRouteHandler): AsyncRouteHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next)
  }
}

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

function optionalQuery(value: unknown): string | undefined {
  if (Array.isArray(value)) return String(value[0] ?? '').trim() || undefined
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function createBettingQueryRouter(
  handlers: BettingQueryRouteHandlers,
): Router {
  const router = Router()

  router.get(
    '/races/:raceId/pool',
    asyncHandler(async (request, response) => {
      const pool = await handlers.getRacePoolHandler.handle(
        routeParam(request.params.raceId),
      )

      response.json(pool)
    }),
  )

  router.get(
    '/bets/:betId',
    asyncHandler(async (request, response) => {
      const bet = await handlers.getFinancialBetHandler.handle(
        routeParam(request.params.betId),
      )

      response.json({ bet })
    }),
  )

  router.get(
    '/races/:raceId/bets',
    asyncHandler(async (request, response) => {
      const bets = await handlers.listFinancialBetsByRaceHandler.handle(
        routeParam(request.params.raceId),
      )

      response.json({ bets })
    }),
  )

  router.get(
    '/players/:userId/bets',
    asyncHandler(async (request, response) => {
      const bets = await handlers.listFinancialBetsByUserHandler.handle(
        routeParam(request.params.userId),
      )

      response.json({ bets })
    }),
  )

  router.get(
    '/carryovers',
    asyncHandler(async (request, response) => {
      const criteria: {
        status?: 'pending' | 'applied' | 'voided'
        sourceRaceId?: string
        targetRaceId?: string
      } = {}
      const status = optionalQuery(request.query.status)
      const sourceRaceId = optionalQuery(request.query.sourceRaceId)
      const targetRaceId = optionalQuery(request.query.targetRaceId)

      if (
        status === 'pending' ||
        status === 'applied' ||
        status === 'voided'
      ) {
        criteria.status = status
      }

      if (sourceRaceId) {
        criteria.sourceRaceId = sourceRaceId
      }

      if (targetRaceId) {
        criteria.targetRaceId = targetRaceId
      }

      const carryovers = await handlers.listCarryoversHandler.handle(criteria)

      response.json({ carryovers })
    }),
  )

  router.get(
    '/races/:raceId/pool-totals',
    asyncHandler(async (request, response) => {
      const total = await handlers.getLivePoolTotalHandler.handle(
        routeParam(request.params.raceId),
      )

      response.json(total)
    }),
  )

  router.get(
    '/races/:raceId/selection-totals',
    asyncHandler(async (request, response) => {
      const totals = await handlers.listSelectionTotalsHandler.handle(
        routeParam(request.params.raceId),
      )

      response.json({ selectionTotals: totals })
    }),
  )

  router.get(
    '/races/:raceId/settlement-reconciliation',
    asyncHandler(async (request, response) => {
      const report =
        await handlers.detectSettlementReconciliationHandler.handle(
          routeParam(request.params.raceId),
        )

      response.json(report)
    }),
  )

  return router
}
