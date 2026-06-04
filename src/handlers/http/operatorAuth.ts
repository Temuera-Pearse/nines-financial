import { timingSafeEqual } from 'node:crypto'

import type { Request, Response } from 'express'

import { AppError } from '../../shared/types/AppError.js'

const allowedOperatorRoles = new Set([
  'admin',
  'operator',
  'settlement_operator',
  'finance_operator',
  'treasury_operator',
  'treasury_admin',
  'financial_admin',
])

function assertSharedSecretIfConfigured(request: Request): void {
  const configuredSecret =
    process.env.NINES_FINANCIAL_OPERATOR_SHARED_SECRET?.trim()

  if (!configuredSecret) {
    return
  }

  const providedSecret = request
    .header('x-nines-operator-secret')
    ?.trim()

  if (!providedSecret) {
    throw new AppError({
      category: 'forbidden',
      code: 'MISSING_OPERATOR_SHARED_SECRET',
      message:
        'Operator shared secret header is required for settlement operations',
    })
  }

  const expected = Buffer.from(configuredSecret)
  const actual = Buffer.from(providedSecret)

  if (
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual)
  ) {
    throw new AppError({
      category: 'forbidden',
      code: 'OPERATOR_SHARED_SECRET_INVALID',
      message: 'Operator shared secret is not authorized',
    })
  }
}

export function requireAuthenticatedOperatorId(
  request: Request,
  response: Response,
): string {
  return requireAuthenticatedOperator(request, response).operatorId
}

export interface AuthenticatedOperator {
  operatorId: string
  operatorRole: string
}

export function requireAuthenticatedOperator(
  request: Request,
  response: Response,
): AuthenticatedOperator {
  assertSharedSecretIfConfigured(request)

  const locals = response.locals as { authenticatedUserId?: unknown }
  const operatorId =
    typeof locals.authenticatedUserId === 'string'
      ? locals.authenticatedUserId.trim()
      : ''

  if (!operatorId) {
    throw new AppError({
      category: 'forbidden',
      code: 'MISSING_AUTHENTICATED_OPERATOR_ID',
      message:
        'Authenticated operator identity must be provided before settlement operations execute',
    })
  }

  const role = (
    request.header('x-nines-operator-role') ??
    request.header('x-nines-admin-role') ??
    ''
  )
    .trim()
    .toLowerCase()

  if (!role) {
    throw new AppError({
      category: 'forbidden',
      code: 'MISSING_OPERATOR_ROLE',
      message: 'Operator role header is required for settlement operations',
    })
  }

  if (!allowedOperatorRoles.has(role)) {
    throw new AppError({
      category: 'forbidden',
      code: 'OPERATOR_ROLE_NOT_AUTHORIZED',
      message:
        'Authenticated operator does not have a role authorized for settlement operations',
      details: { role },
    })
  }

  return { operatorId, operatorRole: role }
}

export function requireOperatorRole(
  request: Request,
  response: Response,
  allowedRoles: readonly string[],
  action: string,
): AuthenticatedOperator {
  const operator = requireAuthenticatedOperator(request, response)

  if (!allowedRoles.includes(operator.operatorRole)) {
    throw new AppError({
      category: 'forbidden',
      code: 'OPERATOR_ROLE_INSUFFICIENT',
      message: 'Authenticated operator role is not authorized for this action',
      details: {
        action,
        role: operator.operatorRole,
        allowedRoles: [...allowedRoles],
      },
    })
  }

  return operator
}
