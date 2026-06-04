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
import type { Clock } from '../../../shared/time/Clock.js'
import type { FaultInjector } from '../../../shared/faults/FaultInjector.js'
import { AppError } from '../../../shared/types/AppError.js'
import type { JsonObject } from '../../../shared/types/Json.js'
import { Account as AccountEntity } from '../../accounting/entities/Account.js'
import type { PlayerAccount } from '../../account/entities/PlayerAccount.js'
import type { PlayerAccountRepository } from '../../account/repositories/PlayerAccountRepository.js'
import { AccountActionAuthorizationService } from '../../account/restrictions/AccountActionAuthorizationService.js'
import { EffectiveStatusService } from '../../account/services/EffectiveStatusService.js'
import { toUserId, type UserId } from '../../account/types/identifiers.js'
import type { AccountRepository } from '../../accounting/repositories/AccountRepository.js'
import type { AuditEventRepository } from '../../accounting/repositories/AuditEventRepository.js'
import type { IdempotencyRepository } from '../../accounting/repositories/IdempotencyRepository.js'
import type { LedgerRepository } from '../../accounting/repositories/LedgerRepository.js'
import { IdempotencyService } from '../../accounting/services/IdempotencyService.js'
import { PostingEngineService } from '../../accounting/services/PostingEngineService.js'
import {
  newAccountId,
  newAuditEventId,
  toOwnerId,
  type LedgerTransactionId,
} from '../../accounting/types/identifiers.js'
import type {
  WithdrawalRequest,
  WithdrawalRequestStatus,
} from '../entities/WithdrawalRequest.js'
import type { WithdrawalProviderEvent } from '../entities/WithdrawalProviderEvent.js'
import type { WithdrawalProviderSubmission } from '../entities/WithdrawalProviderSubmission.js'
import type { NormalizedWithdrawalProviderEvent } from '../providers/WithdrawalProviderAdapter.js'
import type { WithdrawalProviderAdapter } from '../providers/WithdrawalProviderAdapter.js'
import type {
  WithdrawalReconciliationIssue,
  WithdrawalRepository,
  WithdrawalReviewItem,
} from '../repositories/WithdrawalRepository.js'
import {
  newWithdrawalProviderEventId,
  newWithdrawalProviderWebhookReceiptId,
  newWithdrawalRequestId,
  toWithdrawalRequestId,
} from '../types/withdrawalIdentifiers.js'
import type {
  ApproveWithdrawalRequestCommandDto,
  CancelWithdrawalRequestCommandDto,
  CreateWithdrawalRequestCommandDto,
  GetWithdrawalRequestCommandDto,
  FinalizeWithdrawalRequestCommandDto,
  MarkWithdrawalProviderFailureTerminalCommandDto,
  MarkWithdrawalProviderUnknownReviewedCommandDto,
  IngestWithdrawalProviderWebhookCommandDto,
  RejectWithdrawalRequestCommandDto,
  ReleaseWithdrawalProviderFailureCommandDto,
  SubmitWithdrawalRequestCommandDto,
  SyncWithdrawalProviderStatusCommandDto,
  WithdrawalProviderWebhookIngestionDto,
  WithdrawalProviderSubmissionDto,
  WithdrawalReconciliationReportDto,
  WithdrawalRequestDto,
  WithdrawalReviewItemDto,
} from '../dto/withdrawalDtos.js'

const createWithdrawalRequestCommandType = 'create_withdrawal_request'
const approveWithdrawalRequestCommandType = 'approve_withdrawal_request'
const rejectWithdrawalRequestCommandType = 'reject_withdrawal_request'
const cancelWithdrawalRequestCommandType = 'cancel_withdrawal_request'
const submitWithdrawalRequestCommandType = 'submit_withdrawal_request'
const syncWithdrawalProviderStatusCommandType =
  'sync_withdrawal_provider_status'
const finalizeWithdrawalRequestCommandType = 'finalize_withdrawal_request'
const releaseWithdrawalProviderFailureCommandType =
  'release_withdrawal_provider_failure'
const markWithdrawalProviderFailureTerminalCommandType =
  'mark_withdrawal_provider_failure_terminal'
const markWithdrawalProviderUnknownReviewedCommandType =
  'mark_withdrawal_provider_unknown_reviewed'
const webhookSignatureVersion = 'hmac-sha256-v1'
const supportedCurrency = 'USDC'
const withdrawalClearingOwnerId = toOwnerId('platform-withdrawal-clearing')
const elevatedWithdrawalRoles = new Set(['treasury_admin', 'financial_admin'])
const operatorWithdrawalRoles = new Set([
  'treasury_operator',
  'treasury_admin',
  'financial_admin',
])

interface WithdrawalSnapshot extends JsonObject {
  withdrawalRequestId: string
}

export class WithdrawalService {
  private readonly idempotencyService: IdempotencyService

  constructor(
    private readonly database: Database,
    private readonly withdrawalRepository: WithdrawalRepository,
    private readonly idempotencyRepository: IdempotencyRepository,
    private readonly playerAccountRepository: PlayerAccountRepository,
    private readonly accountRepository: AccountRepository,
    private readonly ledgerRepository: LedgerRepository,
    private readonly auditEventRepository: AuditEventRepository,
    private readonly postingEngineService: PostingEngineService,
    private readonly withdrawalProviderAdapter: WithdrawalProviderAdapter,
    private readonly effectiveStatusService: EffectiveStatusService,
    private readonly authorizationService: AccountActionAuthorizationService,
    private readonly clock: Clock,
    private readonly faultInjector: FaultInjector,
  ) {
    this.idempotencyService = new IdempotencyService(
      this.idempotencyRepository,
      this.clock,
    )
  }

  async createWithdrawalRequest(
    command: CreateWithdrawalRequestCommandDto,
  ): Promise<WithdrawalRequestDto> {
    this.assertAlphaSafeDestination(command)
    const playerId = toUserId(command.playerId)
    const requestPayload: JsonObject = {
      playerId: command.playerId,
      currency: command.currency,
      amountMinorUnits: command.amountMinorUnits,
      destinationKind: command.destinationKind,
      destinationReference: command.destinationReference,
      provider: command.provider,
    }

    return this.database.tx(async (transaction) => {
      const existingWithdrawal =
        await this.withdrawalRepository.getByIdempotencyKey(
          command.idempotencyKey,
          transaction,
        )

      if (existingWithdrawal) {
        return this.recoverExistingCreateAttempt(
          existingWithdrawal,
          command,
          playerId,
          requestPayload,
          transaction,
        )
      }

      const decision = await this.idempotencyService.begin(
        createWithdrawalRequestCommandType,
        toIdempotencyKey(command.idempotencyKey),
        requestPayload,
        transaction,
      )

      if (decision.kind === 'replay') {
        return this.getWithdrawalFromSnapshot(
          decision.record.responseSnapshot,
          playerId,
          transaction,
        )
      }

      const playerAccount = await this.requirePlayerAccountForUser(
        playerId,
        command.currency,
        transaction,
      )
      await this.assertWithdrawalReserveAuthorized(playerAccount, transaction)

      const now = this.clock.now()
      const withdrawalRequestId = newWithdrawalRequestId()
      const withdrawalRequest: WithdrawalRequest = {
        withdrawalRequestId,
        playerId,
        playerAccountId: playerAccount.playerAccountId,
        currency: command.currency,
        amountMinorUnits: command.amountMinorUnits,
        destinationKind: command.destinationKind,
        destinationReference: command.destinationReference,
        provider: command.provider,
        status: 'reservation_pending',
        idempotencyKey: command.idempotencyKey,
        correlationId: command.correlationId,
        causationId: command.causationId,
        reservationLedgerTransactionId: null,
        releaseLedgerTransactionId: null,
        finalizationLedgerTransactionId: null,
        reviewReasonCode:
          command.destinationKind === 'manual_review'
            ? 'DESTINATION_REQUIRES_MANUAL_REVIEW'
            : null,
        reviewReasonText:
          command.destinationKind === 'manual_review'
            ? 'Withdrawal destination was explicitly routed to manual review'
            : null,
        failureReasonCode: null,
        failureReasonText: null,
        createdAt: now,
        updatedAt: now,
        requestedAt: now,
        reservedAt: null,
        approvedAt: null,
        rejectedAt: null,
        cancelledAt: null,
      }

      await this.withdrawalRepository.create(withdrawalRequest, transaction)
      await this.faultInjector.trigger(
        'withdrawal.after_request_record_before_reservation',
        {
          withdrawalRequestId,
          playerId,
          amountMinorUnits: command.amountMinorUnits,
        },
      )

      const reservation = await this.postReservation(
        withdrawalRequest,
        playerAccount,
        command,
        transaction,
      )
      await this.faultInjector.trigger(
        'withdrawal.after_reservation_posting_before_state_finalization',
        {
          withdrawalRequestId,
          reservationLedgerTransactionId: reservation.transactionId,
        },
      )

      const reservedRequest: WithdrawalRequest = {
        ...withdrawalRequest,
        status:
          command.destinationKind === 'manual_review'
            ? 'review_required'
            : 'reserved',
        reservationLedgerTransactionId: reservation.transactionId,
        reservedAt: now,
        updatedAt: now,
      }

      await this.withdrawalRepository.update(reservedRequest, transaction)
      await this.appendAuditEvent(
        'financial.withdrawal.request_created',
        reservedRequest,
        {
          action: 'create_withdrawal_request',
          playerId,
          playerAccountId: playerAccount.playerAccountId,
          amountMinorUnits: command.amountMinorUnits,
          currency: command.currency,
          destinationKind: command.destinationKind,
          provider: command.provider,
          previousStatus: null,
          newStatus: reservedRequest.status,
          reservationLedgerTransactionId: reservation.transactionId,
        },
        command,
        now,
        transaction,
      )
      await this.idempotencyService.complete(
        createWithdrawalRequestCommandType,
        toIdempotencyKey(command.idempotencyKey),
        requestPayload,
        { withdrawalRequestId } satisfies WithdrawalSnapshot,
        transaction,
      )

      return this.toWithdrawalRequestDto(reservedRequest)
    })
  }

  async getWithdrawalRequest(
    command: GetWithdrawalRequestCommandDto,
  ): Promise<WithdrawalRequestDto> {
    const playerId = toUserId(command.playerId)
    const withdrawalRequest = await this.withdrawalRepository.getById(
      toWithdrawalRequestId(command.withdrawalRequestId),
    )

    if (!withdrawalRequest) {
      throw new AppError({
        category: 'not_found',
        code: 'WITHDRAWAL_REQUEST_NOT_FOUND',
        message: 'Withdrawal request was not found',
        details: { withdrawalRequestId: command.withdrawalRequestId },
      })
    }

    if (withdrawalRequest.playerId !== playerId) {
      throw new AppError({
        category: 'forbidden',
        code: 'WITHDRAWAL_REQUEST_FORBIDDEN',
        message:
          'Withdrawal request does not belong to the authenticated player',
      })
    }

    const providerSubmission =
      await this.withdrawalRepository.getProviderSubmissionByWithdrawalRequestId(
        withdrawalRequest.withdrawalRequestId,
      )

    return this.toWithdrawalRequestDto(withdrawalRequest, providerSubmission)
  }

