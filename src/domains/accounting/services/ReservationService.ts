import type {
  Database,
  DatabaseTransaction,
} from '../../../shared/db/Database.js'
import { requireCorrelationMetadata } from '../../../shared/observability/correlation.js'
import {
  createLogger,
  type Logger,
} from '../../../shared/observability/logger.js'
import { AppError } from '../../../shared/types/AppError.js'
import type { JsonObject } from '../../../shared/types/Json.js'
import {
  ReservationNotFoundError,
  ReservationStateError,
} from '../errors/AccountingErrors.js'
import type { LedgerTransaction } from '../entities/LedgerTransaction.js'
import type {
  CaptureReservedFundsCommand,
  ReleaseReservedFundsCommand,
  ReserveFundsCommand,
} from '../commands/ledgerCommands.js'
import type { LedgerRepository } from '../repositories/LedgerRepository.js'
import {
  toLedgerTransactionId,
  type AccountId,
  type LedgerTransactionId,
} from '../types/identifiers.js'

import { IdempotencyService } from './IdempotencyService.js'
import { PostingEngineService } from './PostingEngineService.js'

const reserveFundsCommandType = 'reserve_funds'
const releaseReservedFundsCommandType = 'release_reserved_funds'
const captureReservedFundsCommandType = 'capture_reserved_funds'

interface ReservationPostingShape {
  reservation: LedgerTransaction
  sourceAccountId: AccountId
  reserveAccountId: AccountId
  amountMinor: string
  currency: string
}

export class ReservationService {
  private readonly logger: Logger

  constructor(
    private readonly database: Database,
    private readonly ledgerRepository: LedgerRepository,
    private readonly postingEngineService: PostingEngineService,
    private readonly idempotencyService: IdempotencyService,
    logger?: Logger,
  ) {
    this.logger = logger ?? createLogger({ service: 'reservation-service' })
  }

