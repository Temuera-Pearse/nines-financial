import type { AuditEvent } from '../../../shared/audit/AuditEvent.js'
import type {
  Database,
  DatabaseTransaction,
} from '../../../shared/db/Database.js'
import { Money } from '../../../shared/money/Money.js'
import { requireCorrelationMetadata } from '../../../shared/observability/correlation.js'
import {
  createLogger,
  type Logger,
} from '../../../shared/observability/logger.js'
import type { Clock } from '../../../shared/time/Clock.js'
import { AppError } from '../../../shared/types/AppError.js'
import type { JsonObject } from '../../../shared/types/Json.js'
import {
  AccountNotFoundError,
  InsufficientFundsError,
} from '../errors/AccountingErrors.js'
import { LedgerEntry } from '../entities/LedgerEntry.js'
import { LedgerTransaction } from '../entities/LedgerTransaction.js'
import type {
  CreditAccountCommand,
  DebitAccountCommand,
  LedgerEntryInput,
  PostTransactionCommand,
  PostTransferCommand,
} from '../commands/ledgerCommands.js'
import type { AccountRepository } from '../repositories/AccountRepository.js'
import type { AuditEventRepository } from '../repositories/AuditEventRepository.js'
import type { LedgerRepository } from '../repositories/LedgerRepository.js'
import {
  getAccountPostingPolicy,
  getTransactionTypePolicy,
} from '../types/accountingTypes.js'
import {
  newAuditEventId,
  newLedgerEntryId,
  newLedgerTransactionId,
  type AccountId,
  type LedgerTransactionId,
} from '../types/identifiers.js'

import { IdempotencyService } from './IdempotencyService.js'

const postTransactionCommandType = 'post_transaction'
const postTransferCommandType = 'post_transfer'

type InternalPostTransactionCommand = Omit<
  PostTransactionCommand,
  'idempotencyKey'
> & {
  idempotencyKey?: PostTransactionCommand['idempotencyKey']
}

type InternalPostTransferCommand = Omit<
  PostTransferCommand,
  'idempotencyKey'
> & {
  idempotencyKey?: PostTransferCommand['idempotencyKey']
}

interface TransactionSnapshot extends JsonObject {
  transactionId: string
}

export class PostingEngineService {
  private readonly logger: Logger

  constructor(
    private readonly database: Database,
    private readonly accountRepository: AccountRepository,
    private readonly ledgerRepository: LedgerRepository,
    private readonly auditEventRepository: AuditEventRepository,
    private readonly idempotencyService: IdempotencyService,
    private readonly clock: Clock,
    logger?: Logger,
  ) {
    this.logger = logger ?? createLogger({ service: 'posting-engine-service' })
  }

  async postTransaction(
    command: PostTransactionCommand,
  ): Promise<LedgerTransaction> {
    return this.database.tx(async (transaction) => {
      const requestPayload = this.buildPostTransactionPayload(command)
      const idempotencyDecision = await this.idempotencyService.begin(
        postTransactionCommandType,
        command.idempotencyKey,
        requestPayload,
        transaction,
      )

      if (idempotencyDecision.kind === 'replay') {
        return this.getTransactionFromSnapshot(
          idempotencyDecision.record.responseSnapshot,
          transaction,
        )
      }

      const postedTransaction = await this.postTransactionWithinTransaction(
        command,
        transaction,
      )

      await this.idempotencyService.complete(
        postTransactionCommandType,
        command.idempotencyKey,
        requestPayload,
        { transactionId: postedTransaction.transactionId },
        transaction,
      )

      return postedTransaction
    })
  }

  async postTransfer(command: PostTransferCommand): Promise<LedgerTransaction> {
    return this.database.tx(async (transaction) => {
      const requestPayload = this.buildPostTransferPayload(command)
      const idempotencyDecision = await this.idempotencyService.begin(
        postTransferCommandType,
        command.idempotencyKey,
        requestPayload,
        transaction,
      )

      if (idempotencyDecision.kind === 'replay') {
        return this.getTransactionFromSnapshot(
          idempotencyDecision.record.responseSnapshot,
          transaction,
        )
      }

      const postedTransaction = await this.postTransferWithinTransaction(
        command,
        transaction,
      )

      await this.idempotencyService.complete(
        postTransferCommandType,
        command.idempotencyKey,
        requestPayload,
        { transactionId: postedTransaction.transactionId },
        transaction,
      )

      return postedTransaction
    })
  }

  async creditAccount(
    command: CreditAccountCommand,
  ): Promise<LedgerTransaction> {
    return this.postTransfer({
      ...command,
      debitAccountId: command.offsetDebitAccountId,
      creditAccountId: command.creditAccountId,
    })
  }

  async debitAccount(command: DebitAccountCommand): Promise<LedgerTransaction> {
    return this.postTransfer({
      ...command,
      debitAccountId: command.debitAccountId,
      creditAccountId: command.offsetCreditAccountId,
    })
  }

