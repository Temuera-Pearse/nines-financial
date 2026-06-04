import { createHash, randomUUID } from 'node:crypto'

import type { AuditEvent } from '../../../shared/audit/AuditEvent.js'
import type { Database, DatabaseTransaction } from '../../../shared/db/Database.js'
import type { FaultInjector } from '../../../shared/faults/FaultInjector.js'
import { toIdempotencyKey } from '../../../shared/idempotency/types.js'
import type { OutboxRepository } from '../../../shared/outbox/OutboxRepository.js'
import type { Clock } from '../../../shared/time/Clock.js'
import { AppError, isAppError } from '../../../shared/types/AppError.js'
import type { JsonObject } from '../../../shared/types/Json.js'
import type { PlayerAccount } from '../../account/entities/PlayerAccount.js'
import { AccountActionAuthorizationService } from '../../account/restrictions/AccountActionAuthorizationService.js'
import { EffectiveStatusService } from '../../account/services/EffectiveStatusService.js'
import { PlayerAccountProvisioningService } from '../../account/services/PlayerAccountProvisioningService.js'
import { toUserId } from '../../account/types/identifiers.js'
import type { AccountRepository } from '../../accounting/repositories/AccountRepository.js'
import type { AuditEventRepository } from '../../accounting/repositories/AuditEventRepository.js'
import type { IdempotencyRepository } from '../../accounting/repositories/IdempotencyRepository.js'
import { IdempotencyService } from '../../accounting/services/IdempotencyService.js'
import { PostingEngineService } from '../../accounting/services/PostingEngineService.js'
import { newAuditEventId, type LedgerTransactionId } from '../../accounting/types/identifiers.js'
import type {
  CreateRacePoolCommandDto,
  FinancialBetDto,
  FreezePoolCommandDto,
  PlaceBetCommandDto,
  PlaceBetResultDto,
  PoolSelectionDto,
  PoolTotalDto,
  RacePoolDto,
  RacePoolWithSelectionsDto,
  RegisterPoolSelectionCommandDto,
  SelectionTotalDto,
  SettlementCarryoverDto,
  SettlementManualReviewItemDto,
  SettlementReconciliationReportDto,
  SettlementReconciliationRunSummaryDto,
} from '../dto/bettingDtos.js'
import type { BettingRepository } from '../repositories/BettingRepository.js'

const canonicalCurrency = 'USDC'
const createRacePoolCommandType = 'create_race_pool'
const registerPoolSelectionCommandType = 'register_pool_selection'
const freezePoolCommandType = 'freeze_pool'
const placeBetCommandType = 'place_bet'

interface BetRejection {
  code: string
  reason: string
}

export class BettingIntakeService {
  private readonly placementLocks = new Map<string, Promise<void>>()

  constructor(
    private readonly database: Database,
    private readonly bettingRepository: BettingRepository,
    private readonly idempotencyRepository: IdempotencyRepository,
    private readonly auditEventRepository: AuditEventRepository,
    private readonly accountRepository: AccountRepository,
    private readonly postingEngineService: PostingEngineService,
    private readonly playerAccountProvisioningService: PlayerAccountProvisioningService,
    private readonly effectiveStatusService: EffectiveStatusService,
    private readonly authorizationService: AccountActionAuthorizationService,
    private readonly outboxRepository: OutboxRepository,
    private readonly clock: Clock,
    private readonly faultInjector: FaultInjector,
  ) {}