  async reserveFunds(command: ReserveFundsCommand): Promise<LedgerTransaction> {
    const correlation = requireCorrelationMetadata(command)
    const requestPayload: JsonObject = {
      transactionType: command.transactionType,
      referenceType: command.referenceType,
      referenceId: command.referenceId,
      sourceAccountId: command.sourceAccountId,
      reserveAccountId: command.reserveAccountId,
      amountMinor: command.amountMinor,
      currency: command.currency,
      effectiveAt: command.effectiveAt ?? null,
      correlationId: correlation.correlationId,
      causationId: correlation.causationId,
    }

    return this.database.tx(async (transaction) => {
      const idempotencyDecision = await this.idempotencyService.begin(
        reserveFundsCommandType,
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

      const reserveTransferCommand = {
        transactionType: command.transactionType,
        referenceType: command.referenceType,
        referenceId: command.referenceId,
        debitAccountId: command.sourceAccountId,
        creditAccountId: command.reserveAccountId,
        amountMinor: command.amountMinor,
        currency: command.currency,
        correlationId: correlation.correlationId,
        causationId: correlation.causationId,
        idempotencyKey: command.idempotencyKey,
      }

      const postedReservation =
        await this.postingEngineService.postTransferWithinTransaction(
          command.effectiveAt
            ? {
                ...reserveTransferCommand,
                effectiveAt: command.effectiveAt,
              }
            : reserveTransferCommand,
          transaction,
        )

      await this.idempotencyService.complete(
        reserveFundsCommandType,
        command.idempotencyKey,
        requestPayload,
        {
          transactionId: postedReservation.transactionId,
          reservationId: postedReservation.transactionId,
        },
        transaction,
      )

      return postedReservation
    })
  }

  async releaseFunds(
    command: ReleaseReservedFundsCommand,
  ): Promise<LedgerTransaction> {
    const correlation = requireCorrelationMetadata(command)
    const requestPayload: JsonObject = {
      reservationId: command.reservationId,
      effectiveAt: command.effectiveAt ?? null,
      correlationId: correlation.correlationId,
      causationId: correlation.causationId,
    }

    return this.database.tx(async (transaction) => {
      const idempotencyDecision = await this.idempotencyService.begin(
        releaseReservedFundsCommandType,
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

      const reservationPosting = await this.requireOpenReservation(
        command.reservationId,
        transaction,
      )
      const releaseTransactionType: 'bet_release' | 'withdrawal_reversal' =
        reservationPosting.reservation.transactionType === 'bet_reserve'
          ? 'bet_release'
          : 'withdrawal_reversal'
      const releaseTransferCommand = {
        transactionType: releaseTransactionType,
        referenceType: reservationPosting.reservation.referenceType,
        referenceId: reservationPosting.reservation.referenceId,
        relatedTransactionId: reservationPosting.reservation.transactionId,
        debitAccountId: reservationPosting.reserveAccountId,
        creditAccountId: reservationPosting.sourceAccountId,
        amountMinor: reservationPosting.amountMinor,
        currency: reservationPosting.currency,
        correlationId: correlation.correlationId,
        causationId: correlation.causationId,
        idempotencyKey: command.idempotencyKey,
      }

      const releasedTransaction =
        await this.postingEngineService.postTransferWithinTransaction(
          command.effectiveAt
            ? {
                ...releaseTransferCommand,
                effectiveAt: command.effectiveAt,
              }
            : releaseTransferCommand,
          transaction,
        )

      await this.idempotencyService.complete(
        releaseReservedFundsCommandType,
        command.idempotencyKey,
        requestPayload,
        { transactionId: releasedTransaction.transactionId },
        transaction,
      )

      this.logger.info('reservation released', {
        reservationId: command.reservationId,
        transactionId: releasedTransaction.transactionId,
        correlationId: correlation.correlationId,
      })

      return releasedTransaction
    })
  }

  async captureFunds(
    command: CaptureReservedFundsCommand,
  ): Promise<LedgerTransaction> {
    const correlation = requireCorrelationMetadata(command)
    const requestPayload: JsonObject = {
      reservationId: command.reservationId,
      destinationAccountId: command.destinationAccountId,
      effectiveAt: command.effectiveAt ?? null,
      correlationId: correlation.correlationId,
      causationId: correlation.causationId,
    }

    return this.database.tx(async (transaction) => {
      const idempotencyDecision = await this.idempotencyService.begin(
        captureReservedFundsCommandType,
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

      const reservationPosting = await this.requireOpenReservation(
        command.reservationId,
        transaction,
      )
      const captureTransactionType: 'bet_capture' | 'withdrawal_complete' =
        reservationPosting.reservation.transactionType === 'bet_reserve'
          ? 'bet_capture'
          : 'withdrawal_complete'
      const captureTransferCommand = {
        transactionType: captureTransactionType,
        referenceType: reservationPosting.reservation.referenceType,
        referenceId: reservationPosting.reservation.referenceId,
        relatedTransactionId: reservationPosting.reservation.transactionId,
        debitAccountId: reservationPosting.reserveAccountId,
        creditAccountId: command.destinationAccountId,
        amountMinor: reservationPosting.amountMinor,
        currency: reservationPosting.currency,
        correlationId: correlation.correlationId,
        causationId: correlation.causationId,
        idempotencyKey: command.idempotencyKey,
      }

      const capturedTransaction =
        await this.postingEngineService.postTransferWithinTransaction(
          command.effectiveAt
            ? {
                ...captureTransferCommand,
                effectiveAt: command.effectiveAt,
              }
            : captureTransferCommand,
          transaction,
        )

      await this.idempotencyService.complete(
        captureReservedFundsCommandType,
        command.idempotencyKey,
        requestPayload,
        { transactionId: capturedTransaction.transactionId },
        transaction,
      )

      this.logger.info('reservation captured', {
        reservationId: command.reservationId,
        transactionId: capturedTransaction.transactionId,
        correlationId: correlation.correlationId,
      })

      return capturedTransaction
    })
  }

  private async requireOpenReservation(
    reservationId: string,
    transaction: DatabaseTransaction,
  ): Promise<ReservationPostingShape> {
    const reservation = await this.ledgerRepository.getById(
      toLedgerTransactionId(reservationId),
      transaction,
    )

    if (
      !reservation ||
      (reservation.transactionType !== 'bet_reserve' &&
        reservation.transactionType !== 'withdrawal_reserve')
    ) {
      throw new ReservationNotFoundError(reservationId as never)
    }

    const relatedTransactions =
      await this.ledgerRepository.listByRelatedTransactionId(
        reservation.transactionId,
        transaction,
      )

    if (relatedTransactions.length > 0) {
      const relatedTransaction = relatedTransactions[0]

      if (!relatedTransaction) {
        throw new AppError({
          category: 'internal_error',
          code: 'INVALID_RESERVATION_RELATION_STATE',
          message: 'Expected related reservation transactions to be available',
          details: { reservationId },
        })
      }

      throw new ReservationStateError(
        reservation.transactionId as never,
        'open',
        relatedTransaction.transactionType,
      )
    }

    const debitEntry = reservation.entries.find(
      (entry) => entry.direction === 'debit',
    )
    const creditEntry = reservation.entries.find(
      (entry) => entry.direction === 'credit',
    )

    if (!debitEntry || !creditEntry) {
      throw new AppError({
        category: 'invariant_violation',
        code: 'INVALID_RESERVATION_SHAPE',
        message:
          'Reservation transaction must contain one debit entry and one credit entry',
        details: {
          reservationId: reservation.transactionId,
        },
      })
    }

    if (!debitEntry.amount.equals(creditEntry.amount)) {
      throw new AppError({
        category: 'invariant_violation',
        code: 'INVALID_RESERVATION_AMOUNT',
        message: 'Reservation debit and credit amounts must match',
        details: {
          reservationId: reservation.transactionId,
          debitAmountMinor: debitEntry.amount.amountMinor.toString(),
          creditAmountMinor: creditEntry.amount.amountMinor.toString(),
        },
      })
    }

    return {
      reservation,
      sourceAccountId: debitEntry.accountId,
      reserveAccountId: creditEntry.accountId,
      amountMinor: debitEntry.amount.amountMinor.toString(),
      currency: debitEntry.amount.currency,
    }
  }

  private async getTransactionFromSnapshot(
    snapshot: JsonObject | null,
    transaction: DatabaseTransaction,
  ): Promise<LedgerTransaction> {
    const transactionId = snapshot?.transactionId

    if (typeof transactionId !== 'string') {
      throw new AppError({
        category: 'internal_error',
        code: 'INVALID_RESERVATION_IDEMPOTENCY_SNAPSHOT',
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
        code: 'RESERVATION_IDEMPOTENT_TRANSACTION_NOT_FOUND',
        message:
          'Expected reservation transaction from idempotency replay could not be found',
        details: { transactionId },
      })
    }

    return ledgerTransaction
  }
}
