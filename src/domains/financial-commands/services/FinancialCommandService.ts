import { createHash, randomUUID } from 'node:crypto'

import type { Account } from '../../accounting/entities/Account.js'
import type { PlayerAccount } from '../../account/entities/PlayerAccount.js'
import type {
  Database,
  DatabaseTransaction,
} from '../../../shared/db/Database.js'
import type { AccountRepository } from '../../accounting/repositories/AccountRepository.js'
import type { LedgerRepository } from '../../accounting/repositories/LedgerRepository.js'
import { AccountService } from '../../accounting/services/AccountService.js'
import { PostingEngineService } from '../../accounting/services/PostingEngineService.js'
import { ReservationService } from '../../accounting/services/ReservationService.js'
import type {
  AccountType,
  OwnerType,
} from '../../accounting/types/accountingTypes.js'
import {
  toLedgerTransactionId,
  toOwnerId,
  type AccountId,
  type LedgerTransactionId,
} from '../../accounting/types/identifiers.js'
import { AccountActionAuthorizationService } from '../../account/restrictions/AccountActionAuthorizationService.js'
import type { AccountActionType } from '../../account/restrictions/accountActionTypes.js'
import { EffectiveStatusService } from '../../account/services/EffectiveStatusService.js'
import { PlayerAccountProvisioningService } from '../../account/services/PlayerAccountProvisioningService.js'
import { toUserId } from '../../account/types/identifiers.js'
import { toIdempotencyKey } from '../../../shared/idempotency/types.js'
import type { OutboxRepository } from '../../../shared/outbox/OutboxRepository.js'
import type { FaultInjector } from '../../../shared/faults/FaultInjector.js'
import type { Clock } from '../../../shared/time/Clock.js'
import { AppError } from '../../../shared/types/AppError.js'
import type { JsonObject } from '../../../shared/types/Json.js'
import type {
  FinancialBetDto,
  RacePoolDto,
} from '../../betting/dto/bettingDtos.js'
import type {
  BettingRepository,
  SettlementCarryoverRecord,
  SettlementRemediationActionRecord,
  SettlementRunRecord,
  SettlementRunStatus,
} from '../../betting/repositories/BettingRepository.js'
import type {
  ApplyHouseTakeCommandDto,
  ApplyHouseTakeResultDto,
  ApplyCarryoversToRaceCommandDto,
  ApplyCarryoversToRaceResultDto,
  MarkSettlementManualReviewCommandDto,
  ReleaseReservationCommandDto,
  ReleaseReservationResultDto,
  ResolveSettlementManualReviewCommandDto,
  ReserveStakeCommandDto,
  ReserveStakeResultDto,
  SettlementRemediationResultDto,
  SettleBetCommandDto,
  SettleBetResultDto,
  VoidPoolFromManualReviewCommandDto,
} from '../dto/financialCommandDtos.js'

const canonicalCurrency = 'USDC'
const basisPointsDenominator = 10_000n

interface SettlementAllocation {
  betId: string
  userId: string
  selectionId: string
  stakeMinor: string
  resultStatus: 'won' | 'lost'
  payoutMinor: string
}

interface SettlementCalculation {
  acceptedStakeMinor: string
  appliedCarryoverMinor: string
  grossPoolMinor: string
  houseTakeMinor: string
  netPoolMinor: string
  roundingResidualMinor: string
  carryoverMinor: string
  reasonCode: string | null
  allocations: SettlementAllocation[]
}

export class FinancialCommandService {
  constructor(
    private readonly database: Database,
    private readonly playerAccountProvisioningService: PlayerAccountProvisioningService,
    private readonly accountRepository: AccountRepository,
    private readonly ledgerRepository: LedgerRepository,
    private readonly accountService: AccountService,
    private readonly postingEngineService: PostingEngineService,
    private readonly reservationService: ReservationService,
    private readonly effectiveStatusService: EffectiveStatusService,
    private readonly authorizationService: AccountActionAuthorizationService,
    private readonly bettingRepository: BettingRepository,
    private readonly outboxRepository: OutboxRepository,
    private readonly clock: Clock,
    private readonly faultInjector: FaultInjector,
  ) {}

  async reserveStake(
    command: ReserveStakeCommandDto,
  ): Promise<ReserveStakeResultDto> {
    this.assertCanonicalCurrency(command.currency)
    const playerAccount = await this.provisionPlayerAccount(command)
    await this.assertPlayerActionAuthorized(playerAccount, 'bet_reserve')

    const reservation = await this.reservationService.reserveFunds({
      idempotencyKey: toIdempotencyKey(command.idempotencyKey),
      transactionType: 'bet_reserve',
      referenceType: 'bet',
      referenceId: command.betId,
      sourceAccountId: playerAccount.availableAccountId,
      reserveAccountId: playerAccount.reservedAccountId,
      amountMinor: command.stakeMinor,
      currency: command.currency,
      correlationId: command.correlationId,
      causationId: command.causationId,
    })

    await this.emitOutboxEvent({
      eventType: 'stake_reserved',
      aggregateType: 'bet',
      aggregateId: command.betId,
      idempotencyKey: command.idempotencyKey,
      correlationId: command.correlationId,
      causationId: command.causationId,
      payload: {
        betId: command.betId,
        userId: command.userId,
        raceId: command.raceId,
        selectionId: command.selectionId,
        reservationId: reservation.transactionId,
        stakeMinor: command.stakeMinor,
        currency: command.currency,
        transactionId: reservation.transactionId,
      },
    })

    return {
      reservationId: reservation.transactionId,
      acceptedAt: reservation.createdAt.toISOString(),
    }
  }

  async releaseReservation(
    command: ReleaseReservationCommandDto,
  ): Promise<ReleaseReservationResultDto> {
    const release = await this.reservationService.releaseFunds({
      idempotencyKey: toIdempotencyKey(command.idempotencyKey),
      reservationId: command.reservationId,
      correlationId: command.correlationId,
      causationId: command.causationId,
    })

    await this.emitOutboxEvent({
      eventType: 'reservation_released',
      aggregateType: 'reservation',
      aggregateId: command.reservationId,
      idempotencyKey: command.idempotencyKey,
      correlationId: command.correlationId,
      causationId: command.causationId,
      payload: {
        reservationId: command.reservationId,
        reasonCode: command.reasonCode,
        transactionId: release.transactionId,
      },
    })

    return {
      reservationId: command.reservationId,
      releasedAt: release.createdAt.toISOString(),
    }
  }