  // Internal orchestration entry point. Other domains may call accounting services, but only
  // Accounting Core reaches repository append methods and writes ledger rows.
  async postTransactionWithinTransaction(
    command: InternalPostTransactionCommand,
    transaction: DatabaseTransaction,
  ): Promise<LedgerTransaction> {
    const correlation = requireCorrelationMetadata(command)
    const transactionTypePolicy = getTransactionTypePolicy(
      command.transactionType,
    )

    if (transactionTypePolicy.adminOnly && !command.adminOnlyOverride) {
      throw new AppError({
        category: 'forbidden',
        code: 'ADMIN_ONLY_TRANSACTION_TYPE',
        message:
          'manual_adjustment is admin/internal only and requires an explicit override',
        details: {
          transactionType: command.transactionType,
        },
      })
    }

    const createdAt = this.clock.now()
    const effectiveAt = this.resolveEffectiveAt(command.effectiveAt, createdAt)
    const transactionId = newLedgerTransactionId()
    const entries = command.entries.map(
      (entry) =>
        new LedgerEntry({
          entryId: newLedgerEntryId(),
          transactionId,
          accountId: entry.accountId,
          direction: entry.direction,
          amountMinor: entry.amountMinor,
          currency: entry.currency,
          effectiveAt,
          createdAt,
        }),
    )
    const ledgerTransaction = new LedgerTransaction({
      transactionId,
      transactionType: command.transactionType,
      referenceType: command.referenceType,
      referenceId: command.referenceId,
      status: 'posted',
      correlationId: correlation.correlationId,
      causationId: correlation.causationId,
      createdAt,
      entries,
      ...(command.idempotencyKey
        ? { idempotencyKey: command.idempotencyKey }
        : {}),
      ...(command.relatedTransactionId
        ? { relatedTransactionId: command.relatedTransactionId }
        : {}),
    })

    await this.validatePosting(ledgerTransaction, transaction)
    await this.ledgerRepository.appendTransaction(
      ledgerTransaction,
      transaction,
    )
    await this.auditEventRepository.append(
      this.buildAuditEvent(ledgerTransaction),
      transaction,
    )

    this.logger.info('ledger transaction posted', {
      transactionId: ledgerTransaction.transactionId,
      transactionType: ledgerTransaction.transactionType,
      referenceType: ledgerTransaction.referenceType,
      referenceId: ledgerTransaction.referenceId,
      relatedTransactionId: ledgerTransaction.relatedTransactionId ?? null,
      correlationId: ledgerTransaction.correlationId,
      causationId: ledgerTransaction.causationId,
    })

    return ledgerTransaction
  }

  async postTransferWithinTransaction(
    command: InternalPostTransferCommand,
    transaction: DatabaseTransaction,
  ): Promise<LedgerTransaction> {
    const transferCommand: InternalPostTransactionCommand = {
      transactionType: command.transactionType,
      referenceType: command.referenceType,
      referenceId: command.referenceId,
      correlationId: command.correlationId,
      causationId: command.causationId,
      entries: [
        {
          accountId: command.debitAccountId,
          direction: 'debit',
          amountMinor: command.amountMinor,
          currency: command.currency,
        },
        {
          accountId: command.creditAccountId,
          direction: 'credit',
          amountMinor: command.amountMinor,
          currency: command.currency,
        },
      ],
    }

    if (command.relatedTransactionId) {
      transferCommand.relatedTransactionId = command.relatedTransactionId
    }

    if (command.idempotencyKey) {
      transferCommand.idempotencyKey = command.idempotencyKey
    }

    if (command.effectiveAt) {
      transferCommand.effectiveAt = command.effectiveAt
    }

    if (command.adminOnlyOverride !== undefined) {
      transferCommand.adminOnlyOverride = command.adminOnlyOverride
    }

    return this.postTransactionWithinTransaction(transferCommand, transaction)
  }

  private buildPostTransactionPayload(
    command: PostTransactionCommand,
  ): JsonObject {
    return {
      transactionType: command.transactionType,
      referenceType: command.referenceType,
      referenceId: command.referenceId,
      relatedTransactionId: command.relatedTransactionId ?? null,
      effectiveAt: command.effectiveAt ?? null,
      adminOnlyOverride: command.adminOnlyOverride ?? false,
      correlationId: command.correlationId,
      causationId: command.causationId,
      entries: command.entries.map((entry) => ({
        accountId: entry.accountId,
        direction: entry.direction,
        amountMinor: entry.amountMinor,
        currency: entry.currency,
      })),
    }
  }

