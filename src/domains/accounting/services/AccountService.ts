import type { AuditEvent } from '../../../shared/audit/AuditEvent.js'
import type { Database } from '../../../shared/db/Database.js'
import { requireCorrelationMetadata } from '../../../shared/observability/correlation.js'
import { createLogger, type Logger } from '../../../shared/observability/logger.js'
import type { Clock } from '../../../shared/time/Clock.js'
import { AppError } from '../../../shared/types/AppError.js'
import type { JsonObject } from '../../../shared/types/Json.js'
import { AccountNotFoundError } from '../errors/AccountingErrors.js'
import type { Account } from '../entities/Account.js'
import type { AccountBalance } from '../entities/AccountBalance.js'
import { Account as AccountEntity } from '../entities/Account.js'
import type { AccountRepository } from '../repositories/AccountRepository.js'
import type { AuditEventRepository } from '../repositories/AuditEventRepository.js'
import type { CreateAccountCommand, FreezeAccountCommand, UnfreezeAccountCommand } from '../commands/accountCommands.js'
import { newAccountId, newAuditEventId, type AccountId } from '../types/identifiers.js'

import { IdempotencyService } from './IdempotencyService.js'

const createAccountCommandType = 'create_account'

interface AccountSnapshot extends JsonObject {
  accountId: string
}

export class AccountService {
  private readonly logger: Logger

  constructor(
    private readonly database: Database,
    private readonly accountRepository: AccountRepository,
    private readonly auditEventRepository: AuditEventRepository,
    private readonly idempotencyService: IdempotencyService,
    private readonly clock: Clock,
    logger?: Logger,
  ) {
    this.logger = logger ?? createLogger({ service: 'account-service' })
  }

  async createAccount(command: CreateAccountCommand): Promise<Account> {
    const correlation = requireCorrelationMetadata(command)
    const requestPayload: JsonObject = {
      accountType: command.accountType,
      ownerType: command.ownerType,
      ownerId: command.ownerId,
      currency: command.currency,
      correlationId: correlation.correlationId,
      causationId: correlation.causationId,
    }

    return this.database.tx(async (transaction) => {
      const idempotencyDecision = await this.idempotencyService.begin(
        createAccountCommandType,
        command.idempotencyKey,
        requestPayload,
        transaction,
      )

      if (idempotencyDecision.kind === 'replay') {
        return this.getAccountFromSnapshot(idempotencyDecision.record.responseSnapshot)
      }

      const existingAccount = await this.accountRepository.findByOwnerAndType(
        {
          accountType: command.accountType,
          ownerType: command.ownerType,
          ownerId: command.ownerId,
          currency: command.currency,
        },
        transaction,
      )

      if (existingAccount) {
        throw new AppError({
          category: 'conflict',
          code: 'ACCOUNT_ALREADY_EXISTS',
          message: 'An account already exists for the given owner, type, and currency',
          details: {
            accountType: command.accountType,
            ownerType: command.ownerType,
            ownerId: command.ownerId,
            currency: command.currency,
          },
        })
      }

      const now = this.clock.now()
      const account = new AccountEntity({
        accountId: newAccountId(),
        accountType: command.accountType,
        ownerType: command.ownerType,
        ownerId: command.ownerId,
        currency: command.currency,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })

      await this.accountRepository.create(account, transaction)
      await this.auditEventRepository.append(this.buildAuditEvent('account_created', 'account', account.accountId, {
        accountType: account.accountType,
        ownerType: account.ownerType,
        ownerId: account.ownerId,
        currency: account.currency,
      }, correlation, now), transaction)
      await this.idempotencyService.complete(
        createAccountCommandType,
        command.idempotencyKey,
        requestPayload,
        { accountId: account.accountId },
        transaction,
      )

      this.logger.info('account created', {
        accountId: account.accountId,
        accountType: account.accountType,
        ownerType: account.ownerType,
        ownerId: account.ownerId,
        correlationId: correlation.correlationId,
        causationId: correlation.causationId,
      })

      return account
    })
  }

  async getAccount(accountId: AccountId): Promise<Account> {
    const account = await this.accountRepository.getById(accountId)

    if (!account) {
      throw new AccountNotFoundError(accountId)
    }

    return account
  }

  async getAccountBalance(accountId: AccountId): Promise<AccountBalance> {
    const balance = await this.accountRepository.getBalance(accountId)

    if (!balance) {
      throw new AccountNotFoundError(accountId)
    }

    return balance
  }

  async freezeAccount(command: FreezeAccountCommand): Promise<Account> {
    return this.updateAccountStatus(command, 'freeze')
  }

  async unfreezeAccount(command: UnfreezeAccountCommand): Promise<Account> {
    return this.updateAccountStatus(command, 'unfreeze')
  }

  private async updateAccountStatus(
    command: FreezeAccountCommand | UnfreezeAccountCommand,
    action: 'freeze' | 'unfreeze',
  ): Promise<Account> {
    const correlation = requireCorrelationMetadata(command)

    return this.database.tx(async (transaction) => {
      const account = await this.accountRepository.getById(command.accountId, transaction)

      if (!account) {
        throw new AccountNotFoundError(command.accountId)
      }

      const now = this.clock.now()
      const updatedAccount = action === 'freeze' ? account.freeze(now) : account.unfreeze(now)

      await this.accountRepository.update(updatedAccount, transaction)
      await this.auditEventRepository.append(
        this.buildAuditEvent(
          action === 'freeze' ? 'account_frozen' : 'account_unfrozen',
          'account',
          updatedAccount.accountId,
          { status: updatedAccount.status },
          correlation,
          now,
        ),
        transaction,
      )

      return updatedAccount
    })
  }

  private async getAccountFromSnapshot(snapshot: JsonObject | null): Promise<Account> {
    const accountId = snapshot?.accountId

    if (typeof accountId !== 'string') {
      throw new AppError({
        category: 'internal_error',
        code: 'INVALID_IDEMPOTENT_ACCOUNT_SNAPSHOT',
        message: 'Idempotency replay snapshot is missing accountId',
      })
    }

    return this.getAccount(accountId as AccountId)
  }

  private buildAuditEvent(
    eventType: string,
    entityType: string,
    entityId: string,
    payload: JsonObject,
    correlation: { correlationId: string; causationId: string },
    createdAt: Date,
  ): AuditEvent {
    return {
      auditEventId: newAuditEventId(),
      eventType,
      entityType,
      entityId,
      correlationId: correlation.correlationId,
      causationId: correlation.causationId,
      payload,
      createdAt,
    }
  }
}