  async settleBet(command: SettleBetCommandDto): Promise<SettleBetResultDto> {
    this.assertCanonicalCurrency(command.currency)
    const commandFingerprint = this.settlementCommandFingerprint(command)
    const idempotencyReplay =
      await this.bettingRepository.getSettlementRunByIdempotencyKey(
        command.idempotencyKey,
      )

    if (idempotencyReplay) {
      return this.replaySettlementRun(idempotencyReplay, commandFingerprint)
    }

    const existingCompleted =
      await this.bettingRepository.getCompletedSettlementRunByRace(
        command.raceId,
        command.currency,
      )

    if (existingCompleted) {
      throw new AppError({
        category: 'conflict',
        code: 'RACE_ALREADY_SETTLED',
        message: 'A completed settlement already exists for this race',
        details: {
          raceId: command.raceId,
          settlementRunId: existingCompleted.settlementRunId,
        },
      })
    }

    const activeRun = await this.bettingRepository.getActiveSettlementRunByRace(
      command.raceId,
      command.currency,
    )

    if (activeRun) {
      throw new AppError({
        category: 'conflict',
        code: 'SETTLEMENT_ALREADY_ACTIVE',
        message: 'A settlement run is already active for this race',
        details: {
          raceId: command.raceId,
          settlementRunId: activeRun.settlementRunId,
          status: activeRun.status,
        },
      })
    }

    await this.assertPoolAndWinnerReadyForSettlement(command)
    const acceptedBets = (
      await this.bettingRepository.listBetsByRaceId(command.raceId)
    ).filter((bet) => bet.status === 'accepted')
    const appliedCarryoverMinor = await this.getAppliedCarryoverMinor(
      command.raceId,
    )
    const settlement = this.calculatePoolProration(
      command,
      acceptedBets,
      appliedCarryoverMinor,
    )
    const payoutAccountByUserId = new Map<string, PlayerAccount>()

    for (const allocation of settlement.allocations) {
      if (BigInt(allocation.payoutMinor) <= 0n) {
        continue
      }

      const playerAccount = await this.provisionPlayerAccount({
        userId: allocation.userId,
        currency: command.currency,
        idempotencyKey: command.idempotencyKey,
        correlationId: command.correlationId,
        causationId: command.causationId,
      })
      await this.assertPlayerActionAuthorized(
        playerAccount,
        'settlement_payout',
      )
      payoutAccountByUserId.set(allocation.userId, playerAccount)
    }

    const settlementClearingAccount =
      BigInt(settlement.grossPoolMinor) > 0n
        ? await this.ensureAccount({
            accountType: 'settlement_clearing',
            ownerType: 'settlement',
            ownerId: `race:${command.raceId}`,
            currency: command.currency,
            correlationId: command.correlationId,
            causationId: command.causationId,
            idempotencyKey: `ensure:settlement-clearing:${command.raceId}:${command.currency}`,
          })
        : null
    const houseTakeRevenueAccount =
      BigInt(settlement.houseTakeMinor) > 0n
        ? await this.ensureAccount({
            accountType: 'house_take_revenue',
            ownerType: 'platform',
            ownerId: 'house',
            currency: command.currency,
            correlationId: command.correlationId,
            causationId: command.causationId,
            idempotencyKey: `ensure:house-take-revenue:${command.currency}`,
          })
        : null
    const carryoverAccount =
      BigInt(settlement.carryoverMinor) > 0n
        ? await this.ensureAccount({
            accountType: 'race_selection_pool',
            ownerType: 'settlement',
            ownerId: `carryover:${command.raceId}`,
            currency: command.currency,
            correlationId: command.correlationId,
            causationId: command.causationId,
            idempotencyKey: `ensure:settlement-carryover:${command.raceId}:${command.currency}`,
          })
        : null

    return this.database.tx(async (transaction) => {
      const replay =
        await this.bettingRepository.getSettlementRunByIdempotencyKey(
          command.idempotencyKey,
          transaction,
        )

      if (replay) {
        return this.replaySettlementRun(replay, commandFingerprint)
      }

      const completed =
        await this.bettingRepository.getCompletedSettlementRunByRace(
          command.raceId,
          command.currency,
          transaction,
        )

      if (completed) {
        throw new AppError({
          category: 'conflict',
          code: 'RACE_ALREADY_SETTLED',
          message: 'A completed settlement already exists for this race',
          details: {
            raceId: command.raceId,
            settlementRunId: completed.settlementRunId,
          },
        })
      }

      const pool = await this.requireFrozenRacePoolForUpdate(
        command,
        transaction,
      )
      await this.requireActiveWinningSelection(command, transaction)

      const lockedBets = await this.bettingRepository.listBetsByRaceIdForUpdate(
        command.raceId,
        transaction,
      )
      const lockedAcceptedBets = lockedBets.filter(
        (bet) => bet.status === 'accepted',
      )
      const lockedSettlement = this.calculatePoolProration(
        command,
        lockedAcceptedBets,
        await this.getAppliedCarryoverMinor(command.raceId, transaction),
      )
      this.assertSettlementCalculationStable(settlement, lockedSettlement)

      const now = this.clock.now()
      const settlementRunId = `settlement_run_${randomUUID()}`
      const settlementRunningPool = {
        ...pool,
        status: 'settlement_running' as const,
        updatedAt: now.toISOString(),
      }

      await this.bettingRepository.createSettlementRun(
        {
          settlementRunId,
          raceId: command.raceId,
          currency: command.currency,
          status: 'running',
          winningSelectionId: command.winningSelectionId,
          houseTakeBps: command.houseTakeBps,
          idempotencyKey: command.idempotencyKey,
          commandFingerprint,
          createdAt: now,
          updatedAt: now,
          startedAt: now,
        },
        transaction,
      )
      await this.bettingRepository.updateRacePool(
        settlementRunningPool,
        transaction,
      )

      for (const bet of lockedAcceptedBets) {
        await this.bettingRepository.updateBetSettlementStatus(
          {
            betId: bet.betId,
            status: 'settlement_pending',
            settlementRunId,
            updatedAt: now,
          },
          transaction,
        )
      }

      await this.faultInjector.trigger(
        'settlement.after_state_record_creation_before_ledger_posting',
        {
          raceId: command.raceId,
          currency: command.currency,
          settlementRunId,
          idempotencyKey: command.idempotencyKey,
        },
      )

      const captureTransactionIdByBetId = new Map<string, string>()
      const payoutTransactionIdByBetId = new Map<string, string | null>()
      let settledAt = now

      for (const allocation of lockedSettlement.allocations) {
        const bet = lockedAcceptedBets.find(
          (acceptedBet) => acceptedBet.betId === allocation.betId,
        )

        if (!bet?.reservationId) {
          throw new AppError({
            category: 'invariant_violation',
            code: 'BET_RESERVATION_NOT_FOUND',
            message: 'Accepted financial bet is missing its reservation',
            details: { betId: allocation.betId },
          })
        }

        if (!settlementClearingAccount) {
          throw new AppError({
            category: 'internal_error',
            code: 'SETTLEMENT_CLEARING_ACCOUNT_MISSING',
            message: 'Settlement clearing account was not prepared',
            details: { raceId: command.raceId },
          })
        }

        const capture =
          await this.reservationService.captureFundsWithinTransaction(
            {
              idempotencyKey: toIdempotencyKey(
                `${command.idempotencyKey}:capture:${allocation.betId}`,
              ),
              reservationId: bet.reservationId,
              destinationAccountId: settlementClearingAccount.accountId,
              correlationId: command.correlationId,
              causationId: command.causationId,
            },
            transaction,
          )

        captureTransactionIdByBetId.set(allocation.betId, capture.transactionId)
        payoutTransactionIdByBetId.set(allocation.betId, null)
        settledAt = capture.createdAt
      }

      if (BigInt(lockedSettlement.houseTakeMinor) > 0n) {
        if (!settlementClearingAccount || !houseTakeRevenueAccount) {
          throw new AppError({
            category: 'internal_error',
            code: 'HOUSE_TAKE_ACCOUNT_MISSING',
            message: 'House take accounts were not prepared',
            details: { raceId: command.raceId },
          })
        }

        const houseTake =
          await this.postingEngineService.postTransferWithinTransaction(
            {
              idempotencyKey: toIdempotencyKey(
                `${command.idempotencyKey}:house-take`,
              ),
              transactionType: 'settlement_house_take',
              referenceType: 'settlement',
              referenceId: settlementRunId,
              debitAccountId: settlementClearingAccount.accountId,
              creditAccountId: houseTakeRevenueAccount.accountId,
              amountMinor: lockedSettlement.houseTakeMinor,
              currency: command.currency,
              correlationId: command.correlationId,
              causationId: command.causationId,
            },
            transaction,
          )
        settledAt = houseTake.createdAt
      }

      if (BigInt(lockedSettlement.carryoverMinor) > 0n) {
        if (!settlementClearingAccount || !carryoverAccount) {
          throw new AppError({
            category: 'internal_error',
            code: 'CARRYOVER_ACCOUNT_MISSING',
            message: 'Carryover account was not prepared',
            details: { raceId: command.raceId },
          })
        }

        const carryoverPosting =
          await this.postingEngineService.postTransferWithinTransaction(
            {
              idempotencyKey: toIdempotencyKey(
                `${command.idempotencyKey}:carryover`,
              ),
              transactionType: 'settlement_carryover',
              referenceType: 'settlement',
              referenceId: settlementRunId,
              debitAccountId: settlementClearingAccount.accountId,
              creditAccountId: carryoverAccount.accountId,
              amountMinor: lockedSettlement.carryoverMinor,
              currency: command.currency,
              correlationId: command.correlationId,
              causationId: command.causationId,
            },
            transaction,
          )

        await this.bettingRepository.createSettlementCarryover(
          {
            carryoverId: `settlement_carryover_${randomUUID()}`,
            settlementRunId,
            raceId: command.raceId,
            currency: command.currency,
            amountMinor: lockedSettlement.carryoverMinor,
            status: 'pending',
            reasonCode:
              lockedSettlement.reasonCode ?? 'NO_WINNING_STAKE_ROLLOVER',
            createdAt: now,
            updatedAt: now,
          },
          transaction,
        )
        settledAt = carryoverPosting.createdAt
      }

      for (const allocation of lockedSettlement.allocations) {
        if (BigInt(allocation.payoutMinor) <= 0n) {
          continue
        }

        const payoutAccount = payoutAccountByUserId.get(allocation.userId)

        if (!payoutAccount || !settlementClearingAccount) {
          throw new AppError({
            category: 'internal_error',
            code: 'SETTLEMENT_PAYOUT_ACCOUNT_MISSING',
            message: 'Expected payout account to be prepared before posting',
            details: { userId: allocation.userId, betId: allocation.betId },
          })
        }

        const payout = await this.postingEngineService.postTransferWithinTransaction(
          {
            idempotencyKey: toIdempotencyKey(
              `${command.idempotencyKey}:payout:${allocation.betId}`,
            ),
            transactionType: 'settlement_payout',
            referenceType: 'settlement',
            referenceId: allocation.betId,
            relatedTransactionId: captureTransactionIdByBetId.get(
              allocation.betId,
            ) as LedgerTransactionId,
            debitAccountId: settlementClearingAccount.accountId,
            creditAccountId: payoutAccount.availableAccountId,
            amountMinor: allocation.payoutMinor,
            currency: command.currency,
            correlationId: command.correlationId,
            causationId: command.causationId,
          },
          transaction,
        )

        payoutTransactionIdByBetId.set(allocation.betId, payout.transactionId)
        settledAt = payout.createdAt
      }

      await this.faultInjector.trigger(
        'settlement.after_ledger_posting_before_state_finalization',
        {
          raceId: command.raceId,
          currency: command.currency,
          settlementRunId,
          idempotencyKey: command.idempotencyKey,
          allocationCount: lockedSettlement.allocations.length,
        },
      )

      const settledBets = lockedSettlement.allocations.map((allocation) => ({
        betId: allocation.betId,
        userId: allocation.userId,
        selectionId: allocation.selectionId,
        resultStatus: allocation.resultStatus,
        stakeMinor: allocation.stakeMinor,
        payoutMinor: allocation.payoutMinor,
        captureTransactionId:
          captureTransactionIdByBetId.get(allocation.betId) ?? '',
        payoutTransactionId:
          payoutTransactionIdByBetId.get(allocation.betId) ?? null,
      }))

      for (const allocation of lockedSettlement.allocations) {
        await this.bettingRepository.updateBetSettlementStatus(
          {
            betId: allocation.betId,
            status:
              allocation.resultStatus === 'won'
                ? 'settled_win'
                : 'settled_loss',
            settlementRunId,
            updatedAt: settledAt,
          },
          transaction,
        )
      }

      const settledPool = {
        ...settlementRunningPool,
        status: 'settled' as const,
        updatedAt: settledAt.toISOString(),
      }
      const result: SettleBetResultDto = {
        settlementRunId,
        status: 'completed',
        reasonCode: lockedSettlement.reasonCode,
        raceId: command.raceId,
        winningSelectionId: command.winningSelectionId,
        totalPoolMinor: lockedSettlement.grossPoolMinor,
        acceptedStakeMinor: lockedSettlement.acceptedStakeMinor,
        appliedCarryoverMinor: lockedSettlement.appliedCarryoverMinor,
        houseTakeMinor: lockedSettlement.houseTakeMinor,
        netPoolMinor: lockedSettlement.netPoolMinor,
        roundingResidualMinor: lockedSettlement.roundingResidualMinor,
        carryoverMinor: lockedSettlement.carryoverMinor,
        settledBets,
        settledAt: settledAt.toISOString(),
      }

      await this.bettingRepository.updateRacePool(settledPool, transaction)
      await this.bettingRepository.updateSettlementRun(
        {
          settlementRunId,
          status: 'completed',
          totalPoolMinor: lockedSettlement.grossPoolMinor,
          houseTakeMinor: lockedSettlement.houseTakeMinor,
          netPoolMinor: lockedSettlement.netPoolMinor,
          roundingResidualMinor: lockedSettlement.roundingResidualMinor,
          carryoverMinor: lockedSettlement.carryoverMinor,
          reasonCode: lockedSettlement.reasonCode,
          errorCode: null,
          errorMessage: null,
          resultSnapshot: this.toSettlementResultSnapshot(result),
          completedAt: settledAt,
          failedAt: null,
          updatedAt: settledAt,
        },
        transaction,
      )

      for (const settledBet of settledBets) {
        await this.emitOutboxEventWithinTransaction(
          {
            eventType: 'bet_settled',
            aggregateType: 'bet',
            aggregateId: settledBet.betId,
            idempotencyKey: `${command.idempotencyKey}:${settledBet.betId}`,
            correlationId: command.correlationId,
            causationId: command.causationId,
            payload: {
              betId: settledBet.betId,
              userId: settledBet.userId,
              raceId: command.raceId,
              settlementRunId,
              selectionId: settledBet.selectionId,
              winningSelectionId: command.winningSelectionId,
              resultStatus: settledBet.resultStatus,
              stakeMinor: settledBet.stakeMinor,
              payoutMinor: settledBet.payoutMinor,
              currency: command.currency,
              captureTransactionId: settledBet.captureTransactionId,
              payoutTransactionId: settledBet.payoutTransactionId,
            },
          },
          transaction,
        )
      }

      await this.emitOutboxEventWithinTransaction(
        {
          eventType: 'race_settled',
          aggregateType: 'race',
          aggregateId: command.raceId,
          idempotencyKey: command.idempotencyKey,
          correlationId: command.correlationId,
          causationId: command.causationId,
          payload: {
            settlementRunId,
            raceId: command.raceId,
            winningSelectionId: command.winningSelectionId,
            totalPoolMinor: lockedSettlement.grossPoolMinor,
            acceptedStakeMinor: lockedSettlement.acceptedStakeMinor,
            appliedCarryoverMinor: lockedSettlement.appliedCarryoverMinor,
            houseTakeMinor: lockedSettlement.houseTakeMinor,
            netPoolMinor: lockedSettlement.netPoolMinor,
            roundingResidualMinor: lockedSettlement.roundingResidualMinor,
            carryoverMinor: lockedSettlement.carryoverMinor,
            reasonCode: lockedSettlement.reasonCode,
            currency: command.currency,
            settledBets,
          },
        },
        transaction,
      )

      await this.faultInjector.trigger(
        'settlement.after_outbox_before_response',
        {
          raceId: command.raceId,
          currency: command.currency,
          settlementRunId,
          idempotencyKey: command.idempotencyKey,
        },
      )

      return result
    })
  }