  async listReviewItems(): Promise<WithdrawalReviewItemDto[]> {
    const items = await this.withdrawalRepository.listReviewItems()
    return items.map((item) => this.toReviewItemDto(item))
  }

  async detectReconciliation(): Promise<WithdrawalReconciliationReportDto> {
    const checkedAt = this.clock.now()
    const issues =
      await this.withdrawalRepository.detectReconciliationIssues(checkedAt)
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

  async approveWithdrawalRequest(
    command: ApproveWithdrawalRequestCommandDto,
  ): Promise<WithdrawalRequestDto> {
    this.assertElevatedRole(command.operatorRole, 'approve_withdrawal')
    const requestPayload: JsonObject = {
      withdrawalRequestId: command.withdrawalRequestId,
      operatorId: command.operatorId,
      operatorRole: command.operatorRole,
      reason: command.reason ?? null,
      overrideReason: command.overrideReason ?? null,
    }

    return this.database.tx(async (transaction) => {
      const decision = await this.idempotencyService.begin(
        approveWithdrawalRequestCommandType,
        toIdempotencyKey(command.idempotencyKey),
        requestPayload,
        transaction,
      )

      if (decision.kind === 'replay') {
        return this.getWithdrawalFromSnapshot(
          decision.record.responseSnapshot,
          null,
          transaction,
        )
      }

      const withdrawalRequest = await this.requireWithdrawalForUpdate(
        command.withdrawalRequestId,
        transaction,
      )

      if (
        withdrawalRequest.status === 'approved' ||
        withdrawalRequest.status === 'submission_pending'
      ) {
        await this.completeResolutionCommand(
          approveWithdrawalRequestCommandType,
          command,
          requestPayload,
          withdrawalRequest,
          transaction,
        )
        return this.toWithdrawalRequestDto(withdrawalRequest)
      }

      this.assertApprovable(withdrawalRequest)
      const now = this.clock.now()
      const approvedRequest: WithdrawalRequest = {
        ...withdrawalRequest,
        status: 'submission_pending',
        approvedAt: now,
        updatedAt: now,
      }

      await this.withdrawalRepository.update(approvedRequest, transaction)
      await this.appendAuditEvent(
        'financial.withdrawal.request_approved',
        approvedRequest,
        {
          action: 'approve',
          operatorUserId: command.operatorId,
          operatorRole: command.operatorRole,
          reason: command.reason ?? null,
          overrideReason: command.overrideReason ?? null,
          previousStatus: withdrawalRequest.status,
          newStatus: approvedRequest.status,
          withdrawalRequestId: approvedRequest.withdrawalRequestId,
          reservationLedgerTransactionId:
            approvedRequest.reservationLedgerTransactionId,
          externalSubmission: false,
        },
        command,
        now,
        transaction,
      )
      await this.completeResolutionCommand(
        approveWithdrawalRequestCommandType,
        command,
        requestPayload,
        approvedRequest,
        transaction,
      )

      return this.toWithdrawalRequestDto(approvedRequest)
    })
  }

  async rejectWithdrawalRequest(
    command: RejectWithdrawalRequestCommandDto,
  ): Promise<WithdrawalRequestDto> {
    const requestPayload: JsonObject = {
      withdrawalRequestId: command.withdrawalRequestId,
      operatorId: command.operatorId,
      operatorRole: command.operatorRole,
      reasonCode: command.reasonCode,
      reason: command.reason,
    }

    return this.database.tx(async (transaction) => {
      const decision = await this.idempotencyService.begin(
        rejectWithdrawalRequestCommandType,
        toIdempotencyKey(command.idempotencyKey),
        requestPayload,
        transaction,
      )

      if (decision.kind === 'replay') {
        return this.getWithdrawalFromSnapshot(
          decision.record.responseSnapshot,
          null,
          transaction,
        )
      }

      const withdrawalRequest = await this.requireWithdrawalForUpdate(
        command.withdrawalRequestId,
        transaction,
      )

      if (withdrawalRequest.status === 'rejected') {
        await this.completeResolutionCommand(
          rejectWithdrawalRequestCommandType,
          command,
          requestPayload,
          withdrawalRequest,
          transaction,
        )
        return this.toWithdrawalRequestDto(withdrawalRequest)
      }

      this.assertRejectable(withdrawalRequest)
      const now = this.clock.now()
      const releasedLedgerTransactionId =
        await this.releaseReservationIfNeeded(
          withdrawalRequest,
          `withdrawal-reject-release-${command.idempotencyKey}`,
          command,
          transaction,
        )
      const rejectedRequest: WithdrawalRequest = {
        ...withdrawalRequest,
        status: 'rejected',
        rejectedAt: now,
        updatedAt: now,
        releaseLedgerTransactionId:
          releasedLedgerTransactionId ??
          withdrawalRequest.releaseLedgerTransactionId,
        reviewReasonCode: command.reasonCode,
        reviewReasonText: command.reason,
      }

      await this.withdrawalRepository.update(rejectedRequest, transaction)
      await this.appendAuditEvent(
        'financial.withdrawal.request_rejected',
        rejectedRequest,
        {
          action: 'reject',
          operatorUserId: command.operatorId,
          operatorRole: command.operatorRole,
          reasonCode: command.reasonCode,
          reason: command.reason,
          previousStatus: withdrawalRequest.status,
          newStatus: rejectedRequest.status,
          withdrawalRequestId: rejectedRequest.withdrawalRequestId,
          reservationLedgerTransactionId:
            rejectedRequest.reservationLedgerTransactionId,
          releaseLedgerTransactionId:
            rejectedRequest.releaseLedgerTransactionId,
        },
        command,
        now,
        transaction,
      )
      await this.completeResolutionCommand(
        rejectWithdrawalRequestCommandType,
        command,
        requestPayload,
        rejectedRequest,
        transaction,
      )

      return this.toWithdrawalRequestDto(rejectedRequest)
    })
  }

  async submitWithdrawalRequest(
    command: SubmitWithdrawalRequestCommandDto,
  ): Promise<WithdrawalRequestDto> {
    this.assertElevatedRole(command.operatorRole, 'submit_withdrawal')
    const requestPayload: JsonObject = {
      withdrawalRequestId: command.withdrawalRequestId,
      operatorId: command.operatorId,
      operatorRole: command.operatorRole,
      submissionNote: command.submissionNote,
    }

    return this.database.tx(async (transaction) => {
      const decision = await this.idempotencyService.begin(
        submitWithdrawalRequestCommandType,
        toIdempotencyKey(command.idempotencyKey),
        requestPayload,
        transaction,
      )

      if (decision.kind === 'replay') {
        return this.getWithdrawalFromSnapshot(
          decision.record.responseSnapshot,
          null,
          transaction,
        )
      }

      const withdrawalRequest = await this.requireWithdrawalForUpdate(
        command.withdrawalRequestId,
        transaction,
      )
      const existingSubmission =
        await this.withdrawalRepository.getProviderSubmissionByWithdrawalRequestId(
          withdrawalRequest.withdrawalRequestId,
          transaction,
        )

      if (existingSubmission) {
        const recoveredWithdrawal =
          await this.finalizeExistingProviderSubmissionIfNeeded(
            withdrawalRequest,
            existingSubmission,
            transaction,
          )
        await this.completeResolutionCommand(
          submitWithdrawalRequestCommandType,
          command,
          requestPayload,
          recoveredWithdrawal,
          transaction,
        )
        return this.toWithdrawalRequestDto(
          recoveredWithdrawal,
          existingSubmission,
        )
      }

      this.assertSubmittable(withdrawalRequest)
      const destinationValidation =
        this.withdrawalProviderAdapter.validateDestination({
          provider: withdrawalRequest.provider,
          currency: withdrawalRequest.currency,
          destinationKind: withdrawalRequest.destinationKind,
          destinationReference: withdrawalRequest.destinationReference,
        })
      const now = this.clock.now()

      if (!destinationValidation.valid) {
        const reviewRequest: WithdrawalRequest = {
          ...withdrawalRequest,
          status: 'review_required',
          reviewReasonCode:
            destinationValidation.reasonCode ??
            'WITHDRAWAL_PROVIDER_DESTINATION_INVALID',
          reviewReasonText:
            destinationValidation.reasonText ??
            'Withdrawal destination failed provider validation',
          updatedAt: now,
        }

        await this.withdrawalRepository.update(reviewRequest, transaction)
        await this.appendAuditEvent(
          'financial.withdrawal.provider_submission_blocked',
          reviewRequest,
          {
            action: 'submit_blocked',
            operatorUserId: command.operatorId,
            operatorRole: command.operatorRole,
            submissionNote: command.submissionNote,
            previousStatus: withdrawalRequest.status,
            newStatus: reviewRequest.status,
            withdrawalRequestId: reviewRequest.withdrawalRequestId,
            reasonCode: reviewRequest.reviewReasonCode,
            reason: reviewRequest.reviewReasonText,
          },
          command,
          now,
          transaction,
        )
        await this.completeResolutionCommand(
          submitWithdrawalRequestCommandType,
          command,
          requestPayload,
          reviewRequest,
          transaction,
        )
        return this.toWithdrawalRequestDto(reviewRequest)
      }

      const submittingRequest: WithdrawalRequest = {
        ...withdrawalRequest,
        status: 'submitting',
        updatedAt: now,
      }

      await this.withdrawalRepository.update(submittingRequest, transaction)
      await this.faultInjector.trigger(
        'withdrawal.after_mark_submitting_before_provider_submission',
        {
          withdrawalRequestId: submittingRequest.withdrawalRequestId,
        },
      )

      const providerIdempotencyKey = `withdrawal-provider-submit-${submittingRequest.withdrawalRequestId}`
      const providerResult =
        await this.withdrawalProviderAdapter.submitWithdrawal({
          withdrawalRequest: submittingRequest,
          providerIdempotencyKey,
        })
      const submission: WithdrawalProviderSubmission = {
        withdrawalRequestId: submittingRequest.withdrawalRequestId,
        provider: providerResult.provider,
        externalWithdrawalId: providerResult.externalWithdrawalId,
        externalTransactionId: providerResult.externalTransactionId,
        providerStatus: providerResult.providerStatus,
        submissionAttemptCount: 1,
        lastSubmittedAt: providerResult.submittedAt,
        lastStatusSyncedAt: null,
        rawProviderPayload: providerResult.rawPayload,
        providerIdempotencyKey: providerResult.providerIdempotencyKey,
        createdAt: now,
        updatedAt: now,
      }

      await this.withdrawalRepository.createProviderSubmission(
        submission,
        transaction,
      )
      await this.faultInjector.trigger(
        'withdrawal.after_provider_submission_persisted_before_state_update',
        {
          withdrawalRequestId: submittingRequest.withdrawalRequestId,
          externalWithdrawalId: submission.externalWithdrawalId,
          providerStatus: submission.providerStatus,
        },
      )

      const submittedRequest = this.applyProviderStatusToWithdrawal(
        submittingRequest,
        submission.providerStatus,
        now,
      )

      await this.withdrawalRepository.update(submittedRequest, transaction)
      await this.faultInjector.trigger(
        'withdrawal.after_provider_submission_accepted_before_audit',
        {
          withdrawalRequestId: submittedRequest.withdrawalRequestId,
          externalWithdrawalId: submission.externalWithdrawalId,
          providerStatus: submission.providerStatus,
        },
      )
      await this.appendAuditEvent(
        'financial.withdrawal.provider_submitted',
        submittedRequest,
        {
          action: 'submit',
          operatorUserId: command.operatorId,
          operatorRole: command.operatorRole,
          submissionNote: command.submissionNote,
          previousStatus: withdrawalRequest.status,
          newStatus: submittedRequest.status,
          withdrawalRequestId: submittedRequest.withdrawalRequestId,
          provider: submission.provider,
          externalWithdrawalId: submission.externalWithdrawalId,
          externalTransactionId: submission.externalTransactionId,
          providerStatus: submission.providerStatus,
          providerIdempotencyKey: submission.providerIdempotencyKey,
          externalSubmission: 'simulated',
        },
        command,
        now,
        transaction,
      )
      await this.completeResolutionCommand(
        submitWithdrawalRequestCommandType,
        command,
        requestPayload,
        submittedRequest,
        transaction,
      )

      return this.toWithdrawalRequestDto(submittedRequest, submission)
    })
  }

  async syncWithdrawalProviderStatus(
    command: SyncWithdrawalProviderStatusCommandDto,
  ): Promise<WithdrawalRequestDto> {
    this.assertOperatorRole(command.operatorRole, 'sync_withdrawal_provider_status')
    const requestPayload: JsonObject = {
      withdrawalRequestId: command.withdrawalRequestId,
      operatorId: command.operatorId,
      operatorRole: command.operatorRole,
      reason: command.reason ?? null,
      simulatedProviderStatus: command.simulatedProviderStatus ?? null,
    }

    return this.database.tx(async (transaction) => {
      const decision = await this.idempotencyService.begin(
        syncWithdrawalProviderStatusCommandType,
        toIdempotencyKey(command.idempotencyKey),
        requestPayload,
        transaction,
      )

      if (decision.kind === 'replay') {
        return this.getWithdrawalFromSnapshot(
          decision.record.responseSnapshot,
          null,
          transaction,
        )
      }

      const withdrawalRequest = await this.requireWithdrawalForUpdate(
        command.withdrawalRequestId,
        transaction,
      )
      const existingSubmission =
        await this.withdrawalRepository.getProviderSubmissionByWithdrawalRequestId(
          withdrawalRequest.withdrawalRequestId,
          transaction,
        )

      if (!existingSubmission) {
        throw new AppError({
          category: 'conflict',
          code: 'WITHDRAWAL_PROVIDER_SUBMISSION_MISSING',
          message:
            'Withdrawal provider status cannot be synced before submission',
          details: {
            withdrawalRequestId: withdrawalRequest.withdrawalRequestId,
          },
        })
      }

      const statusResult =
        await this.withdrawalProviderAdapter.getWithdrawalStatus({
          withdrawalRequest,
          provider: existingSubmission.provider,
          externalWithdrawalId: existingSubmission.externalWithdrawalId,
          externalTransactionId: existingSubmission.externalTransactionId,
          currentProviderStatus: existingSubmission.providerStatus,
          simulatedProviderStatus: command.simulatedProviderStatus,
        })
      const now = this.clock.now()
      const updatedSubmission: WithdrawalProviderSubmission = {
        ...existingSubmission,
        providerStatus: statusResult.providerStatus,
        lastStatusSyncedAt: statusResult.syncedAt,
        rawProviderPayload: statusResult.rawPayload,
        updatedAt: now,
      }
      const syncedRequest = this.applyProviderStatusToWithdrawal(
        withdrawalRequest,
        updatedSubmission.providerStatus,
        now,
      )

      await this.withdrawalRepository.updateProviderSubmission(
        updatedSubmission,
        transaction,
      )
      await this.withdrawalRepository.update(syncedRequest, transaction)
      await this.faultInjector.trigger(
        'withdrawal.after_provider_status_sync_before_audit',
        {
          withdrawalRequestId: syncedRequest.withdrawalRequestId,
          providerStatus: updatedSubmission.providerStatus,
        },
      )
      await this.appendAuditEvent(
        'financial.withdrawal.provider_status_synced',
        syncedRequest,
        {
          action: 'sync_provider_status',
          operatorUserId: command.operatorId,
          operatorRole: command.operatorRole,
          reason: command.reason ?? null,
          previousStatus: withdrawalRequest.status,
          newStatus: syncedRequest.status,
          withdrawalRequestId: syncedRequest.withdrawalRequestId,
          provider: updatedSubmission.provider,
          externalWithdrawalId: updatedSubmission.externalWithdrawalId,
          externalTransactionId: updatedSubmission.externalTransactionId,
          providerStatus: updatedSubmission.providerStatus,
          completed: false,
          releasedReservation: false,
        },
        command,
        now,
        transaction,
      )
      await this.completeResolutionCommand(
        syncWithdrawalProviderStatusCommandType,
        command,
        requestPayload,
        syncedRequest,
        transaction,
      )

      return this.toWithdrawalRequestDto(syncedRequest, updatedSubmission)
    })
  }

  async ingestWithdrawalProviderWebhook(
    command: IngestWithdrawalProviderWebhookCommandDto,
  ): Promise<WithdrawalProviderWebhookIngestionDto> {
    const normalized = this.withdrawalProviderAdapter.parseWithdrawalWebhook({
      provider: command.provider,
      body: command.body,
      rawBody: command.rawBody,
      headers: command.headers,
    })

    try {
      return await this.database.tx(async (transaction) => {
        const now = this.clock.now()
        const receiptId = newWithdrawalProviderWebhookReceiptId()

        await this.withdrawalRepository.createWebhookReceipt(
          {
            withdrawalProviderWebhookReceiptId: receiptId,
            provider: command.provider,
            nonce: command.providerWebhookNonce,
            providerTimestamp: parseProviderWebhookTimestamp(
              command.providerWebhookTimestamp,
            ),
            receivedAt: now,
            requestHash: command.providerWebhookRequestHash,
            signatureVersion: webhookSignatureVersion,
            externalWithdrawalId: normalized.externalWithdrawalId,
            externalTransactionId: normalized.externalTransactionId,
            withdrawalRequestId: normalized.withdrawalRequestId
              ? toWithdrawalRequestId(normalized.withdrawalRequestId)
              : null,
            status: 'accepted',
            rejectionReason: null,
          },
          transaction,
        )
        await this.faultInjector.trigger(
          'withdrawal.after_webhook_receipt_before_provider_event',
          {
            provider: command.provider,
            nonce: command.providerWebhookNonce,
            externalWithdrawalId: normalized.externalWithdrawalId,
          },
        )

        const match = await this.matchWithdrawalProviderEvent(
          normalized,
          transaction,
        )
        const eventStatus = match.reviewReasonCode ? 'review_required' : 'applied'
        const event: WithdrawalProviderEvent = {
          withdrawalProviderEventId: newWithdrawalProviderEventId(),
          provider: command.provider,
          externalWithdrawalId: normalized.externalWithdrawalId,
          externalTransactionId: normalized.externalTransactionId,
          withdrawalRequestId:
            match.withdrawalRequest?.withdrawalRequestId ?? null,
          providerStatus: normalized.providerStatus,
          status: eventStatus,
          reviewReasonCode: match.reviewReasonCode,
          reviewReasonText: match.reviewReasonText,
          rawPayload: normalized.rawPayload,
          webhookReceiptId: receiptId,
          receivedAt: now,
          updatedAt: now,
        }

        await this.withdrawalRepository.createProviderEvent(event, transaction)
        await this.faultInjector.trigger(
          'withdrawal.after_provider_event_persisted_before_status_update',
          {
            withdrawalProviderEventId: event.withdrawalProviderEventId,
            withdrawalRequestId: event.withdrawalRequestId,
            providerStatus: event.providerStatus,
          },
        )

        const updatedWithdrawal = await this.applyWebhookEventIfSafe(
          normalized,
          event,
          match.withdrawalRequest,
          match.providerSubmission,
          match.reviewReasonCode,
          match.reviewReasonText,
          command,
          now,
          transaction,
        )

        return {
          webhookReceiptId: receiptId,
          providerEventId: event.withdrawalProviderEventId,
          provider: event.provider,
          externalWithdrawalId: event.externalWithdrawalId,
          externalTransactionId: event.externalTransactionId,
          withdrawalRequestId: event.withdrawalRequestId,
          providerStatus: event.providerStatus,
          eventStatus: event.status,
          withdrawalStatus: updatedWithdrawal?.status ?? null,
        }
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        await this.recordWebhookReplayRejection(command, normalized)
        throw new AppError({
          category: 'forbidden',
          code: 'WITHDRAWAL_WEBHOOK_NONCE_REPLAYED',
          message:
            'Withdrawal provider webhook nonce has already been accepted',
          details: {
            provider: command.provider,
            nonce: command.providerWebhookNonce,
          },
        })
      }

      throw error
    }
  }

  async finalizeWithdrawalRequest(
    command: FinalizeWithdrawalRequestCommandDto,
  ): Promise<WithdrawalRequestDto> {
    this.assertElevatedRole(command.operatorRole, 'finalize_withdrawal')
    const requestPayload: JsonObject = {
      withdrawalRequestId: command.withdrawalRequestId,
      operatorId: command.operatorId,
      operatorRole: command.operatorRole,
      reason: command.reason,
    }

    return this.database.tx(async (transaction) => {
      const decision = await this.idempotencyService.begin(
        finalizeWithdrawalRequestCommandType,
        toIdempotencyKey(command.idempotencyKey),
        requestPayload,
        transaction,
      )

      if (decision.kind === 'replay') {
        return this.getWithdrawalFromSnapshot(
          decision.record.responseSnapshot,
          null,
          transaction,
        )
      }

      const withdrawalRequest = await this.requireWithdrawalForUpdate(
        command.withdrawalRequestId,
        transaction,
      )
      const providerSubmission =
        await this.requireProviderSubmission(withdrawalRequest, transaction)
      const existingFinalization =
        await this.findRelatedLedgerTransaction(
          withdrawalRequest,
          'withdrawal_finalized',
          transaction,
        )

      if (withdrawalRequest.status === 'completed') {
        if (!withdrawalRequest.finalizationLedgerTransactionId && !existingFinalization) {
          throw new AppError({
            category: 'invariant_violation',
            code: 'WITHDRAWAL_COMPLETED_WITHOUT_FINALIZATION_LEDGER',
            message:
              'Completed withdrawal is missing its finalization ledger transaction',
            details: {
              withdrawalRequestId: withdrawalRequest.withdrawalRequestId,
            },
          })
        }

        const completedRequest: WithdrawalRequest = {
          ...withdrawalRequest,
          finalizationLedgerTransactionId:
            withdrawalRequest.finalizationLedgerTransactionId ??
            existingFinalization?.transactionId ??
            null,
        }
        if (
          completedRequest.finalizationLedgerTransactionId !==
          withdrawalRequest.finalizationLedgerTransactionId
        ) {
          await this.withdrawalRepository.update(completedRequest, transaction)
        }
        await this.completeResolutionCommand(
          finalizeWithdrawalRequestCommandType,
          command,
          requestPayload,
          completedRequest,
          transaction,
        )
        return this.toWithdrawalRequestDto(completedRequest, providerSubmission)
      }

      this.assertFinalizableProviderStatus(withdrawalRequest)

      const finalization =
        existingFinalization ??
        (await this.postFinalization(
          withdrawalRequest,
          providerSubmission,
          command,
          transaction,
        ))
      await this.faultInjector.trigger(
        'withdrawal.after_finalization_ledger_posted_before_state_update',
        {
          withdrawalRequestId: withdrawalRequest.withdrawalRequestId,
          finalizationLedgerTransactionId: finalization.transactionId,
        },
      )

      const now = this.clock.now()
      const completedRequest: WithdrawalRequest = {
        ...withdrawalRequest,
        status: 'completed',
        finalizationLedgerTransactionId: finalization.transactionId,
        updatedAt: now,
      }

      await this.withdrawalRepository.update(completedRequest, transaction)
      await this.faultInjector.trigger(
        'withdrawal.after_finalization_state_update_before_audit',
        {
          withdrawalRequestId: completedRequest.withdrawalRequestId,
          finalizationLedgerTransactionId:
            completedRequest.finalizationLedgerTransactionId,
        },
      )
      await this.appendAuditEvent(
        'financial.withdrawal.finalized',
        completedRequest,
        {
          action: 'finalize',
          operatorUserId: command.operatorId,
          operatorRole: command.operatorRole,
          reason: command.reason,
          previousStatus: withdrawalRequest.status,
          newStatus: completedRequest.status,
          withdrawalRequestId: completedRequest.withdrawalRequestId,
          provider: providerSubmission.provider,
          externalWithdrawalId: providerSubmission.externalWithdrawalId,
          externalTransactionId: providerSubmission.externalTransactionId,
          providerStatus: providerSubmission.providerStatus,
          reservationLedgerTransactionId:
            completedRequest.reservationLedgerTransactionId,
          finalizationLedgerTransactionId:
            completedRequest.finalizationLedgerTransactionId,
        },
        command,
        now,
        transaction,
      )
      await this.completeResolutionCommand(
        finalizeWithdrawalRequestCommandType,
        command,
        requestPayload,
        completedRequest,
        transaction,
      )

      return this.toWithdrawalRequestDto(completedRequest, providerSubmission)
    })
  }

  async releaseWithdrawalProviderFailure(
    command: ReleaseWithdrawalProviderFailureCommandDto,
  ): Promise<WithdrawalRequestDto> {
    this.assertElevatedRole(command.operatorRole, 'release_withdrawal_provider_failure')
    const requestPayload: JsonObject = {
      withdrawalRequestId: command.withdrawalRequestId,
      operatorId: command.operatorId,
      operatorRole: command.operatorRole,
      reason: command.reason,
    }

    return this.database.tx(async (transaction) => {
      const decision = await this.idempotencyService.begin(
        releaseWithdrawalProviderFailureCommandType,
        toIdempotencyKey(command.idempotencyKey),
        requestPayload,
        transaction,
      )

      if (decision.kind === 'replay') {
        return this.getWithdrawalFromSnapshot(
          decision.record.responseSnapshot,
          null,
          transaction,
        )
      }

      const withdrawalRequest = await this.requireWithdrawalForUpdate(
        command.withdrawalRequestId,
        transaction,
      )
      const providerSubmission =
        await this.requireProviderSubmission(withdrawalRequest, transaction)

      if (withdrawalRequest.status === 'provider_failure_released') {
        await this.completeResolutionCommand(
          releaseWithdrawalProviderFailureCommandType,
          command,
          requestPayload,
          withdrawalRequest,
          transaction,
        )
        return this.toWithdrawalRequestDto(withdrawalRequest, providerSubmission)
      }

      this.assertProviderFailureReleasable(withdrawalRequest)
      const releasedLedgerTransactionId =
        await this.releaseReservationIfNeeded(
          withdrawalRequest,
          `withdrawal-provider-failure-release-${withdrawalRequest.withdrawalRequestId}`,
          command,
          transaction,
          'withdrawal_provider_failure_release',
        )
      await this.faultInjector.trigger(
        'withdrawal.after_provider_failure_release_posted_before_state_update',
        {
          withdrawalRequestId: withdrawalRequest.withdrawalRequestId,
          releaseLedgerTransactionId: releasedLedgerTransactionId,
        },
      )

      const now = this.clock.now()
      const releasedRequest: WithdrawalRequest = {
        ...withdrawalRequest,
        status: 'provider_failure_released',
        releaseLedgerTransactionId:
          releasedLedgerTransactionId ??
          withdrawalRequest.releaseLedgerTransactionId,
        reviewReasonCode: 'WITHDRAWAL_PROVIDER_FAILURE_RELEASED',
        reviewReasonText: command.reason,
        updatedAt: now,
      }

      await this.withdrawalRepository.update(releasedRequest, transaction)
      await this.faultInjector.trigger(
        'withdrawal.after_provider_failure_release_state_update_before_audit',
        {
          withdrawalRequestId: releasedRequest.withdrawalRequestId,
          releaseLedgerTransactionId: releasedRequest.releaseLedgerTransactionId,
        },
      )
      await this.appendAuditEvent(
        'financial.withdrawal.provider_failure_released',
        releasedRequest,
        {
          action: 'release_after_provider_failure',
          operatorUserId: command.operatorId,
          operatorRole: command.operatorRole,
          reason: command.reason,
          previousStatus: withdrawalRequest.status,
          newStatus: releasedRequest.status,
          withdrawalRequestId: releasedRequest.withdrawalRequestId,
          provider: providerSubmission.provider,
          externalWithdrawalId: providerSubmission.externalWithdrawalId,
          externalTransactionId: providerSubmission.externalTransactionId,
          providerStatus: providerSubmission.providerStatus,
          reservationLedgerTransactionId:
            releasedRequest.reservationLedgerTransactionId,
          releaseLedgerTransactionId: releasedRequest.releaseLedgerTransactionId,
        },
        command,
        now,
        transaction,
      )
      await this.completeResolutionCommand(
        releaseWithdrawalProviderFailureCommandType,
        command,
        requestPayload,
        releasedRequest,
        transaction,
      )

      return this.toWithdrawalRequestDto(releasedRequest, providerSubmission)
    })
  }

  async markWithdrawalProviderFailureTerminal(
    command: MarkWithdrawalProviderFailureTerminalCommandDto,
  ): Promise<WithdrawalRequestDto> {
    this.assertElevatedRole(command.operatorRole, 'mark_withdrawal_provider_failure_terminal')
    const requestPayload: JsonObject = {
      withdrawalRequestId: command.withdrawalRequestId,
      operatorId: command.operatorId,
      operatorRole: command.operatorRole,
      reason: command.reason,
    }

    return this.markProviderTerminal(
      command,
      requestPayload,
      markWithdrawalProviderFailureTerminalCommandType,
      'financial.withdrawal.provider_failure_marked_terminal',
      command.reason,
    )
  }

  async markWithdrawalProviderUnknownReviewed(
    command: MarkWithdrawalProviderUnknownReviewedCommandDto,
  ): Promise<WithdrawalRequestDto> {
    this.assertElevatedRole(command.operatorRole, 'mark_withdrawal_provider_unknown_reviewed')
    const requestPayload: JsonObject = {
      withdrawalRequestId: command.withdrawalRequestId,
      operatorId: command.operatorId,
      operatorRole: command.operatorRole,
      reason: command.reason,
    }

    return this.database.tx(async (transaction) => {
      const decision = await this.idempotencyService.begin(
        markWithdrawalProviderUnknownReviewedCommandType,
        toIdempotencyKey(command.idempotencyKey),
        requestPayload,
        transaction,
      )

      if (decision.kind === 'replay') {
        return this.getWithdrawalFromSnapshot(
          decision.record.responseSnapshot,
          null,
          transaction,
        )
      }

      const withdrawalRequest = await this.requireWithdrawalForUpdate(
        command.withdrawalRequestId,
        transaction,
      )
      const providerSubmission =
        await this.requireProviderSubmission(withdrawalRequest, transaction)

      if (withdrawalRequest.status === 'provider_unknown_reviewed') {
        await this.completeResolutionCommand(
          markWithdrawalProviderUnknownReviewedCommandType,
          command,
          requestPayload,
          withdrawalRequest,
          transaction,
        )
        return this.toWithdrawalRequestDto(withdrawalRequest, providerSubmission)
      }

      if (withdrawalRequest.status !== 'provider_unknown') {
        throw new AppError({
          category: 'conflict',
          code: 'WITHDRAWAL_PROVIDER_UNKNOWN_NOT_REVIEWABLE',
          message:
            'Only provider-unknown withdrawals can be marked reviewed',
          details: {
            withdrawalRequestId: withdrawalRequest.withdrawalRequestId,
            status: withdrawalRequest.status,
          },
        })
      }

      const now = this.clock.now()
      const reviewedRequest: WithdrawalRequest = {
        ...withdrawalRequest,
        status: 'provider_unknown_reviewed',
        reviewReasonCode: 'WITHDRAWAL_PROVIDER_UNKNOWN_REVIEWED',
        reviewReasonText: command.reason,
        updatedAt: now,
      }

      await this.withdrawalRepository.update(reviewedRequest, transaction)
      await this.appendAuditEvent(
        'financial.withdrawal.provider_unknown_reviewed',
        reviewedRequest,
        {
          action: 'mark_provider_unknown_reviewed',
          operatorUserId: command.operatorId,
          operatorRole: command.operatorRole,
          reason: command.reason,
          previousStatus: withdrawalRequest.status,
          newStatus: reviewedRequest.status,
          withdrawalRequestId: reviewedRequest.withdrawalRequestId,
          provider: providerSubmission.provider,
          externalWithdrawalId: providerSubmission.externalWithdrawalId,
          externalTransactionId: providerSubmission.externalTransactionId,
          providerStatus: providerSubmission.providerStatus,
          releasedReservation: false,
        },
        command,
        now,
        transaction,
      )
      await this.completeResolutionCommand(
        markWithdrawalProviderUnknownReviewedCommandType,
        command,
        requestPayload,
        reviewedRequest,
        transaction,
      )

      return this.toWithdrawalRequestDto(reviewedRequest, providerSubmission)
    })
  }

  async cancelWithdrawalRequest(
    command: CancelWithdrawalRequestCommandDto,
  ): Promise<WithdrawalRequestDto> {
    const playerId = toUserId(command.playerId)
    const requestPayload: JsonObject = {
      withdrawalRequestId: command.withdrawalRequestId,
      playerId: command.playerId,
      reason: command.reason ?? null,
    }

    return this.database.tx(async (transaction) => {
      const decision = await this.idempotencyService.begin(
        cancelWithdrawalRequestCommandType,
        toIdempotencyKey(command.idempotencyKey),
        requestPayload,
        transaction,
      )

      if (decision.kind === 'replay') {
        return this.getWithdrawalFromSnapshot(
          decision.record.responseSnapshot,
          playerId,
          transaction,
        )
      }

      const withdrawalRequest = await this.requireWithdrawalForUpdate(
        command.withdrawalRequestId,
        transaction,
      )

      if (withdrawalRequest.playerId !== playerId) {
        throw new AppError({
          category: 'forbidden',
          code: 'WITHDRAWAL_REQUEST_CANCEL_FORBIDDEN',
          message:
            'Withdrawal request does not belong to the authenticated player',
        })
      }

      if (withdrawalRequest.status === 'cancelled') {
        await this.completeResolutionCommand(
          cancelWithdrawalRequestCommandType,
          command,
          requestPayload,
          withdrawalRequest,
          transaction,
        )
        return this.toWithdrawalRequestDto(withdrawalRequest)
      }

      this.assertCancellable(withdrawalRequest)
      const now = this.clock.now()
      const releasedLedgerTransactionId =
        await this.releaseReservationIfNeeded(
          withdrawalRequest,
          `withdrawal-cancel-release-${command.idempotencyKey}`,
          command,
          transaction,
        )
      const cancelledRequest: WithdrawalRequest = {
        ...withdrawalRequest,
        status: 'cancelled',
        cancelledAt: now,
        updatedAt: now,
        releaseLedgerTransactionId:
          releasedLedgerTransactionId ??
          withdrawalRequest.releaseLedgerTransactionId,
      }

      await this.withdrawalRepository.update(cancelledRequest, transaction)
      await this.appendAuditEvent(
        'financial.withdrawal.request_cancelled',
        cancelledRequest,
        {
          action: 'cancel',
          playerId,
          reason: command.reason ?? null,
          previousStatus: withdrawalRequest.status,
          newStatus: cancelledRequest.status,
          withdrawalRequestId: cancelledRequest.withdrawalRequestId,
          reservationLedgerTransactionId:
            cancelledRequest.reservationLedgerTransactionId,
          releaseLedgerTransactionId:
            cancelledRequest.releaseLedgerTransactionId,
        },
        command,
        now,
        transaction,
      )
      await this.completeResolutionCommand(
        cancelWithdrawalRequestCommandType,
        command,
        requestPayload,
        cancelledRequest,
        transaction,
      )

      return this.toWithdrawalRequestDto(cancelledRequest)
    })
  }

  private async postReservation(
    withdrawalRequest: WithdrawalRequest,
    playerAccount: PlayerAccount,
    command: CorrelationMetadata & { idempotencyKey: string },
    transaction: DatabaseTransaction,
  ) {
    return this.postingEngineService.postTransferWithinTransaction(
      {
        idempotencyKey: toIdempotencyKey(
          `withdrawal-reserve-${withdrawalRequest.withdrawalRequestId}`,
        ),
        transactionType: 'withdrawal_reserve',
        referenceType: 'withdrawal',
        referenceId: withdrawalRequest.withdrawalRequestId,
        debitAccountId: playerAccount.availableAccountId,
        creditAccountId: playerAccount.reservedAccountId,
        amountMinor: withdrawalRequest.amountMinorUnits,
        currency: withdrawalRequest.currency,
        correlationId: command.correlationId,
        causationId: command.causationId,
      },
      transaction,
    )
  }

  private async matchWithdrawalProviderEvent(
    event: NormalizedWithdrawalProviderEvent,
    transaction: DatabaseTransaction,
  ): Promise<{
    withdrawalRequest: WithdrawalRequest | null
    providerSubmission: WithdrawalProviderSubmission | null
    reviewReasonCode: string | null
    reviewReasonText: string | null
  }> {
    const submissionByExternalWithdrawalId =
      await this.withdrawalRepository.getProviderSubmissionByExternalWithdrawalId(
        event.provider,
        event.externalWithdrawalId,
        transaction,
      )
    const submissionByExternalTransactionId = event.externalTransactionId
      ? await this.withdrawalRepository.getProviderSubmissionByExternalTransactionId(
          event.provider,
          event.externalTransactionId,
          transaction,
        )
      : null
    const submission =
      submissionByExternalWithdrawalId ?? submissionByExternalTransactionId

    let withdrawalRequest: WithdrawalRequest | null = null

    if (event.withdrawalRequestId) {
      withdrawalRequest = await this.withdrawalRepository.getByIdForUpdate(
        toWithdrawalRequestId(event.withdrawalRequestId),
        transaction,
      )
    }

    if (!withdrawalRequest && submission) {
      withdrawalRequest = await this.withdrawalRepository.getByIdForUpdate(
        submission.withdrawalRequestId,
        transaction,
      )
    }

    if (!withdrawalRequest) {
      return {
        withdrawalRequest: null,
        providerSubmission: submission,
        reviewReasonCode: 'WITHDRAWAL_PROVIDER_EVENT_UNMATCHED',
        reviewReasonText:
          'Withdrawal provider callback did not match a known withdrawal request',
      }
    }

    const providerSubmission =
      submission ??
      (await this.withdrawalRepository.getProviderSubmissionByWithdrawalRequestId(
        withdrawalRequest.withdrawalRequestId,
        transaction,
      ))

    if (!providerSubmission) {
      return {
        withdrawalRequest,
        providerSubmission: null,
        reviewReasonCode: 'WITHDRAWAL_PROVIDER_SUBMISSION_MISSING',
        reviewReasonText:
          'Withdrawal provider callback matched a request without submission metadata',
      }
    }

    if (
      withdrawalRequest.provider !== event.provider ||
      providerSubmission.provider !== event.provider ||
      providerSubmission.externalWithdrawalId !== event.externalWithdrawalId ||
      (event.externalTransactionId &&
        providerSubmission.externalTransactionId &&
        providerSubmission.externalTransactionId !== event.externalTransactionId)
    ) {
      return {
        withdrawalRequest,
        providerSubmission,
        reviewReasonCode: 'WITHDRAWAL_PROVIDER_EVENT_REFERENCE_MISMATCH',
        reviewReasonText:
          'Withdrawal provider callback did not match persisted submission references',
      }
    }

    if (
      event.amountMinorUnits &&
      event.amountMinorUnits !== withdrawalRequest.amountMinorUnits
    ) {
      return {
        withdrawalRequest,
        providerSubmission,
        reviewReasonCode: 'WITHDRAWAL_PROVIDER_EVENT_AMOUNT_MISMATCH',
        reviewReasonText:
          'Withdrawal provider callback amount does not match the withdrawal request',
      }
    }

    if (event.currency && event.currency !== withdrawalRequest.currency) {
      return {
        withdrawalRequest,
        providerSubmission,
        reviewReasonCode: 'WITHDRAWAL_PROVIDER_EVENT_CURRENCY_MISMATCH',
        reviewReasonText:
          'Withdrawal provider callback currency does not match the withdrawal request',
      }
    }

    if (this.isTerminalForProviderCallback(withdrawalRequest.status)) {
      return {
        withdrawalRequest,
        providerSubmission,
        reviewReasonCode: 'WITHDRAWAL_PROVIDER_EVENT_FOR_TERMINAL_REQUEST',
        reviewReasonText:
          'Withdrawal provider callback arrived for a terminal withdrawal request',
      }
    }

    return {
      withdrawalRequest,
      providerSubmission,
      reviewReasonCode: null,
      reviewReasonText: null,
    }
  }

  private async applyWebhookEventIfSafe(
    normalized: NormalizedWithdrawalProviderEvent,
    event: WithdrawalProviderEvent,
    withdrawalRequest: WithdrawalRequest | null,
    providerSubmission: WithdrawalProviderSubmission | null,
    reviewReasonCode: string | null,
    reviewReasonText: string | null,
    command: CorrelationMetadata,
    now: Date,
    transaction: DatabaseTransaction,
  ): Promise<WithdrawalRequest | null> {
    if (!withdrawalRequest) {
      await this.appendProviderEventAudit(
        event,
        {
          action: 'withdrawal_provider_webhook_unmatched',
          actorType: 'provider',
          provider: event.provider,
          webhookReceiptId: event.webhookReceiptId,
          providerEventId: event.withdrawalProviderEventId,
          externalWithdrawalId: event.externalWithdrawalId,
          externalTransactionId: event.externalTransactionId,
          providerStatus: event.providerStatus,
          reason: reviewReasonText,
        },
        command,
        now,
        transaction,
      )
      return null
    }

    if (reviewReasonCode) {
      const reviewRequest = this.isTerminalForProviderCallback(
        withdrawalRequest.status,
      )
        ? withdrawalRequest
        : {
            ...withdrawalRequest,
            status: 'review_required' as const,
            reviewReasonCode,
            reviewReasonText,
            updatedAt: now,
          }

      if (reviewRequest !== withdrawalRequest) {
        await this.withdrawalRepository.update(reviewRequest, transaction)
      }

      await this.appendAuditEvent(
        'financial.withdrawal.provider_webhook_review_required',
        reviewRequest,
        {
          action: 'provider_webhook_review_required',
          actorType: 'provider',
          provider: event.provider,
          webhookReceiptId: event.webhookReceiptId,
          providerEventId: event.withdrawalProviderEventId,
          previousStatus: withdrawalRequest.status,
          newStatus: reviewRequest.status,
          reason: reviewReasonText,
          withdrawalRequestId: reviewRequest.withdrawalRequestId,
          externalWithdrawalId: event.externalWithdrawalId,
          externalTransactionId: event.externalTransactionId,
          providerStatus: event.providerStatus,
        },
        command,
        now,
        transaction,
      )
      return reviewRequest
    }

    if (!providerSubmission) {
      return withdrawalRequest
    }

    const updatedSubmission: WithdrawalProviderSubmission = {
      ...providerSubmission,
      providerStatus: normalized.providerStatus,
      lastStatusSyncedAt: now,
      rawProviderPayload: normalized.rawPayload,
      updatedAt: now,
    }
    const updatedWithdrawal = this.applyProviderStatusToWithdrawal(
      withdrawalRequest,
      normalized.providerStatus,
      now,
    )

    await this.withdrawalRepository.updateProviderSubmission(
      updatedSubmission,
      transaction,
    )
    await this.withdrawalRepository.update(updatedWithdrawal, transaction)
    await this.faultInjector.trigger(
      'withdrawal.after_provider_webhook_status_update_before_audit',
      {
        withdrawalRequestId: updatedWithdrawal.withdrawalRequestId,
        providerStatus: normalized.providerStatus,
      },
    )
    await this.appendAuditEvent(
      'financial.withdrawal.provider_webhook_status_updated',
      updatedWithdrawal,
      {
        action: 'provider_webhook_status_update',
        actorType: 'provider',
        provider: event.provider,
        webhookReceiptId: event.webhookReceiptId,
        providerEventId: event.withdrawalProviderEventId,
        previousStatus: withdrawalRequest.status,
        newStatus: updatedWithdrawal.status,
        withdrawalRequestId: updatedWithdrawal.withdrawalRequestId,
        externalWithdrawalId: event.externalWithdrawalId,
        externalTransactionId: event.externalTransactionId,
        providerStatus: normalized.providerStatus,
        finalized: false,
        releasedReservation: false,
      },
      command,
      now,
      transaction,
    )

    return updatedWithdrawal
  }

  private isTerminalForProviderCallback(status: WithdrawalRequestStatus): boolean {
    return (
      status === 'completed' ||
      status === 'cancelled' ||
      status === 'rejected' ||
      status === 'provider_failure_released' ||
      status === 'provider_failed_terminal' ||
      status === 'provider_rejected_terminal' ||
      status === 'provider_unknown_reviewed'
    )
  }

  private async recordWebhookReplayRejection(
    command: IngestWithdrawalProviderWebhookCommandDto,
    event: NormalizedWithdrawalProviderEvent,
  ): Promise<void> {
    await this.database.tx((transaction) =>
      this.withdrawalRepository.recordWebhookReplayRejection(
        {
          withdrawalProviderWebhookReceiptId:
            newWithdrawalProviderWebhookReceiptId(),
          provider: command.provider,
          nonce: command.providerWebhookNonce,
          providerTimestamp: parseProviderWebhookTimestamp(
            command.providerWebhookTimestamp,
          ),
          receivedAt: this.clock.now(),
          requestHash: command.providerWebhookRequestHash,
          signatureVersion: webhookSignatureVersion,
          externalWithdrawalId: event.externalWithdrawalId,
          externalTransactionId: event.externalTransactionId,
          withdrawalRequestId: event.withdrawalRequestId
            ? toWithdrawalRequestId(event.withdrawalRequestId)
            : null,
          status: 'rejected',
          rejectionReason: 'duplicate_nonce',
        },
        transaction,
      ),
    )
  }

  private async postFinalization(
    withdrawalRequest: WithdrawalRequest,
    providerSubmission: WithdrawalProviderSubmission,
    command: CorrelationMetadata,
    transaction: DatabaseTransaction,
  ) {
    if (!withdrawalRequest.reservationLedgerTransactionId) {
      throw new AppError({
        category: 'conflict',
        code: 'WITHDRAWAL_REQUEST_NOT_RESERVED',
        message:
          'Withdrawal request must have a reservation before finalization',
        details: {
          withdrawalRequestId: withdrawalRequest.withdrawalRequestId,
        },
      })
    }

    const playerAccount = await this.playerAccountRepository.getById(
      withdrawalRequest.playerAccountId,
      transaction,
    )

    if (!playerAccount) {
      throw new AppError({
        category: 'not_found',
        code: 'PLAYER_ACCOUNT_NOT_FOUND',
        message: 'Player account for withdrawal finalization was not found',
        details: {
          withdrawalRequestId: withdrawalRequest.withdrawalRequestId,
          playerAccountId: withdrawalRequest.playerAccountId,
        },
      })
    }

    const clearingAccount = await this.requireWithdrawalClearingAccount(
      withdrawalRequest.currency,
      transaction,
    )

    return this.postingEngineService.postTransferWithinTransaction(
      {
        idempotencyKey: toIdempotencyKey(
          `withdrawal-finalize-${withdrawalRequest.withdrawalRequestId}`,
        ),
        transactionType: 'withdrawal_finalized',
        referenceType: 'withdrawal',
        referenceId: withdrawalRequest.withdrawalRequestId,
        relatedTransactionId: withdrawalRequest.reservationLedgerTransactionId,
        debitAccountId: playerAccount.reservedAccountId,
        creditAccountId: clearingAccount.accountId,
        amountMinor: withdrawalRequest.amountMinorUnits,
        currency: withdrawalRequest.currency,
        correlationId: command.correlationId,
        causationId: command.causationId,
      },
      transaction,
    )
  }

  private async requireWithdrawalClearingAccount(
    currency: string,
    transaction: DatabaseTransaction,
  ) {
    const existingAccount = await this.accountRepository.findByOwnerAndType(
      {
        accountType: 'withdrawal_clearing',
        ownerType: 'platform',
        ownerId: withdrawalClearingOwnerId,
        currency,
      },
      transaction,
    )

    if (existingAccount) {
      return existingAccount
    }

    const now = this.clock.now()
    const account = new AccountEntity({
      accountId: newAccountId(),
      accountType: 'withdrawal_clearing',
      ownerType: 'platform',
      ownerId: withdrawalClearingOwnerId,
      currency,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })

    await this.accountRepository.create(account, transaction)
    return account
  }

  private async recoverExistingCreateAttempt(
    existingWithdrawal: WithdrawalRequest,
    command: CreateWithdrawalRequestCommandDto,
    playerId: UserId,
    requestPayload: JsonObject,
    transaction: DatabaseTransaction,
  ): Promise<WithdrawalRequestDto> {
    this.assertCreatePayloadMatchesExisting(existingWithdrawal, command)

    if (existingWithdrawal.playerId !== playerId) {
      throw new AppError({
        category: 'forbidden',
        code: 'WITHDRAWAL_REQUEST_REPLAY_FORBIDDEN',
        message: 'Withdrawal request replay does not belong to the player',
      })
    }

    if (existingWithdrawal.status !== 'reservation_pending') {
      await this.idempotencyService.complete(
        createWithdrawalRequestCommandType,
        toIdempotencyKey(command.idempotencyKey),
        requestPayload,
        {
          withdrawalRequestId: existingWithdrawal.withdrawalRequestId,
        } satisfies WithdrawalSnapshot,
        transaction,
      )
      return this.toWithdrawalRequestDto(existingWithdrawal)
    }

    const playerAccount = await this.requirePlayerAccountForUser(
      playerId,
      command.currency,
      transaction,
    )
    const existingReservation = (
      await this.ledgerRepository.listByReference(
        'withdrawal',
        existingWithdrawal.withdrawalRequestId,
        transaction,
      )
    ).find(
      (ledgerTransaction) =>
        ledgerTransaction.transactionType === 'withdrawal_reserve',
    )
    const reservation =
      existingReservation ??
      (await this.postReservation(
        existingWithdrawal,
        playerAccount,
        command,
        transaction,
      ))
    const now = this.clock.now()
    const recoveredWithdrawal: WithdrawalRequest = {
      ...existingWithdrawal,
      status:
        existingWithdrawal.destinationKind === 'manual_review'
          ? 'review_required'
          : 'reserved',
      reservationLedgerTransactionId: reservation.transactionId,
      reservedAt: existingWithdrawal.reservedAt ?? now,
      updatedAt: now,
    }

    await this.withdrawalRepository.update(recoveredWithdrawal, transaction)
    await this.idempotencyService.complete(
      createWithdrawalRequestCommandType,
      toIdempotencyKey(command.idempotencyKey),
      requestPayload,
      {
        withdrawalRequestId: recoveredWithdrawal.withdrawalRequestId,
      } satisfies WithdrawalSnapshot,
      transaction,
    )

    return this.toWithdrawalRequestDto(recoveredWithdrawal)
  }

  private assertCreatePayloadMatchesExisting(
    existingWithdrawal: WithdrawalRequest,
    command: CreateWithdrawalRequestCommandDto,
  ): void {
    if (
      existingWithdrawal.playerId === command.playerId &&
      existingWithdrawal.currency === command.currency &&
      existingWithdrawal.amountMinorUnits === command.amountMinorUnits &&
      existingWithdrawal.destinationKind === command.destinationKind &&
      existingWithdrawal.destinationReference === command.destinationReference &&
      existingWithdrawal.provider === command.provider
    ) {
      return
    }

    throw new AppError({
      category: 'idempotency_conflict',
      code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
      message:
        'The provided idempotency key was already used with a different withdrawal request payload',
      details: {
        commandType: createWithdrawalRequestCommandType,
        idempotencyKey: command.idempotencyKey,
      },
    })
  }

  private async releaseReservationIfNeeded(
    withdrawalRequest: WithdrawalRequest,
    idempotencyKey: string,
    command: CorrelationMetadata,
    transaction: DatabaseTransaction,
    transactionType:
      | 'withdrawal_reversal'
      | 'withdrawal_provider_failure_release' = 'withdrawal_reversal',
  ): Promise<LedgerTransactionId | null> {
    if (!withdrawalRequest.reservationLedgerTransactionId) {
      return null
    }

    if (withdrawalRequest.releaseLedgerTransactionId) {
      return withdrawalRequest.releaseLedgerTransactionId
    }

    const relatedTransactions =
      await this.ledgerRepository.listByRelatedTransactionId(
        withdrawalRequest.reservationLedgerTransactionId,
        transaction,
      )

    const existingRelease = relatedTransactions.find(
      (ledgerTransaction) =>
        ledgerTransaction.transactionType === transactionType ||
        (transactionType === 'withdrawal_reversal' &&
          ledgerTransaction.transactionType ===
            'withdrawal_provider_failure_release'),
    )

    if (existingRelease) {
      return existingRelease.transactionId
    }

    const reservation = await this.ledgerRepository.getById(
      withdrawalRequest.reservationLedgerTransactionId,
      transaction,
    )

    if (!reservation) {
      throw new AppError({
        category: 'invariant_violation',
        code: 'WITHDRAWAL_RESERVATION_LEDGER_MISSING',
        message:
          'Withdrawal request references a reservation ledger transaction that does not exist',
        details: {
          withdrawalRequestId: withdrawalRequest.withdrawalRequestId,
          reservationLedgerTransactionId:
            withdrawalRequest.reservationLedgerTransactionId,
        },
      })
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
        code: 'WITHDRAWAL_RESERVATION_SHAPE_INVALID',
        message:
          'Withdrawal reservation must have one debit and one credit entry',
        details: { withdrawalRequestId: withdrawalRequest.withdrawalRequestId },
      })
    }

    const release =
      await this.postingEngineService.postTransferWithinTransaction(
        {
          idempotencyKey: toIdempotencyKey(idempotencyKey),
          transactionType,
          referenceType: 'withdrawal',
          referenceId: withdrawalRequest.withdrawalRequestId,
          relatedTransactionId: reservation.transactionId,
          debitAccountId: creditEntry.accountId,
          creditAccountId: debitEntry.accountId,
          amountMinor: withdrawalRequest.amountMinorUnits,
          currency: withdrawalRequest.currency,
          correlationId: command.correlationId,
          causationId: command.causationId,
        },
        transaction,
      )

    await this.faultInjector.trigger(
      'withdrawal.after_release_posting_before_state_finalization',
      {
        withdrawalRequestId: withdrawalRequest.withdrawalRequestId,
        releaseLedgerTransactionId: release.transactionId,
      },
    )

    return release.transactionId
  }

