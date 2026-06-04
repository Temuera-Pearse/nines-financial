import { randomUUID } from 'node:crypto'

import type { AuditEvent } from '../../../shared/audit/AuditEvent.js'
import type {
  Database,
  DatabaseTransaction,
} from '../../../shared/db/Database.js'
import { toIdempotencyKey } from '../../../shared/idempotency/types.js'
import {
  requireCorrelationMetadata,
  type CorrelationMetadata,
} from '../../../shared/observability/correlation.js'
import type { OutboxRepository } from '../../../shared/outbox/OutboxRepository.js'
import type { Clock } from '../../../shared/time/Clock.js'
import type { FaultInjector } from '../../../shared/faults/FaultInjector.js'
import { AppError, isAppError } from '../../../shared/types/AppError.js'
import {
  isJsonValue,
  type JsonObject,
} from '../../../shared/types/Json.js'
import { Account } from '../../accounting/entities/Account.js'
import type { AccountRepository } from '../../accounting/repositories/AccountRepository.js'
import type { AuditEventRepository } from '../../accounting/repositories/AuditEventRepository.js'
import type { IdempotencyRepository } from '../../accounting/repositories/IdempotencyRepository.js'
import type { LedgerTransaction } from '../../accounting/entities/LedgerTransaction.js'
import { PostingEngineService } from '../../accounting/services/PostingEngineService.js'
import { IdempotencyService } from '../../accounting/services/IdempotencyService.js'
import {
  newAccountId,
  newAuditEventId,
  toOwnerId,
} from '../../accounting/types/identifiers.js'
import type { PlayerAccount } from '../../account/entities/PlayerAccount.js'
import type { PlayerAccountRepository } from '../../account/repositories/PlayerAccountRepository.js'
import { AccountActionAuthorizationService } from '../../account/restrictions/AccountActionAuthorizationService.js'
import { EffectiveStatusService } from '../../account/services/EffectiveStatusService.js'
import {
  PlayerAccountProvisioningService,
} from '../../account/services/PlayerAccountProvisioningService.js'
import { toUserId, type UserId } from '../../account/types/identifiers.js'
import type {
  DepositIntent,
} from '../entities/DepositIntent.js'
import type {
  ProviderDepositEvent,
  ProviderDepositEventStatus,
} from '../entities/ProviderDepositEvent.js'
import type {
  DepositReconciliationIssue,
  DepositRepository,
  DepositReviewItem,
} from '../repositories/DepositRepository.js'
import {
  newDepositEventId,
  newDepositIntentId,
  toDepositEventId,
  toDepositIntentId,
  type DepositIntentId,
} from '../types/depositIdentifiers.js'
import type {
  CreateDepositIntentCommandDto,
  ApproveProviderDepositCreditCommandDto,
  DepositIntentDto,
  DepositReconciliationReportDto,
  DepositReviewItemDto,
  GetDepositIntentCommandDto,
  IngestProviderDepositEventCommandDto,
  IngestProviderDepositEventResultDto,
  LinkProviderDepositEventCommandDto,
  MarkDepositReviewedNoCreditCommandDto,
  ProviderDepositEventDto,
  RejectProviderDepositEventCommandDto,
  ResolveProviderDepositEventResultDto,
} from '../dto/depositDtos.js'

const createDepositIntentCommandType = 'create_deposit_intent'
const ingestProviderDepositEventCommandType = 'ingest_provider_deposit_event'
const markDepositReviewedNoCreditCommandType =
  'mark_deposit_reviewed_no_credit'
const rejectProviderDepositEventCommandType = 'reject_provider_deposit_event'
const linkProviderDepositEventCommandType = 'link_provider_deposit_event'
const approveProviderDepositCreditCommandType =
  'approve_provider_deposit_credit'
const retryProviderDepositCreditCommandType = 'retry_provider_deposit_credit'
const canonicalCurrency = 'USDC'
const defaultIntentTtlMs = 24 * 60 * 60 * 1000
const overridableReviewReasonCodes = new Set([
  'DESTINATION_REFERENCE_MISMATCH',
  'CURRENCY_MISMATCH',
  'AMOUNT_MISMATCH',
  'DEPOSIT_INTENT_EXPIRED',
  'DEPOSIT_INTENT_NOT_CREDITABLE',
])
const elevatedDepositReviewRoles = new Set(['treasury_admin', 'financial_admin'])

interface DepositIntentSnapshot extends JsonObject {
  depositIntentId: string
}

interface ProviderEventSnapshot extends JsonObject {
  depositEventId: string
}

interface ReviewReason {
  code: string
  text: string
}

export class DepositService {
  private readonly idempotencyService: IdempotencyService

  constructor(
    private readonly database: Database,
    private readonly depositRepository: DepositRepository,
    private readonly idempotencyRepository: IdempotencyRepository,
    private readonly playerAccountRepository: PlayerAccountRepository,
    private readonly accountRepository: AccountRepository,
    private readonly auditEventRepository: AuditEventRepository,
    private readonly postingEngineService: PostingEngineService,
    private readonly playerAccountProvisioningService: PlayerAccountProvisioningService,
    private readonly effectiveStatusService: EffectiveStatusService,
    private readonly authorizationService: AccountActionAuthorizationService,
    private readonly outboxRepository: OutboxRepository,
    private readonly clock: Clock,
    private readonly faultInjector: FaultInjector,
  ) {
    this.idempotencyService = new IdempotencyService(
      this.idempotencyRepository,
      this.clock,
    )
  }

  async createDepositIntent(
    command: CreateDepositIntentCommandDto,
  ): Promise<DepositIntentDto> {
    const userId = toUserId(command.userId)
    const playerAccount =
      await this.playerAccountProvisioningService.provisionIfNeeded({
        idempotencyKey: toIdempotencyKey(
          `deposit-intent-provision-${command.idempotencyKey}`,
        ),
        userId,
        currency: command.currency,
        correlationId: command.correlationId,
        causationId: command.causationId,
      })
    const requestPayload: JsonObject = {
      userId: command.userId,
      currency: command.currency,
      expectedAmountMinor: command.expectedAmountMinor ?? null,
      provider: command.provider,
      providerKind: command.providerKind,
      expiresAt: command.expiresAt ?? null,
    }

    return this.database.tx(async (transaction) => {
      const decision = await this.idempotencyService.begin(
        createDepositIntentCommandType,
        toIdempotencyKey(command.idempotencyKey),
        requestPayload,
        transaction,
      )

      if (decision.kind === 'replay') {
        return this.getDepositIntentFromSnapshot(
          decision.record.responseSnapshot,
          userId,
          transaction,
        )
      }

      const now = this.clock.now()
      const depositIntentId = newDepositIntentId()
      const intent: DepositIntent = {
        depositIntentId,
        playerAccountId: playerAccount.playerAccountId,
        userId,
        currency: command.currency,
        expectedAmountMinor: command.expectedAmountMinor ?? null,
        provider: command.provider,
        providerKind: command.providerKind,
        destinationReference: `nines:${command.provider}:${depositIntentId}`,
        status: 'awaiting_external_payment',
        createdAt: now,
        updatedAt: now,
        expiresAt: command.expiresAt
          ? new Date(command.expiresAt)
          : new Date(now.getTime() + defaultIntentTtlMs),
        idempotencyKey: command.idempotencyKey,
        correlationId: command.correlationId,
        causationId: command.causationId,
        creditedLedgerTransactionId: null,
        reviewReasonCode: null,
        reviewReasonText: null,
      }

      await this.depositRepository.createIntent(intent, transaction)
      await this.appendAuditEvent(
        'financial.deposit.intent_created',
        'deposit_intent',
        intent.depositIntentId,
        {
          userId: intent.userId,
          playerAccountId: intent.playerAccountId,
          expectedAmountMinor: intent.expectedAmountMinor,
          provider: intent.provider,
          providerKind: intent.providerKind,
          destinationReference: intent.destinationReference,
          expiresAt: intent.expiresAt?.toISOString() ?? null,
        },
        command,
        now,
        transaction,
      )
      await this.appendOutboxEvent(
        'deposit_intent',
        intent.depositIntentId,
        'financial.deposit.intent_created',
        {
          depositIntentId: intent.depositIntentId,
          playerAccountId: intent.playerAccountId,
          userId: intent.userId,
          currency: intent.currency,
          expectedAmountMinor: intent.expectedAmountMinor,
          provider: intent.provider,
          providerKind: intent.providerKind,
          destinationReference: intent.destinationReference,
          status: intent.status,
          expiresAt: intent.expiresAt?.toISOString() ?? null,
        },
        command,
        now,
        transaction,
      )
      await this.idempotencyService.complete(
        createDepositIntentCommandType,
        toIdempotencyKey(command.idempotencyKey),
        requestPayload,
        { depositIntentId: intent.depositIntentId } satisfies DepositIntentSnapshot,
        transaction,
      )

      return this.toDepositIntentDto(intent)
    })
  }

