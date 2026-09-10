import { randomUUID } from 'node:crypto'

import type { AuditEvent } from '../../../shared/audit/AuditEvent.js'
import type {
  Database,
  DatabaseTransaction,
  QueryResultRow,
} from '../../../shared/db/Database.js'
import { toIdempotencyKey } from '../../../shared/idempotency/types.js'
import type { Clock } from '../../../shared/time/Clock.js'
import { AppError } from '../../../shared/types/AppError.js'
import { isJsonValue, type JsonObject } from '../../../shared/types/Json.js'
import type { AuditEventRepository } from '../../accounting/repositories/AuditEventRepository.js'
import type { BalanceMaintenanceService } from '../../accounting/services/BalanceMaintenanceService.js'
import { newAuditEventId } from '../../accounting/types/identifiers.js'
import type { PlayerAccountRepository } from '../../account/repositories/PlayerAccountRepository.js'
import type { AccountControlService } from '../../account/services/AccountControlService.js'
import { toUserId } from '../../account/types/identifiers.js'
import { toAccountRestrictionId } from '../../account/types/identifiers.js'
import type { DepositService } from '../../deposits/services/DepositService.js'
import type { WithdrawalService } from '../../withdrawals/services/WithdrawalService.js'
import type { Discrepancy, DiscrepancyStatus } from '../entities/Discrepancy.js'
import type {
  DiscrepancyWorkflowCommandDto,
  DiscrepancyDto,
  ListDiscrepanciesQueryDto,
  OperatorCommandDto,
  ReconciliationMaterializationDto,
  RiskFreezeCommandDto,
  RiskUnfreezeCommandDto,
} from '../dto/operationsDtos.js'
import type {
  DiscrepancyInput,
  MaterializedDiscrepancyResult,
  OperationsRepository,
} from '../repositories/OperationsRepository.js'

const operatorRoles = new Set([
  'operator',
  'finance_operator',
  'treasury_operator',
  'treasury_admin',
  'financial_admin',
  'admin',
])
const elevatedRoles = new Set(['treasury_admin', 'financial_admin', 'admin'])

interface ActiveRestrictionRow extends QueryResultRow {
  restriction_id: string
}

interface ActiveFreezeRow extends QueryResultRow {
  freeze_id: string
}

interface TimelineRow extends QueryResultRow {
  item_type: string
  item_id: string
  status: string
  occurred_at: Date | string
}

function toJsonObject(value: unknown): JsonObject {
  if (
    !isJsonValue(value) ||
    value === null ||
    Array.isArray(value) ||
    typeof value !== 'object'
  ) {
    return {}
  }

  return value
}

export class OperationsService {
  constructor(
    private readonly database: Database,
    private readonly operationsRepository: OperationsRepository,
    private readonly depositService: DepositService,
    private readonly withdrawalService: WithdrawalService,
    private readonly balanceMaintenanceService: BalanceMaintenanceService,
    private readonly auditEventRepository: AuditEventRepository,
    private readonly playerAccountRepository: PlayerAccountRepository,
    private readonly accountControlService: AccountControlService,
    private readonly clock: Clock,
  ) {}

