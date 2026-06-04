import { Router, type RequestHandler } from 'express'

import type {
  DetectSettlementReconciliationHandler,
  ListCarryoversHandler,
  ListManualReviewItemsHandler,
  ListSettlementReconciliationRunsHandler,
  RunSettlementReconciliationHandler,
} from '../../domains/betting/handlers/BettingQueryHandlers.js'
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
} from '../../domains/operations/handlers/OperationsHandlers.js'
import {
  requireAuthenticatedOperatorId,
  requireOperatorRole,
} from './operatorAuth.js'
import {
  mirrorCorrelationHeaders,
  readStateChangingRequestContext,
  writeCorrelationHeaders,
} from './requestContext.js'

type AsyncRouteHandler = RequestHandler

export interface AdminOperationsRouteHandlers {
  listCarryoversHandler: ListCarryoversHandler
  listManualReviewItemsHandler: ListManualReviewItemsHandler
  detectSettlementReconciliationHandler: DetectSettlementReconciliationHandler
  runSettlementReconciliationHandler: RunSettlementReconciliationHandler
  listSettlementReconciliationRunsHandler: ListSettlementReconciliationRunsHandler
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

const operationsRoles = [
  'operator',
  'finance_operator',
  'treasury_operator',
  'treasury_admin',
  'financial_admin',
  'admin',
] as const
const elevatedOperationsRoles = [
  'treasury_admin',
  'financial_admin',
  'admin',
] as const

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

function commandPayload(
  request: Parameters<RequestHandler>[0],
  operator: { operatorId: string; operatorRole: string },
): Record<string, unknown> {
  const requestContext = readStateChangingRequestContext(request)
  return {
    ...(typeof request.body === 'object' && request.body !== null
      ? request.body
      : {}),
    idempotencyKey: requestContext.idempotencyKey,
    correlationId: requestContext.correlationId,
    causationId: requestContext.causationId,
    operatorId: operator.operatorId,
    operatorRole: operator.operatorRole,
  }
}

function carryoverCriteria(query: Record<string, unknown>): {
  status?: 'pending' | 'applied' | 'voided'
  sourceRaceId?: string
  targetRaceId?: string
} {
  const criteria: {
    status?: 'pending' | 'applied' | 'voided'
    sourceRaceId?: string
    targetRaceId?: string
  } = {}
  const status = optionalQuery(query.status)
  const sourceRaceId = optionalQuery(query.sourceRaceId)
  const targetRaceId = optionalQuery(query.targetRaceId)

  if (status === 'pending' || status === 'applied' || status === 'voided') {
    criteria.status = status
  }

  if (sourceRaceId) {
    criteria.sourceRaceId = sourceRaceId
  }

  if (targetRaceId) {
    criteria.targetRaceId = targetRaceId
  }

  return criteria
}

export function createAdminOperationsRouter(
  handlers: AdminOperationsRouteHandlers,
): Router {
  const router = Router()

  router.get(
    '/admin/operations/carryovers',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      requireAuthenticatedOperatorId(request, response)

      const carryovers = await handlers.listCarryoversHandler.handle(
        carryoverCriteria(request.query),
      )

      response.status(200).json({ carryovers })
    }),
  )

  router.get(
    '/admin/operations/manual-review',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      requireAuthenticatedOperatorId(request, response)

      const manualReviewItems =
        await handlers.listManualReviewItemsHandler.handle()

      response.status(200).json({ manualReviewItems })
    }),
  )

  router.get(
    '/admin/operations/reconciliation/races/:raceId',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      requireAuthenticatedOperatorId(request, response)

      const report =
        await handlers.detectSettlementReconciliationHandler.handle(
          routeParam(request.params.raceId),
        )

      response.status(200).json({ reconciliation: report })
    }),
  )

  router.post(
    '/admin/operations/reconciliation/run',
    asyncHandler(async (request, response) => {
      const operator = requireOperatorRole(
        request,
        response,
        operationsRoles,
        'operations.reconciliation.run',
      )
      const requestContext = readStateChangingRequestContext(request)
      writeCorrelationHeaders(response, requestContext)

      const reconciliation =
        await handlers.runOperationalReconciliationHandler.handle({
          operatorId: operator.operatorId,
          operatorRole: operator.operatorRole,
          idempotencyKey: requestContext.idempotencyKey,
          correlationId: requestContext.correlationId,
          causationId: requestContext.causationId,
        })

      response.status(201).json({ reconciliation })
    }),
  )

  router.get(
    '/admin/operations/discrepancies',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      requireOperatorRole(request, response, operationsRoles, 'operations.discrepancies.list')
      const discrepancies = await handlers.listDiscrepanciesHandler.handle({
        status: optionalQuery(request.query.status) as never,
        severity: optionalQuery(request.query.severity) as never,
        category: optionalQuery(request.query.category),
      })
      response.status(200).json({ discrepancies })
    }),
  )

  router.get(
    '/admin/operations/discrepancies/:discrepancyId',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      requireOperatorRole(request, response, operationsRoles, 'operations.discrepancies.get')
      const discrepancy = await handlers.getDiscrepancyHandler.handle(
        routeParam(request.params.discrepancyId),
      )
      response.status(200).json({ discrepancy })
    }),
  )

  const workflow =
    (
      action: 'acknowledge' | 'assign' | 'resolve' | 'suppress' | 'reopen',
    ): RequestHandler =>
    asyncHandler(async (request, response) => {
      const operator = requireOperatorRole(
        request,
        response,
        action === 'suppress' ? elevatedOperationsRoles : operationsRoles,
        `operations.discrepancies.${action}`,
      )
      const requestContext = readStateChangingRequestContext(request)
      writeCorrelationHeaders(response, requestContext)
      const payload = {
        ...commandPayload(request, operator),
        discrepancyId: routeParam(request.params.discrepancyId),
      } as never
      const handler = {
        acknowledge: handlers.acknowledgeDiscrepancyHandler,
        assign: handlers.assignDiscrepancyHandler,
        resolve: handlers.resolveDiscrepancyHandler,
        suppress: handlers.suppressDiscrepancyHandler,
        reopen: handlers.reopenDiscrepancyHandler,
      }[action]
      const discrepancy = await handler.handle(payload)
      response.status(200).json({ discrepancy })
    })

  router.post('/admin/operations/discrepancies/:discrepancyId/acknowledge', workflow('acknowledge'))
  router.post('/admin/operations/discrepancies/:discrepancyId/assign', workflow('assign'))
  router.post('/admin/operations/discrepancies/:discrepancyId/resolve', workflow('resolve'))
  router.post('/admin/operations/discrepancies/:discrepancyId/suppress', workflow('suppress'))
  router.post('/admin/operations/discrepancies/:discrepancyId/reopen', workflow('reopen'))

  router.get(
    '/admin/operations/health/ledger-balance-check',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      requireOperatorRole(request, response, operationsRoles, 'operations.health.ledger')
      response.status(200).json({
        ledgerBalanceCheck:
          await handlers.ledgerBalanceCheckHandler.handle(),
      })
    }),
  )

  router.get(
    '/admin/operations/health/accounting-integrity',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      requireOperatorRole(request, response, operationsRoles, 'operations.health.accounting')
      response.status(200).json({
        accountingIntegrity:
          await handlers.accountingIntegrityHandler.handle(),
      })
    }),
  )

  router.get(
    '/admin/operations/health/treasury-summary',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      requireOperatorRole(request, response, operationsRoles, 'operations.health.treasury')
      response.status(200).json({
        treasurySummary: await handlers.treasurySummaryHandler.handle(),
      })
    }),
  )

  router.post(
    '/admin/risk/accounts/:playerId/freeze',
    asyncHandler(async (request, response) => {
      const operator = requireOperatorRole(
        request,
        response,
        elevatedOperationsRoles,
        'operations.risk.freeze',
      )
      const requestContext = readStateChangingRequestContext(request)
      writeCorrelationHeaders(response, requestContext)
      const riskAccount = await handlers.freezeRiskAccountHandler.handle({
        ...commandPayload(request, operator),
        playerId: routeParam(request.params.playerId),
      } as never)
      response.status(200).json({ riskAccount })
    }),
  )

  router.post(
    '/admin/risk/accounts/:playerId/unfreeze',
    asyncHandler(async (request, response) => {
      const operator = requireOperatorRole(
        request,
        response,
        elevatedOperationsRoles,
        'operations.risk.unfreeze',
      )
      const requestContext = readStateChangingRequestContext(request)
      writeCorrelationHeaders(response, requestContext)
      const riskAccount = await handlers.unfreezeRiskAccountHandler.handle({
        ...commandPayload(request, operator),
        playerId: routeParam(request.params.playerId),
      } as never)
      response.status(200).json({ riskAccount })
    }),
  )

  router.get(
    '/admin/risk/accounts/:playerId',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      requireOperatorRole(request, response, operationsRoles, 'operations.risk.get')
      const riskAccount = await handlers.getRiskAccountHandler.handle(
        routeParam(request.params.playerId),
        optionalQuery(request.query.currency) ?? 'USDC',
      )
      response.status(200).json({ riskAccount })
    }),
  )

  router.post(
    '/admin/operations/balances/rebuild',
    asyncHandler(async (request, response) => {
      const operator = requireOperatorRole(
        request,
        response,
        elevatedOperationsRoles,
        'operations.balances.rebuild',
      )
      const requestContext = readStateChangingRequestContext(request)
      writeCorrelationHeaders(response, requestContext)
      const rebuild = await handlers.rebuildBalancesOperationalHandler.handle(
        commandPayload(request, operator) as never,
      )
      response.status(200).json({ rebuild })
    }),
  )

  router.get(
    '/admin/operations/players/:playerId/financial-timeline',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      requireOperatorRole(request, response, operationsRoles, 'operations.timeline.player')
      const timeline = await handlers.playerFinancialTimelineHandler.handle(
        routeParam(request.params.playerId),
      )
      response.status(200).json({ timeline })
    }),
  )

  router.get(
    '/admin/operations/deposits/:depositIntentId/timeline',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      requireOperatorRole(request, response, operationsRoles, 'operations.timeline.deposit')
      const timeline = await handlers.depositTimelineHandler.handle(
        routeParam(request.params.depositIntentId),
      )
      response.status(200).json({ timeline })
    }),
  )

  router.get(
    '/admin/operations/withdrawals/:withdrawalRequestId/timeline',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      requireOperatorRole(request, response, operationsRoles, 'operations.timeline.withdrawal')
      const timeline = await handlers.withdrawalTimelineHandler.handle(
        routeParam(request.params.withdrawalRequestId),
      )
      response.status(200).json({ timeline })
    }),
  )

  router.post(
    '/admin/operations/reconciliation/races/:raceId/runs',
    asyncHandler(async (request, response) => {
      const requestContext = readStateChangingRequestContext(request)
      writeCorrelationHeaders(response, requestContext)
      const operatorId = requireAuthenticatedOperatorId(request, response)

      const reconciliationRun =
        await handlers.runSettlementReconciliationHandler.handle({
          raceId: routeParam(request.params.raceId),
          operatorId,
          idempotencyKey: requestContext.idempotencyKey,
          correlationId: requestContext.correlationId,
          causationId: requestContext.causationId,
        })

      response.status(201).json({ reconciliationRun })
    }),
  )

  router.get(
    '/admin/operations/reconciliation/runs',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      requireAuthenticatedOperatorId(request, response)

      const raceId = optionalQuery(request.query.raceId)
      const reconciliationRuns =
        await handlers.listSettlementReconciliationRunsHandler.handle(
          raceId ? { raceId } : {},
        )

      response.status(200).json({ reconciliationRuns })
    }),
  )

  return router
}