  async applyHouseTake(
    command: ApplyHouseTakeCommandDto,
  ): Promise<ApplyHouseTakeResultDto> {
    this.assertCanonicalCurrency(command.currency)
    const settlementClearingAccount = await this.ensureAccount({
      accountType: 'settlement_clearing',
      ownerType: 'settlement',
      ownerId: `race:${command.raceId}`,
      currency: command.currency,
      correlationId: command.correlationId,
      causationId: command.causationId,
      idempotencyKey: `ensure:settlement-clearing:${command.raceId}:${command.currency}`,
    })
    const houseTakeRevenueAccount = await this.ensureAccount({
      accountType: 'house_take_revenue',
      ownerType: 'platform',
      ownerId: 'house',
      currency: command.currency,
      correlationId: command.correlationId,
      causationId: command.causationId,
      idempotencyKey: `ensure:house-take-revenue:${command.currency}`,
    })
    const houseTake = await this.postingEngineService.postTransfer({
      idempotencyKey: toIdempotencyKey(command.idempotencyKey),
      transactionType: 'settlement_house_take',
      referenceType: 'settlement',
      referenceId: command.raceId,
      debitAccountId: settlementClearingAccount.accountId,
      creditAccountId: houseTakeRevenueAccount.accountId,
      amountMinor: command.amountMinor,
      currency: command.currency,
      correlationId: command.correlationId,
      causationId: command.causationId,
    })

    await this.emitOutboxEvent({
      eventType: 'house_take_applied',
      aggregateType: 'race',
      aggregateId: command.raceId,
      idempotencyKey: command.idempotencyKey,
      correlationId: command.correlationId,
      causationId: command.causationId,
      payload: {
        raceId: command.raceId,
        amountMinor: command.amountMinor,
        currency: command.currency,
        transactionId: houseTake.transactionId,
      },
    })

    return {
      raceId: command.raceId,
      amountMinor: command.amountMinor,
      appliedAt: houseTake.createdAt.toISOString(),
    }
  }