  async runReconciliationMaterialization(
    command: OperatorCommandDto,
  ): Promise<ReconciliationMaterializationDto> {
    this.assertOperator(command.operatorRole)
    const scannedAt = this.clock.now()
    const [depositReport, withdrawalReport, balanceReport] = await Promise.all([
      this.depositService.detectReconciliation(),
      this.withdrawalService.detectReconciliation(),
      this.balanceMaintenanceService.verifyBalances(),
    ])
    const issues: DiscrepancyInput[] = [
      ...depositReport.issues.map((issue) => ({
        dedupeKey: `deposit:${issue.code}:${issue.entityType}:${issue.entityId}`,
        category: `deposit.${issue.code}`,
        severity: issue.severity,
        entityType: issue.entityType,
        entityId: issue.entityId,
        relatedIds: {},
        summary: `Deposit reconciliation issue ${issue.code}`,
        detailsPayload: toJsonObject(issue.details),
        detectedAt: scannedAt,
      })),
      ...withdrawalReport.issues.map((issue) => ({
        dedupeKey: `withdrawal:${issue.code}:${issue.entityType}:${issue.entityId}`,
        category: `withdrawal.${issue.code}`,
        severity: issue.severity,
        entityType: issue.entityType,
        entityId: issue.entityId,
        relatedIds: {},
        summary: `Withdrawal reconciliation issue ${issue.code}`,
        detailsPayload: toJsonObject(issue.details),
        detectedAt: scannedAt,
      })),
      ...balanceReport.mismatches.map((mismatch) => ({
        dedupeKey: `accounting:balance_mismatch:account:${mismatch.accountId}`,
        category: 'accounting.balance_mismatch',
        severity: 'incident' as const,
        entityType: 'account',
        entityId: mismatch.accountId,
        relatedIds: { accountId: mismatch.accountId },
        summary: 'Account balance read model mismatch',
        detailsPayload: toJsonObject(mismatch),
        detectedAt: scannedAt,
      })),
    ]

    const results = await this.database.tx(async (transaction) => {
      const materialized: MaterializedDiscrepancyResult[] = []
      for (const issue of issues) {
        materialized.push(
          await this.operationsRepository.materializeDiscrepancy(
            issue,
            transaction,
          ),
        )
      }
      return materialized
    })
    const discrepancies = results.map((result) => result.discrepancy)
    const bySeverity = this.countBy(discrepancies.map((item) => item.severity))
    const byStatus = this.countBy(discrepancies.map((item) => item.status))

    await this.auditSystemEvent(
      'financial.operations.reconciliation_materialized',
      'operational_reconciliation',
      'global',
      {
        actorType: 'operator',
        operatorUserId: command.operatorId,
        operatorRole: command.operatorRole,
        action: 'run_reconciliation_materialization',
        scannedIssueCount: issues.length,
        openedCount: results.filter((result) => result.outcome === 'opened')
          .length,
        reopenedCount: results.filter((result) => result.outcome === 'reopened')
          .length,
        refreshedCount: results.filter((result) => result.outcome === 'refreshed')
          .length,
      },
      command,
      scannedAt,
    )

    return {
      scannedAt: scannedAt.toISOString(),
      scannedIssueCount: issues.length,
      openedCount: results.filter((result) => result.outcome === 'opened')
        .length,
      reopenedCount: results.filter((result) => result.outcome === 'reopened')
        .length,
      refreshedCount: results.filter((result) => result.outcome === 'refreshed')
        .length,
      bySeverity,
      byStatus,
      discrepancies: discrepancies.map(toDiscrepancyDto),
    }
  }

  async listDiscrepancies(
    criteria: ListDiscrepanciesQueryDto,
  ): Promise<DiscrepancyDto[]> {
    const repositoryCriteria: {
      status?: DiscrepancyStatus
      severity?: 'info' | 'warning' | 'incident'
      category?: string
    } = {}
    if (criteria.status) repositoryCriteria.status = criteria.status
    if (criteria.severity) repositoryCriteria.severity = criteria.severity
    if (criteria.category) repositoryCriteria.category = criteria.category
    const discrepancies =
      await this.operationsRepository.listDiscrepancies(repositoryCriteria)
    return discrepancies.map(toDiscrepancyDto)
  }

  async getDiscrepancy(discrepancyId: string): Promise<DiscrepancyDto> {
    const discrepancy =
      await this.operationsRepository.getDiscrepancyById(discrepancyId)

    if (!discrepancy) {
      throw new AppError({
        category: 'not_found',
        code: 'DISCREPANCY_NOT_FOUND',
        message: 'Operational discrepancy was not found',
      })
    }

    return toDiscrepancyDto(discrepancy)
  }

  acknowledgeDiscrepancy(
    command: DiscrepancyWorkflowCommandDto,
  ): Promise<DiscrepancyDto> {
    this.assertOperator(command.operatorRole)
    return this.transitionDiscrepancy(command, 'acknowledge', 'acknowledged')
  }