  async getDepositIntent(
    command: GetDepositIntentCommandDto,
  ): Promise<DepositIntentDto> {
    const intent = await this.depositRepository.getIntentById(
      toDepositIntentId(command.depositIntentId),
    )

    if (!intent) {
      throw new AppError({
        category: 'not_found',
        code: 'DEPOSIT_INTENT_NOT_FOUND',
        message: 'Deposit intent was not found',
        details: { depositIntentId: command.depositIntentId },
      })
    }

    if (intent.userId !== command.userId) {
      throw new AppError({
        category: 'forbidden',
        code: 'DEPOSIT_INTENT_FORBIDDEN',
        message: 'Deposit intent does not belong to the authenticated user',
      })
    }

    return this.toDepositIntentDto(intent)
  }

  async ingestProviderDepositEvent(
    command: IngestProviderDepositEventCommandDto,
  ): Promise<IngestProviderDepositEventResultDto> {
    const confirmed =
      command.confirmed ?? (command.confirmationCount ?? 0) > 0
    const requestPayload: JsonObject = {
      providerEventId: command.providerEventId,
      provider: command.provider,
      externalTransactionId: command.externalTransactionId,
      depositIntentId: command.depositIntentId ?? null,
      destinationReference: command.destinationReference ?? null,
      amountMinor: command.amountMinor,
      currency: command.currency,
      confirmationCount: command.confirmationCount ?? null,
      confirmed,
      rawPayload: this.sanitizeRawPayload(command.rawPayload),
      providerWebhookNonce: command.providerWebhookNonce ?? null,
      providerWebhookTimestamp: command.providerWebhookTimestamp ?? null,
      providerWebhookRequestHash: command.providerWebhookRequestHash ?? null,
    }

    try {
      return await this.database.tx(async (transaction) => {
      await this.persistWebhookReceiptIfPresent(command, transaction)

      const decision = await this.idempotencyService.begin(
        ingestProviderDepositEventCommandType,
        toIdempotencyKey(command.idempotencyKey),
        requestPayload,
        transaction,
      )

      if (decision.kind === 'replay') {
        return this.getProviderEventResultFromSnapshot(
          decision.record.responseSnapshot,
          transaction,
        )
      }

      const existingProviderEvent =
        await this.depositRepository.getEventByProviderEventId(
          command.provider,
          command.providerEventId,
          transaction,
        )

      if (existingProviderEvent) {
        const providerEventForRetry = confirmed
          ? {
              ...existingProviderEvent,
              confirmed: true,
              confirmationCount:
                command.confirmationCount ??
                existingProviderEvent.confirmationCount,
            }
          : existingProviderEvent
        const resultEvent =
          confirmed &&
          (providerEventForRetry.status === 'received' ||
            providerEventForRetry.status === 'awaiting_confirmation')
            ? await this.handleConfirmedEvent(
                providerEventForRetry,
                command,
                transaction,
              )
            : providerEventForRetry

        await this.idempotencyService.complete(
          ingestProviderDepositEventCommandType,
          toIdempotencyKey(command.idempotencyKey),
          requestPayload,
          {
            depositEventId: resultEvent.depositEventId,
          } satisfies ProviderEventSnapshot,
          transaction,
        )

        return this.toProviderEventResult(resultEvent, transaction)
      }

      const now = this.clock.now()
      const existingCreditedExternalTransaction =
        await this.depositRepository.getCreditedEventByExternalTransactionId(
          command.provider,
          command.externalTransactionId,
          transaction,
        )
      const event: ProviderDepositEvent = {
        depositEventId: newDepositEventId(),
        providerEventId: command.providerEventId,
        provider: command.provider,
        externalTransactionId: command.externalTransactionId,
        depositIntentId: command.depositIntentId
          ? toDepositIntentId(command.depositIntentId)
          : null,
        destinationReference: command.destinationReference ?? null,
        amountMinor: command.amountMinor,
        currency: command.currency,
        confirmationCount: command.confirmationCount ?? null,
        confirmed,
        status: 'received',
        reviewReasonCode: null,
        reviewReasonText: null,
        rawPayload: this.sanitizeRawPayload(command.rawPayload),
        receivedAt: now,
        updatedAt: now,
        ledgerTransactionId: null,
        idempotencyKey: command.idempotencyKey,
        correlationId: command.correlationId,
        causationId: command.causationId,
      }

      if (existingCreditedExternalTransaction) {
        const sameIntent =
          command.depositIntentId !== undefined &&
          existingCreditedExternalTransaction.depositIntentId ===
            command.depositIntentId
        const duplicateEvent = this.updateEventStatus(event, {
          status: sameIntent ? 'duplicate' : 'review_required',
          reason: {
            code: 'DUPLICATE_EXTERNAL_TRANSACTION',
            text: sameIntent
              ? 'External transaction has already been credited'
              : 'External transaction was already credited to a different deposit intent',
          },
          now,
        })
        duplicateEvent.depositIntentId =
          existingCreditedExternalTransaction.depositIntentId
        await this.depositRepository.createEvent(duplicateEvent, transaction)
        await this.completeProviderEventCommand(
          command,
          requestPayload,
          duplicateEvent,
          transaction,
        )

        return this.toProviderEventResult(duplicateEvent, transaction)
      }

      await this.depositRepository.createEvent(event, transaction)
      await this.faultInjector.trigger('deposit.after_event_record_before_credit', {
        depositEventId: event.depositEventId,
        provider: event.provider,
        externalTransactionId: event.externalTransactionId,
      })

      const resultEvent = confirmed
        ? await this.handleConfirmedEvent(event, command, transaction)
        : await this.handleUnconfirmedEvent(event, command, transaction)

      await this.completeProviderEventCommand(
        command,
        requestPayload,
        resultEvent,
        transaction,
      )

      return this.toProviderEventResult(resultEvent, transaction)
      })
    } catch (error) {
      if (
        command.providerWebhookNonce &&
        isAppError(error) &&
        error.code === 'DEPOSIT_WEBHOOK_NONCE_REPLAYED'
      ) {
        await this.recordWebhookReplayRejection(command)
        throw error
      }

      const recovered = await this.recoverDuplicateDepositCredit(error, command)

      if (recovered) {
        return recovered
      }

      throw error
    }
  }