  async applyCarryoversToRace(
    command: ApplyCarryoversToRaceCommandDto,
  ): Promise<ApplyCarryoversToRaceResultDto> {
    this.assertCanonicalCurrency(command.currency)
    const commandFingerprint = this.carryoverApplicationFingerprint(command)
    const existing =
      await this.bettingRepository.getCarryoverApplicationByIdempotencyKey(
        command.idempotencyKey,
      )

    if (existing) {
      return this.replayCarryoverApplication(existing, commandFingerprint)
    }

    const targetPool = await this.bettingRepository.getRacePool(
      command.targetRaceId,
      command.currency,
    )

    if (!targetPool) {
      throw new AppError({
        category: 'not_found',
        code: 'RACE_POOL_NOT_FOUND',
        message: 'Carryover application target pool was not found',
        details: { targetRaceId: command.targetRaceId },
      })
    }

    if (targetPool.status !== 'open' && targetPool.status !== 'frozen') {
      throw new AppError({
        category: 'conflict',
        code: 'CARRYOVER_TARGET_POOL_NOT_ELIGIBLE',
        message: 'Carryovers can only be applied to open or frozen pools',
        details: {
          targetRaceId: command.targetRaceId,
          status: targetPool.status,
        },
      })
    }

    const preflightPools = await this.bettingRepository.listRacePools(
      command.currency,
    )
    const preflightPendingCarryovers =
      await this.bettingRepository.listCarryovers({ status: 'pending' })
    const preflightEligibleCarryovers = this.eligibleCarryoversForTarget(
      preflightPendingCarryovers,
      preflightPools,
      command.targetRaceId,
    )

    if (preflightEligibleCarryovers.length === 0) {
      return this.noopCarryoverApplicationResult(command, this.clock.now())
    }

    const targetSettlementClearing = await this.ensureAccount({
      accountType: 'settlement_clearing',
      ownerType: 'settlement',
      ownerId: `race:${command.targetRaceId}`,
      currency: command.currency,
      correlationId: command.correlationId,
      causationId: command.causationId,
      idempotencyKey: `ensure:settlement-clearing:${command.targetRaceId}:${command.currency}`,
    })

    return this.database.tx(async (transaction) => {
      const replay =
        await this.bettingRepository.getCarryoverApplicationByIdempotencyKey(
          command.idempotencyKey,
          transaction,
        )

      if (replay) {
        return this.replayCarryoverApplication(replay, commandFingerprint)
      }

      const lockedTargetPool = await this.bettingRepository.getRacePoolForUpdate(
        command.targetRaceId,
        command.currency,
        transaction,
      )

      if (!lockedTargetPool) {
        throw new AppError({
          category: 'not_found',
          code: 'RACE_POOL_NOT_FOUND',
          message: 'Carryover application target pool was not found',
          details: { targetRaceId: command.targetRaceId },
        })
      }

      if (
        lockedTargetPool.status !== 'open' &&
        lockedTargetPool.status !== 'frozen'
      ) {
        throw new AppError({
          category: 'conflict',
          code: 'CARRYOVER_TARGET_POOL_NOT_ELIGIBLE',
          message: 'Carryovers can only be applied to open or frozen pools',
          details: {
            targetRaceId: command.targetRaceId,
            status: lockedTargetPool.status,
          },
        })
      }

      const pools = await this.bettingRepository.listRacePools(
        command.currency,
        transaction,
      )
      const pendingCarryovers =
        await this.bettingRepository.listPendingCarryoversForUpdate(
          command.currency,
          transaction,
        )
      const eligibleCarryovers = this.eligibleCarryoversForTarget(
        pendingCarryovers,
        pools,
        command.targetRaceId,
      )
      const now = this.clock.now()

      if (eligibleCarryovers.length === 0) {
        return this.noopCarryoverApplicationResult(command, now)
      }

      const applicationId = `carryover_application_${randomUUID()}`
      const appliedCarryovers: Array<
        ApplyCarryoversToRaceResultDto['appliedCarryovers'][number]
      > = []
      let totalAppliedMinor = 0n

      for (const carryover of eligibleCarryovers) {
        const sourceCarryoverAccount = await this.requireAccount({
          accountType: 'race_selection_pool',
          ownerType: 'settlement',
          ownerId: `carryover:${carryover.sourceRaceId}`,
          currency: command.currency,
        })
        const applicationPosting =
          await this.postingEngineService.postTransferWithinTransaction(
            {
              idempotencyKey: toIdempotencyKey(
                `${command.idempotencyKey}:carryover:${carryover.carryoverId}`,
              ),
              transactionType: 'settlement_carryover_apply',
              referenceType: 'settlement',
              referenceId: applicationId,
              debitAccountId: sourceCarryoverAccount.accountId,
              creditAccountId: targetSettlementClearing.accountId,
              amountMinor: carryover.amountMinor,
              currency: command.currency,
              correlationId: command.correlationId,
              causationId: command.causationId,
            },
            transaction,
          )

        await this.faultInjector.trigger(
          'carryover.after_ledger_posting_before_state_finalization',
          {
            carryoverId: carryover.carryoverId,
            sourceRaceId: carryover.sourceRaceId,
            targetRaceId: command.targetRaceId,
            currency: command.currency,
            applicationId,
            applicationTransactionId: applicationPosting.transactionId,
            idempotencyKey: command.idempotencyKey,
          },
        )

        await this.bettingRepository.markCarryoverApplied(
          {
            carryoverId: carryover.carryoverId,
            targetRaceId: command.targetRaceId,
            applicationId,
            applicationTransactionId: applicationPosting.transactionId,
            appliedAt: now,
            updatedAt: now,
          },
          transaction,
        )

        totalAppliedMinor += BigInt(carryover.amountMinor)
        appliedCarryovers.push({
          ...carryover,
          status: 'applied',
          targetRaceId: command.targetRaceId,
          applicationId,
          applicationTransactionId: applicationPosting.transactionId,
          appliedAt: now.toISOString(),
          updatedAt: now.toISOString(),
        })
      }

      const result: ApplyCarryoversToRaceResultDto = {
        applicationId,
        targetRaceId: command.targetRaceId,
        currency: command.currency,
        totalAppliedMinor: totalAppliedMinor.toString(),
        appliedCarryovers,
        appliedAt: now.toISOString(),
      }

      await this.bettingRepository.createCarryoverApplication(
        {
          applicationId,
          targetRaceId: command.targetRaceId,
          currency: command.currency,
          idempotencyKey: command.idempotencyKey,
          commandFingerprint,
          totalAmountMinor: result.totalAppliedMinor,
          appliedCarryoverIds: appliedCarryovers.map(
            (carryover) => carryover.carryoverId,
          ),
          resultSnapshot: this.toCarryoverApplicationSnapshot(result),
          createdAt: now,
          completedAt: now,
        },
        transaction,
      )

      await this.emitOutboxEventWithinTransaction(
        {
          eventType: 'settlement.carryovers_applied',
          aggregateType: 'race',
          aggregateId: command.targetRaceId,
          idempotencyKey: command.idempotencyKey,
          correlationId: command.correlationId,
          causationId: command.causationId,
          payload: this.toCarryoverApplicationSnapshot(result),
        },
        transaction,
      )

      return result
    })
  }