  assignDiscrepancy(
    command: DiscrepancyWorkflowCommandDto,
  ): Promise<DiscrepancyDto> {
    this.assertOperator(command.operatorRole)
    if (!command.assignedToOperatorId) {
      throw new AppError({
        category: 'validation_error',
        code: 'DISCREPANCY_ASSIGNEE_REQUIRED',
        message: 'Discrepancy assignment requires an operator id',
      })
    }
    return this.transitionDiscrepancy(command, 'assign', 'in_progress')
  }

  resolveDiscrepancy(
    command: DiscrepancyWorkflowCommandDto,
  ): Promise<DiscrepancyDto> {
    this.assertOperator(command.operatorRole)
    this.requireReason(command.reason, 'DISCREPANCY_RESOLUTION_REASON_REQUIRED')
    return this.transitionDiscrepancy(command, 'resolve', 'resolved')
  }

  suppressDiscrepancy(
    command: DiscrepancyWorkflowCommandDto,
  ): Promise<DiscrepancyDto> {
    this.assertElevated(command.operatorRole)
    this.requireReason(command.reason, 'DISCREPANCY_SUPPRESSION_REASON_REQUIRED')
    return this.transitionDiscrepancy(command, 'suppress', 'suppressed')
  }

  reopenDiscrepancy(
    command: DiscrepancyWorkflowCommandDto,
  ): Promise<DiscrepancyDto> {
    this.assertOperator(command.operatorRole)
    this.requireReason(command.reason, 'DISCREPANCY_REOPEN_REASON_REQUIRED')
    return this.transitionDiscrepancy(command, 'reopen', 'open')
  }

  async getLedgerBalanceCheck() {
    const verification = await this.balanceMaintenanceService.verifyBalances()
    return {
      verifiedAt: verification.verifiedAt.toISOString(),
      totalAccounts: verification.totalAccounts,
      mismatchCount: verification.mismatchCount,
      mismatches: verification.mismatches,
    }
  }

  async getAccountingIntegrity() {
    const negativeBalances = await this.database.query<QueryResultRow & {
      count: number
    }>(
      `
        SELECT count(*)::int AS count
        FROM account_balances b
        JOIN accounts a ON a.account_id = b.account_id
        WHERE a.account_type IN ('user_available', 'user_locked', 'user_withdrawal_reserved')
          AND b.balance_minor < 0
      `,
    )
    const outstandingReservations = await this.database.query<QueryResultRow & {
      transaction_type: string
      count: number
      amount_minor: string | number
    }>(
      `
        SELECT transaction_type,
               count(*)::int AS count,
               COALESCE(sum(transaction_amount_minor), 0::NUMERIC(20,0)) AS amount_minor
        FROM (
          SELECT t.transaction_id,
                 t.transaction_type,
                 max(e.amount_minor) AS transaction_amount_minor
          FROM ledger_transactions t
          JOIN ledger_entries e ON e.transaction_id = t.transaction_id
          WHERE t.transaction_type IN ('bet_reserve', 'withdrawal_reserve')
          GROUP BY t.transaction_id, t.transaction_type
        ) reservations
        GROUP BY transaction_type
        ORDER BY transaction_type
      `,
    )

    return {
      checkedAt: this.clock.now().toISOString(),
      negativeForbiddenBalanceCount: negativeBalances.rows[0]?.count ?? 0,
      outstandingReservations: outstandingReservations.rows.map((row) => ({
        transactionType: row.transaction_type,
        count: row.count,
        amountMinor: String(row.amount_minor),
      })),
    }
  }

  async getTreasurySummary() {
    const rows = await this.database.query<QueryResultRow & {
      bucket: string
      count: number
      amount_minor: string | number
    }>(
      `
        SELECT 'withdrawal_requests_' || status AS bucket,
               count(*)::int AS count,
               COALESCE(sum(amount_minor_units), 0::NUMERIC(20,0)) AS amount_minor
        FROM withdrawal_requests
        GROUP BY status
        UNION ALL
        SELECT 'deposit_intents_' || status AS bucket,
               count(*)::int AS count,
               COALESCE(sum(expected_amount_minor), 0::NUMERIC(20,0)) AS amount_minor
        FROM deposit_intents
        GROUP BY status
        UNION ALL
        SELECT 'discrepancies_' || severity AS bucket,
               count(*)::int AS count,
               0::NUMERIC(20,0) AS amount_minor
        FROM operational_discrepancies
        WHERE status NOT IN ('resolved', 'suppressed')
        GROUP BY severity
        ORDER BY bucket
      `,
    )

    return {
      checkedAt: this.clock.now().toISOString(),
      buckets: rows.rows.map((row) => ({
        bucket: row.bucket,
        count: row.count,
        amountMinor: String(row.amount_minor),
      })),
    }
  }