  private assertAlphaSafeDestination(
    command: CreateWithdrawalRequestCommandDto,
  ): void {
    if (command.currency !== supportedCurrency) {
      throw new AppError({
        category: 'validation_error',
        code: 'WITHDRAWAL_CURRENCY_NOT_SUPPORTED',
        message: 'Withdrawal currency is not supported',
        details: { currency: command.currency },
      })
    }

    if (command.provider !== 'simulated') {
      throw new AppError({
        category: 'validation_error',
        code: 'WITHDRAWAL_PROVIDER_NOT_SUPPORTED',
        message: 'Withdrawal provider is not supported in Phase 5',
        details: { provider: command.provider },
      })
    }

    if (!command.destinationReference.trim()) {
      throw new AppError({
        category: 'validation_error',
        code: 'WITHDRAWAL_DESTINATION_REFERENCE_REQUIRED',
        message: 'Withdrawal destination reference is required',
      })
    }
  }

  private async requirePlayerAccountForUser(
    playerId: UserId,
    currency: string,
    transaction: DatabaseTransaction,
  ): Promise<PlayerAccount> {
    const playerAccount =
      await this.playerAccountRepository.findByUserAndCurrency(
        {
          userId: playerId,
          currency,
          accountClass: 'primary',
        },
        transaction,
      )

    if (!playerAccount) {
      throw new AppError({
        category: 'not_found',
        code: 'PLAYER_ACCOUNT_NOT_FOUND',
        message: 'Player account for withdrawal was not found',
        details: { playerId, currency },
      })
    }

    return playerAccount
  }

