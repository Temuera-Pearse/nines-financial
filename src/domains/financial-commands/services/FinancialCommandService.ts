import { createHash } from 'node:crypto'

import type { Account } from '../../accounting/entities/Account.js'
import type { PlayerAccount } from '../../account/entities/PlayerAccount.js'
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
import type { Clock } from '../../../shared/time/Clock.js'
import { AppError } from '../../../shared/types/AppError.js'
import type { JsonObject } from '../../../shared/types/Json.js'
import type {
  ApplyHouseTakeCommandDto,
  ApplyHouseTakeResultDto,
  ReleaseReservationCommandDto,
  ReleaseReservationResultDto,
  ReserveStakeCommandDto,
  ReserveStakeResultDto,
  SettleBetCommandDto,
  SettleBetResultDto,
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
  grossPoolMinor: string
  houseTakeMinor: string
  netPoolMinor: string
  roundingResidualMinor: string
  allocations: SettlementAllocation[]
}

export class FinancialCommandService {
  constructor(
    private readonly playerAccountProvisioningService: PlayerAccountProvisioningService,
    private readonly accountRepository: AccountRepository,
    private readonly ledgerRepository: LedgerRepository,
    private readonly accountService: AccountService,
    private readonly postingEngineService: PostingEngineService,
    private readonly reservationService: ReservationService,
    private readonly effectiveStatusService: EffectiveStatusService,
    private readonly authorizationService: AccountActionAuthorizationService,
    private readonly outboxRepository: OutboxRepository,
    private readonly clock: Clock,
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
    const settlement = this.calculatePoolProration(command)
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

    const settlementClearingAccount = await this.ensureAccount({
      accountType: 'settlement_clearing',
      ownerType: 'settlement',
      ownerId: `race:${command.raceId}`,
      currency: command.currency,
      correlationId: command.correlationId,
      causationId: command.causationId,
      idempotencyKey: `ensure:settlement-clearing:${command.raceId}:${command.currency}`,
    })
    const captureTransactionIdByBetId = new Map<string, string>()
    const payoutTransactionIdByBetId = new Map<string, string | null>()
    let settledAt = this.clock.now()

    for (const allocation of settlement.allocations) {
      const reservationId = await this.requireBetReservationId(allocation.betId)
      const capture = await this.reservationService.captureFunds({
        idempotencyKey: toIdempotencyKey(
          `${command.idempotencyKey}:capture:${allocation.betId}`,
        ),
        reservationId,
        destinationAccountId: settlementClearingAccount.accountId,
        correlationId: command.correlationId,
        causationId: command.causationId,
      })

      captureTransactionIdByBetId.set(allocation.betId, capture.transactionId)
      payoutTransactionIdByBetId.set(allocation.betId, null)
      settledAt = capture.createdAt
    }

    if (BigInt(settlement.houseTakeMinor) > 0n) {
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
        idempotencyKey: toIdempotencyKey(
          `${command.idempotencyKey}:house-take`,
        ),
        transactionType: 'settlement_house_take',
        referenceType: 'settlement',
        referenceId: command.raceId,
        debitAccountId: settlementClearingAccount.accountId,
        creditAccountId: houseTakeRevenueAccount.accountId,
        amountMinor: settlement.houseTakeMinor,
        currency: command.currency,
        correlationId: command.correlationId,
        causationId: command.causationId,
      })
      settledAt = houseTake.createdAt
    }

    for (const allocation of settlement.allocations) {
      if (BigInt(allocation.payoutMinor) <= 0n) {
        continue
      }

      const payoutAccount = payoutAccountByUserId.get(allocation.userId)

      if (!payoutAccount) {
        throw new AppError({
          category: 'internal_error',
          code: 'SETTLEMENT_PAYOUT_ACCOUNT_MISSING',
          message: 'Expected payout account to be prepared before posting',
          details: { userId: allocation.userId, betId: allocation.betId },
        })
      }

      const payout = await this.postingEngineService.postTransfer({
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
      })

      payoutTransactionIdByBetId.set(allocation.betId, payout.transactionId)
      settledAt = payout.createdAt
    }

    const settledBets = settlement.allocations.map((allocation) => ({
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

    for (const settledBet of settledBets) {
      await this.emitOutboxEvent({
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
          selectionId: settledBet.selectionId,
          winningSelectionId: command.winningSelectionId,
          resultStatus: settledBet.resultStatus,
          stakeMinor: settledBet.stakeMinor,
          payoutMinor: settledBet.payoutMinor,
          currency: command.currency,
          captureTransactionId: settledBet.captureTransactionId,
          payoutTransactionId: settledBet.payoutTransactionId,
        },
      })
    }

    await this.emitOutboxEvent({
      eventType: 'race_settled',
      aggregateType: 'race',
      aggregateId: command.raceId,
      idempotencyKey: command.idempotencyKey,
      correlationId: command.correlationId,
      causationId: command.causationId,
      payload: {
        raceId: command.raceId,
        winningSelectionId: command.winningSelectionId,
        totalPoolMinor: settlement.grossPoolMinor,
        houseTakeMinor: settlement.houseTakeMinor,
        netPoolMinor: settlement.netPoolMinor,
        roundingResidualMinor: settlement.roundingResidualMinor,
        currency: command.currency,
        settledBets,
      },
    })

    return {
      raceId: command.raceId,
      winningSelectionId: command.winningSelectionId,
      totalPoolMinor: settlement.grossPoolMinor,
      houseTakeMinor: settlement.houseTakeMinor,
      netPoolMinor: settlement.netPoolMinor,
      roundingResidualMinor: settlement.roundingResidualMinor,
      settledBets,
      settledAt: settledAt.toISOString(),
    }
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
  ): SettlementCalculation {
    const totalPoolMinor = BigInt(command.totalPoolMinor)
    const grossPoolMinor = command.acceptedBets.reduce(
      (sum, bet) => sum + BigInt(bet.stakeMinor),
      0n,
    )

    if (grossPoolMinor !== totalPoolMinor) {
      throw new AppError({
        category: 'validation_error',
        code: 'SETTLEMENT_POOL_TOTAL_MISMATCH',
        message: 'totalPoolMinor must equal the sum of accepted bet stakes',
        details: {
          totalPoolMinor: command.totalPoolMinor,
          acceptedStakeSumMinor: grossPoolMinor.toString(),
        },
      })
    }

    const winningBets = command.acceptedBets.filter(
      (bet) => bet.selectionId === command.winningSelectionId,
    )

    if (winningBets.length === 0) {
      throw new AppError({
        category: 'conflict',
        code: 'NO_WINNING_BETS_RULE_UNDEFINED',
        message:
          'No winning accepted bets were supplied; the no-winner settlement rule is not active in Phase 2.10',
        details: {
          raceId: command.raceId,
          winningSelectionId: command.winningSelectionId,
        },
      })
    }

    const houseTakeMinor =
      (grossPoolMinor * BigInt(command.houseTakeBps)) / basisPointsDenominator
    const netPoolMinor = grossPoolMinor - houseTakeMinor
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

    const allocations = command.acceptedBets.map((bet) => {
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
      grossPoolMinor: grossPoolMinor.toString(),
      houseTakeMinor: houseTakeMinor.toString(),
      netPoolMinor: netPoolMinor.toString(),
      roundingResidualMinor: (netPoolMinor - finalPayoutTotalMinor).toString(),
      allocations,
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