  async freezeRiskAccount(command: RiskFreezeCommandDto) {
    this.assertElevated(command.operatorRole)
    const playerAccount = await this.requirePlayerAccount(
      command.playerId,
      command.currency,
    )
    const existing = await this.activeRiskControls(playerAccount.playerAccountId)

    if (command.scope === 'withdrawals') {
      if (existing.restrictionIds.length === 0) {
        await this.accountControlService.applyRestriction({
          playerAccountId: playerAccount.playerAccountId,
          actorType: 'admin_user',
          actorId: command.operatorId,
          source: 'phase_6_risk_controls',
          idempotencyKey: toIdempotencyKey(command.idempotencyKey),
          correlationId: command.correlationId,
          causationId: command.causationId,
          blockedActions: ['withdrawal_reserve'],
          reasonCode: 'RISK_WITHDRAWAL_FREEZE',
          reasonText: command.reason,
          ticketId: command.ticketId ?? null,
          expiresAt: null,
        })
      }
    } else if (existing.freezeIds.length === 0) {
      await this.accountControlService.applyFreeze({
        playerAccountId: playerAccount.playerAccountId,
        actorType: 'admin_user',
        actorId: command.operatorId,
        source: 'phase_6_risk_controls',
        idempotencyKey: toIdempotencyKey(command.idempotencyKey),
        correlationId: command.correlationId,
        causationId: command.causationId,
        reasonCode: 'RISK_ACCOUNT_FREEZE',
        reasonText: command.reason,
        ticketId: command.ticketId ?? null,
      })
    }

    await this.auditSystemEvent(
      'financial.operations.risk_account_frozen',
      'player_account',
      playerAccount.playerAccountId,
      {
        actorType: 'operator',
        operatorUserId: command.operatorId,
        operatorRole: command.operatorRole,
        action: 'risk_freeze',
        playerId: command.playerId,
        scope: command.scope,
        reason: command.reason!,
      },
      command,
      this.clock.now(),
    )

    return this.getRiskAccount(command.playerId, command.currency)
  }

  async unfreezeRiskAccount(command: RiskUnfreezeCommandDto) {
    this.assertElevated(command.operatorRole)
    const playerAccount = await this.requirePlayerAccount(
      command.playerId,
      command.currency,
    )
    const existing = await this.activeRiskControls(playerAccount.playerAccountId)

    for (const restrictionId of existing.restrictionIds) {
      await this.accountControlService.liftRestriction({
        playerAccountId: playerAccount.playerAccountId,
        restrictionId: toAccountRestrictionId(restrictionId),
        actorType: 'admin_user',
        actorId: command.operatorId,
        source: 'phase_6_risk_controls',
        idempotencyKey: toIdempotencyKey(
          `${command.idempotencyKey}-restriction-${restrictionId}`,
        ),
        correlationId: command.correlationId,
        causationId: command.causationId,
        liftReasonCode: 'RISK_CONTROL_LIFTED',
        liftReasonText: command.reason,
        ticketId: command.ticketId ?? null,
      })
    }

    if (existing.freezeIds.length > 0) {
      await this.accountControlService.liftFreeze({
        playerAccountId: playerAccount.playerAccountId,
        actorType: 'admin_user',
        actorId: command.operatorId,
        source: 'phase_6_risk_controls',
        idempotencyKey: toIdempotencyKey(
          `${command.idempotencyKey}-freeze`,
        ),
        correlationId: command.correlationId,
        causationId: command.causationId,
        liftReasonCode: 'RISK_CONTROL_LIFTED',
        liftReasonText: command.reason,
        ticketId: command.ticketId ?? null,
      })
    }

    await this.auditSystemEvent(
      'financial.operations.risk_account_unfrozen',
      'player_account',
      playerAccount.playerAccountId,
      {
        actorType: 'operator',
        operatorUserId: command.operatorId,
        operatorRole: command.operatorRole,
        action: 'risk_unfreeze',
        playerId: command.playerId,
        reason: command.reason,
        liftedRestrictionCount: existing.restrictionIds.length,
        liftedFreezeCount: existing.freezeIds.length,
      },
      command,
      this.clock.now(),
    )

    return this.getRiskAccount(command.playerId, command.currency)
  }