  private async assertWithdrawalReserveAuthorized(
    playerAccount: PlayerAccount,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    const [statusSnapshot, linkedAvailableAccount] = await Promise.all([
      this.effectiveStatusService.getSnapshot(
        playerAccount.playerAccountId,
        this.clock.now(),
        transaction,
      ),
      this.accountRepository.getById(playerAccount.availableAccountId, transaction),
    ])

    this.authorizationService.assertAuthorized({
      action: 'withdrawal_reserve',
      actorRole: 'player',
      effectiveStatus: statusSnapshot.effectiveStatus,
      controlState: statusSnapshot.controlState,
      linkedCoreAccountId: playerAccount.availableAccountId,
      accountingCorePermitsAction: linkedAvailableAccount?.status === 'active',
    })
  }

  private assertElevatedRole(operatorRole: string, action: string): void {
    if (elevatedWithdrawalRoles.has(operatorRole)) {
      return
    }

    throw new AppError({
      category: 'forbidden',
      code: 'WITHDRAWAL_OPERATOR_ROLE_INSUFFICIENT',
      message:
        'Withdrawal approval requires treasury_admin or financial_admin role',
      details: { operatorRole, action },
    })
  }

  private assertOperatorRole(operatorRole: string, action: string): void {
    if (operatorWithdrawalRoles.has(operatorRole)) {
      return
    }

    throw new AppError({
      category: 'forbidden',
      code: 'WITHDRAWAL_OPERATOR_ROLE_INSUFFICIENT',
      message:
        'Withdrawal provider status sync requires a treasury operator role',
      details: { operatorRole, action },
    })
  }

