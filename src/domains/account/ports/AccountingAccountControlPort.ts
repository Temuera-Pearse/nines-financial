import type { IdempotencyKey } from '../../../shared/idempotency/types.js'
import type { CorrelationMetadata } from '../../../shared/observability/correlation.js'
import type { DatabaseTransaction } from '../../../shared/db/Database.js'
import type { Account } from '../../accounting/entities/Account.js'
import type { AccountId } from '../../accounting/types/identifiers.js'
import type { UserId } from '../types/identifiers.js'

export interface CreateLinkedPlayerAccountsCommand extends CorrelationMetadata {
  idempotencyKey: IdempotencyKey
  userId: UserId
  currency: string
}

export interface SyncLinkedPlayerAccountsCommand extends CorrelationMetadata {
  idempotencyKey: IdempotencyKey
  availableAccountId: AccountId
  reservedAccountId: AccountId
}

export interface LinkedPlayerAccountingAccounts {
  availableAccount: Account
  reservedAccount: Account
}

export interface AccountingAccountControlPort {
  createLinkedPlayerAccounts(
    command: CreateLinkedPlayerAccountsCommand,
    transaction?: DatabaseTransaction,
  ): Promise<LinkedPlayerAccountingAccounts>
  freezeLinkedPlayerAccounts(
    command: SyncLinkedPlayerAccountsCommand,
    transaction?: DatabaseTransaction,
  ): Promise<LinkedPlayerAccountingAccounts>
  unfreezeLinkedPlayerAccounts(
    command: SyncLinkedPlayerAccountsCommand,
    transaction?: DatabaseTransaction,
  ): Promise<LinkedPlayerAccountingAccounts>
}