  async markSettlementManualReview(
    command: MarkSettlementManualReviewCommandDto,
  ): Promise<SettlementRemediationResultDto> {
    return this.recordSettlementRemediation(
      'mark_manual_review',
      command,
      command.reasonCode,
      async ({ transaction, pool, now }) => {
        if (pool.status === 'settled' || pool.status === 'voided') {
          throw new AppError({
            category: 'conflict',
            code: 'POOL_TERMINAL',
            message: 'Terminal pools cannot be moved into manual review',
            details: { raceId: command.raceId, status: pool.status },
          })
        }

        const existingManualRun =
          await this.bettingRepository.getLatestSettlementRunByRaceAndStatus(
            command.raceId,
            command.currency,
            'manual_review',
            transaction,
          )
        const activeRun =
          existingManualRun ??
          (await this.bettingRepository.getActiveSettlementRunByRace(
            command.raceId,
            command.currency,
            transaction,
          ))
        const settlementRun =
          activeRun ??
          (await this.createManualReviewSettlementRun(command, now, transaction))

        await this.bettingRepository.updateRacePool(
          {
            ...pool,
            status: 'manual_review',
            frozenAt: pool.frozenAt ?? now.toISOString(),
            updatedAt: now.toISOString(),
          },
          transaction,
        )
        await this.bettingRepository.updateSettlementRun(
          {
            settlementRunId: settlementRun.settlementRunId,
            status: 'manual_review',
            totalPoolMinor: settlementRun.totalPoolMinor,
            houseTakeMinor: settlementRun.houseTakeMinor,
            netPoolMinor: settlementRun.netPoolMinor,
            roundingResidualMinor: settlementRun.roundingResidualMinor,
            carryoverMinor: settlementRun.carryoverMinor,
            reasonCode: command.reasonCode,
            errorCode: 'MANUAL_REVIEW_MARKED',
            errorMessage: command.reasonText ?? null,
            resultSnapshot: null,
            completedAt: null,
            failedAt: null,
            updatedAt: now,
          },
          transaction,
        )

        return {
          poolStatus: 'manual_review',
          settlementRunId: settlementRun.settlementRunId,
          settlementRunStatus: 'manual_review',
        }
      },
    )
  }

  async resolveSettlementManualReview(
    command: ResolveSettlementManualReviewCommandDto,
  ): Promise<SettlementRemediationResultDto> {
    return this.recordSettlementRemediation(
      'resolve_manual_review',
      command,
      command.resolutionCode,
      async ({ transaction, pool, now }) => {
        if (pool.status !== 'manual_review') {
          throw new AppError({
            category: 'conflict',
            code: 'POOL_NOT_IN_MANUAL_REVIEW',
            message: 'Only manual-review pools can be resolved for retry',
            details: { raceId: command.raceId, status: pool.status },
          })
        }

        const manualRun =
          await this.bettingRepository.getLatestSettlementRunByRaceAndStatus(
            command.raceId,
            command.currency,
            'manual_review',
            transaction,
          )

        await this.bettingRepository.updateRacePool(
          {
            ...pool,
            status: 'frozen',
            updatedAt: now.toISOString(),
          },
          transaction,
        )

        if (manualRun) {
          await this.bettingRepository.updateSettlementRun(
            {
              settlementRunId: manualRun.settlementRunId,
              status: 'failed',
              totalPoolMinor: manualRun.totalPoolMinor,
              houseTakeMinor: manualRun.houseTakeMinor,
              netPoolMinor: manualRun.netPoolMinor,
              roundingResidualMinor: manualRun.roundingResidualMinor,
              carryoverMinor: manualRun.carryoverMinor,
              reasonCode: command.resolutionCode,
              errorCode: 'MANUAL_REVIEW_RESOLVED_FOR_RETRY',
              errorMessage: command.reasonText ?? null,
              resultSnapshot: null,
              completedAt: null,
              failedAt: now,
              updatedAt: now,
            },
            transaction,
          )
        }

        return {
          poolStatus: 'frozen',
          settlementRunId: manualRun?.settlementRunId ?? null,
          settlementRunStatus: manualRun ? 'failed' : null,
        }
      },
    )
  }

  async voidPoolFromManualReview(
    command: VoidPoolFromManualReviewCommandDto,
  ): Promise<SettlementRemediationResultDto> {
    return this.recordSettlementRemediation(
      'void_pool_from_manual_review',
      command,
      command.reasonCode,
      async ({ transaction, pool, now }) => {
        if (pool.status !== 'manual_review') {
          throw new AppError({
            category: 'conflict',
            code: 'POOL_NOT_IN_MANUAL_REVIEW',
            message: 'Only manual-review pools can be voided by remediation',
            details: { raceId: command.raceId, status: pool.status },
          })
        }

        const manualRun =
          await this.bettingRepository.getLatestSettlementRunByRaceAndStatus(
            command.raceId,
            command.currency,
            'manual_review',
            transaction,
          )

        await this.bettingRepository.updateRacePool(
          {
            ...pool,
            status: 'voided',
            updatedAt: now.toISOString(),
          },
          transaction,
        )

        if (manualRun) {
          await this.bettingRepository.updateSettlementRun(
            {
              settlementRunId: manualRun.settlementRunId,
              status: 'failed',
              totalPoolMinor: manualRun.totalPoolMinor,
              houseTakeMinor: manualRun.houseTakeMinor,
              netPoolMinor: manualRun.netPoolMinor,
              roundingResidualMinor: manualRun.roundingResidualMinor,
              carryoverMinor: manualRun.carryoverMinor,
              reasonCode: command.reasonCode,
              errorCode: 'MANUAL_REVIEW_VOIDED',
              errorMessage: command.reasonText ?? null,
              resultSnapshot: null,
              completedAt: null,
              failedAt: now,
              updatedAt: now,
            },
            transaction,
          )
        }

        return {
          poolStatus: 'voided',
          settlementRunId: manualRun?.settlementRunId ?? null,
          settlementRunStatus: manualRun ? 'failed' : null,
        }
      },
    )
  }

  private async provisionPlayerAccount(command: {
    userId: string
    currency: string
    idempotencyKey: string
    correlationId: string
    causationId: string
  }): Promise<PlayerAccount> {
    return this.playerAccountProvisioningService.provisionIfNeeded({
      idempotencyKey: toIdempotencyKey(
        `provision:${command.userId}:${command.currency}`,
      ),
      userId: toUserId(command.userId),
      currency: command.currency,
      correlationId: command.correlationId,
      causationId: command.causationId,
    })
  }