  private assertSubmittable(withdrawalRequest: WithdrawalRequest): void {
    if (
      withdrawalRequest.status === 'approved' ||
      withdrawalRequest.status === 'submission_pending' ||
      withdrawalRequest.status === 'submitting'
    ) {
      return
    }

    throw new AppError({
      category: 'conflict',
      code: 'WITHDRAWAL_REQUEST_NOT_SUBMITTABLE',
      message:
        'Withdrawal request must be approved before provider submission',
      details: {
        withdrawalRequestId: withdrawalRequest.withdrawalRequestId,
        status: withdrawalRequest.status,
      },
    })
  }

  private assertFinalizableProviderStatus(
    withdrawalRequest: WithdrawalRequest,
  ): void {
    if (withdrawalRequest.status === 'provider_confirmed') {
      return
    }

    throw new AppError({
      category: 'conflict',
      code: 'WITHDRAWAL_REQUEST_NOT_FINALIZABLE',
      message: 'Only provider-confirmed withdrawals can be finalized',
      details: {
        withdrawalRequestId: withdrawalRequest.withdrawalRequestId,
        status: withdrawalRequest.status,
      },
    })
  }

  private assertProviderFailureReleasable(
    withdrawalRequest: WithdrawalRequest,
  ): void {
    if (
      withdrawalRequest.status === 'provider_failed' ||
      withdrawalRequest.status === 'provider_rejected'
    ) {
      return
    }

    if (withdrawalRequest.status === 'provider_unknown') {
      throw new AppError({
        category: 'conflict',
        code: 'WITHDRAWAL_PROVIDER_UNKNOWN_RELEASE_FORBIDDEN',
        message:
          'Provider-unknown withdrawals cannot be released without a confirmed failure or rejection',
        details: {
          withdrawalRequestId: withdrawalRequest.withdrawalRequestId,
          status: withdrawalRequest.status,
        },
      })
    }

    throw new AppError({
      category: 'conflict',
      code: 'WITHDRAWAL_PROVIDER_FAILURE_NOT_RELEASABLE',
      message:
        'Only provider-failed or provider-rejected withdrawals can be released through failure resolution',
      details: {
        withdrawalRequestId: withdrawalRequest.withdrawalRequestId,
        status: withdrawalRequest.status,
      },
    })
  }