  async createRacePool(
    command: CreateRacePoolCommandDto,
  ): Promise<RacePoolDto> {
    this.assertCanonicalCurrency(command.currency)
    const requestPayload: JsonObject = {
      raceId: command.raceId,
      currency: command.currency,
      bettingOpensAt: command.bettingOpensAt ?? null,
      bettingClosesAt: command.bettingClosesAt ?? null,
      correlationId: command.correlationId,
      causationId: command.causationId,
    }

    return this.database.tx(async (transaction) => {
      const idempotencyService = this.idempotencyService()
      const idempotencyDecision = await idempotencyService.begin(
        createRacePoolCommandType,
        toIdempotencyKey(command.idempotencyKey),
        requestPayload,
        transaction,
      )

      if (idempotencyDecision.kind === 'replay') {
        return this.getRacePoolFromSnapshot(
          idempotencyDecision.record.responseSnapshot,
          transaction,
        )
      }

      this.assertBettingWindowOrder(
        command.bettingOpensAt ?? null,
        command.bettingClosesAt ?? null,
      )

      const existingPool = await this.bettingRepository.getRacePoolForUpdate(
        command.raceId,
        command.currency,
        transaction,
      )

      if (existingPool) {
        this.assertExistingPoolMatchesCommand(existingPool, command)
        await idempotencyService.complete(
          createRacePoolCommandType,
          toIdempotencyKey(command.idempotencyKey),
          requestPayload,
          { raceId: existingPool.raceId, currency: existingPool.currency },
          transaction,
        )

        return existingPool
      }

      const now = this.clock.now()

      await this.bettingRepository.createRacePool(
        {
          raceId: command.raceId,
          currency: command.currency,
          status: 'open',
          bettingOpensAt: this.parseOptionalDate(command.bettingOpensAt),
          bettingClosesAt: this.parseOptionalDate(command.bettingClosesAt),
          createdAt: now,
          updatedAt: now,
          frozenAt: null,
        },
        transaction,
      )

      const pool = await this.requireRacePool(
        command.raceId,
        command.currency,
        transaction,
      )

      await this.persistDomainEvent(
        {
          eventType: 'financial.pool.opened',
          entityType: 'race_pool',
          entityId: command.raceId,
          aggregateType: 'race_pool',
          aggregateId: command.raceId,
          idempotencyKey: command.idempotencyKey,
          correlationId: command.correlationId,
          causationId: command.causationId,
          payload: { ...pool },
        },
        transaction,
      )
      await idempotencyService.complete(
        createRacePoolCommandType,
        toIdempotencyKey(command.idempotencyKey),
        requestPayload,
        { raceId: pool.raceId, currency: pool.currency },
        transaction,
      )

      return pool
    })
  }

  async registerPoolSelection(
    command: RegisterPoolSelectionCommandDto,
  ): Promise<PoolSelectionDto> {
    this.assertCanonicalCurrency(command.currency)
    const requestPayload: JsonObject = {
      raceId: command.raceId,
      selectionId: command.selectionId,
      currency: command.currency,
      status: command.status ?? 'active',
      displayName: command.displayName ?? null,
      correlationId: command.correlationId,
      causationId: command.causationId,
    }

    return this.database.tx(async (transaction) => {
      const idempotencyService = this.idempotencyService()
      const idempotencyDecision = await idempotencyService.begin(
        registerPoolSelectionCommandType,
        toIdempotencyKey(command.idempotencyKey),
        requestPayload,
        transaction,
      )

      if (idempotencyDecision.kind === 'replay') {
        return this.getPoolSelectionFromSnapshot(
          idempotencyDecision.record.responseSnapshot,
          transaction,
        )
      }

      const existingSelection = await this.bettingRepository.getPoolSelection(
        command.raceId,
        command.selectionId,
        command.currency,
        transaction,
      )

      if (existingSelection) {
        this.assertExistingSelectionMatchesCommand(existingSelection, command)
        await idempotencyService.complete(
          registerPoolSelectionCommandType,
          toIdempotencyKey(command.idempotencyKey),
          requestPayload,
          {
            raceId: existingSelection.raceId,
            selectionId: existingSelection.selectionId,
            currency: existingSelection.currency,
          },
          transaction,
        )

        return existingSelection
      }

      const pool = await this.requireRacePoolForUpdate(
        command.raceId,
        command.currency,
        transaction,
      )

      if (pool.status !== 'open') {
        throw new AppError({
          category: 'conflict',
          code: 'POOL_NOT_OPEN',
          message: 'Selections can only be registered while the pool is open',
          details: { raceId: command.raceId, status: pool.status },
        })
      }

      const now = this.clock.now()

      await this.bettingRepository.createPoolSelection(
        {
          raceId: command.raceId,
          selectionId: command.selectionId,
          currency: command.currency,
          status: command.status ?? 'active',
          displayName: command.displayName ?? null,
          createdAt: now,
          updatedAt: now,
        },
        transaction,
      )

      const selection = await this.requirePoolSelection(
        command.raceId,
        command.selectionId,
        command.currency,
        transaction,
      )

      await this.persistDomainEvent(
        {
          eventType: 'financial.pool.selection_registered',
          entityType: 'race_pool_selection',
          entityId: `${command.raceId}:${command.selectionId}`,
          aggregateType: 'race_pool',
          aggregateId: command.raceId,
          idempotencyKey: command.idempotencyKey,
          correlationId: command.correlationId,
          causationId: command.causationId,
          payload: { ...selection },
        },
        transaction,
      )
      await idempotencyService.complete(
        registerPoolSelectionCommandType,
        toIdempotencyKey(command.idempotencyKey),
        requestPayload,
        {
          raceId: selection.raceId,
          selectionId: selection.selectionId,
          currency: selection.currency,
        },
        transaction,
      )

      return selection
    })
  }