  private calculatePoolProration(
    command: SettleBetCommandDto,
    acceptedBets: FinancialBetDto[],
    appliedCarryoverMinorInput: string,
  ): SettlementCalculation {
    const acceptedStakeMinor = acceptedBets.reduce(
      (sum, bet) => sum + BigInt(bet.stakeMinor),
      0n,
    )
    const appliedCarryoverMinor = BigInt(appliedCarryoverMinorInput)
    const grossPoolMinor = acceptedStakeMinor + appliedCarryoverMinor

    if (grossPoolMinor === 0n) {
      return {
        acceptedStakeMinor: '0',
        appliedCarryoverMinor: '0',
        grossPoolMinor: '0',
        houseTakeMinor: '0',
        netPoolMinor: '0',
        roundingResidualMinor: '0',
        carryoverMinor: '0',
        reasonCode: null,
        allocations: [],
      }
    }

    const winningBets = acceptedBets.filter(
      (bet) => bet.selectionId === command.winningSelectionId,
    )
    const houseTakeMinor =
      (acceptedStakeMinor * BigInt(command.houseTakeBps)) /
      basisPointsDenominator
    const netPoolMinor = acceptedStakeMinor - houseTakeMinor + appliedCarryoverMinor

    if (winningBets.length === 0) {
      return {
        acceptedStakeMinor: acceptedStakeMinor.toString(),
        appliedCarryoverMinor: appliedCarryoverMinor.toString(),
        grossPoolMinor: grossPoolMinor.toString(),
        houseTakeMinor: houseTakeMinor.toString(),
        netPoolMinor: netPoolMinor.toString(),
        roundingResidualMinor: '0',
        carryoverMinor: netPoolMinor.toString(),
        reasonCode: 'NO_WINNING_STAKE_ROLLOVER',
        allocations: acceptedBets.map((bet) => ({
          betId: bet.betId,
          userId: bet.userId,
          selectionId: bet.selectionId,
          stakeMinor: bet.stakeMinor,
          resultStatus: 'lost',
          payoutMinor: '0',
        })),
      }
    }

    const winningStakeMinor = winningBets.reduce(
      (sum, bet) => sum + BigInt(bet.stakeMinor),
      0n,
    )
    const payoutByBetId = new Map<string, bigint>()
    const remainderByBetId = new Map<string, bigint>()
    let allocatedMinor = 0n

    for (const bet of winningBets) {
      const stakeMinor = BigInt(bet.stakeMinor)
      const weightedPool = netPoolMinor * stakeMinor
      const basePayoutMinor = weightedPool / winningStakeMinor
      const remainderMinor = weightedPool % winningStakeMinor

      payoutByBetId.set(bet.betId, basePayoutMinor)
      remainderByBetId.set(bet.betId, remainderMinor)
      allocatedMinor += basePayoutMinor
    }

    const deterministicRemainderOrder = [...winningBets].sort((left, right) => {
      const leftRemainder = remainderByBetId.get(left.betId) ?? 0n
      const rightRemainder = remainderByBetId.get(right.betId) ?? 0n

      if (leftRemainder > rightRemainder) return -1
      if (leftRemainder < rightRemainder) return 1

      return left.betId.localeCompare(right.betId)
    })
    const remainderUnits = Number(netPoolMinor - allocatedMinor)

    for (let index = 0; index < remainderUnits; index += 1) {
      const bet = deterministicRemainderOrder[index]

      if (!bet) {
        break
      }

      payoutByBetId.set(bet.betId, (payoutByBetId.get(bet.betId) ?? 0n) + 1n)
      allocatedMinor += 1n
    }

    const allocations = acceptedBets.map((bet) => {
      const payoutMinor = payoutByBetId.get(bet.betId) ?? 0n
      const resultStatus: 'won' | 'lost' =
        bet.selectionId === command.winningSelectionId ? 'won' : 'lost'

      return {
        betId: bet.betId,
        userId: bet.userId,
        selectionId: bet.selectionId,
        stakeMinor: bet.stakeMinor,
        resultStatus,
        payoutMinor: payoutMinor.toString(),
      }
    })
    const finalPayoutTotalMinor = allocations.reduce(
      (sum, allocation) => sum + BigInt(allocation.payoutMinor),
      0n,
    )

    return {
      acceptedStakeMinor: acceptedStakeMinor.toString(),
      appliedCarryoverMinor: appliedCarryoverMinor.toString(),
      grossPoolMinor: grossPoolMinor.toString(),
      houseTakeMinor: houseTakeMinor.toString(),
      netPoolMinor: netPoolMinor.toString(),
      roundingResidualMinor: (netPoolMinor - finalPayoutTotalMinor).toString(),
      carryoverMinor: '0',
      reasonCode: null,
      allocations,
    }
  }

  private async assertPoolAndWinnerReadyForSettlement(
    command: SettleBetCommandDto,
  ): Promise<void> {
    const pool = await this.bettingRepository.getRacePool(
      command.raceId,
      command.currency,
    )

    if (!pool) {
      throw new AppError({
        category: 'not_found',
        code: 'RACE_POOL_NOT_FOUND',
        message: 'Settlement cannot proceed because the race pool was not found',
        details: { raceId: command.raceId, currency: command.currency },
      })
    }

    if (pool.status !== 'frozen') {
      throw new AppError({
        category: 'conflict',
        code: 'RACE_POOL_NOT_FROZEN',
        message: 'Settlement cannot proceed until the race pool is frozen',
        details: {
          raceId: command.raceId,
          currency: command.currency,
          status: pool.status,
        },
      })
    }

    await this.requireActiveWinningSelection(command)
  }

  private async getAppliedCarryoverMinor(
    raceId: string,
    queryable?: DatabaseTransaction,
  ): Promise<string> {
    const carryovers = await this.bettingRepository.listCarryovers(
      {
        status: 'applied',
        targetRaceId: raceId,
      },
      queryable,
    )

    return carryovers
      .reduce((sum, carryover) => sum + BigInt(carryover.amountMinor), 0n)
      .toString()
  }

  private async requireFrozenRacePoolForUpdate(
    command: SettleBetCommandDto,
    transaction: DatabaseTransaction,
  ): Promise<RacePoolDto> {
    const pool = await this.bettingRepository.getRacePoolForUpdate(
      command.raceId,
      command.currency,
      transaction,
    )

    if (!pool) {
      throw new AppError({
        category: 'not_found',
        code: 'RACE_POOL_NOT_FOUND',
        message: 'Settlement cannot proceed because the race pool was not found',
        details: { raceId: command.raceId, currency: command.currency },
      })
    }

    if (pool.status !== 'frozen') {
      throw new AppError({
        category: 'conflict',
        code: 'RACE_POOL_NOT_FROZEN',
        message: 'Settlement can start only from a frozen pool',
        details: {
          raceId: command.raceId,
          currency: command.currency,
          status: pool.status,
        },
      })
    }

    return pool
  }

  private async requireActiveWinningSelection(
    command: SettleBetCommandDto,
    transaction?: DatabaseTransaction,
  ): Promise<void> {
    const selection = await this.bettingRepository.getPoolSelection(
      command.raceId,
      command.winningSelectionId,
      command.currency,
      transaction,
    )

    if (!selection || selection.status !== 'active') {
      throw new AppError({
        category: 'conflict',
        code: 'WINNING_SELECTION_NOT_ACTIVE',
        message:
          'Settlement winning selection must be registered and active for the pool',
        details: {
          raceId: command.raceId,
          winningSelectionId: command.winningSelectionId,
          selectionStatus: selection?.status ?? null,
        },
      })
    }
  }

  private assertSettlementCalculationStable(
    expected: SettlementCalculation,
    actual: SettlementCalculation,
  ): void {
    if (
      expected.acceptedStakeMinor === actual.acceptedStakeMinor &&
      expected.appliedCarryoverMinor === actual.appliedCarryoverMinor &&
      expected.grossPoolMinor === actual.grossPoolMinor &&
      expected.houseTakeMinor === actual.houseTakeMinor &&
      expected.netPoolMinor === actual.netPoolMinor &&
      expected.roundingResidualMinor === actual.roundingResidualMinor &&
      expected.carryoverMinor === actual.carryoverMinor &&
      expected.reasonCode === actual.reasonCode &&
      JSON.stringify(expected.allocations) === JSON.stringify(actual.allocations)
    ) {
      return
    }

    throw new AppError({
      category: 'conflict',
      code: 'SETTLEMENT_INPUTS_CHANGED',
      message:
        'Financial accepted bets changed while preparing settlement; retry the command',
      details: {
        expectedTotalPoolMinor: expected.grossPoolMinor,
        actualTotalPoolMinor: actual.grossPoolMinor,
      },
    })
  }