  private assertApprovable(withdrawalRequest: WithdrawalRequest): void {
    if (
      withdrawalRequest.status !== 'reserved' &&
      withdrawalRequest.status !== 'review_required'
    ) {
      throw new AppError({
        category: 'conflict',
        code: 'WITHDRAWAL_REQUEST_NOT_APPROVABLE',
        message: 'Withdrawal request is not in an approvable state',
        details: {
          withdrawalRequestId: withdrawalRequest.withdrawalRequestId,
          status: withdrawalRequest.status,
        },
      })
    }

    if (!withdrawalRequest.reservationLedgerTransactionId) {
      throw new AppError({
        category: 'conflict',
        code: 'WITHDRAWAL_REQUEST_NOT_RESERVED',
        message:
          'Withdrawal request must be internally reserved before approval',
        details: { withdrawalRequestId: withdrawalRequest.withdrawalRequestId },
      })
    }
  }

  private assertRejectable(withdrawalRequest: WithdrawalRequest): void {
    if (
      withdrawalRequest.status === 'submitted' ||
      withdrawalRequest.status === 'submitting' ||
      withdrawalRequest.status === 'provider_pending' ||
      withdrawalRequest.status === 'provider_confirmed' ||
      withdrawalRequest.status === 'provider_failed' ||
      withdrawalRequest.status === 'provider_rejected' ||
      withdrawalRequest.status === 'provider_unknown' ||
      withdrawalRequest.status === 'provider_failure_released' ||
      withdrawalRequest.status === 'provider_failed_terminal' ||
      withdrawalRequest.status === 'provider_rejected_terminal' ||
      withdrawalRequest.status === 'provider_unknown_reviewed' ||
      withdrawalRequest.status === 'completed'
    ) {
      throw new AppError({
        category: 'conflict',
        code: 'WITHDRAWAL_REQUEST_ALREADY_SUBMITTED',
        message: 'Submitted/completed withdrawals cannot be rejected in Phase 5',
        details: {
          withdrawalRequestId: withdrawalRequest.withdrawalRequestId,
          status: withdrawalRequest.status,
        },
      })
    }

    if (
      withdrawalRequest.status === 'cancelled' ||
      withdrawalRequest.status === 'rejected'
    ) {
      throw new AppError({
        category: 'conflict',
        code: 'WITHDRAWAL_REQUEST_TERMINAL',
        message: 'Withdrawal request is already terminal',
        details: {
          withdrawalRequestId: withdrawalRequest.withdrawalRequestId,
          status: withdrawalRequest.status,
        },
      })
    }
  }

