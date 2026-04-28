import type { IdempotencyKey } from '../../../shared/idempotency/types.js'
import type { Database } from '../../../shared/db/Database.js'
import type { CorrelationMetadata } from '../../../shared/observability/correlation.js'
import { requireCorrelationMetadata } from '../../../shared/observability/correlation.js'
import {
  createLogger,
  type Logger,
} from '../../../shared/observability/logger.js'
import type { Clock } from '../../../shared/time/Clock.js'
import { AppError } from '../../../shared/types/AppError.js'
import { AccountDomainValidationError } from '../errors/AccountDomainErrors.js'
import { PlayerAccount } from '../entities/PlayerAccount.js'
import type {
  AccountingAccountControlPort,
  CreateLinkedPlayerAccountsCommand,
  LinkedPlayerAccountingAccounts,
} from '../ports/AccountingAccountControlPort.js'
import type { PlayerAccountRepository } from '../repositories/PlayerAccountRepository.js'
import { newPlayerAccountId, type UserId } from '../types/identifiers.js'

export interface ProvisionPlayerAccountCommand extends CorrelationMetadata {
  idempotencyKey: IdempotencyKey
  userId: UserId
  currency: string
}

export class PlayerAccountProvisioningService {
  private readonly logger: Logger

  constructor(
    private readonly database: Database,
    private readonly playerAccountRepository: PlayerAccountRepository,
    private readonly accountingAccountControlPort: AccountingAccountControlPort,
    private readonly clock: Clock,
    logger?: Logger,
  ) {
    this.logger =
      logger ?? createLogger({ service: 'player-account-provisioning-service' })
  }

  async provisionIfNeeded(
    command: ProvisionPlayerAccountCommand,
  ): Promise<PlayerAccount> {
    const correlation = requireCorrelationMetadata(command)
    this.requireIdempotencyKey(command.idempotencyKey)

    try {
      return await this.database.tx(async (transaction) => {
        const existingPlayerAccount =
          await this.playerAccountRepository.findByUserAndCurrency(
            {
              userId: command.userId,
              currency: command.currency,
              accountClass: 'primary',
            },
            transaction,
          )

        if (existingPlayerAccount) {
          this.logger.debug(
            'reused existing player account during provisioning',
            {
              playerAccountId: existingPlayerAccount.playerAccountId,
              userId: command.userId,
              currency: command.currency,
              correlationId: correlation.correlationId,
              causationId: correlation.causationId,
            },
          )

          return existingPlayerAccount
        }

        const linkedAccounts =
          await this.accountingAccountControlPort.createLinkedPlayerAccounts(
            this.toCreateLinkedPlayerAccountsCommand(command),
            transaction,
          )

        this.assertLinkedAccountsMatchProvisioningRequest(
          linkedAccounts,
          command,
        )

        const existingPlayerAccountAfterLinkedAccountCreation =
          await this.playerAccountRepository.findByUserAndCurrency(
            {
              userId: command.userId,
              currency: command.currency,
              accountClass: 'primary',
            },
            transaction,
          )

        if (existingPlayerAccountAfterLinkedAccountCreation) {
          return this.resolveConcurrentExistingPlayerAccount(
            existingPlayerAccountAfterLinkedAccountCreation,
            linkedAccounts,
            command,
          )
        }

        const conflictingPlayerAccount =
          await this.playerAccountRepository.findByLinkedAccounts(
            {
              availableAccountId: linkedAccounts.availableAccount.accountId,
              reservedAccountId: linkedAccounts.reservedAccount.accountId,
            },
            transaction,
          )

        if (conflictingPlayerAccount) {
          throw new AppError({
            category: 'conflict',
            code: 'PLAYER_ACCOUNT_LINKS_ALREADY_ASSIGNED',
            message:
              'The linked Accounting Core accounts are already assigned to another PlayerAccount',
            details: {
              conflictingPlayerAccountId:
                conflictingPlayerAccount.playerAccountId,
              availableAccountId: linkedAccounts.availableAccount.accountId,
              reservedAccountId: linkedAccounts.reservedAccount.accountId,
            },
          })
        }

        const now = this.clock.now()
        const playerAccount = new PlayerAccount({
          playerAccountId: newPlayerAccountId(),
          userId: command.userId,
          currency: command.currency,
          accountClass: 'primary',
          availableAccountId: linkedAccounts.availableAccount.accountId,
          reservedAccountId: linkedAccounts.reservedAccount.accountId,
          createdAt: now,
          updatedAt: now,
          statusChangedAt: now,
        })

        try {
          await this.playerAccountRepository.create(playerAccount, transaction)
        } catch (error) {
          if (!this.isPlayerAccountOwnershipUniquenessConflict(error)) {
            throw error
          }

          throw new AppError({
            category: 'conflict',
            code: 'PLAYER_ACCOUNT_OWNERSHIP_RACE_RETRY',
            message:
              'PlayerAccount creation lost a uniqueness race and should be reloaded',
            details: {
              userId: command.userId,
              currency: command.currency,
              accountClass: 'primary',
            },
            cause: error,
          })
        }

        this.logger.info('player account provisioned', {
          playerAccountId: playerAccount.playerAccountId,
          userId: command.userId,
          currency: command.currency,
          availableAccountId: playerAccount.availableAccountId,
          reservedAccountId: playerAccount.reservedAccountId,
          correlationId: correlation.correlationId,
          causationId: correlation.causationId,
        })

        return playerAccount
      })
    } catch (error) {
      if (!this.isPlayerAccountOwnershipRaceRetry(error)) {
        throw error
      }

      const existingPlayerAccount =
        await this.playerAccountRepository.findByUserAndCurrency({
          userId: command.userId,
          currency: command.currency,
          accountClass: 'primary',
        })

      if (!existingPlayerAccount) {
        throw error
      }

      this.logger.debug(
        'reloaded player account after provisioning uniqueness race',
        {
          playerAccountId: existingPlayerAccount.playerAccountId,
          userId: command.userId,
          currency: command.currency,
          correlationId: correlation.correlationId,
          causationId: correlation.causationId,
        },
      )

      return existingPlayerAccount
    }
  }