  private settlementCommandFingerprint(command: SettleBetCommandDto): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          raceId: command.raceId,
          winningSelectionId: command.winningSelectionId,
          houseTakeBps: command.houseTakeBps,
          currency: command.currency,
        }),
      )
      .digest('hex')
  }

  private carryoverApplicationFingerprint(
    command: ApplyCarryoversToRaceCommandDto,
  ): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          targetRaceId: command.targetRaceId,
          currency: command.currency,
        }),
      )
      .digest('hex')
  }

  private replayCarryoverApplication(
    application: {
      applicationId: string
      commandFingerprint: string
      resultSnapshot: JsonObject
    },
    commandFingerprint: string,
  ): ApplyCarryoversToRaceResultDto {
    if (application.commandFingerprint !== commandFingerprint) {
      throw new AppError({
        category: 'conflict',
        code: 'CARRYOVER_APPLICATION_IDEMPOTENCY_CONFLICT',
        message:
          'Carryover application idempotency key was reused with a different command fingerprint',
        details: { applicationId: application.applicationId },
      })
    }

    return application.resultSnapshot as unknown as ApplyCarryoversToRaceResultDto
  }

  private toCarryoverApplicationSnapshot(
    result: ApplyCarryoversToRaceResultDto,
  ): JsonObject {
    return {
      applicationId: result.applicationId,
      targetRaceId: result.targetRaceId,
      currency: result.currency,
      totalAppliedMinor: result.totalAppliedMinor,
      appliedAt: result.appliedAt,
      appliedCarryovers: result.appliedCarryovers.map((carryover) => ({
        carryoverId: carryover.carryoverId,
        sourceRaceId: carryover.sourceRaceId,
        targetRaceId: carryover.targetRaceId,
        currency: carryover.currency,
        amountMinor: carryover.amountMinor,
        status: carryover.status,
        reasonCode: carryover.reasonCode,
        applicationId: carryover.applicationId,
        applicationTransactionId: carryover.applicationTransactionId,
        appliedAt: carryover.appliedAt,
        createdAt: carryover.createdAt,
        updatedAt: carryover.updatedAt,
      })),
    }
  }

  private noopCarryoverApplicationId(
    command: ApplyCarryoversToRaceCommandDto,
  ): string {
    const suffix = createHash('sha256')
      .update(
        JSON.stringify({
          targetRaceId: command.targetRaceId,
          currency: command.currency,
          idempotencyKey: command.idempotencyKey,
        }),
      )
      .digest('hex')
      .slice(0, 24)

    return `carryover_application_none_${suffix}`
  }

  private noopCarryoverApplicationResult(
    command: ApplyCarryoversToRaceCommandDto,
    appliedAt: Date,
  ): ApplyCarryoversToRaceResultDto {
    return {
      applicationId: this.noopCarryoverApplicationId(command),
      targetRaceId: command.targetRaceId,
      currency: command.currency,
      totalAppliedMinor: '0',
      appliedCarryovers: [],
      appliedAt: appliedAt.toISOString(),
    }
  }

  private eligibleCarryoversForTarget(
    pendingCarryovers: SettlementCarryoverRecord[],
    pools: RacePoolDto[],
    targetRaceId: string,
  ): SettlementCarryoverRecord[] {
    const poolByRaceId = new Map(pools.map((pool) => [pool.raceId, pool]))
    const targetPool = poolByRaceId.get(targetRaceId)

    if (!targetPool) {
      return []
    }

    return pendingCarryovers.filter((carryover) => {
      const sourcePool = poolByRaceId.get(carryover.sourceRaceId)

      if (!sourcePool || carryover.sourceRaceId === targetRaceId) {
        return false
      }

      return (
        this.nextEligiblePoolAfterSource(sourcePool, pools)?.raceId ===
        targetRaceId
      )
    })
  }

  private nextEligiblePoolAfterSource(
    sourcePool: RacePoolDto,
    pools: RacePoolDto[],
  ): RacePoolDto | null {
    const sourceTime = this.poolEligibilityTime(sourcePool).getTime()
    const eligiblePools = pools
      .filter((pool) => {
        if (pool.currency !== sourcePool.currency) return false
        if (pool.raceId === sourcePool.raceId) return false
        if (
          pool.status !== 'open' &&
          pool.status !== 'frozen'
        ) {
          return false
        }

        const poolTime = this.poolEligibilityTime(pool).getTime()

        return (
          poolTime > sourceTime ||
          (poolTime === sourceTime &&
            pool.raceId.localeCompare(sourcePool.raceId) > 0)
        )
      })
      .sort((left, right) => {
        const timeDelta =
          this.poolEligibilityTime(left).getTime() -
          this.poolEligibilityTime(right).getTime()

        return timeDelta === 0
          ? left.raceId.localeCompare(right.raceId)
          : timeDelta
      })

    return eligiblePools[0] ?? null
  }

  private poolEligibilityTime(pool: RacePoolDto): Date {
    return new Date(pool.bettingOpensAt ?? pool.createdAt)
  }

  private async createManualReviewSettlementRun(
    command: MarkSettlementManualReviewCommandDto,
    now: Date,
    transaction: DatabaseTransaction,
  ): Promise<SettlementRunRecord> {
    const settlementRunId = `settlement_run_${randomUUID()}`
    const commandFingerprint = this.remediationFingerprint(
      'mark_manual_review',
      command,
      command.reasonCode,
    )

    await this.bettingRepository.createSettlementRun(
      {
        settlementRunId,
        raceId: command.raceId,
        currency: command.currency,
        status: 'manual_review',
        winningSelectionId: 'manual_review',
        houseTakeBps: 0,
        idempotencyKey: `${command.idempotencyKey}:settlement-run`,
        commandFingerprint,
        createdAt: now,
        updatedAt: now,
        startedAt: now,
      },
      transaction,
    )

    const run = await this.bettingRepository.getSettlementRunById(
      settlementRunId,
      transaction,
    )

    if (!run) {
      throw new AppError({
        category: 'invariant_violation',
        code: 'SETTLEMENT_RUN_NOT_FOUND',
        message: 'Manual review settlement run could not be reloaded',
        details: { settlementRunId },
      })
    }

    return run
  }

  private async recordSettlementRemediation(
    actionType: SettlementRemediationActionRecord['actionType'],
    command:
      | MarkSettlementManualReviewCommandDto
      | ResolveSettlementManualReviewCommandDto
      | VoidPoolFromManualReviewCommandDto,
    reasonCode: string,
    applyTransition: (input: {
      transaction: DatabaseTransaction
      pool: RacePoolDto
      now: Date
    }) => Promise<{
      poolStatus: RacePoolDto['status']
      settlementRunId: string | null
      settlementRunStatus: SettlementRunStatus | null
    }>,
  ): Promise<SettlementRemediationResultDto> {
    this.assertCanonicalCurrency(command.currency)
    const commandFingerprint = this.remediationFingerprint(
      actionType,
      command,
      reasonCode,
    )
    const existing =
      await this.bettingRepository.getSettlementRemediationActionByIdempotencyKey(
        command.idempotencyKey,
      )

    if (existing) {
      return this.replayRemediationAction(existing, commandFingerprint)
    }

    return this.database.tx(async (transaction) => {
      const replay =
        await this.bettingRepository.getSettlementRemediationActionByIdempotencyKey(
          command.idempotencyKey,
          transaction,
        )

      if (replay) {
        return this.replayRemediationAction(replay, commandFingerprint)
      }

      const pool = await this.bettingRepository.getRacePoolForUpdate(
        command.raceId,
        command.currency,
        transaction,
      )

      if (!pool) {
        throw new AppError({
          category: 'not_found',
          code: 'RACE_POOL_NOT_FOUND',
          message: 'Settlement remediation target pool was not found',
          details: { raceId: command.raceId, currency: command.currency },
        })
      }

      const now = this.clock.now()
      const transition = await applyTransition({ transaction, pool, now })
      const result: SettlementRemediationResultDto = {
        remediationActionId: `settlement_remediation_${randomUUID()}`,
        actionType,
        raceId: command.raceId,
        currency: command.currency,
        poolStatus: transition.poolStatus,
        settlementRunId: transition.settlementRunId,
        settlementRunStatus: transition.settlementRunStatus,
        operatorId: command.operatorId,
        reasonCode,
        reasonText: command.reasonText ?? null,
        actedAt: now.toISOString(),
      }

      await this.bettingRepository.createSettlementRemediationAction(
        {
          remediationActionId: result.remediationActionId,
          actionType,
          raceId: command.raceId,
          currency: command.currency,
          idempotencyKey: command.idempotencyKey,
          commandFingerprint,
          operatorId: command.operatorId,
          reasonCode,
          reasonText: command.reasonText ?? null,
          resultSnapshot: this.toRemediationSnapshot(result),
          createdAt: now,
        },
        transaction,
      )
      await this.emitOutboxEventWithinTransaction(
        {
          eventType: `settlement.${actionType}`,
          aggregateType: 'race',
          aggregateId: command.raceId,
          idempotencyKey: command.idempotencyKey,
          correlationId: command.correlationId,
          causationId: command.causationId,
          payload: this.toRemediationSnapshot(result),
        },
        transaction,
      )

      return result
    })
  }

  private remediationFingerprint(
    actionType: SettlementRemediationActionRecord['actionType'],
    command:
      | MarkSettlementManualReviewCommandDto
      | ResolveSettlementManualReviewCommandDto
      | VoidPoolFromManualReviewCommandDto,
    reasonCode: string,
  ): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          actionType,
          raceId: command.raceId,
          currency: command.currency,
          operatorId: command.operatorId,
          reasonCode,
          reasonText: command.reasonText ?? null,
        }),
      )
      .digest('hex')
  }

  private replayRemediationAction(
    action: SettlementRemediationActionRecord,
    commandFingerprint: string,
  ): SettlementRemediationResultDto {
    if (action.commandFingerprint !== commandFingerprint) {
      throw new AppError({
        category: 'conflict',
        code: 'SETTLEMENT_REMEDIATION_IDEMPOTENCY_CONFLICT',
        message:
          'Settlement remediation idempotency key was reused with a different command fingerprint',
        details: {
          remediationActionId: action.remediationActionId,
          actionType: action.actionType,
        },
      })
    }

    const result =
      action.resultSnapshot as unknown as SettlementRemediationResultDto

    return {
      ...result,
      operatorId: result.operatorId ?? action.operatorId,
      reasonText: result.reasonText ?? action.reasonText ?? null,
    }
  }

  private toRemediationSnapshot(
    result: SettlementRemediationResultDto,
  ): JsonObject {
    return {
      remediationActionId: result.remediationActionId,
      actionType: result.actionType,
      raceId: result.raceId,
      currency: result.currency,
      poolStatus: result.poolStatus,
      settlementRunId: result.settlementRunId,
      settlementRunStatus: result.settlementRunStatus,
      operatorId: result.operatorId,
      reasonCode: result.reasonCode,
      reasonText: result.reasonText,
      actedAt: result.actedAt,
    }
  }

  private replaySettlementRun(
    run: SettlementRunRecord,
    commandFingerprint: string,
  ): SettleBetResultDto {
    if (run.commandFingerprint !== commandFingerprint) {
      throw new AppError({
        category: 'conflict',
        code: 'SETTLEMENT_IDEMPOTENCY_CONFLICT',
        message:
          'Settlement idempotency key was reused with a different command fingerprint',
        details: {
          settlementRunId: run.settlementRunId,
          status: run.status,
        },
      })
    }

    if (
      (run.status === 'completed' || run.status === 'manual_review') &&
      run.resultSnapshot
    ) {
      return run.resultSnapshot as unknown as SettleBetResultDto
    }

    throw new AppError({
      category: 'conflict',
      code: 'SETTLEMENT_NOT_REPLAYABLE',
      message:
        'Settlement command has not reached a replayable terminal response',
      details: {
        settlementRunId: run.settlementRunId,
        status: run.status,
      },
    })
  }

  private toSettlementResultSnapshot(result: SettleBetResultDto): JsonObject {
    return {
      settlementRunId: result.settlementRunId,
      status: result.status,
      reasonCode: result.reasonCode,
      raceId: result.raceId,
      winningSelectionId: result.winningSelectionId,
      totalPoolMinor: result.totalPoolMinor,
      acceptedStakeMinor: result.acceptedStakeMinor,
      appliedCarryoverMinor: result.appliedCarryoverMinor,
      houseTakeMinor: result.houseTakeMinor,
      netPoolMinor: result.netPoolMinor,
      roundingResidualMinor: result.roundingResidualMinor,
      carryoverMinor: result.carryoverMinor,
      settledAt: result.settledAt,
      settledBets: result.settledBets.map((bet) => ({
        betId: bet.betId,
        userId: bet.userId,
        selectionId: bet.selectionId,
        resultStatus: bet.resultStatus,
        stakeMinor: bet.stakeMinor,
        payoutMinor: bet.payoutMinor,
        captureTransactionId: bet.captureTransactionId,
        payoutTransactionId: bet.payoutTransactionId,
      })),
    }
  }

  private async assertPlayerActionAuthorized(
    playerAccount: PlayerAccount,
    action: AccountActionType,
  ): Promise<void> {
    const statusSnapshot = await this.effectiveStatusService.getSnapshot(
      playerAccount.playerAccountId,
      this.clock.now(),
    )
    const availableAccount = await this.accountRepository.getById(
      playerAccount.availableAccountId,
    )

    this.authorizationService.assertAuthorized({
      action,
      actorRole: 'player',
      effectiveStatus: statusSnapshot.effectiveStatus,
      controlState: statusSnapshot.controlState,
      linkedCoreAccountId: playerAccount.availableAccountId,
      accountingCorePermitsAction: availableAccount?.status === 'active',
    })
  }

  private async requireBetReservationId(
    betId: string,
  ): Promise<LedgerTransactionId> {
    const transactions = await this.ledgerRepository.listByReference(
      'bet',
      betId,
    )
    const reservation = transactions.find(
      (transaction) => transaction.transactionType === 'bet_reserve',
    )

    if (!reservation) {
      throw new AppError({
        category: 'not_found',
        code: 'BET_RESERVATION_NOT_FOUND',
        message: 'No reserved stake exists for the requested bet',
        details: { betId },
      })
    }

    return toLedgerTransactionId(reservation.transactionId)
  }

  private async ensureAccount(input: {
    accountType: AccountType
    ownerType: OwnerType
    ownerId: string
    currency: string
    correlationId: string
    causationId: string
    idempotencyKey: string
  }): Promise<Account> {
    const existing = await this.accountRepository.findByOwnerAndType({
      accountType: input.accountType,
      ownerType: input.ownerType,
      ownerId: toOwnerId(input.ownerId),
      currency: input.currency,
    })

    if (existing) {
      return existing
    }

    return this.accountService.createAccount({
      accountType: input.accountType,
      ownerType: input.ownerType,
      ownerId: toOwnerId(input.ownerId),
      currency: input.currency,
      correlationId: input.correlationId,
      causationId: input.causationId,
      idempotencyKey: toIdempotencyKey(input.idempotencyKey),
    })
  }

  private async requireAccount(input: {
    accountType: AccountType
    ownerType: OwnerType
    ownerId: string
    currency: string
  }): Promise<Account> {
    const account = await this.accountRepository.findByOwnerAndType({
      accountType: input.accountType,
      ownerType: input.ownerType,
      ownerId: toOwnerId(input.ownerId),
      currency: input.currency,
    })

    if (!account) {
      throw new AppError({
        category: 'not_found',
        code: 'ACCOUNT_NOT_FOUND',
        message: 'Required accounting account was not found',
        details: {
          accountType: input.accountType,
          ownerType: input.ownerType,
          ownerId: input.ownerId,
          currency: input.currency,
        },
      })
    }

    return account
  }

  private async emitOutboxEvent(input: {
    eventType: string
    aggregateType: string
    aggregateId: string
    idempotencyKey: string
    correlationId: string
    causationId: string
    payload: JsonObject
  }): Promise<void> {
    await this.outboxRepository.appendIfAbsent({
      outboxEventId: this.outboxEventId(
        input.eventType,
        input.idempotencyKey,
      ),
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      payload: input.payload,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: null,
      correlationId: input.correlationId,
      causationId: input.causationId,
      createdAt: this.clock.now(),
      publishedAt: null,
    })
  }

  private async emitOutboxEventWithinTransaction(
    input: {
      eventType: string
      aggregateType: string
      aggregateId: string
      idempotencyKey: string
      correlationId: string
      causationId: string
      payload: JsonObject
    },
    transaction: DatabaseTransaction,
  ): Promise<void> {
    await this.outboxRepository.appendIfAbsent(
      {
        outboxEventId: this.outboxEventId(
          input.eventType,
          input.idempotencyKey,
        ),
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        eventType: input.eventType,
        payload: input.payload,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: null,
        correlationId: input.correlationId,
        causationId: input.causationId,
        createdAt: this.clock.now(),
        publishedAt: null,
      },
      transaction,
    )
  }

  private outboxEventId(eventType: string, idempotencyKey: string): string {
    const digest = createHash('sha256')
      .update(`${eventType}:${idempotencyKey}`)
      .digest('hex')
      .slice(0, 32)

    return `outbox_${digest}`
  }

  private assertCanonicalCurrency(currency: string): void {
    if (currency !== canonicalCurrency) {
      throw new AppError({
        category: 'validation_error',
        code: 'UNSUPPORTED_CURRENCY',
        message: 'USDC is the only supported front-of-house currency',
        details: { currency, supportedCurrencies: [canonicalCurrency] },
      })
    }
  }
}