  async listReviewItems(): Promise<DepositReviewItemDto[]> {
    const items = await this.depositRepository.listReviewItems()
    return items.map((item) => this.toReviewItemDto(item))
  }

  private async persistWebhookReceiptIfPresent(
    command: IngestProviderDepositEventCommandDto,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    if (
      !command.providerWebhookNonce ||
      !command.providerWebhookTimestamp ||
      !command.providerWebhookRequestHash
    ) {
      return
    }

    try {
      await this.depositRepository.createWebhookReceipt(
        {
          provider: command.provider,
          nonce: command.providerWebhookNonce,
          providerTimestamp: parseProviderWebhookTimestamp(
            command.providerWebhookTimestamp,
          ),
          receivedAt: this.clock.now(),
          requestHash: command.providerWebhookRequestHash,
        },
        transaction,
      )
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error
      }

      throw new AppError({
        category: 'forbidden',
        code: 'DEPOSIT_WEBHOOK_NONCE_REPLAYED',
        message: 'Deposit provider webhook nonce has already been accepted',
        details: {
          provider: command.provider,
          nonce: command.providerWebhookNonce,
        },
      })
    }
  }

  private async recordWebhookReplayRejection(
    command: IngestProviderDepositEventCommandDto,
  ): Promise<void> {
    if (
      !command.providerWebhookNonce ||
      !command.providerWebhookTimestamp ||
      !command.providerWebhookRequestHash
    ) {
      return
    }

    await this.database.tx((transaction) =>
      this.depositRepository.recordWebhookReplayRejection(
        {
          provider: command.provider,
          nonce: command.providerWebhookNonce!,
          providerTimestamp: parseProviderWebhookTimestamp(
            command.providerWebhookTimestamp!,
          ),
          receivedAt: this.clock.now(),
          requestHash: command.providerWebhookRequestHash!,
          rejectedReason: 'duplicate_nonce',
        },
        transaction,
      ),
    )
  }

  async detectReconciliation(): Promise<DepositReconciliationReportDto> {
    const checkedAt = this.clock.now()
    const issues = await this.depositRepository.detectReconciliationIssues(
      checkedAt,
    )
    const incidentCount = issues.filter(
      (issue) => issue.severity === 'incident',
    ).length
    const warningCount = issues.filter(
      (issue) => issue.severity === 'warning',
    ).length
    const infoCount = issues.filter((issue) => issue.severity === 'info').length

    return {
      checkedAt: checkedAt.toISOString(),
      issueCount: issues.length,
      incidentCount,
      warningCount,
      infoCount,
      issues: issues.map((issue) => this.toIssueDto(issue)),
    }
  }

  async markReviewedNoCredit(
    command: MarkDepositReviewedNoCreditCommandDto,
  ): Promise<ResolveProviderDepositEventResultDto> {
    const requestPayload = this.reviewCommandPayload(command)

    return this.database.tx(async (transaction) => {
      const decision = await this.idempotencyService.begin(
        markDepositReviewedNoCreditCommandType,
        toIdempotencyKey(command.idempotencyKey),
        requestPayload,
        transaction,
      )

      if (decision.kind === 'replay') {
        return this.getProviderEventResultFromSnapshot(
          decision.record.responseSnapshot,
          transaction,
        )
      }

      const event = await this.requireProviderEvent(
        command.depositEventId,
        transaction,
      )
      this.assertReviewResolutionAllowed(event)
      const now = this.clock.now()
      const updatedEvent = this.updateEventStatus(event, {
        status: 'reviewed_no_credit',
        reason: {
          code: command.reasonCode,
          text: command.reasonText,
        },
        now,
      })

      await this.depositRepository.updateEvent(updatedEvent, transaction)
      await this.appendAuditEvent(
        'financial.deposit.provider_event_reviewed_no_credit',
        'provider_deposit_event',
        updatedEvent.depositEventId,
        {
          action: 'mark_reviewed_no_credit',
          operatorUserId: command.operatorId,
          operatorRole: command.operatorRole,
          provider: updatedEvent.provider,
          externalTransactionId: updatedEvent.externalTransactionId,
          previousStatus: event.status,
          newStatus: updatedEvent.status,
          depositEventId: updatedEvent.depositEventId,
          depositIntentId: updatedEvent.depositIntentId,
          reasonCode: command.reasonCode,
          reason: command.reasonText,
          overrideReason: null,
        },
        command,
        now,
        transaction,
      )
      await this.completeProviderEventCommandForType(
        markDepositReviewedNoCreditCommandType,
        command,
        requestPayload,
        updatedEvent,
        transaction,
      )

      return this.toProviderEventResult(updatedEvent, transaction)
    })
  }

  async rejectProviderEvent(
    command: RejectProviderDepositEventCommandDto,
  ): Promise<ResolveProviderDepositEventResultDto> {
    const requestPayload = this.reviewCommandPayload(command)

    return this.database.tx(async (transaction) => {
      const decision = await this.idempotencyService.begin(
        rejectProviderDepositEventCommandType,
        toIdempotencyKey(command.idempotencyKey),
        requestPayload,
        transaction,
      )

      if (decision.kind === 'replay') {
        return this.getProviderEventResultFromSnapshot(
          decision.record.responseSnapshot,
          transaction,
        )
      }

      const event = await this.requireProviderEvent(
        command.depositEventId,
        transaction,
      )
      this.assertReviewResolutionAllowed(event)
      const now = this.clock.now()
      const updatedEvent = this.updateEventStatus(event, {
        status: 'rejected',
        reason: {
          code: command.reasonCode,
          text: command.reasonText,
        },
        now,
      })

      await this.depositRepository.updateEvent(updatedEvent, transaction)
      await this.appendAuditEvent(
        'financial.deposit.provider_event_rejected',
        'provider_deposit_event',
        updatedEvent.depositEventId,
        {
          action: 'reject',
          operatorUserId: command.operatorId,
          operatorRole: command.operatorRole,
          provider: updatedEvent.provider,
          externalTransactionId: updatedEvent.externalTransactionId,
          previousStatus: event.status,
          newStatus: updatedEvent.status,
          depositEventId: updatedEvent.depositEventId,
          depositIntentId: updatedEvent.depositIntentId,
          reasonCode: command.reasonCode,
          reason: command.reasonText,
          overrideReason: null,
        },
        command,
        now,
        transaction,
      )
      await this.completeProviderEventCommandForType(
        rejectProviderDepositEventCommandType,
        command,
        requestPayload,
        updatedEvent,
        transaction,
      )

      return this.toProviderEventResult(updatedEvent, transaction)
    })
  }

  async linkProviderEventToIntent(
    command: LinkProviderDepositEventCommandDto,
  ): Promise<ResolveProviderDepositEventResultDto> {
    const requestPayload: JsonObject = {
      depositEventId: command.depositEventId,
      depositIntentId: command.depositIntentId,
      operatorId: command.operatorId,
      operatorRole: command.operatorRole,
      overrideReason: command.overrideReason ?? null,
    }

    return this.database.tx(async (transaction) => {
      const decision = await this.idempotencyService.begin(
        linkProviderDepositEventCommandType,
        toIdempotencyKey(command.idempotencyKey),
        requestPayload,
        transaction,
      )

      if (decision.kind === 'replay') {
        return this.getProviderEventResultFromSnapshot(
          decision.record.responseSnapshot,
          transaction,
        )
      }

      const event = await this.requireProviderEvent(
        command.depositEventId,
        transaction,
      )
      this.assertReviewResolutionAllowed(event)
      const intent = await this.requireDepositIntent(
        command.depositIntentId,
        transaction,
      )
      const validationReason = await this.validateManualLink(
        intent,
        event,
        transaction,
      )

      if (command.overrideReason) {
        this.assertElevatedDepositReviewRole(command.operatorRole, {
          action: 'manual_link_override',
        })
      }

      if (validationReason && !command.overrideReason) {
        throw new AppError({
          category: 'validation_error',
          code: 'DEPOSIT_REVIEW_OVERRIDE_REASON_REQUIRED',
          message:
            'Manual deposit link requires an override reason for the detected mismatch',
          details: {
            reasonCode: validationReason.code,
            depositEventId: event.depositEventId,
            depositIntentId: intent.depositIntentId,
          },
        })
      }

      const now = this.clock.now()
      const linkedEvent = this.updateEventStatus(
        {
          ...event,
          depositIntentId: intent.depositIntentId,
          destinationReference: intent.destinationReference,
        },
        {
          status: 'review_required',
          reason: {
            code: validationReason
              ? 'MANUAL_LINK_REQUIRES_APPROVAL_WITH_OVERRIDE'
              : 'MANUAL_LINK_REQUIRES_APPROVAL',
            text: command.overrideReason
              ? `Manually linked by ${command.operatorId}: ${command.overrideReason}`
              : `Manually linked by ${command.operatorId}; approval still required`,
          },
          now,
        },
      )
      const reviewedIntent: DepositIntent = {
        ...intent,
        status:
          intent.status === 'credited' ? intent.status : 'review_required',
        updatedAt: now,
        reviewReasonCode:
          intent.status === 'credited'
            ? intent.reviewReasonCode
            : 'PROVIDER_EVENT_MANUALLY_LINKED',
        reviewReasonText:
          intent.status === 'credited'
            ? intent.reviewReasonText
            : `Provider event ${event.depositEventId} was manually linked for operator approval`,
      }

      await this.depositRepository.updateEvent(linkedEvent, transaction)
      if (intent.status !== 'credited') {
        await this.depositRepository.updateIntent(reviewedIntent, transaction)
      }
      await this.appendAuditEvent(
        'financial.deposit.provider_event_manually_linked',
        'provider_deposit_event',
        linkedEvent.depositEventId,
        {
          action: 'manual_link',
          operatorUserId: command.operatorId,
          operatorRole: command.operatorRole,
          depositIntentId: intent.depositIntentId,
          depositEventId: linkedEvent.depositEventId,
          previousStatus: event.status,
          newStatus: linkedEvent.status,
          reason: 'Provider event manually linked to a deposit intent',
          overrideReason: command.overrideReason ?? null,
          validationReasonCode: validationReason?.code ?? null,
        },
        command,
        now,
        transaction,
      )
      await this.completeProviderEventCommandForType(
        linkProviderDepositEventCommandType,
        command,
        requestPayload,
        linkedEvent,
        transaction,
      )

      return this.toProviderEventResult(linkedEvent, transaction)
    })
  }

  async approveProviderEventCredit(
    command: ApproveProviderDepositCreditCommandDto,
  ): Promise<ResolveProviderDepositEventResultDto> {
    const requestPayload: JsonObject = {
      depositEventId: command.depositEventId,
      operatorId: command.operatorId,
      operatorRole: command.operatorRole,
      overrideReason: command.overrideReason ?? null,
    }

    try {
      return await this.database.tx(async (transaction) => {
        const decision = await this.idempotencyService.begin(
          approveProviderDepositCreditCommandType,
          toIdempotencyKey(command.idempotencyKey),
          requestPayload,
          transaction,
        )

        if (decision.kind === 'replay') {
          return this.getProviderEventResultFromSnapshot(
            decision.record.responseSnapshot,
            transaction,
          )
        }

        this.assertElevatedDepositReviewRole(command.operatorRole, {
          action: 'approve_credit',
        })

        const event = await this.requireProviderEvent(
          command.depositEventId,
          transaction,
        )

        if (event.status === 'credited') {
          await this.completeProviderEventCommandForType(
            approveProviderDepositCreditCommandType,
            command,
            requestPayload,
            event,
            transaction,
          )
          return this.toProviderEventResult(event, transaction)
        }

        this.assertCreditApprovalAllowed(event)

        if (!event.confirmed) {
          throw new AppError({
            category: 'conflict',
            code: 'DEPOSIT_PROVIDER_EVENT_NOT_CONFIRMED',
            message:
              'Provider event must be confirmed before operator credit approval',
            details: { depositEventId: event.depositEventId },
          })
        }

        const intent = event.depositIntentId
          ? await this.depositRepository.getIntentById(
              event.depositIntentId,
              transaction,
            )
          : null

        if (!intent) {
          throw new AppError({
            category: 'conflict',
            code: 'DEPOSIT_REVIEW_EVENT_NOT_LINKED',
            message:
              'Provider event must be linked to a deposit intent before approval',
            details: { depositEventId: event.depositEventId },
          })
        }

        const validationReason = await this.validateCreditableIntent(
          intent,
          event,
          transaction,
          { allowReviewIntent: true },
        )

        if (validationReason) {
          if (
            !command.overrideReason ||
            !overridableReviewReasonCodes.has(validationReason.code)
          ) {
            throw new AppError({
              category: 'validation_error',
              code: 'DEPOSIT_REVIEW_OVERRIDE_REASON_REQUIRED',
              message:
                'Deposit credit approval requires an override reason for the detected mismatch',
              details: {
                reasonCode: validationReason.code,
                depositEventId: event.depositEventId,
                depositIntentId: intent.depositIntentId,
              },
            })
          }
        }

        const creditedEvent = await this.creditIntentForEvent(
          event,
          intent,
          command,
          transaction,
        )
        await this.appendAuditEvent(
          'financial.deposit.provider_event_credit_approved',
          'provider_deposit_event',
          creditedEvent.depositEventId,
          {
            action: 'approve_credit',
            operatorUserId: command.operatorId,
            operatorRole: command.operatorRole,
            depositIntentId: intent.depositIntentId,
            depositEventId: creditedEvent.depositEventId,
            previousStatus: event.status,
            newStatus: creditedEvent.status,
            reason: 'Operator approved provider deposit credit',
            overrideReason: command.overrideReason ?? null,
            validationReasonCode: validationReason?.code ?? null,
            ledgerTransactionId: creditedEvent.ledgerTransactionId,
          },
          command,
          this.clock.now(),
          transaction,
        )
        await this.completeProviderEventCommandForType(
          approveProviderDepositCreditCommandType,
          command,
          requestPayload,
          creditedEvent,
          transaction,
        )

        return this.toProviderEventResult(creditedEvent, transaction)
      })
    } catch (error) {
      const recovered = await this.recoverDuplicateDepositCredit(
        error,
        command,
      )

      if (recovered) {
        return recovered
      }

      throw error
    }
  }

  async retryProviderEventCredit(
    command: ApproveProviderDepositCreditCommandDto,
  ): Promise<ResolveProviderDepositEventResultDto> {
    const requestPayload: JsonObject = {
      depositEventId: command.depositEventId,
      operatorId: command.operatorId,
      operatorRole: command.operatorRole,
      overrideReason: command.overrideReason ?? null,
    }

    try {
      return await this.database.tx(async (transaction) => {
        const decision = await this.idempotencyService.begin(
          retryProviderDepositCreditCommandType,
          toIdempotencyKey(command.idempotencyKey),
          requestPayload,
          transaction,
        )

        if (decision.kind === 'replay') {
          return this.getProviderEventResultFromSnapshot(
            decision.record.responseSnapshot,
            transaction,
          )
        }

        const event = await this.requireProviderEvent(
          command.depositEventId,
          transaction,
        )

        if (event.status === 'credited') {
          await this.appendAuditEvent(
            'financial.deposit.provider_event_credit_retry',
            'provider_deposit_event',
            event.depositEventId,
            {
              action: 'retry_credit',
              operatorUserId: command.operatorId,
              operatorRole: command.operatorRole,
              depositIntentId: event.depositIntentId,
              depositEventId: event.depositEventId,
              previousStatus: event.status,
              newStatus: event.status,
              reason: 'Operator retried deposit credit after it was already credited',
              overrideReason: command.overrideReason ?? null,
              ledgerTransactionId: event.ledgerTransactionId,
            },
            command,
            this.clock.now(),
            transaction,
          )
          await this.completeProviderEventCommandForType(
            retryProviderDepositCreditCommandType,
            command,
            requestPayload,
            event,
            transaction,
          )
          return this.toProviderEventResult(event, transaction)
        }

        this.assertCreditApprovalAllowed(event)

        if (!event.confirmed) {
          throw new AppError({
            category: 'conflict',
            code: 'DEPOSIT_PROVIDER_EVENT_NOT_CONFIRMED',
            message:
              'Provider event must be confirmed before operator credit retry',
            details: { depositEventId: event.depositEventId },
          })
        }

        const intent = event.depositIntentId
          ? await this.depositRepository.getIntentById(
              event.depositIntentId,
              transaction,
            )
          : null

        if (!intent) {
          throw new AppError({
            category: 'conflict',
            code: 'DEPOSIT_REVIEW_EVENT_NOT_LINKED',
            message:
              'Provider event must be linked to a deposit intent before credit retry',
            details: { depositEventId: event.depositEventId },
          })
        }

        const validationReason = await this.validateCreditableIntent(
          intent,
          event,
          transaction,
          { allowReviewIntent: true },
        )

        if (validationReason) {
          if (
            !command.overrideReason ||
            !overridableReviewReasonCodes.has(validationReason.code)
          ) {
            throw new AppError({
              category: 'validation_error',
              code: 'DEPOSIT_REVIEW_OVERRIDE_REASON_REQUIRED',
              message:
                'Deposit credit retry requires an override reason for the detected mismatch',
              details: {
                reasonCode: validationReason.code,
                depositEventId: event.depositEventId,
                depositIntentId: intent.depositIntentId,
              },
            })
          }

          this.assertElevatedDepositReviewRole(command.operatorRole, {
            action: 'retry_credit_override',
          })
        }

        const creditedEvent = await this.creditIntentForEvent(
          event,
          intent,
          command,
          transaction,
        )
        await this.appendAuditEvent(
          'financial.deposit.provider_event_credit_retry',
          'provider_deposit_event',
          creditedEvent.depositEventId,
          {
            action: 'retry_credit',
            operatorUserId: command.operatorId,
            operatorRole: command.operatorRole,
            depositIntentId: intent.depositIntentId,
            depositEventId: creditedEvent.depositEventId,
            previousStatus: event.status,
            newStatus: creditedEvent.status,
            reason: 'Operator retried provider deposit credit',
            overrideReason: command.overrideReason ?? null,
            validationReasonCode: validationReason?.code ?? null,
            ledgerTransactionId: creditedEvent.ledgerTransactionId,
          },
          command,
          this.clock.now(),
          transaction,
        )
        await this.completeProviderEventCommandForType(
          retryProviderDepositCreditCommandType,
          command,
          requestPayload,
          creditedEvent,
          transaction,
        )

        return this.toProviderEventResult(creditedEvent, transaction)
      })
    } catch (error) {
      const recovered = await this.recoverDuplicateDepositCredit(
        error,
        command,
      )

      if (recovered) {
        return recovered
      }

      throw error
    }
  }

  private async handleUnconfirmedEvent(
    event: ProviderDepositEvent,
    command: IngestProviderDepositEventCommandDto,
    transaction: DatabaseTransaction,
  ): Promise<ProviderDepositEvent> {
    const now = this.clock.now()
    const intent = await this.resolveMatchingIntent(event, transaction)
    const updatedEvent = {
      ...event,
      depositIntentId: intent?.depositIntentId ?? event.depositIntentId,
      status: 'awaiting_confirmation' as ProviderDepositEventStatus,
      updatedAt: now,
    }

    await this.depositRepository.updateEvent(updatedEvent, transaction)

    if (
      intent &&
      (intent.status === 'created' ||
        intent.status === 'awaiting_external_payment')
    ) {
      await this.depositRepository.updateIntent(
        {
          ...intent,
          status: 'detected',
          updatedAt: now,
        },
        transaction,
      )
    }

    await this.appendAuditEvent(
      'financial.deposit.provider_event_awaiting_confirmation',
      'provider_deposit_event',
      updatedEvent.depositEventId,
      {
        provider: updatedEvent.provider,
        providerEventId: updatedEvent.providerEventId,
        externalTransactionId: updatedEvent.externalTransactionId,
        depositIntentId: updatedEvent.depositIntentId,
      },
      command,
      now,
      transaction,
    )

    return updatedEvent
  }

  private async handleConfirmedEvent(
    event: ProviderDepositEvent,
    command: IngestProviderDepositEventCommandDto,
    transaction: DatabaseTransaction,
  ): Promise<ProviderDepositEvent> {
    const now = this.clock.now()
    const intent = await this.resolveMatchingIntent(event, transaction)

    if (!intent) {
      return this.markEventForReview(
        event,
        {
          code: 'NO_MATCHING_DEPOSIT_INTENT',
          text: 'Confirmed provider event could not be matched to a deposit intent',
        },
        command,
        transaction,
      )
    }

    const validationReason = await this.validateCreditableIntent(
      intent,
      event,
      transaction,
      { allowReviewIntent: false },
    )

    if (validationReason) {
      const reviewedEvent = await this.markEventForReview(
        { ...event, depositIntentId: intent.depositIntentId },
        validationReason,
        command,
        transaction,
      )
      await this.markIntentForReview(
        intent,
        validationReason,
        command,
        transaction,
      )

      return reviewedEvent
    }

    return this.creditIntentForEvent(
      { ...event, depositIntentId: intent.depositIntentId },
      intent,
      command,
      transaction,
    )
  }

  private async creditIntentForEvent(
    event: ProviderDepositEvent,
    intent: DepositIntent,
    command: CorrelationMetadata,
    transaction: DatabaseTransaction,
  ): Promise<ProviderDepositEvent> {
    const now = this.clock.now()

    try {
      await this.assertDepositCreditAuthorized(intent, transaction)
    } catch (error) {
      if (!isAppError(error)) {
        throw error
      }

      const reason = {
        code: 'DEPOSIT_CREDIT_BLOCKED',
        text: error.message,
      }
      const reviewedEvent = await this.markEventForReview(
        { ...event, depositIntentId: intent.depositIntentId },
        reason,
        command,
        transaction,
      )
      await this.markIntentForReview(intent, reason, command, transaction)

      return reviewedEvent
    }

    const playerAccount = await this.requirePlayerAccount(
      intent.playerAccountId,
      transaction,
    )
    const clearingAccount = await this.ensureDepositClearingAccount(
      event.provider,
      event.currency,
      command,
      transaction,
    )
    const ledgerTransaction =
      await this.postingEngineService.postTransferWithinTransaction(
        {
          idempotencyKey: toIdempotencyKey(
            `deposit-credit-${event.provider}-${event.externalTransactionId}`,
          ),
          transactionType: 'deposit_confirmed_credit',
          referenceType: 'deposit',
          referenceId: intent.depositIntentId,
          debitAccountId: clearingAccount.accountId,
          creditAccountId: playerAccount.availableAccountId,
          amountMinor: event.amountMinor,
          currency: event.currency,
          correlationId: command.correlationId,
          causationId: command.causationId,
        },
        transaction,
      )

    await this.faultInjector.trigger(
      'deposit.after_ledger_posting_before_state_finalization',
      {
        depositEventId: event.depositEventId,
        depositIntentId: intent.depositIntentId,
        ledgerTransactionId: ledgerTransaction.transactionId,
      },
    )

    const creditedEvent: ProviderDepositEvent = {
      ...event,
      depositIntentId: intent.depositIntentId,
      status: 'credited',
      updatedAt: now,
      ledgerTransactionId: ledgerTransaction.transactionId,
    }
    const creditedIntent: DepositIntent = {
      ...intent,
      status: 'credited',
      updatedAt: now,
      creditedLedgerTransactionId: ledgerTransaction.transactionId,
      reviewReasonCode: null,
      reviewReasonText: null,
    }

    await this.depositRepository.updateEvent(creditedEvent, transaction)
    await this.depositRepository.updateIntent(creditedIntent, transaction)
    await this.appendDepositCreditedAuditAndOutbox(
      creditedIntent,
      creditedEvent,
      ledgerTransaction,
      command,
      now,
      transaction,
    )

    return creditedEvent
  }

  private async resolveMatchingIntent(
    event: ProviderDepositEvent,
    transaction: DatabaseTransaction,
  ): Promise<DepositIntent | null> {
    if (event.depositIntentId) {
      return this.depositRepository.getIntentById(
        event.depositIntentId,
        transaction,
      )
    }

    if (event.destinationReference) {
      return this.depositRepository.findIntentByDestination(
        event.provider,
        event.destinationReference,
        transaction,
      )
    }

    return null
  }

  private async validateCreditableIntent(
    intent: DepositIntent,
    event: ProviderDepositEvent,
    transaction: DatabaseTransaction,
    options: {
      allowReviewIntent: boolean
    },
  ): Promise<ReviewReason | null> {
    if (intent.provider !== event.provider) {
      return {
        code: 'PROVIDER_MISMATCH',
        text: 'Provider event provider does not match the deposit intent provider',
      }
    }

    if (
      event.destinationReference &&
      event.destinationReference !== intent.destinationReference
    ) {
      return {
        code: 'DESTINATION_REFERENCE_MISMATCH',
        text: 'Provider event destination does not match the deposit intent destination',
      }
    }

    if (intent.currency !== event.currency || event.currency !== canonicalCurrency) {
      return {
        code: 'CURRENCY_MISMATCH',
        text: 'Provider event currency does not match the deposit intent currency',
      }
    }

    if (
      intent.expectedAmountMinor !== null &&
      intent.expectedAmountMinor !== event.amountMinor
    ) {
      return {
        code: 'AMOUNT_MISMATCH',
        text: 'Provider event amount does not match the deposit intent expected amount',
      }
    }

    if (intent.expiresAt && intent.expiresAt.getTime() < this.clock.now().getTime()) {
      return {
        code: 'DEPOSIT_INTENT_EXPIRED',
        text: 'Confirmed provider event arrived after the deposit intent expired',
      }
    }

    if (intent.status === 'credited') {
      return {
        code: 'DEPOSIT_INTENT_ALREADY_CREDITED',
        text: 'Deposit intent has already been credited',
      }
    }

    if (
      intent.status === 'cancelled' ||
      intent.status === 'failed' ||
      (intent.status === 'review_required' && !options.allowReviewIntent)
    ) {
      return {
        code: 'DEPOSIT_INTENT_NOT_CREDITABLE',
        text: 'Deposit intent is not in a creditable state',
      }
    }

    const creditedExternalTransaction =
      await this.depositRepository.getCreditedEventByExternalTransactionId(
        event.provider,
        event.externalTransactionId,
        transaction,
      )

    if (creditedExternalTransaction) {
      return {
        code: 'DUPLICATE_EXTERNAL_TRANSACTION',
        text: 'External transaction has already been credited',
      }
    }

    return null
  }

  private async assertDepositCreditAuthorized(
    intent: DepositIntent,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    const playerAccount = await this.requirePlayerAccount(
      intent.playerAccountId,
      transaction,
    )
    const [statusSnapshot, linkedAvailableAccount] = await Promise.all([
      this.effectiveStatusService.getSnapshot(
        intent.playerAccountId,
        this.clock.now(),
        transaction,
      ),
      this.accountRepository.getById(playerAccount.availableAccountId, transaction),
    ])

    this.authorizationService.assertAuthorized({
      action: 'deposit_credit',
      actorRole: 'player',
      effectiveStatus: statusSnapshot.effectiveStatus,
      controlState: statusSnapshot.controlState,
      linkedCoreAccountId: playerAccount.availableAccountId,
      accountingCorePermitsAction: linkedAvailableAccount?.status === 'active',
    })
  }

  private async requirePlayerAccount(
    playerAccountId: PlayerAccount['playerAccountId'],
    transaction: DatabaseTransaction,
  ): Promise<PlayerAccount> {
    const playerAccount = await this.playerAccountRepository.getById(
      playerAccountId,
      transaction,
    )

    if (!playerAccount) {
      throw new AppError({
        category: 'not_found',
        code: 'PLAYER_ACCOUNT_NOT_FOUND',
        message: 'Player account for deposit intent was not found',
        details: { playerAccountId },
      })
    }

    return playerAccount
  }

  private async ensureDepositClearingAccount(
    provider: string,
    currency: string,
    command: CorrelationMetadata,
    transaction: DatabaseTransaction,
  ): Promise<Account> {
    const ownerId = toOwnerId(`deposit-provider:${provider}`)
    const existingAccount = await this.accountRepository.findByOwnerAndType(
      {
        accountType: 'deposit_clearing',
        ownerType: 'platform',
        ownerId,
        currency,
      },
      transaction,
    )

    if (existingAccount) {
      return existingAccount
    }

    const now = this.clock.now()
    const account = new Account({
      accountId: newAccountId(),
      accountType: 'deposit_clearing',
      ownerType: 'platform',
      ownerId,
      currency,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })

    await this.accountRepository.create(account, transaction)
    await this.appendAuditEvent(
      'financial.deposit.clearing_account_created',
      'account',
      account.accountId,
      {
        accountType: account.accountType,
        ownerType: account.ownerType,
        ownerId: account.ownerId,
        currency: account.currency,
        provider,
      },
      command,
      now,
      transaction,
    )

    return account
  }

  private async markEventForReview(
    event: ProviderDepositEvent,
    reason: ReviewReason,
    command: CorrelationMetadata,
    transaction: DatabaseTransaction,
  ): Promise<ProviderDepositEvent> {
    const now = this.clock.now()
    const reviewedEvent = this.updateEventStatus(event, {
      status: 'review_required',
      reason,
      now,
    })

    await this.depositRepository.updateEvent(reviewedEvent, transaction)
    await this.appendAuditEvent(
      'financial.deposit.provider_event_review_required',
      'provider_deposit_event',
      reviewedEvent.depositEventId,
      {
        provider: reviewedEvent.provider,
        providerEventId: reviewedEvent.providerEventId,
        externalTransactionId: reviewedEvent.externalTransactionId,
        depositIntentId: reviewedEvent.depositIntentId,
        reasonCode: reason.code,
        reasonText: reason.text,
      },
      command,
      now,
      transaction,
    )

    return reviewedEvent
  }

  private async markIntentForReview(
    intent: DepositIntent,
    reason: ReviewReason,
    command: CorrelationMetadata,
    transaction: DatabaseTransaction,
  ): Promise<DepositIntent> {
    const now = this.clock.now()
    const reviewedIntent: DepositIntent = {
      ...intent,
      status: 'review_required',
      updatedAt: now,
      reviewReasonCode: reason.code,
      reviewReasonText: reason.text,
    }

    await this.depositRepository.updateIntent(reviewedIntent, transaction)
    await this.appendAuditEvent(
      'financial.deposit.intent_review_required',
      'deposit_intent',
      intent.depositIntentId,
      {
        provider: intent.provider,
        destinationReference: intent.destinationReference,
        reasonCode: reason.code,
        reasonText: reason.text,
      },
      command,
      now,
      transaction,
    )

    return reviewedIntent
  }

  private updateEventStatus(
    event: ProviderDepositEvent,
    input: {
      status: ProviderDepositEventStatus
      reason?: ReviewReason
      now: Date
    },
  ): ProviderDepositEvent {
    return {
      ...event,
      status: input.status,
      updatedAt: input.now,
      reviewReasonCode: input.reason?.code ?? event.reviewReasonCode,
      reviewReasonText: input.reason?.text ?? event.reviewReasonText,
    }
  }

  private async completeProviderEventCommand(
    command: IngestProviderDepositEventCommandDto,
    requestPayload: JsonObject,
    event: ProviderDepositEvent,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    await this.completeProviderEventCommandForType(
      ingestProviderDepositEventCommandType,
      command,
      requestPayload,
      event,
      transaction,
    )
  }

  private async completeProviderEventCommandForType(
    commandType: string,
    command: CorrelationMetadata & { idempotencyKey: string },
    requestPayload: JsonObject,
    event: ProviderDepositEvent,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    await this.idempotencyService.complete(
      commandType,
      toIdempotencyKey(command.idempotencyKey),
      requestPayload,
      { depositEventId: event.depositEventId } satisfies ProviderEventSnapshot,
      transaction,
    )
  }

  private reviewCommandPayload(command: {
    depositEventId: string
    operatorId: string
    operatorRole: string
    reasonCode: string
    reasonText: string
  }): JsonObject {
    return {
      depositEventId: command.depositEventId,
      operatorId: command.operatorId,
      operatorRole: command.operatorRole,
      reasonCode: command.reasonCode,
      reasonText: command.reasonText,
    }
  }

  private async requireProviderEvent(
    depositEventId: string,
    transaction: DatabaseTransaction,
  ): Promise<ProviderDepositEvent> {
    const event = await this.depositRepository.getEventById(
      toDepositEventId(depositEventId),
      transaction,
    )

    if (!event) {
      throw new AppError({
        category: 'not_found',
        code: 'PROVIDER_DEPOSIT_EVENT_NOT_FOUND',
        message: 'Provider deposit event was not found',
        details: { depositEventId },
      })
    }

    return event
  }

  private async requireDepositIntent(
    depositIntentId: string,
    transaction: DatabaseTransaction,
  ): Promise<DepositIntent> {
    const intent = await this.depositRepository.getIntentById(
      toDepositIntentId(depositIntentId),
      transaction,
    )

    if (!intent) {
      throw new AppError({
        category: 'not_found',
        code: 'DEPOSIT_INTENT_NOT_FOUND',
        message: 'Deposit intent was not found',
        details: { depositIntentId },
      })
    }

    return intent
  }

  private assertReviewResolutionAllowed(event: ProviderDepositEvent): void {
    if (event.status === 'credited') {
      throw new AppError({
        category: 'conflict',
        code: 'DEPOSIT_PROVIDER_EVENT_ALREADY_CREDITED',
        message: 'Credited provider events cannot be marked no-credit or rejected',
        details: { depositEventId: event.depositEventId },
      })
    }

    if (event.status === 'reviewed_no_credit' || event.status === 'rejected') {
      throw new AppError({
        category: 'conflict',
        code: 'DEPOSIT_PROVIDER_EVENT_TERMINAL',
        message:
          'Provider event is already terminal and requires an explicit new remediation path',
        details: {
          depositEventId: event.depositEventId,
          status: event.status,
        },
      })
    }
  }

  private assertCreditApprovalAllowed(event: ProviderDepositEvent): void {
    if (event.status === 'reviewed_no_credit' || event.status === 'rejected') {
      throw new AppError({
        category: 'conflict',
        code: 'DEPOSIT_PROVIDER_EVENT_TERMINAL',
        message:
          'Rejected/no-credit provider events cannot credit without an explicit new remediation action',
        details: {
          depositEventId: event.depositEventId,
          status: event.status,
        },
      })
    }
  }

  private assertElevatedDepositReviewRole(
    operatorRole: string,
    details: { action: string },
  ): void {
    if (elevatedDepositReviewRoles.has(operatorRole)) {
      return
    }

    throw new AppError({
      category: 'forbidden',
      code: 'DEPOSIT_OPERATOR_ROLE_INSUFFICIENT',
      message:
        'Deposit review action requires treasury_admin or financial_admin role',
      details: {
        ...details,
        operatorRole,
      },
    })
  }

  private async validateManualLink(
    intent: DepositIntent,
    event: ProviderDepositEvent,
    transaction: DatabaseTransaction,
  ): Promise<ReviewReason | null> {
    const reason = await this.validateCreditableIntent(
      intent,
      {
        ...event,
        depositIntentId: intent.depositIntentId,
        destinationReference: intent.destinationReference,
      },
      transaction,
      { allowReviewIntent: true },
    )

    if (reason?.code === 'DUPLICATE_EXTERNAL_TRANSACTION') {
      throw new AppError({
        category: 'conflict',
        code: 'DUPLICATE_EXTERNAL_TRANSACTION',
        message: 'External transaction has already been credited',
        details: {
          provider: event.provider,
          externalTransactionId: event.externalTransactionId,
        },
      })
    }

    if (reason?.code === 'DEPOSIT_INTENT_ALREADY_CREDITED') {
      throw new AppError({
        category: 'conflict',
        code: 'DEPOSIT_INTENT_ALREADY_CREDITED',
        message: 'Deposit intent has already been credited',
        details: { depositIntentId: intent.depositIntentId },
      })
    }

    return reason
  }

  private async recoverDuplicateDepositCredit(
    error: unknown,
    command: {
      provider?: string
      externalTransactionId?: string
      depositEventId?: string
    },
  ): Promise<IngestProviderDepositEventResultDto | null> {
    if (!isUniqueViolation(error)) {
      return null
    }

    if (command.provider && command.externalTransactionId) {
      const creditedEvent =
        await this.depositRepository.getCreditedEventByExternalTransactionId(
          command.provider,
          command.externalTransactionId,
        )

      if (creditedEvent) {
        return this.database.tx((transaction) =>
          this.toProviderEventResult(creditedEvent, transaction),
        )
      }
    }

    if (command.depositEventId) {
      const event = await this.depositRepository.getEventById(
        toDepositEventId(command.depositEventId),
      )

      if (event) {
        return this.database.tx((transaction) =>
          this.toProviderEventResult(event, transaction),
        )
      }
    }

    return null
  }

  private async getDepositIntentFromSnapshot(
    snapshot: JsonObject | null,
    userId: UserId,
    transaction: DatabaseTransaction,
  ): Promise<DepositIntentDto> {
    const depositIntentId = snapshot?.depositIntentId

    if (typeof depositIntentId !== 'string') {
      throw new AppError({
        category: 'internal_error',
        code: 'INVALID_IDEMPOTENT_DEPOSIT_INTENT_SNAPSHOT',
        message: 'Idempotency replay snapshot is missing depositIntentId',
      })
    }

    const intent = await this.depositRepository.getIntentById(
      toDepositIntentId(depositIntentId),
      transaction,
    )

    if (!intent) {
      throw new AppError({
        category: 'internal_error',
        code: 'IDEMPOTENT_DEPOSIT_INTENT_NOT_FOUND',
        message: 'Expected deposit intent from idempotency replay was not found',
        details: { depositIntentId },
      })
    }

    if (intent.userId !== userId) {
      throw new AppError({
        category: 'forbidden',
        code: 'DEPOSIT_INTENT_REPLAY_FORBIDDEN',
        message: 'Deposit intent replay does not belong to the user',
      })
    }

    return this.toDepositIntentDto(intent)
  }

  private async getProviderEventResultFromSnapshot(
    snapshot: JsonObject | null,
    transaction: DatabaseTransaction,
  ): Promise<IngestProviderDepositEventResultDto> {
    const depositEventId = snapshot?.depositEventId

    if (typeof depositEventId !== 'string') {
      throw new AppError({
        category: 'internal_error',
        code: 'INVALID_IDEMPOTENT_PROVIDER_EVENT_SNAPSHOT',
        message: 'Idempotency replay snapshot is missing depositEventId',
      })
    }

    const event = await this.depositRepository.getEventById(
      toDepositEventId(depositEventId),
      transaction,
    )

    if (!event) {
      throw new AppError({
        category: 'internal_error',
        code: 'IDEMPOTENT_PROVIDER_EVENT_NOT_FOUND',
        message: 'Expected provider event from idempotency replay was not found',
        details: { depositEventId },
      })
    }

    return this.toProviderEventResult(event, transaction)
  }

  private async toProviderEventResult(
    event: ProviderDepositEvent,
    queryable: DatabaseTransaction,
  ): Promise<IngestProviderDepositEventResultDto> {
    const intent = event.depositIntentId
      ? await this.depositRepository.getIntentById(event.depositIntentId, queryable)
      : null

    return {
      providerEvent: this.toProviderDepositEventDto(event),
      depositIntent: intent ? this.toDepositIntentDto(intent) : null,
      credited: event.status === 'credited',
      reviewRequired: event.status === 'review_required',
    }
  }

  private async appendDepositCreditedAuditAndOutbox(
    intent: DepositIntent,
    event: ProviderDepositEvent,
    ledgerTransaction: LedgerTransaction,
    command: CorrelationMetadata,
    now: Date,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    const payload: JsonObject = {
      depositIntentId: intent.depositIntentId,
      providerEventId: event.providerEventId,
      externalTransactionId: event.externalTransactionId,
      amountMinor: event.amountMinor,
      currency: event.currency,
      ledgerTransactionId: ledgerTransaction.transactionId,
    }

    await this.appendAuditEvent(
      'financial.deposit.credited',
      'deposit_intent',
      intent.depositIntentId,
      payload,
      command,
      now,
      transaction,
    )
    await this.appendOutboxEvent(
      'deposit_intent',
      intent.depositIntentId,
      'financial.deposit.credited',
      payload,
      command,
      now,
      transaction,
    )
  }

  private async appendAuditEvent(
    eventType: string,
    entityType: string,
    entityId: string,
    payload: JsonObject,
    correlation: CorrelationMetadata,
    createdAt: Date,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    const metadata = requireCorrelationMetadata(correlation)
    const event: AuditEvent = {
      auditEventId: newAuditEventId(),
      eventType,
      entityType,
      entityId,
      correlationId: metadata.correlationId,
      causationId: metadata.causationId,
      payload,
      createdAt,
    }

    await this.auditEventRepository.append(event, transaction)
  }

  private async appendOutboxEvent(
    aggregateType: string,
    aggregateId: string,
    eventType: string,
    payload: JsonObject,
    correlation: CorrelationMetadata,
    createdAt: Date,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    const metadata = requireCorrelationMetadata(correlation)
    await this.outboxRepository.appendIfAbsent(
      {
        outboxEventId: `outbox_${randomUUID()}`,
        aggregateType,
        aggregateId,
        eventType,
        payload,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: null,
        correlationId: metadata.correlationId,
        causationId: metadata.causationId,
        createdAt,
        publishedAt: null,
      },
      transaction,
    )
  }

  private toDepositIntentDto(intent: DepositIntent): DepositIntentDto {
    return {
      depositIntentId: intent.depositIntentId,
      playerAccountId: intent.playerAccountId,
      userId: intent.userId,
      currency: intent.currency,
      expectedAmountMinor: intent.expectedAmountMinor,
      provider: intent.provider,
      providerKind: intent.providerKind,
      destinationReference: intent.destinationReference,
      status: intent.status,
      createdAt: intent.createdAt.toISOString(),
      updatedAt: intent.updatedAt.toISOString(),
      expiresAt: intent.expiresAt?.toISOString() ?? null,
      creditedLedgerTransactionId: intent.creditedLedgerTransactionId,
      reviewReasonCode: intent.reviewReasonCode,
      reviewReasonText: intent.reviewReasonText,
    }
  }

  private toProviderDepositEventDto(
    event: ProviderDepositEvent,
  ): ProviderDepositEventDto {
    return {
      depositEventId: event.depositEventId,
      providerEventId: event.providerEventId,
      provider: event.provider,
      externalTransactionId: event.externalTransactionId,
      depositIntentId: event.depositIntentId,
      destinationReference: event.destinationReference,
      amountMinor: event.amountMinor,
      currency: event.currency,
      confirmationCount: event.confirmationCount,
      confirmed: event.confirmed,
      status: event.status,
      reviewReasonCode: event.reviewReasonCode,
      reviewReasonText: event.reviewReasonText,
      receivedAt: event.receivedAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
      ledgerTransactionId: event.ledgerTransactionId,
    }
  }

  private toReviewItemDto(item: DepositReviewItem): DepositReviewItemDto {
    return {
      itemType: item.itemType,
      itemId: item.itemId,
      status: item.status,
      reasonCode: item.reasonCode,
      reasonText: item.reasonText,
      provider: item.provider,
      externalTransactionId: item.externalTransactionId,
      depositIntentId: item.depositIntentId,
      amountMinor: item.amountMinor,
      currency: item.currency,
      updatedAt: item.updatedAt.toISOString(),
    }
  }

  private toIssueDto(
    issue: DepositReconciliationIssue,
  ): DepositReconciliationReportDto['issues'][number] {
    return {
      code: issue.code,
      severity: issue.severity,
      entityType: issue.entityType,
      entityId: issue.entityId,
      details: issue.details,
    }
  }

  private sanitizeRawPayload(rawPayload: Record<string, unknown> = {}): JsonObject {
    if (!isJsonValue(rawPayload) || Array.isArray(rawPayload) || rawPayload === null) {
      return {}
    }

    return rawPayload
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const maybePgError = error as { code?: unknown; message?: unknown }

  return (
    maybePgError.code === '23505' ||
    (typeof maybePgError.message === 'string' &&
      maybePgError.message.toLowerCase().includes('duplicate key'))
  )
}

function parseProviderWebhookTimestamp(value: string): Date {
  if (/^[0-9]{10}$/.test(value)) {
    return new Date(Number(value) * 1000)
  }

  if (/^[0-9]{13}$/.test(value)) {
    return new Date(Number(value))
  }

  return new Date(value)
}