  async freezePool(command: FreezePoolCommandDto): Promise<RacePoolDto> {
    this.assertCanonicalCurrency(command.currency)
    const requestPayload: JsonObject = {
      raceId: command.raceId,
      currency: command.currency,
      reasonCode: command.reasonCode,
      correlationId: command.correlationId,
      causationId: command.causationId,
    }

    return this.database.tx(async (transaction) => {
      const idempotencyService = this.idempotencyService()
      const idempotencyDecision = await idempotencyService.begin(
        freezePoolCommandType,
        toIdempotencyKey(command.idempotencyKey),
        requestPayload,
        transaction,
      )

      if (idempotencyDecision.kind === 'replay') {
        return this.getRacePoolFromSnapshot(
          idempotencyDecision.record.responseSnapshot,
          transaction,
        )
      }

      const pool = await this.requireRacePoolForUpdate(
        command.raceId,
        command.currency,
        transaction,
      )

      if (pool.status !== 'open') {
        await idempotencyService.complete(
          freezePoolCommandType,
          toIdempotencyKey(command.idempotencyKey),
          requestPayload,
          { raceId: pool.raceId, currency: pool.currency },
          transaction,
        )

        return pool
      }

      const now = this.clock.now()
      const frozenPool: RacePoolDto = {
        ...pool,
        status: 'frozen',
        updatedAt: now.toISOString(),
        frozenAt: pool.frozenAt ?? now.toISOString(),
      }

      await this.bettingRepository.updateRacePool(frozenPool, transaction)
      await this.persistDomainEvent(
        {
          eventType: 'financial.pool.frozen',
          entityType: 'race_pool',
          entityId: command.raceId,
          aggregateType: 'race_pool',
          aggregateId: command.raceId,
          idempotencyKey: command.idempotencyKey,
          correlationId: command.correlationId,
          causationId: command.causationId,
          payload: {
            ...frozenPool,
            reasonCode: command.reasonCode,
          },
        },
        transaction,
      )
      await idempotencyService.complete(
        freezePoolCommandType,
        toIdempotencyKey(command.idempotencyKey),
        requestPayload,
        { raceId: frozenPool.raceId, currency: frozenPool.currency },
        transaction,
      )

      return frozenPool
    })
  }

  async placeBet(command: PlaceBetCommandDto): Promise<PlaceBetResultDto> {
    return this.withPlacementLock(`${command.userId}:${command.currency}`, () =>
      this.placeBetUnlocked(command),
    )
  }

  private async placeBetUnlocked(
    command: PlaceBetCommandDto,
  ): Promise<PlaceBetResultDto> {
    this.assertCanonicalCurrency(command.currency)
    const preliminaryRejection = await this.getRuleRejection(command)

    if (preliminaryRejection) {
      return this.recordRejectedBet(command, preliminaryRejection)
    }

    const playerAccount = await this.provisionPlayerAccount(command)
    const authorizationRejection = await this.getAuthorizationRejection(
      playerAccount,
    )

    if (authorizationRejection) {
      return this.recordRejectedBet(command, authorizationRejection)
    }

    const requestPayload = this.placeBetRequestPayload(command)

    return this.database.tx(async (transaction) => {
      const idempotencyService = this.idempotencyService()
      const idempotencyDecision = await idempotencyService.begin(
        placeBetCommandType,
        toIdempotencyKey(command.idempotencyKey),
        requestPayload,
        transaction,
      )

      if (idempotencyDecision.kind === 'replay') {
        return this.getPlaceBetResultFromSnapshot(
          idempotencyDecision.record.responseSnapshot,
          transaction,
        )
      }

      const inTransactionRejection = await this.getRuleRejection(
        command,
        transaction,
      )

      if (inTransactionRejection) {
        return this.recordRejectedBetWithinTransaction(
          command,
          inTransactionRejection,
          requestPayload,
          transaction,
        )
      }

      try {
        const reservation = await this.postingEngineService.postTransferWithinTransaction(
          {
            transactionType: 'bet_reserve',
            referenceType: 'bet',
            referenceId: command.betId,
            debitAccountId: playerAccount.availableAccountId,
            creditAccountId: playerAccount.reservedAccountId,
            amountMinor: command.stakeMinor,
            currency: command.currency,
            correlationId: command.correlationId,
            causationId: command.causationId,
            idempotencyKey: toIdempotencyKey(command.idempotencyKey),
          },
          transaction,
        )
        const acceptedBet = await this.insertAcceptedBet(
          command,
          reservation.transactionId,
          transaction,
        )

        await this.persistDomainEvent(
          {
            eventType: 'financial.bet.accepted',
            entityType: 'financial_bet',
            entityId: command.betId,
            aggregateType: 'bet',
            aggregateId: command.betId,
            idempotencyKey: command.idempotencyKey,
            correlationId: command.correlationId,
            causationId: command.causationId,
          payload: { ...acceptedBet },
          },
          transaction,
        )
        await this.persistDomainEvent(
          {
            eventType: 'financial.wallet.balance_changed',
            entityType: 'player_account',
            entityId: playerAccount.playerAccountId,
            aggregateType: 'player_account',
            aggregateId: playerAccount.playerAccountId,
            idempotencyKey: `${command.idempotencyKey}:balance-changed`,
            correlationId: command.correlationId,
            causationId: command.causationId,
            payload: {
              userId: command.userId,
              betId: command.betId,
              transactionId: reservation.transactionId,
              sourceAccountId: playerAccount.availableAccountId,
              lockedAccountId: playerAccount.reservedAccountId,
              amountMinor: command.stakeMinor,
              currency: command.currency,
            },
          },
          transaction,
        )
        await idempotencyService.complete(
          placeBetCommandType,
          toIdempotencyKey(command.idempotencyKey),
          requestPayload,
          { betId: acceptedBet.betId },
          transaction,
        )

        return {
          bet: acceptedBet,
          reservationId: reservation.transactionId,
          accepted: true,
        }
      } catch (error) {
        const rejection = this.rejectionFromPostingError(error)

        if (!rejection) {
          throw error
        }

        return this.recordRejectedBetWithinTransaction(
          command,
          rejection,
          requestPayload,
          transaction,
        )
      }
    })
  }

