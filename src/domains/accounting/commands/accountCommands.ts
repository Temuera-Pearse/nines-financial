import type { IdempotencyKey } from '../../../shared/idempotency/types.js'
import type { CorrelationMetadata } from '../../../shared/observability/correlation.js'
import type { AccountId, OwnerId } from '../types/identifiers.js'
import type { AccountType, OwnerType } from '../types/accountingTypes.js'

export interface CreateAccountCommand extends CorrelationMetadata {
  idempotencyKey: IdempotencyKey
  accountType: AccountType
  ownerType: OwnerType
  ownerId: OwnerId
  currency: string
}

export interface FreezeAccountCommand extends CorrelationMetadata {
  accountId: AccountId
}

export interface UnfreezeAccountCommand extends CorrelationMetadata {
  accountId: AccountId
}