  async getRiskAccount(playerId: string, currency = 'USDC') {
    const playerAccount = await this.requirePlayerAccount(playerId, currency)
    const controls = await this.activeRiskControls(playerAccount.playerAccountId)

    return {
      playerId,
      playerAccountId: playerAccount.playerAccountId,
      currency,
      withdrawalFrozen: controls.restrictionIds.length > 0 || controls.freezeIds.length > 0,
      accountFrozen: controls.freezeIds.length > 0,
      activeRestrictionIds: controls.restrictionIds,
      activeFreezeIds: controls.freezeIds,
    }
  }

  async rebuildBalances(command: OperatorCommandDto & { reason?: string }) {
    this.assertElevated(command.operatorRole)
    this.requireReason(command.reason, 'BALANCE_REBUILD_REASON_REQUIRED')
    const reason = command.reason ?? ''
    const result = await this.balanceMaintenanceService.rebuildBalances(command)
    await this.auditSystemEvent(
      'financial.operations.balance_rebuild_requested',
      'account_balance_read_model',
      'global',
      {
        actorType: 'operator',
        operatorUserId: command.operatorId,
        operatorRole: command.operatorRole,
        action: 'balance_rebuild',
        reason,
        rebuiltAccountCount: result.rebuiltAccountCount,
        mismatchCountBefore: result.mismatchCountBefore,
      },
      command,
      result.rebuiltAt,
    )
    return {
      rebuiltAt: result.rebuiltAt.toISOString(),
      rebuiltAccountCount: result.rebuiltAccountCount,
      mismatchCountBefore: result.mismatchCountBefore,
    }
  }

  async playerFinancialTimeline(playerId: string) {
    const rows = await this.database.query<TimelineRow>(
      `
        SELECT 'withdrawal_request' AS item_type, withdrawal_request_id AS item_id, status, created_at AS occurred_at
        FROM withdrawal_requests
        WHERE player_id = $1
        UNION ALL
        SELECT 'deposit_intent' AS item_type, deposit_intent_id AS item_id, status, created_at AS occurred_at
        FROM deposit_intents
        WHERE user_id = $1
        UNION ALL
        SELECT 'audit_event' AS item_type, audit_event_id AS item_id, event_type AS status, created_at AS occurred_at
        FROM audit_events
        WHERE payload::text LIKE $2
        ORDER BY occurred_at ASC, item_id ASC
      `,
      [playerId, `%${playerId}%`],
    )

    return { playerId, items: rows.rows.map(toTimelineItemDto) }
  }

  async depositTimeline(depositIntentId: string) {
    return this.timelineForReference('deposit', depositIntentId)
  }

  async withdrawalTimeline(withdrawalRequestId: string) {
    return this.timelineForReference('withdrawal', withdrawalRequestId)
  }

  private async timelineForReference(referenceType: string, referenceId: string) {
    const rows = await this.database.query<TimelineRow>(
      `
        SELECT 'ledger_transaction' AS item_type, transaction_id AS item_id, transaction_type AS status, created_at AS occurred_at
        FROM ledger_transactions
        WHERE reference_type = $1 AND reference_id = $2
        UNION ALL
        SELECT 'audit_event' AS item_type, audit_event_id AS item_id, event_type AS status, created_at AS occurred_at
        FROM audit_events
        WHERE entity_id = $2 OR payload::text LIKE $3
        ORDER BY occurred_at ASC, item_id ASC
      `,
      [referenceType, referenceId, `%${referenceId}%`],
    )

    return { referenceType, referenceId, items: rows.rows.map(toTimelineItemDto) }
  }

