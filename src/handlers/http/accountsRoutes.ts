import { Router, type RequestHandler } from 'express'

import {
  createAccountRequestSchema,
  toAccountBalanceResponseDto,
  toAccountResponseDto,
} from '../../domains/accounting/dto/accountDtos.js'
import type { AccountService } from '../../domains/accounting/services/AccountService.js'
import {
  toAccountId,
  toOwnerId,
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

export function createAccountsRouter(accountService: AccountService): Router {
  const router = Router()

  router.post(
    '/',
    asyncHandler(async (request, response) => {
      const body = createAccountRequestSchema.parse(request.body)
      const requestContext = readStateChangingRequestContext(request)
      writeCorrelationHeaders(response, requestContext)

      const account = await accountService.createAccount({
        accountType: body.accountType,
        ownerType: body.ownerType,
        ownerId: toOwnerId(body.ownerId),
        currency: body.currency,
        correlationId: requestContext.correlationId,
        causationId: requestContext.causationId,
        idempotencyKey: requestContext.idempotencyKey,
      })

      response.status(201).json({ account: toAccountResponseDto(account) })
    }),
  )

  router.get(
    '/:accountId',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      const account = await accountService.getAccount(
        toAccountId(requirePathParam(request.params.accountId, 'accountId')),
      )

      response.status(200).json({ account: toAccountResponseDto(account) })
    }),
  )

  router.get(
    '/:accountId/balance',
    asyncHandler(async (request, response) => {
      mirrorCorrelationHeaders(request, response)
      const balance = await accountService.getAccountBalance(
        toAccountId(requirePathParam(request.params.accountId, 'accountId')),
      )

      response
        .status(200)
        .json({ balance: toAccountBalanceResponseDto(balance) })
    }),
  )

  return router
}