  private assertCancellable(withdrawalRequest: WithdrawalRequest): void {
    if (
      withdrawalRequest.status === 'approved' ||
      withdrawalRequest.status === 'submission_pending' ||
      withdrawalRequest.status === 'submitting' ||
      withdrawalRequest.status === 'submitted' ||
      withdrawalRequest.status === 'provider_pending' ||
      withdrawalRequest.status === 'provider_confirmed' ||
      withdrawalRequest.status === 'provider_failed' ||
      withdrawalRequest.status === 'provider_rejected' ||
      withdrawalRequest.status === 'provider_unknown' ||
      withdrawalRequest.status === 'provider_failure_released' ||
      withdrawalRequest.status === 'provider_failed_terminal' ||
      withdrawalRequest.status === 'provider_rejected_terminal' ||
      withdrawalRequest.status === 'provider_unknown_reviewed' ||
      withdrawalRequest.status === 'completed'
    ) {
      throw new AppError({
        category: 'conflict',
        code: 'WITHDRAWAL_REQUEST_NOT_CANCELLABLE',
        message:
          'Approved, submitted, or completed withdrawals cannot be cancelled by the player',
        details: {
          withdrawalRequestId: withdrawalRequest.withdrawalRequestId,
          status: withdrawalRequest.status,
        },
      })
    }

    if (
      withdrawalRequest.status === 'cancelled' ||
      withdrawalRequest.status === 'rejected'
    ) {
      throw new AppError({
        category: 'conflict',
        code: 'WITHDRAWAL_REQUEST_TERMINAL',
        message: 'Withdrawal request is already terminal',
        details: {
          withdrawalRequestId: withdrawalRequest.withdrawalRequestId,
          status: withdrawalRequest.status,
        },
      })
    }
  }

  private async requireWithdrawalForUpdate(
    withdrawalRequestId: string,
    transaction: DatabaseTransaction,
  ): Promise<WithdrawalRequest> {
    const withdrawalRequest =
      await this.withdrawalRepository.getByIdForUpdate(
        toWithdrawalRequestId(withdrawalRequestId),
        transaction,
      )

    if (!withdrawalRequest) {
      throw new AppError({
        category: 'not_found',
        code: 'WITHDRAWAL_REQUEST_NOT_FOUND',
        message: 'Withdrawal request was not found',
        details: { withdrawalRequestId },
      })
    }

    return withdrawalRequest
  }

  private async requireProviderSubmission(
    withdrawalRequest: WithdrawalRequest,
    transaction: DatabaseTransaction,
  ): Promise<WithdrawalProviderSubmission> {
    const providerSubmission =
      await this.withdrawalRepository.getProviderSubmissionByWithdrawalRequestId(
        withdrawalRequest.withdrawalRequestId,
        transaction,
      )

    if (!providerSubmission) {
      throw new AppError({
        category: 'conflict',
        code: 'WITHDRAWAL_PROVIDER_SUBMISSION_MISSING',
        message: 'Withdrawal provider submission is required',
        details: {
          withdrawalRequestId: withdrawalRequest.withdrawalRequestId,
        },
      })
    }

    return providerSubmission
  }

  private async findRelatedLedgerTransaction(
    withdrawalRequest: WithdrawalRequest,
    transactionType:
      | 'withdrawal_finalized'
      | 'withdrawal_reversal'
      | 'withdrawal_provider_failure_release',
    transaction: DatabaseTransaction,
  ) {
    return (
      await this.ledgerRepository.listByReference(
        'withdrawal',
        withdrawalRequest.withdrawalRequestId,
        transaction,
      )
    ).find(
      (ledgerTransaction) =>
        ledgerTransaction.transactionType === transactionType,
    )
  }

  private async completeResolutionCommand(
    commandType: string,
    command: CorrelationMetadata & { idempotencyKey: string },
    requestPayload: JsonObject,
    withdrawalRequest: WithdrawalRequest,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    await this.idempotencyService.complete(
      commandType,
      toIdempotencyKey(command.idempotencyKey),
      requestPayload,
      {
        withdrawalRequestId: withdrawalRequest.withdrawalRequestId,
      } satisfies WithdrawalSnapshot,
      transaction,
    )
  }

  private applyProviderStatusToWithdrawal(
    withdrawalRequest: WithdrawalRequest,
    providerStatus: WithdrawalProviderSubmission['providerStatus'],
    updatedAt: Date,
  ): WithdrawalRequest {
    const status = this.withdrawalStatusForProviderStatus(providerStatus)
    const failureReasonCode =
      providerStatus === 'failed' ? 'WITHDRAWAL_PROVIDER_FAILED' : null
    const failureReasonText =
      providerStatus === 'failed'
        ? 'Simulated withdrawal provider reported failure'
        : null
    const reviewReasonCode =
      providerStatus === 'rejected'
        ? 'WITHDRAWAL_PROVIDER_REJECTED'
        : providerStatus === 'unknown'
          ? 'WITHDRAWAL_PROVIDER_STATUS_UNKNOWN'
          : null
    const reviewReasonText =
      providerStatus === 'rejected'
        ? 'Simulated withdrawal provider rejected the submission'
        : providerStatus === 'unknown'
          ? 'Simulated withdrawal provider returned an ambiguous status'
          : null

    return {
      ...withdrawalRequest,
      status,
      failureReasonCode,
      failureReasonText,
      reviewReasonCode,
      reviewReasonText,
      updatedAt,
    }
  }