  private async withPlacementLock<T>(
    lockKey: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const previous = this.placementLocks.get(lockKey) ?? Promise.resolve()
    let releaseCurrent!: () => void
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve
    })
    const tail = previous.catch(() => undefined).then(() => current)

    this.placementLocks.set(lockKey, tail)
    await previous.catch(() => undefined)

    try {
      return await work()
    } finally {
      releaseCurrent()

      if (this.placementLocks.get(lockKey) === tail) {
        this.placementLocks.delete(lockKey)
      }
    }
  }

  async getBetById(betId: string): Promise<FinancialBetDto> {
    const bet = await this.bettingRepository.getBetById(betId)

    if (!bet) {
      throw new AppError({
        category: 'not_found',
        code: 'FINANCIAL_BET_NOT_FOUND',
        message: 'Financial bet was not found',
        details: { betId },
      })
    }

    return bet
  }

  async getRacePoolWithSelections(
    raceId: string,
  ): Promise<RacePoolWithSelectionsDto> {
    const pool = await this.bettingRepository.getRacePool(
      raceId,
      canonicalCurrency,
    )

    if (!pool) {
      throw new AppError({
        category: 'not_found',
        code: 'RACE_POOL_NOT_FOUND',
        message: 'Race pool was not found',
        details: { raceId, currency: canonicalCurrency },
      })
    }

    const selections = await this.bettingRepository.listPoolSelections(
      raceId,
      canonicalCurrency,
    )
    const appliedCarryovers = await this.bettingRepository.listCarryovers({
      status: 'applied',
      targetRaceId: raceId,
    })
    const pendingCarryovers = await this.bettingRepository.listCarryovers({
      status: 'pending',
    })
    const appliedCarryoverMinor = appliedCarryovers
      .reduce((sum, carryover) => sum + BigInt(carryover.amountMinor), 0n)
      .toString()
    const pendingCarryoverMinor = pendingCarryovers
      .reduce((sum, carryover) => sum + BigInt(carryover.amountMinor), 0n)
      .toString()

    return {
      pool,
      selections,
      carryoverSummary: {
        appliedCarryoverMinor,
        appliedCarryoverCount: appliedCarryovers.length,
        pendingCarryoverMinor,
        pendingCarryoverCount: pendingCarryovers.length,
      },
    }
  }

  listBetsByRaceId(raceId: string): Promise<FinancialBetDto[]> {
    return this.bettingRepository.listBetsByRaceId(raceId)
  }

  listBetsByUserId(userId: string): Promise<FinancialBetDto[]> {
    return this.bettingRepository.listBetsByUserId(userId)
  }

  listCarryovers(criteria: {
    status?: SettlementCarryoverDto['status']
    sourceRaceId?: string
    targetRaceId?: string
  }): Promise<SettlementCarryoverDto[]> {
    return this.bettingRepository.listCarryovers(criteria)
  }

  async getLivePoolTotal(raceId: string): Promise<PoolTotalDto> {
    const total = await this.bettingRepository.getLivePoolTotal(
      raceId,
      canonicalCurrency,
    )

    return { ...total, asOf: this.clock.now().toISOString() }
  }

  async listSelectionTotals(raceId: string): Promise<SelectionTotalDto[]> {
    const totals = await this.bettingRepository.listSelectionTotals(
      raceId,
      canonicalCurrency,
    )
    const asOf = this.clock.now().toISOString()

    return totals.map((total) => ({ ...total, asOf }))
  }

  async detectSettlementReconciliation(
    raceId: string,
  ): Promise<SettlementReconciliationReportDto> {
    const issues =
      await this.bettingRepository.detectSettlementReconciliationIssues(
        raceId,
        canonicalCurrency,
      )

    return {
      raceId,
      currency: canonicalCurrency,
      checkedAt: this.clock.now().toISOString(),
      issues,
    }
  }

  listManualReviewItems(): Promise<SettlementManualReviewItemDto[]> {
    return this.bettingRepository.listManualReviewItems(canonicalCurrency)
  }

  listSettlementReconciliationRuns(criteria: {
    raceId?: string
  }): Promise<SettlementReconciliationRunSummaryDto[]> {
    return this.bettingRepository.listSettlementReconciliationRuns(criteria)
  }

  async runSettlementReconciliation(input: {
    raceId: string
    operatorId: string
    idempotencyKey: string
    correlationId: string
    causationId: string
  }): Promise<SettlementReconciliationRunSummaryDto> {
    const existing =
      await this.bettingRepository.getSettlementReconciliationRunByIdempotencyKey(
        input.idempotencyKey,
      )

    if (existing) {
      return existing
    }

    return this.database.tx(async (transaction) => {
      const replay =
        await this.bettingRepository.getSettlementReconciliationRunByIdempotencyKey(
          input.idempotencyKey,
          transaction,
        )

      if (replay) {
        return replay
      }

      const issues =
        await this.bettingRepository.detectSettlementReconciliationIssues(
          input.raceId,
          canonicalCurrency,
          transaction,
        )
      const now = this.clock.now()
      const errorCount = issues.filter(
        (issue) => issue.severity === 'error',
      ).length
      const warningCount = issues.filter(
        (issue) => issue.severity === 'warning',
      ).length
      const classification =
        errorCount > 0
          ? 'actionable_incident'
          : warningCount > 0
            ? 'discrepancy'
            : 'informational'
      const run: SettlementReconciliationRunSummaryDto = {
        reconciliationRunId: `settlement_reconciliation_run_${randomUUID()}`,
        raceId: input.raceId,
        currency: canonicalCurrency,
        status: 'completed',
        classification,
        actionRequired: classification !== 'informational',
        issueCount: issues.length,
        errorCount,
        warningCount,
        issues,
        requestedByOperatorId: input.operatorId,
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
        causationId: input.causationId,
        createdAt: now.toISOString(),
        completedAt: now.toISOString(),
      }

      await this.faultInjector.trigger('reconciliation.before_run_persist', {
        raceId: input.raceId,
        currency: canonicalCurrency,
        reconciliationRunId: run.reconciliationRunId,
        idempotencyKey: input.idempotencyKey,
        issueCount: run.issueCount,
        classification: run.classification,
      })

      await this.bettingRepository.createSettlementReconciliationRun(
        {
          reconciliationRunId: run.reconciliationRunId,
          raceId: run.raceId,
          currency: run.currency,
          status: run.status,
          classification: run.classification,
          actionRequired: run.actionRequired,
          issueCount: run.issueCount,
          errorCount: run.errorCount,
          warningCount: run.warningCount,
          issues,
          requestedByOperatorId: run.requestedByOperatorId,
          idempotencyKey: run.idempotencyKey,
          correlationId: run.correlationId,
          causationId: run.causationId,
          createdAt: now,
          completedAt: now,
        },
        transaction,
      )

      await this.faultInjector.trigger(
        'reconciliation.after_run_persist_before_response',
        {
          raceId: input.raceId,
          currency: canonicalCurrency,
          reconciliationRunId: run.reconciliationRunId,
          idempotencyKey: input.idempotencyKey,
        },
      )

      return run
    })
  }

  private async recordRejectedBet(
    command: PlaceBetCommandDto,
    rejection: BetRejection,
  ): Promise<PlaceBetResultDto> {
    const requestPayload = this.placeBetRequestPayload(command)

    return this.database.tx(async (transaction) => {
      const idempotencyService = this.idempotencyService()
      const idempotencyDecision = await idempotencyService.begin(
        placeBetCommandType,
        toIdempotencyKey(command.idempotencyKey),
        requestPayload,
        transaction,
      )

      if (idempotencyDecision.kind === 'replay') {
        return this.getPlaceBetResultFromSnapshot(
          idempotencyDecision.record.responseSnapshot,
          transaction,
        )
      }

      return this.recordRejectedBetWithinTransaction(
        command,
        rejection,
        requestPayload,
        transaction,
      )
    })
  }

  private async recordRejectedBetWithinTransaction(
    command: PlaceBetCommandDto,
    rejection: BetRejection,
    requestPayload: JsonObject,
    transaction: DatabaseTransaction,
  ): Promise<PlaceBetResultDto> {
    const now = this.clock.now()

    await this.bettingRepository.createBet(
      {
        betId: command.betId,
        userId: command.userId,
        raceId: command.raceId,
        selectionId: command.selectionId,
        stakeMinor: command.stakeMinor,
        currency: command.currency,
        status: 'rejected',
        rejectionCode: rejection.code,
        rejectionReason: rejection.reason,
        reservationId: null,
        acceptedAt: null,
        rejectedAt: now,
        idempotencyKey: command.idempotencyKey,
        correlationId: command.correlationId,
        causationId: command.causationId,
        createdAt: now,
        updatedAt: now,
      },
      transaction,
    )

    const bet = await this.requireBet(command.betId, transaction)

    await this.persistDomainEvent(
      {
        eventType: 'financial.bet.rejected',
        entityType: 'financial_bet',
        entityId: command.betId,
        aggregateType: 'bet',
        aggregateId: command.betId,
        idempotencyKey: command.idempotencyKey,
        correlationId: command.correlationId,
        causationId: command.causationId,
        payload: { ...bet },
      },
      transaction,
    )
    await this.idempotencyService().complete(
      placeBetCommandType,
      toIdempotencyKey(command.idempotencyKey),
      requestPayload,
      { betId: bet.betId },
      transaction,
    )

    return {
      bet,
      reservationId: null,
      accepted: false,
    }
  }

  private async insertAcceptedBet(
    command: PlaceBetCommandDto,
    reservationId: LedgerTransactionId,
    transaction: DatabaseTransaction,
  ): Promise<FinancialBetDto> {
    const now = this.clock.now()

    await this.bettingRepository.createBet(
      {
        betId: command.betId,
        userId: command.userId,
        raceId: command.raceId,
        selectionId: command.selectionId,
        stakeMinor: command.stakeMinor,
        currency: command.currency,
        status: 'accepted',
        rejectionCode: null,
        rejectionReason: null,
        reservationId,
        acceptedAt: now,
        rejectedAt: null,
        idempotencyKey: command.idempotencyKey,
        correlationId: command.correlationId,
        causationId: command.causationId,
        createdAt: now,
        updatedAt: now,
      },
      transaction,
    )

    return this.requireBet(command.betId, transaction)
  }

  private async getRuleRejection(
    command: PlaceBetCommandDto,
    transaction?: DatabaseTransaction,
  ): Promise<BetRejection | null> {
    const pool = transaction
      ? await this.bettingRepository.getRacePoolForUpdate(
          command.raceId,
          command.currency,
          transaction,
        )
      : await this.bettingRepository.getRacePool(command.raceId, command.currency)

    if (!pool) {
      return {
        code: 'POOL_NOT_FOUND',
        reason: 'Race pool does not exist',
      }
    }

    if (pool.status !== 'open') {
      return {
        code: 'POOL_NOT_OPEN',
        reason: 'Race pool is not open for betting',
      }
    }

    const now = this.clock.now()
    const opensAt = pool.bettingOpensAt ? new Date(pool.bettingOpensAt) : null
    const closesAt = pool.bettingClosesAt ? new Date(pool.bettingClosesAt) : null

    if (opensAt && now.getTime() < opensAt.getTime()) {
      return {
        code: 'BETTING_WINDOW_CLOSED',
        reason: 'Betting has not opened for this pool',
      }
    }

    if (closesAt && now.getTime() >= closesAt.getTime()) {
      return {
        code: 'BETTING_WINDOW_CLOSED',
        reason: 'Betting is closed for this pool',
      }
    }

    const selection = await this.bettingRepository.getPoolSelection(
      command.raceId,
      command.selectionId,
      command.currency,
      transaction,
    )

    if (!selection) {
      return {
        code: 'POOL_SELECTION_NOT_FOUND',
        reason: 'Selection is not registered for this pool',
      }
    }

    if (selection.status !== 'active') {
      return {
        code: 'POOL_SELECTION_INACTIVE',
        reason: 'Selection is not active for betting',
      }
    }

    return null
  }

  private assertExistingPoolMatchesCommand(
    pool: RacePoolDto,
    command: CreateRacePoolCommandDto,
  ): void {
    const requestedOpensAt = this.toOptionalIso(command.bettingOpensAt)
    const requestedClosesAt = this.toOptionalIso(command.bettingClosesAt)

    if (
      pool.currency !== command.currency ||
      pool.bettingOpensAt !== requestedOpensAt ||
      pool.bettingClosesAt !== requestedClosesAt
    ) {
      throw new AppError({
        category: 'conflict',
        code: 'RACE_POOL_ALREADY_EXISTS',
        message:
          'A race pool already exists with different lifecycle attributes',
        details: {
          raceId: command.raceId,
          currency: command.currency,
          existingBettingOpensAt: pool.bettingOpensAt,
          requestedBettingOpensAt: requestedOpensAt,
          existingBettingClosesAt: pool.bettingClosesAt,
          requestedBettingClosesAt: requestedClosesAt,
        },
      })
    }
  }

  private assertExistingSelectionMatchesCommand(
    selection: PoolSelectionDto,
    command: RegisterPoolSelectionCommandDto,
  ): void {
    const requestedStatus = command.status ?? 'active'
    const requestedDisplayName = command.displayName ?? null

    if (
      selection.currency !== command.currency ||
      selection.status !== requestedStatus ||
      selection.displayName !== requestedDisplayName
    ) {
      throw new AppError({
        category: 'conflict',
        code: 'POOL_SELECTION_ALREADY_EXISTS',
        message:
          'A selection is already registered with different lifecycle attributes',
        details: {
          raceId: command.raceId,
          selectionId: command.selectionId,
          existingStatus: selection.status,
          requestedStatus,
          existingDisplayName: selection.displayName,
          requestedDisplayName,
        },
      })
    }
  }

  private async getAuthorizationRejection(
    playerAccount: PlayerAccount,
  ): Promise<BetRejection | null> {
    try {
      const statusSnapshot = await this.effectiveStatusService.getSnapshot(
        playerAccount.playerAccountId,
        this.clock.now(),
      )
      const availableAccount = await this.accountRepository.getById(
        playerAccount.availableAccountId,
      )

      this.authorizationService.assertAuthorized({
        action: 'bet_reserve',
        actorRole: 'player',
        effectiveStatus: statusSnapshot.effectiveStatus,
        controlState: statusSnapshot.controlState,
        linkedCoreAccountId: playerAccount.availableAccountId,
        accountingCorePermitsAction: availableAccount?.status === 'active',
      })

      return null
    } catch (error) {
      if (!isAppError(error)) {
        throw error
      }

      return {
        code: error.code,
        reason: error.message,
      }
    }
  }

  private rejectionFromPostingError(error: unknown): BetRejection | null {
    if (!isAppError(error)) {
      return null
    }

    if (
      error.code !== 'INSUFFICIENT_FUNDS' &&
      error.code !== 'ACCOUNT_NOT_POSTABLE' &&
      error.code !== 'INVALID_LINKED_CORE_ACCOUNT_STATE'
    ) {
      return null
    }

    return {
      code: error.code,
      reason: error.message,
    }
  }

  private async provisionPlayerAccount(
    command: PlaceBetCommandDto,
  ): Promise<PlayerAccount> {
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

  private async requireRacePool(
    raceId: string,
    currency: 'USDC',
    transaction: DatabaseTransaction,
  ): Promise<RacePoolDto> {
    const pool = await this.bettingRepository.getRacePool(
      raceId,
      currency,
      transaction,
    )

    if (!pool) {
      throw new AppError({
        category: 'internal_error',
        code: 'RACE_POOL_MISSING_AFTER_CREATE',
        message: 'Race pool was missing after creation',
        details: { raceId, currency },
      })
    }

    return pool
  }

  private async requireRacePoolForUpdate(
    raceId: string,
    currency: 'USDC',
    transaction: DatabaseTransaction,
  ): Promise<RacePoolDto> {
    const pool = await this.bettingRepository.getRacePoolForUpdate(
      raceId,
      currency,
      transaction,
    )

    if (!pool) {
      throw new AppError({
        category: 'not_found',
        code: 'RACE_POOL_NOT_FOUND',
        message: 'Race pool was not found',
        details: { raceId, currency },
      })
    }

    return pool
  }

  private async requirePoolSelection(
    raceId: string,
    selectionId: string,
    currency: 'USDC',
    transaction: DatabaseTransaction,
  ): Promise<PoolSelectionDto> {
    const selection = await this.bettingRepository.getPoolSelection(
      raceId,
      selectionId,
      currency,
      transaction,
    )

    if (!selection) {
      throw new AppError({
        category: 'internal_error',
        code: 'POOL_SELECTION_MISSING_AFTER_CREATE',
        message: 'Pool selection was missing after creation',
        details: { raceId, selectionId, currency },
      })
    }

    return selection
  }

  private async requireBet(
    betId: string,
    transaction: DatabaseTransaction,
  ): Promise<FinancialBetDto> {
    const bet = await this.bettingRepository.getBetById(betId, transaction)

    if (!bet) {
      throw new AppError({
        category: 'internal_error',
        code: 'FINANCIAL_BET_MISSING_AFTER_CREATE',
        message: 'Financial bet was missing after creation',
        details: { betId },
      })
    }

    return bet
  }

  private async getRacePoolFromSnapshot(
    snapshot: JsonObject | null,
    transaction: DatabaseTransaction,
  ): Promise<RacePoolDto> {
    const raceId = snapshot?.raceId
    const currency = snapshot?.currency

    if (typeof raceId !== 'string' || currency !== canonicalCurrency) {
      throw new AppError({
        category: 'internal_error',
        code: 'INVALID_IDEMPOTENT_RACE_POOL_SNAPSHOT',
        message: 'Idempotency replay snapshot is missing race pool identity',
      })
    }

    return this.requireRacePool(raceId, currency, transaction)
  }

  private async getPoolSelectionFromSnapshot(
    snapshot: JsonObject | null,
    transaction: DatabaseTransaction,
  ): Promise<PoolSelectionDto> {
    const raceId = snapshot?.raceId
    const selectionId = snapshot?.selectionId
    const currency = snapshot?.currency

    if (
      typeof raceId !== 'string' ||
      typeof selectionId !== 'string' ||
      currency !== canonicalCurrency
    ) {
      throw new AppError({
        category: 'internal_error',
        code: 'INVALID_IDEMPOTENT_POOL_SELECTION_SNAPSHOT',
        message:
          'Idempotency replay snapshot is missing pool selection identity',
      })
    }

    return this.requirePoolSelection(raceId, selectionId, currency, transaction)
  }

  private async getPlaceBetResultFromSnapshot(
    snapshot: JsonObject | null,
    transaction: DatabaseTransaction,
  ): Promise<PlaceBetResultDto> {
    const betId = snapshot?.betId

    if (typeof betId !== 'string') {
      throw new AppError({
        category: 'internal_error',
        code: 'INVALID_IDEMPOTENT_PLACE_BET_SNAPSHOT',
        message: 'Idempotency replay snapshot is missing betId',
      })
    }

    const bet = await this.requireBet(betId, transaction)

    return {
      bet,
      reservationId: bet.reservationId,
      accepted: bet.status === 'accepted',
    }
  }

  private placeBetRequestPayload(command: PlaceBetCommandDto): JsonObject {
    return {
      betId: command.betId,
      userId: command.userId,
      raceId: command.raceId,
      selectionId: command.selectionId,
      stakeMinor: command.stakeMinor,
      currency: command.currency,
      correlationId: command.correlationId,
      causationId: command.causationId,
    }
  }

  private async persistDomainEvent(
    input: {
      eventType: string
      entityType: string
      entityId: string
      aggregateType: string
      aggregateId: string
      idempotencyKey: string
      correlationId: string
      causationId: string
      payload: JsonObject
    },
    transaction: DatabaseTransaction,
  ): Promise<void> {
    const createdAt = this.clock.now()
    const auditEvent: AuditEvent = {
      auditEventId: newAuditEventId(),
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId,
      correlationId: input.correlationId,
      causationId: input.causationId,
      payload: input.payload,
      createdAt,
    }

    await this.auditEventRepository.append(auditEvent, transaction)
    await this.outboxRepository.appendIfAbsent(
      {
        outboxEventId: this.outboxEventId(input.eventType, input.idempotencyKey),
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        eventType: input.eventType,
        payload: input.payload,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: null,
        correlationId: input.correlationId,
        causationId: input.causationId,
        createdAt,
        publishedAt: null,
      },
      transaction,
    )
  }

  private idempotencyService(): IdempotencyService {
    return new IdempotencyService(this.idempotencyRepository, this.clock)
  }

  private parseOptionalDate(value: string | null | undefined): Date | null {
    if (!value) {
      return null
    }

    return new Date(value)
  }

  private toOptionalIso(value: string | null | undefined): string | null {
    const parsed = this.parseOptionalDate(value)

    return parsed ? parsed.toISOString() : null
  }

  private assertBettingWindowOrder(
    bettingOpensAt: string | null,
    bettingClosesAt: string | null,
  ): void {
    if (!bettingOpensAt || !bettingClosesAt) {
      return
    }

    if (
      new Date(bettingClosesAt).getTime() <=
      new Date(bettingOpensAt).getTime()
    ) {
      throw new AppError({
        category: 'validation_error',
        code: 'INVALID_BETTING_WINDOW',
        message: 'bettingClosesAt must be after bettingOpensAt',
        details: { bettingOpensAt, bettingClosesAt },
      })
    }
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