  private async transitionDiscrepancy(
    command: DiscrepancyWorkflowCommandDto,
    action: string,
    newStatus: DiscrepancyStatus,
  ): Promise<DiscrepancyDto> {
    return this.database.tx(async (transaction) => {
      const now = this.clock.now()
      const discrepancy =
        await this.operationsRepository.getDiscrepancyByIdForUpdate(
          command.discrepancyId,
          transaction,
        )

      if (!discrepancy) {
        throw new AppError({
          category: 'not_found',
          code: 'DISCREPANCY_NOT_FOUND',
          message: 'Operational discrepancy was not found',
        })
      }

      this.assertValidTransition(discrepancy.status, newStatus)
      const updated: Discrepancy = {
        ...discrepancy,
        status: newStatus,
        assignedToOperatorId:
          command.assignedToOperatorId ?? discrepancy.assignedToOperatorId,
        resolutionReason:
          newStatus === 'resolved' || newStatus === 'suppressed'
            ? command.reason!
            : newStatus === 'open'
              ? null
              : discrepancy.resolutionReason,
        resolvedAt:
          newStatus === 'resolved' || newStatus === 'suppressed'
            ? now
            : newStatus === 'open'
              ? null
              : discrepancy.resolvedAt,
        updatedAt: now,
      }

      await this.operationsRepository.updateDiscrepancy(updated, transaction)
      await this.operationsRepository.appendDiscrepancyHistory(
        {
          discrepancyHistoryId: `disc_hist_${randomUUID()}`,
          discrepancyId: discrepancy.discrepancyId,
          action,
          operatorUserId: command.operatorId,
          operatorRole: command.operatorRole,
          reason: command.reason ?? null,
          previousStatus: discrepancy.status,
          newStatus,
          metadata: {
            assignedToOperatorId: command.assignedToOperatorId ?? null,
          },
          createdAt: now,
        },
        transaction,
      )
      await this.appendAuditEvent(
        'financial.operations.discrepancy_workflow',
        'operational_discrepancy',
        discrepancy.discrepancyId,
        {
          actorType: 'operator',
          operatorUserId: command.operatorId,
          operatorRole: command.operatorRole,
          action,
          reason: command.reason ?? null,
          previousStatus: discrepancy.status,
          newStatus,
          targetEntityType: discrepancy.entityType,
          targetEntityId: discrepancy.entityId,
        },
        command,
        now,
        transaction,
      )

      return toDiscrepancyDto(updated)
    })
  }

  private assertValidTransition(
    current: DiscrepancyStatus,
    next: DiscrepancyStatus,
  ): void {
    const allowed: Record<DiscrepancyStatus, DiscrepancyStatus[]> = {
      open: ['acknowledged', 'in_progress', 'resolved', 'suppressed'],
      acknowledged: ['in_progress', 'resolved', 'suppressed', 'open'],
      in_progress: ['resolved', 'suppressed', 'open'],
      resolved: ['open'],
      suppressed: ['open'],
    }

    if (!allowed[current].includes(next)) {
      throw new AppError({
        category: 'conflict',
        code: 'DISCREPANCY_INVALID_TRANSITION',
        message: 'Discrepancy workflow transition is not allowed',
        details: { current, next },
      })
    }
  }

  private async requirePlayerAccount(playerId: string, currency: string) {
    const playerAccount = await this.playerAccountRepository.findByUserAndCurrency({
      userId: toUserId(playerId),
      currency,
      accountClass: 'primary',
    })

    if (!playerAccount) {
      throw new AppError({
        category: 'not_found',
        code: 'PLAYER_ACCOUNT_NOT_FOUND',
        message: 'Player account was not found',
        details: { playerId, currency },
      })
    }

    return playerAccount
  }