  private buildPostTransferPayload(command: PostTransferCommand): JsonObject {
    return {
      transactionType: command.transactionType,
      referenceType: command.referenceType,
      referenceId: command.referenceId,
      relatedTransactionId: command.relatedTransactionId ?? null,
      effectiveAt: command.effectiveAt ?? null,
      adminOnlyOverride: command.adminOnlyOverride ?? false,
      correlationId: command.correlationId,
      causationId: command.causationId,
      debitAccountId: command.debitAccountId,
      creditAccountId: command.creditAccountId,
      amountMinor: command.amountMinor,
      currency: command.currency,
    }
  }

  private async validatePosting(
    ledgerTransaction: LedgerTransaction,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    const uniqueAccountIds = [
      ...new Set(ledgerTransaction.entries.map((entry) => entry.accountId)),
    ]
    const postingStates =
      await this.accountRepository.getPostingStatesForUpdate(
        uniqueAccountIds,
        transaction,
      )
    const postingStateByAccountId = new Map(
      postingStates.map((state) => [state.account.accountId, state]),
    )

    for (const accountId of uniqueAccountIds) {
      if (!postingStateByAccountId.has(accountId)) {
        throw new AccountNotFoundError(accountId)
      }
    }

    const balanceDeltaByAccountId = new Map<AccountId, Money>()

    for (const entry of ledgerTransaction.entries) {
      const postingState = postingStateByAccountId.get(entry.accountId)

      if (!postingState) {
        throw new AccountNotFoundError(entry.accountId)
      }

      postingState.account.ensureCanPost()

      if (postingState.account.currency !== entry.amount.currency) {
        throw new AppError({
          category: 'invariant_violation',
          code: 'ACCOUNT_CURRENCY_MISMATCH',
          message:
            'Ledger entry currency must match the target account currency',
          details: {
            accountId: postingState.account.accountId,
            accountCurrency: postingState.account.currency,
            entryCurrency: entry.amount.currency,
          },
        })
      }

      const existingDelta =
        balanceDeltaByAccountId.get(entry.accountId) ??
        Money.zero(postingState.account.currency)
      balanceDeltaByAccountId.set(
        entry.accountId,
        existingDelta.add(entry.signedAmount()),
      )
    }

    for (const [accountId, delta] of balanceDeltaByAccountId.entries()) {
      const postingState = postingStateByAccountId.get(accountId)

      if (!postingState) {
        throw new AccountNotFoundError(accountId)
      }

      const postingPolicy = getAccountPostingPolicy(
        postingState.account.accountType,
      )
      const resultingBalance = postingState.balance.balance.add(delta)

      if (
        !postingPolicy.allowNegativeBalance &&
        resultingBalance.amountMinor < 0n
      ) {
        throw new InsufficientFundsError(
          accountId,
          postingState.balance.balance.amountMinor.toString(),
          delta.amountMinor < 0n ? (-delta.amountMinor).toString() : '0',
        )
      }
    }
  }

  private async getTransactionFromSnapshot(
    snapshot: JsonObject | null,
    transaction?: DatabaseTransaction,
  ): Promise<LedgerTransaction> {
    const transactionId = snapshot?.transactionId

    if (typeof transactionId !== 'string') {
      throw new AppError({
        category: 'internal_error',
        code: 'INVALID_IDEMPOTENT_TRANSACTION_SNAPSHOT',
        message: 'Idempotency replay snapshot is missing transactionId',
      })
    }

    const ledgerTransaction = await this.ledgerRepository.getById(
      transactionId as LedgerTransactionId,
      transaction,
    )

    if (!ledgerTransaction) {
      throw new AppError({
        category: 'internal_error',
        code: 'IDEMPOTENT_TRANSACTION_NOT_FOUND',
        message:
          'Expected ledger transaction from idempotency replay could not be found',
        details: { transactionId },
      })
    }

    return ledgerTransaction
  }

  private resolveEffectiveAt(
    effectiveAt: string | undefined,
    fallback: Date,
  ): Date {
    if (!effectiveAt) {
      return fallback
    }

    const parsedDate = new Date(effectiveAt)

    if (Number.isNaN(parsedDate.getTime())) {
      throw new AppError({
        category: 'validation_error',
        code: 'INVALID_EFFECTIVE_AT',
        message: 'effectiveAt must be a valid ISO-8601 timestamp',
        details: { effectiveAt },
      })
    }

    return parsedDate
  }

  private buildAuditEvent(ledgerTransaction: LedgerTransaction): AuditEvent {
    return {
      auditEventId: newAuditEventId(),
      eventType: 'ledger_transaction_posted',
      entityType: 'ledger_transaction',
      entityId: ledgerTransaction.transactionId,
      correlationId: ledgerTransaction.correlationId,
      causationId: ledgerTransaction.causationId,
      payload: {
        transactionType: ledgerTransaction.transactionType,
        referenceType: ledgerTransaction.referenceType,
        referenceId: ledgerTransaction.referenceId,
        relatedTransactionId: ledgerTransaction.relatedTransactionId ?? null,
        entryCount: ledgerTransaction.entries.length,
      },
      createdAt: ledgerTransaction.createdAt,
    }
  }
}