  private withdrawalStatusForProviderStatus(
    providerStatus: WithdrawalProviderSubmission['providerStatus'],
  ): WithdrawalRequestStatus {
    switch (providerStatus) {
      case 'accepted':
      case 'pending':
        return 'provider_pending'
      case 'confirmed':
        return 'provider_confirmed'
      case 'failed':
        return 'provider_failed'
      case 'rejected':
        return 'provider_rejected'
      case 'unknown':
        return 'provider_unknown'
    }
  }

  private async finalizeExistingProviderSubmissionIfNeeded(
    withdrawalRequest: WithdrawalRequest,
    submission: WithdrawalProviderSubmission,
    transaction: DatabaseTransaction,
  ): Promise<WithdrawalRequest> {
    const expectedStatus = this.withdrawalStatusForProviderStatus(
      submission.providerStatus,
    )

    if (withdrawalRequest.status === expectedStatus) {
      return withdrawalRequest
    }

    if (
      withdrawalRequest.status !== 'approved' &&
      withdrawalRequest.status !== 'submission_pending' &&
      withdrawalRequest.status !== 'submitting'
    ) {
      return withdrawalRequest
    }

    const recoveredWithdrawal = this.applyProviderStatusToWithdrawal(
      withdrawalRequest,
      submission.providerStatus,
      this.clock.now(),
    )

    await this.withdrawalRepository.update(recoveredWithdrawal, transaction)
    return recoveredWithdrawal
  }

  private async getWithdrawalFromSnapshot(
    snapshot: JsonObject | null,
    playerId: UserId | null,
    transaction: DatabaseTransaction,
  ): Promise<WithdrawalRequestDto> {
    const withdrawalRequestId = snapshot?.withdrawalRequestId

    if (typeof withdrawalRequestId !== 'string') {
      throw new AppError({
        category: 'internal_error',
        code: 'INVALID_IDEMPOTENT_WITHDRAWAL_SNAPSHOT',
        message: 'Idempotency replay snapshot is missing withdrawalRequestId',
      })
    }

    const withdrawalRequest = await this.withdrawalRepository.getById(
      toWithdrawalRequestId(withdrawalRequestId),
      transaction,
    )

    if (!withdrawalRequest) {
      throw new AppError({
        category: 'internal_error',
        code: 'IDEMPOTENT_WITHDRAWAL_NOT_FOUND',
        message:
          'Expected withdrawal request from idempotency replay was not found',
        details: { withdrawalRequestId },
      })
    }

    if (playerId && withdrawalRequest.playerId !== playerId) {
      throw new AppError({
        category: 'forbidden',
        code: 'WITHDRAWAL_REQUEST_REPLAY_FORBIDDEN',
        message: 'Withdrawal request replay does not belong to the player',
      })
    }

    const providerSubmission =
      await this.withdrawalRepository.getProviderSubmissionByWithdrawalRequestId(
        withdrawalRequest.withdrawalRequestId,
        transaction,
      )

    return this.toWithdrawalRequestDto(withdrawalRequest, providerSubmission)
  }

  private async markProviderTerminal(
    command: MarkWithdrawalProviderFailureTerminalCommandDto,
    requestPayload: JsonObject,
    commandType: string,
    eventType: string,
    reason: string,
  ): Promise<WithdrawalRequestDto> {
    return this.database.tx(async (transaction) => {
      const decision = await this.idempotencyService.begin(
        commandType,
        toIdempotencyKey(command.idempotencyKey),
        requestPayload,
        transaction,
      )

      if (decision.kind === 'replay') {
        return this.getWithdrawalFromSnapshot(
          decision.record.responseSnapshot,
          null,
          transaction,
        )
      }

      const withdrawalRequest = await this.requireWithdrawalForUpdate(
        command.withdrawalRequestId,
        transaction,
      )
      const providerSubmission =
        await this.requireProviderSubmission(withdrawalRequest, transaction)

      if (
        withdrawalRequest.status === 'provider_failed_terminal' ||
        withdrawalRequest.status === 'provider_rejected_terminal'
      ) {
        await this.completeResolutionCommand(
          commandType,
          command,
          requestPayload,
          withdrawalRequest,
          transaction,
        )
        return this.toWithdrawalRequestDto(withdrawalRequest, providerSubmission)
      }

      if (
        withdrawalRequest.status !== 'provider_failed' &&
        withdrawalRequest.status !== 'provider_rejected'
      ) {
        throw new AppError({
          category: 'conflict',
          code: 'WITHDRAWAL_PROVIDER_FAILURE_NOT_TERMINAL_MARKABLE',
          message:
            'Only provider-failed or provider-rejected withdrawals can be marked terminal',
          details: {
            withdrawalRequestId: withdrawalRequest.withdrawalRequestId,
            status: withdrawalRequest.status,
          },
        })
      }

      const now = this.clock.now()
      const terminalRequest: WithdrawalRequest = {
        ...withdrawalRequest,
        status:
          withdrawalRequest.status === 'provider_failed'
            ? 'provider_failed_terminal'
            : 'provider_rejected_terminal',
        reviewReasonCode:
          withdrawalRequest.status === 'provider_failed'
            ? 'WITHDRAWAL_PROVIDER_FAILED_TERMINAL'
            : 'WITHDRAWAL_PROVIDER_REJECTED_TERMINAL',
        reviewReasonText: reason,
        updatedAt: now,
      }

      await this.withdrawalRepository.update(terminalRequest, transaction)
      await this.appendAuditEvent(
        eventType,
        terminalRequest,
        {
          action: 'mark_provider_failure_terminal',
          operatorUserId: command.operatorId,
          operatorRole: command.operatorRole,
          reason,
          previousStatus: withdrawalRequest.status,
          newStatus: terminalRequest.status,
          withdrawalRequestId: terminalRequest.withdrawalRequestId,
          provider: providerSubmission.provider,
          externalWithdrawalId: providerSubmission.externalWithdrawalId,
          externalTransactionId: providerSubmission.externalTransactionId,
          providerStatus: providerSubmission.providerStatus,
          releasedReservation: false,
        },
        command,
        now,
        transaction,
      )
      await this.completeResolutionCommand(
        commandType,
        command,
        requestPayload,
        terminalRequest,
        transaction,
      )

      return this.toWithdrawalRequestDto(terminalRequest, providerSubmission)
    })
  }

  private async appendAuditEvent(
    eventType: string,
    withdrawalRequest: WithdrawalRequest,
    payload: JsonObject,
    correlation: CorrelationMetadata,
    createdAt: Date,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    const metadata = requireCorrelationMetadata(correlation)
    const event: AuditEvent = {
      auditEventId: newAuditEventId(),
      eventType,
      entityType: 'withdrawal_request',
      entityId: withdrawalRequest.withdrawalRequestId,
      correlationId: metadata.correlationId,
      causationId: metadata.causationId,
      payload,
      createdAt,
    }

    await this.auditEventRepository.append(event, transaction)
  }

  private async appendProviderEventAudit(
    event: WithdrawalProviderEvent,
    payload: JsonObject,
    correlation: CorrelationMetadata,
    createdAt: Date,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    const metadata = requireCorrelationMetadata(correlation)
    const auditEvent: AuditEvent = {
      auditEventId: newAuditEventId(),
      eventType: 'financial.withdrawal.provider_webhook_event_recorded',
      entityType: 'withdrawal_provider_event',
      entityId: event.withdrawalProviderEventId,
      correlationId: metadata.correlationId,
      causationId: metadata.causationId,
      payload,
      createdAt,
    }

    await this.auditEventRepository.append(auditEvent, transaction)
  }

  private toWithdrawalRequestDto(
    withdrawalRequest: WithdrawalRequest,
    providerSubmission: WithdrawalProviderSubmission | null = null,
  ): WithdrawalRequestDto {
    return {
      withdrawalRequestId: withdrawalRequest.withdrawalRequestId,
      playerId: withdrawalRequest.playerId,
      playerAccountId: withdrawalRequest.playerAccountId,
      currency: withdrawalRequest.currency,
      amountMinorUnits: withdrawalRequest.amountMinorUnits,
      destinationKind: withdrawalRequest.destinationKind,
      destinationReference: withdrawalRequest.destinationReference,
      provider: withdrawalRequest.provider,
      status: withdrawalRequest.status,
      reservationLedgerTransactionId:
        withdrawalRequest.reservationLedgerTransactionId,
      releaseLedgerTransactionId: withdrawalRequest.releaseLedgerTransactionId,
      finalizationLedgerTransactionId:
        withdrawalRequest.finalizationLedgerTransactionId,
      reviewReasonCode: withdrawalRequest.reviewReasonCode,
      reviewReasonText: withdrawalRequest.reviewReasonText,
      failureReasonCode: withdrawalRequest.failureReasonCode,
      failureReasonText: withdrawalRequest.failureReasonText,
      createdAt: withdrawalRequest.createdAt.toISOString(),
      updatedAt: withdrawalRequest.updatedAt.toISOString(),
      requestedAt: withdrawalRequest.requestedAt.toISOString(),
      reservedAt: withdrawalRequest.reservedAt?.toISOString() ?? null,
      approvedAt: withdrawalRequest.approvedAt?.toISOString() ?? null,
      rejectedAt: withdrawalRequest.rejectedAt?.toISOString() ?? null,
      cancelledAt: withdrawalRequest.cancelledAt?.toISOString() ?? null,
      providerSubmission: providerSubmission
        ? this.toProviderSubmissionDto(providerSubmission)
        : null,
    }
  }

  private toProviderSubmissionDto(
    submission: WithdrawalProviderSubmission,
  ): WithdrawalProviderSubmissionDto {
    return {
      withdrawalRequestId: submission.withdrawalRequestId,
      provider: submission.provider,
      externalWithdrawalId: submission.externalWithdrawalId,
      externalTransactionId: submission.externalTransactionId,
      providerStatus: submission.providerStatus,
      submissionAttemptCount: submission.submissionAttemptCount,
      lastSubmittedAt: submission.lastSubmittedAt.toISOString(),
      lastStatusSyncedAt:
        submission.lastStatusSyncedAt?.toISOString() ?? null,
      providerIdempotencyKey: submission.providerIdempotencyKey,
      createdAt: submission.createdAt.toISOString(),
      updatedAt: submission.updatedAt.toISOString(),
    }
  }

  private toReviewItemDto(item: WithdrawalReviewItem): WithdrawalReviewItemDto {
    return {
      withdrawalRequestId: item.withdrawalRequestId,
      playerId: item.playerId,
      playerAccountId: item.playerAccountId,
      currency: item.currency,
      amountMinorUnits: item.amountMinorUnits,
      destinationKind: item.destinationKind,
      destinationReference: item.destinationReference,
      provider: item.provider,
      status: item.status,
      reasonCode: item.reasonCode,
      reasonText: item.reasonText,
      updatedAt: item.updatedAt.toISOString(),
    }
  }

  private toIssueDto(
    issue: WithdrawalReconciliationIssue,
  ): WithdrawalReconciliationReportDto['issues'][number] {
    return {
      code: issue.code,
      severity: issue.severity,
      entityType: issue.entityType,
      entityId: issue.entityId,
      details: issue.details,
    }
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