  private async activeRiskControls(playerAccountId: string): Promise<{
    restrictionIds: string[]
    freezeIds: string[]
  }> {
    const [restrictions, freezes] = await Promise.all([
      this.database.query<ActiveRestrictionRow>(
        `
          SELECT restriction_id
          FROM account_restrictions
          WHERE player_account_id = $1
            AND lifted_at IS NULL
            AND reason_code LIKE 'RISK_%'
        `,
        [playerAccountId],
      ),
      this.database.query<ActiveFreezeRow>(
        `
          SELECT freeze_id
          FROM account_freezes
          WHERE player_account_id = $1
            AND lifted_at IS NULL
            AND reason_code LIKE 'RISK_%'
        `,
        [playerAccountId],
      ),
    ])

    return {
      restrictionIds: restrictions.rows.map((row) => row.restriction_id),
      freezeIds: freezes.rows.map((row) => row.freeze_id),
    }
  }

  private assertOperator(role: string): void {
    if (operatorRoles.has(role)) return
    throw new AppError({
      category: 'forbidden',
      code: 'OPERATIONS_OPERATOR_ROLE_INSUFFICIENT',
      message: 'Operator role is not authorized for operational action',
      details: { role },
    })
  }

  private assertElevated(role: string): void {
    if (elevatedRoles.has(role)) return
    throw new AppError({
      category: 'forbidden',
      code: 'OPERATIONS_OPERATOR_ROLE_INSUFFICIENT',
      message: 'Elevated operator role is required for operational action',
      details: { role },
    })
  }

  private requireReason(reason: string | undefined, code: string): void {
    if (reason?.trim()) return
    throw new AppError({
      category: 'validation_error',
      code,
      message: 'Operational action requires a reason',
    })
  }

  private countBy(values: string[]): Record<string, number> {
    return values.reduce<Record<string, number>>((counts, value) => {
      counts[value] = (counts[value] ?? 0) + 1
      return counts
    }, {})
  }

  private async auditSystemEvent(
    eventType: string,
    entityType: string,
    entityId: string,
    payload: JsonObject,
    correlation: { correlationId: string; causationId: string },
    createdAt: Date,
  ): Promise<void> {
    await this.database.tx((transaction) =>
      this.appendAuditEvent(
        eventType,
        entityType,
        entityId,
        payload,
        correlation,
        createdAt,
        transaction,
      ),
    )
  }

  private async appendAuditEvent(
    eventType: string,
    entityType: string,
    entityId: string,
    payload: JsonObject,
    correlation: { correlationId: string; causationId: string },
    createdAt: Date,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    const event: AuditEvent = {
      auditEventId: newAuditEventId(),
      eventType,
      entityType,
      entityId,
      correlationId: correlation.correlationId,
      causationId: correlation.causationId,
      payload,
      createdAt,
    }

    await this.auditEventRepository.append(event, transaction)
  }
}

function toDiscrepancyDto(discrepancy: Discrepancy): DiscrepancyDto {
  return {
    discrepancyId: discrepancy.discrepancyId,
    dedupeKey: discrepancy.dedupeKey,
    category: discrepancy.category,
    severity: discrepancy.severity,
    status: discrepancy.status,
    entityType: discrepancy.entityType,
    entityId: discrepancy.entityId,
    relatedIds: discrepancy.relatedIds,
    summary: discrepancy.summary,
    detailsPayload: discrepancy.detailsPayload,
    firstDetectedAt: discrepancy.firstDetectedAt.toISOString(),
    lastDetectedAt: discrepancy.lastDetectedAt.toISOString(),
    detectedAt: discrepancy.detectedAt.toISOString(),
    updatedAt: discrepancy.updatedAt.toISOString(),
    assignedToOperatorId: discrepancy.assignedToOperatorId,
    resolutionReason: discrepancy.resolutionReason,
    resolvedAt: discrepancy.resolvedAt?.toISOString() ?? null,
  }
}

function toTimelineItemDto(row: TimelineRow) {
  const occurredAt =
    row.occurred_at instanceof Date
      ? row.occurred_at
      : new Date(row.occurred_at)

  return {
    itemType: row.item_type,
    itemId: row.item_id,
    status: row.status,
    occurredAt: occurredAt.toISOString(),
  }
}