  private toCreateLinkedPlayerAccountsCommand(
    command: ProvisionPlayerAccountCommand,
  ): CreateLinkedPlayerAccountsCommand {
    return {
      idempotencyKey: command.idempotencyKey,
      userId: command.userId,
      currency: command.currency,
      correlationId: command.correlationId,
      causationId: command.causationId,
    }
  }

  private requireIdempotencyKey(idempotencyKey: IdempotencyKey) {
    if (!`${idempotencyKey}`.trim()) {
      throw new AccountDomainValidationError(
        'MISSING_IDEMPOTENCY_KEY',
        'idempotencyKey is required for PlayerAccount provisioning',
      )
    }
  }

  private resolveConcurrentExistingPlayerAccount(
    existingPlayerAccount: PlayerAccount,
    linkedAccounts: LinkedPlayerAccountingAccounts,
    command: ProvisionPlayerAccountCommand,
  ): PlayerAccount {
    if (
      existingPlayerAccount.availableAccountId !==
        linkedAccounts.availableAccount.accountId ||
      existingPlayerAccount.reservedAccountId !==
        linkedAccounts.reservedAccount.accountId
    ) {
      throw new AppError({
        category: 'conflict',
        code: 'PLAYER_ACCOUNT_CONCURRENT_PROVISIONING_CONFLICT',
        message:
          'A concurrent PlayerAccount provision already succeeded with different linked Accounting Core accounts',
        details: {
          existingPlayerAccountId: existingPlayerAccount.playerAccountId,
          expectedAvailableAccountId: existingPlayerAccount.availableAccountId,
          actualAvailableAccountId: linkedAccounts.availableAccount.accountId,
          expectedReservedAccountId: existingPlayerAccount.reservedAccountId,
          actualReservedAccountId: linkedAccounts.reservedAccount.accountId,
          userId: command.userId,
          currency: command.currency,
          accountClass: 'primary',
        },
      })
    }

    this.logger.debug('reused concurrently provisioned player account', {
      playerAccountId: existingPlayerAccount.playerAccountId,
      userId: command.userId,
      currency: command.currency,
    })

    return existingPlayerAccount
  }

  private isPlayerAccountOwnershipUniquenessConflict(error: unknown): boolean {
    return (
      error instanceof AppError &&
      error.category === 'conflict' &&
      error.code === 'PLAYER_ACCOUNT_ALREADY_EXISTS'
    )
  }

  private isPlayerAccountOwnershipRaceRetry(error: unknown): boolean {
    return (
      error instanceof AppError &&
      error.category === 'conflict' &&
      error.code === 'PLAYER_ACCOUNT_OWNERSHIP_RACE_RETRY'
    )
  }

  private assertLinkedAccountsMatchProvisioningRequest(
    linkedAccounts: LinkedPlayerAccountingAccounts,
    command: ProvisionPlayerAccountCommand,
  ) {
    if (
      linkedAccounts.availableAccount.accountType !== 'user_available' ||
      linkedAccounts.reservedAccount.accountType !== 'user_locked'
    ) {
      throw new AppError({
        category: 'invariant_violation',
        code: 'INVALID_LINKED_PLAYER_ACCOUNT_TYPES',
        message:
          'Linked Accounting Core accounts for a PlayerAccount must be the user available and user locked account types',
        details: {
          availableAccountType: linkedAccounts.availableAccount.accountType,
          reservedAccountType: linkedAccounts.reservedAccount.accountType,
        },
      })
    }

    if (
      linkedAccounts.availableAccount.ownerType !== 'user' ||
      linkedAccounts.reservedAccount.ownerType !== 'user'
    ) {
      throw new AppError({
        category: 'invariant_violation',
        code: 'INVALID_LINKED_PLAYER_ACCOUNT_OWNERS',
        message:
          'Linked Accounting Core accounts for a PlayerAccount must be user-owned accounts',
        details: {
          availableOwnerType: linkedAccounts.availableAccount.ownerType,
          reservedOwnerType: linkedAccounts.reservedAccount.ownerType,
        },
      })
    }

    if (
      String(linkedAccounts.availableAccount.ownerId) !==
        String(command.userId) ||
      String(linkedAccounts.reservedAccount.ownerId) !== String(command.userId)
    ) {
      throw new AppError({
        category: 'invariant_violation',
        code: 'INVALID_LINKED_PLAYER_ACCOUNT_OWNER_ID',
        message:
          'Linked Accounting Core accounts for a PlayerAccount must belong to the requested user',
        details: {
          userId: command.userId,
          availableOwnerId: linkedAccounts.availableAccount.ownerId,
          reservedOwnerId: linkedAccounts.reservedAccount.ownerId,
        },
      })
    }

    if (
      linkedAccounts.availableAccount.currency !== command.currency ||
      linkedAccounts.reservedAccount.currency !== command.currency
    ) {
      throw new AppError({
        category: 'invariant_violation',
        code: 'INVALID_LINKED_PLAYER_ACCOUNT_CURRENCY',
        message:
          'Linked Accounting Core accounts for a PlayerAccount must use the requested currency',
        details: {
          currency: command.currency,
          availableCurrency: linkedAccounts.availableAccount.currency,
          reservedCurrency: linkedAccounts.reservedAccount.currency,
        },
      })
    }
  }
}
