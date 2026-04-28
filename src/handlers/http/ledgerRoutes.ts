import { Router, type RequestHandler } from 'express'

import {
  captureReservationRequestSchema,
  postLedgerTransactionRequestSchema,
  releaseReservationRequestSchema,
  reserveFundsRequestSchema,
  toLedgerTransactionResponseDto,
} from '../../domains/accounting/dto/ledgerDtos.js'
import type { PostingEngineService } from '../../domains/accounting/services/PostingEngineService.js'
import type { ReservationService } from '../../domains/accounting/services/ReservationService.js'
import {
  toAccountId,
  toLedgerTransactionId,
} from '../../domains/accounting/types/identifiers.js'
import { AppError } from '../../shared/types/AppError.js'
import {
  mirrorCorrelationHeaders,
  readStateChangingRequestContext,
  writeCorrelationHeaders,
} from './requestContext.js'

type AsyncRouteHandler = RequestHandler

function asyncHandler(handler: AsyncRouteHandler): AsyncRouteHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next)
  }
}

function requirePathParam(
  value: string | string[] | undefined,
  paramName: string,
): string {
  const normalizedValue = Array.isArray(value) ? value[0] : value

  if (!normalizedValue?.trim()) {
    throw new AppError({
      category: 'validation_error',
      code: 'MISSING_PATH_PARAMETER',
      message: `${paramName} path parameter is required`,
      details: { paramName },
    })
  }

  return normalizedValue.trim()
}

export function createLedgerRouter(
  postingEngineService: PostingEngineService,
  reservationService: ReservationService,
): Router {
  const router = Router()

  router.post(
    '/transactions',
    asyncHandler(async (request, response) => {
      const body = postLedgerTransactionRequestSchema.parse(request.body)
      const requestContext = readStateChangingRequestContext(request)
      writeCorrelationHeaders(response, requestContext)

      const ledgerTransaction = await postingEngineService.postTransaction({
        transactionType: body.transactionType,
        referenceType: body.referenceType,
        referenceId: body.referenceId,
        entries: body.entries.map((entry) => ({
          accountId: toAccountId(entry.accountId),
          direction: entry.direction,
          amountMinor: entry.amountMinor,
          currency: entry.currency,
        })),
        correlationId: requestContext.correlationId,
        causationId: requestContext.causationId,
        idempotencyKey: requestContext.idempotencyKey,
        ...(body.relatedTransactionId
          ? {
              relatedTransactionId: toLedgerTransactionId(
                body.relatedTransactionId,
              ),
            }
          : {}),
        ...(body.effectiveAt ? { effectiveAt: body.effectiveAt } : {}),
        ...(body.adminOnlyOverride !== undefined
          ? { adminOnlyOverride: body.adminOnlyOverride }
          : {}),
      })

      response
        .status(201)
        .json({
          transaction: toLedgerTransactionResponseDto(ledgerTransaction),
        })
    }),
  )

  router.post(
    '/reservations',
    asyncHandler(async (request, response) => {
      const body = reserveFundsRequestSchema.parse(request.body)
      const requestContext = readStateChangingRequestContext(request)
      writeCorrelationHeaders(response, requestContext)

      const reservation = await reservationService.reserveFunds({
        transactionType: body.transactionType,
        referenceType: body.referenceType,
        referenceId: body.referenceId,
        sourceAccountId: toAccountId(body.sourceAccountId),
        reserveAccountId: toAccountId(body.reserveAccountId),
        amountMinor: body.amountMinor,
        currency: body.currency,
        correlationId: requestContext.correlationId,
        causationId: requestContext.causationId,
        idempotencyKey: requestContext.idempotencyKey,
        ...(body.effectiveAt ? { effectiveAt: body.effectiveAt } : {}),
      })

      response.status(201).json({
        reservationId: reservation.transactionId,
        transaction: toLedgerTransactionResponseDto(reservation),
      })
    }),
  )

  router.post(
    '/reservations/:reservationId/release',
    asyncHandler(async (request, response) => {
      const body = releaseReservationRequestSchema.parse(request.body ?? {})
      const reservationId = requirePathParam(
        request.params.reservationId,
        'reservationId',
      )
      const requestContext = readStateChangingRequestContext(request)
      writeCorrelationHeaders(response, requestContext)

      const releaseTransaction = await reservationService.releaseFunds({
        reservationId,
        correlationId: requestContext.correlationId,
        causationId: requestContext.causationId,
        idempotencyKey: requestContext.idempotencyKey,
        ...(body.effectiveAt ? { effectiveAt: body.effectiveAt } : {}),
      })

      response
        .status(201)
        .json({
          transaction: toLedgerTransactionResponseDto(releaseTransaction),
        })
    }),
  )

  router.post(
    '/reservations/:reservationId/capture',
    asyncHandler(async (request, response) => {
      const body = captureReservationRequestSchema.parse(request.body)
      const reservationId = requirePathParam(
        request.params.reservationId,
        'reservationId',
      )
      const requestContext = readStateChangingRequestContext(request)
      writeCorrelationHeaders(response, requestContext)

      const captureTransaction = await reservationService.captureFunds({
        reservationId,
        destinationAccountId: toAccountId(body.destinationAccountId),
        correlationId: requestContext.correlationId,
        causationId: requestContext.causationId,
        idempotencyKey: requestContext.idempotencyKey,
        ...(body.effectiveAt ? { effectiveAt: body.effectiveAt } : {}),
      })

      response
        .status(201)
        .json({
          transaction: toLedgerTransactionResponseDto(captureTransaction),
        })
    }),
  )

  router.use((_request, response) => {
    mirrorCorrelationHeaders(_request, response)
  })

  return router
}
