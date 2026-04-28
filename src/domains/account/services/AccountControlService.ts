import type { IdempotencyKey } from '../../../shared/idempotency/types.js'
import type {
  Database,
  DatabaseTransaction,
} from '../../../shared/db/Database.js'
import type { CorrelationMetadata } from '../../../shared/observability/correlation.js'
import { requireCorrelationMetadata } from '../../../shared/observability/correlation.js'
import {
  createLogger,
  type Logger,
} from '../../../shared/observability/logger.js'
import type { Clock } from '../../../shared/time/Clock.js'
import { AppError } from '../../../shared/types/AppError.js'
import {
  FreezeSyncFailedError,
  PlayerAccountNotFoundError,
  AccountDomainValidationError,
} from '../errors/AccountDomainErrors.js'
import type { AccountDomainAuditPort } from '../audit/AccountAuditService.js'
import type { PreparedAccountDomainAuditEvent } from '../audit/accountAuditPayloads.js'
import type { AccountAuditEventType } from '../audit/accountAuditEventTypes.js'
import { AccountFreeze } from '../entities/AccountFreeze.js'
import { AccountRestriction } from '../entities/AccountRestriction.js'
import { AccountSuspension } from '../entities/AccountSuspension.js'
import { PlayerAccount } from '../entities/PlayerAccount.js'
import type {
  AccountingAccountControlPort,
  LinkedPlayerAccountingAccounts,
  SyncLinkedPlayerAccountsCommand,
} from '../ports/AccountingAccountControlPort.js'
import type { PlayerAccountRepository } from '../repositories/PlayerAccountRepository.js'
import type { AccountRestrictionRepository } from '../repositories/AccountRestrictionRepository.js'
import type { AccountSuspensionRepository } from '../repositories/AccountSuspensionRepository.js'
import type { AccountFreezeRepository } from '../repositories/AccountFreezeRepository.js'
import type { RestrictableAccountActionType } from '../restrictions/accountActionTypes.js'
import {
  applyPlayerAccountTransition,
  type PlayerAccountStateTransitionResult,
  type PlayerAccountTransitionType,
} from '../state/playerAccountStateMachine.js'
import { resolveStatusChangedAt } from '../state/statusChangedAtPolicy.js'
import type {
  PlayerAccountControlStateSummary,
  PlayerAccountEffectiveStatus,
} from '../state/playerAccountEffectiveStatus.js'
import type { AccountControlActorType } from '../types/accountDomainTypes.js'
import {
  newAccountFreezeId,
  newAccountRestrictionId,
  newAccountSuspensionId,
  type AccountFreezeId,
  type AccountRestrictionId,
  type PlayerAccountId,
} from '../types/identifiers.js'

import { EffectiveStatusService } from './EffectiveStatusService.js'

interface StateChangingAccountControlCommand extends CorrelationMetadata {
  idempotencyKey: IdempotencyKey
  playerAccountId: PlayerAccountId
  actorType: AccountControlActorType
  actorId: string
  source: string
}

export interface ApplyAccountRestrictionCommand extends StateChangingAccountControlCommand {
  blockedActions: readonly RestrictableAccountActionType[]
  reasonCode: string
  reasonText: string
  ticketId?: string | null
  expiresAt?: Date | null
}

export interface LiftAccountRestrictionCommand extends StateChangingAccountControlCommand {
  restrictionId: AccountRestrictionId
  liftReasonCode: string
  liftReasonText: string
  ticketId?: string | null
}

export interface ApplyAccountSuspensionCommand extends StateChangingAccountControlCommand {
  reasonCode: string
  reasonText: string
  ticketId?: string | null
  expiresAt?: Date | null
}

export interface LiftAccountSuspensionCommand extends StateChangingAccountControlCommand {
  liftReasonCode: string
  liftReasonText: string
  ticketId?: string | null
}

export interface ApplyAccountFreezeCommand extends StateChangingAccountControlCommand {
  reasonCode: string
  reasonText: string
  ticketId?: string | null
}

export interface LiftAccountFreezeCommand extends StateChangingAccountControlCommand {
  liftReasonCode: string
  liftReasonText: string
  ticketId?: string | null
}

export interface AccountControlMutationResult<TControl> {
  playerAccount: PlayerAccount
  control: TControl
  effectiveStatusBefore: PlayerAccountEffectiveStatus
  effectiveStatusAfter: PlayerAccountEffectiveStatus
  controlStateBefore: PlayerAccountControlStateSummary
  controlStateAfter: PlayerAccountControlStateSummary
  statusChanged: boolean
}

export interface FreezeAccountControlMutationResult extends AccountControlMutationResult<AccountFreeze> {
  linkedAccounts: LinkedPlayerAccountingAccounts
}

export class AccountControlService {
  private readonly logger: Logger

  constructor(
    private readonly database: Database,
    private readonly playerAccountRepository: PlayerAccountRepository,
    private readonly restrictionRepository: AccountRestrictionRepository,
    private readonly suspensionRepository: AccountSuspensionRepository,
    private readonly freezeRepository: AccountFreezeRepository,
    private readonly accountingAccountControlPort: AccountingAccountControlPort,
    private readonly effectiveStatusService: EffectiveStatusService,
    private readonly clock: Clock,
    private readonly auditPort?: AccountDomainAuditPort,
    logger?: Logger,
  ) {
    this.logger = logger ?? createLogger({ service: 'account-control-service' })
  }

  async applyRestriction(
    command: ApplyAccountRestrictionCommand,
  ): Promise<AccountControlMutationResult<AccountRestriction>> {
    const correlation = this.requireStateChangeMetadata(command)

    return this.database.tx(async (transaction) => {
      const now = this.clock.now()
      const playerAccount = await this.requirePlayerAccount(
        command.playerAccountId,
        transaction,
      )
      const snapshot = await this.effectiveStatusService.getSnapshot(
        playerAccount.playerAccountId,
        now,
        transaction,
      )
      const transition = applyPlayerAccountTransition({
        playerAccountId: playerAccount.playerAccountId,
        current: snapshot.controlState,
        transition: 'apply_restriction',
      })
      const restriction = new AccountRestriction({
        restrictionId: newAccountRestrictionId(),
        playerAccountId: playerAccount.playerAccountId,
        blockedActions: command.blockedActions,
        reasonCode: command.reasonCode,
        reasonText: command.reasonText,
        ticketId: command.ticketId ?? null,
        actorType: command.actorType,
        actorId: command.actorId,
        source: command.source,
        createdAt: now,
        expiresAt: command.expiresAt ?? null,
      })
      const updatedPlayerAccount = this.buildUpdatedPlayerAccount(
        playerAccount,
        now,
        transition,
      )

      await this.restrictionRepository.create(restriction, transaction)
      await this.playerAccountRepository.update(
        updatedPlayerAccount,
        transaction,
      )

      await this.recordPreparedEvent(
        {
          eventType: 'player_account_restriction_applied',
          playerAccountId: playerAccount.playerAccountId,
          correlationId: correlation.correlationId,
          causationId: correlation.causationId,
          payload: {
            ...this.buildAuditSubject(playerAccount),
            ...this.buildAuditActorContext(command),
            ...this.buildAuditReasonContext(
              command.reasonCode,
              command.reasonText,
            ),
            restrictionId: restriction.restrictionId,
            blockedActions: [...restriction.blockedActions],
            expiresAt: restriction.expiresAt?.toISOString() ?? null,
            effectiveStatusBefore: transition.effectiveStatusBefore,
            effectiveStatusAfter: transition.effectiveStatusAfter,
          },
          occurredAt: now,
        },
        transaction,
      )
      await this.recordPreparedStatusChangeEvent(
        playerAccount,
        correlation,
        transition,
        now,
        restriction.restrictionId,
        'apply_restriction',
        command,
        {
          reasonCode: command.reasonCode,
          reasonText: command.reasonText,
        },
        transaction,
      )

      this.logger.info('account restriction applied', {
        playerAccountId: playerAccount.playerAccountId,
        restrictionId: restriction.restrictionId,
        correlationId: correlation.correlationId,
        causationId: correlation.causationId,
      })

      return {
        playerAccount: updatedPlayerAccount,
        control: restriction,
        effectiveStatusBefore: transition.effectiveStatusBefore,
        effectiveStatusAfter: transition.effectiveStatusAfter,
        controlStateBefore: transition.previousControls,
        controlStateAfter: transition.nextControls,
        statusChanged: transition.statusChanged,
      }
    })
  }

  async liftRestriction(
    command: LiftAccountRestrictionCommand,
  ): Promise<AccountControlMutationResult<AccountRestriction>> {
    const correlation = this.requireStateChangeMetadata(command)

    return this.database.tx(async (transaction) => {
      const now = this.clock.now()
      const playerAccount = await this.requirePlayerAccount(
        command.playerAccountId,
        transaction,
      )
      const restriction = await this.requireRestriction(
        command.restrictionId,
        playerAccount.playerAccountId,
        now,
        transaction,
      )
      const snapshot = await this.effectiveStatusService.getSnapshot(
        playerAccount.playerAccountId,
        now,
        transaction,
      )
      const transition = applyPlayerAccountTransition({
        playerAccountId: playerAccount.playerAccountId,
        current: snapshot.controlState,
        transition: 'lift_restriction',
      })
      const liftedRestriction = new AccountRestriction({
        restrictionId: restriction.restrictionId,
        playerAccountId: restriction.playerAccountId,
        blockedActions: restriction.blockedActions,
        reasonCode: restriction.reasonCode,
        reasonText: restriction.reasonText,
        ticketId: restriction.ticketId,
        actorType: restriction.actorType,
        actorId: restriction.actorId,
        source: restriction.source,
        createdAt: restriction.createdAt,
        expiresAt: restriction.expiresAt,
        liftedAt: now,
        liftReasonCode: command.liftReasonCode,
        liftReasonText: command.liftReasonText,
      })
      const updatedPlayerAccount = this.buildUpdatedPlayerAccount(
        playerAccount,
        now,
        transition,
      )

      await this.restrictionRepository.update(liftedRestriction, transaction)
      await this.playerAccountRepository.update(
        updatedPlayerAccount,
        transaction,
      )

      await this.recordPreparedEvent(
        {
          eventType: 'player_account_restriction_lifted',
          playerAccountId: playerAccount.playerAccountId,
          correlationId: correlation.correlationId,
          causationId: correlation.causationId,
          payload: {
            ...this.buildAuditSubject(playerAccount),
            ...this.buildAuditActorContext(command),
            ...this.buildAuditReasonContext(
              command.liftReasonCode,
              command.liftReasonText,
            ),
            restrictionId: liftedRestriction.restrictionId,
            blockedActions: [...liftedRestriction.blockedActions],
            liftedAt: now.toISOString(),
            effectiveStatusBefore: transition.effectiveStatusBefore,
            effectiveStatusAfter: transition.effectiveStatusAfter,
          },
          occurredAt: now,
        },
        transaction,
      )
      await this.recordPreparedStatusChangeEvent(
        playerAccount,
        correlation,
        transition,
        now,
        liftedRestriction.restrictionId,
        'lift_restriction',
        command,
        {
          reasonCode: command.liftReasonCode,
          reasonText: command.liftReasonText,
        },
        transaction,
      )

      this.logger.info('account restriction lifted', {
        playerAccountId: playerAccount.playerAccountId,
        restrictionId: liftedRestriction.restrictionId,
        correlationId: correlation.correlationId,
        causationId: correlation.causationId,
      })

      return {
        playerAccount: updatedPlayerAccount,
        control: liftedRestriction,
        effectiveStatusBefore: transition.effectiveStatusBefore,
        effectiveStatusAfter: transition.effectiveStatusAfter,
        controlStateBefore: transition.previousControls,
        controlStateAfter: transition.nextControls,
        statusChanged: transition.statusChanged,
      }
    })
  }

  async applySuspension(
    command: ApplyAccountSuspensionCommand,
  ): Promise<AccountControlMutationResult<AccountSuspension>> {
    const correlation = this.requireStateChangeMetadata(command)

    return this.database.tx(async (transaction) => {
      const now = this.clock.now()
      const playerAccount = await this.requirePlayerAccount(
        command.playerAccountId,
        transaction,
      )
      const snapshot = await this.effectiveStatusService.getSnapshot(
        playerAccount.playerAccountId,
        now,
        transaction,
      )
      const transition = applyPlayerAccountTransition({
        playerAccountId: playerAccount.playerAccountId,
        current: snapshot.controlState,
        transition: 'apply_suspension',
      })
      const suspension = new AccountSuspension({
        suspensionId: newAccountSuspensionId(),
        playerAccountId: playerAccount.playerAccountId,
        reasonCode: command.reasonCode,
        reasonText: command.reasonText,
        ticketId: command.ticketId ?? null,
        actorType: command.actorType,
        actorId: command.actorId,
        source: command.source,
        createdAt: now,
        expiresAt: command.expiresAt ?? null,
      })
      const updatedPlayerAccount = this.buildUpdatedPlayerAccount(
        playerAccount,
        now,
        transition,
      )

      await this.suspensionRepository.create(suspension, transaction)
      await this.playerAccountRepository.update(
        updatedPlayerAccount,
        transaction,
      )

      await this.recordPreparedEvent(
        {
          eventType: 'player_account_suspension_applied',
          playerAccountId: playerAccount.playerAccountId,
          correlationId: correlation.correlationId,
          causationId: correlation.causationId,
          payload: {
            ...this.buildAuditSubject(playerAccount),
            ...this.buildAuditActorContext(command),
            ...this.buildAuditReasonContext(
              command.reasonCode,
              command.reasonText,
            ),
            suspensionId: suspension.suspensionId,
            expiresAt: suspension.expiresAt?.toISOString() ?? null,
            effectiveStatusBefore: transition.effectiveStatusBefore,
            effectiveStatusAfter: transition.effectiveStatusAfter,
          },
          occurredAt: now,
        },
        transaction,
      )
      await this.recordPreparedStatusChangeEvent(
        playerAccount,
        correlation,
        transition,
        now,
        suspension.suspensionId,
        'apply_suspension',
        command,
        {
          reasonCode: command.reasonCode,
          reasonText: command.reasonText,
        },
        transaction,
      )

      this.logger.info('account suspension applied', {
        playerAccountId: playerAccount.playerAccountId,
        suspensionId: suspension.suspensionId,
        correlationId: correlation.correlationId,
        causationId: correlation.causationId,
      })

      return {
        playerAccount: updatedPlayerAccount,
        control: suspension,
        effectiveStatusBefore: transition.effectiveStatusBefore,
        effectiveStatusAfter: transition.effectiveStatusAfter,
        controlStateBefore: transition.previousControls,
        controlStateAfter: transition.nextControls,
        statusChanged: transition.statusChanged,
      }
    })
  }

  async liftSuspension(
    command: LiftAccountSuspensionCommand,
  ): Promise<AccountControlMutationResult<AccountSuspension>> {
    const correlation = this.requireStateChangeMetadata(command)

    return this.database.tx(async (transaction) => {
      const now = this.clock.now()
      const playerAccount = await this.requirePlayerAccount(
        command.playerAccountId,
        transaction,
      )
      const suspension = await this.requireActiveSuspension(
        playerAccount.playerAccountId,
        now,
        transaction,
      )
      const snapshot = await this.effectiveStatusService.getSnapshot(
        playerAccount.playerAccountId,
        now,
        transaction,
      )
      const transition = applyPlayerAccountTransition({
        playerAccountId: playerAccount.playerAccountId,
        current: snapshot.controlState,
        transition: 'lift_suspension',
      })
      const liftedSuspension = new AccountSuspension({
        suspensionId: suspension.suspensionId,
        playerAccountId: suspension.playerAccountId,
        reasonCode: suspension.reasonCode,
        reasonText: suspension.reasonText,
        ticketId: suspension.ticketId,
        actorType: suspension.actorType,
        actorId: suspension.actorId,
        source: suspension.source,
        createdAt: suspension.createdAt,
        expiresAt: suspension.expiresAt,
        liftedAt: now,
        liftReasonCode: command.liftReasonCode,
        liftReasonText: command.liftReasonText,
      })
      const updatedPlayerAccount = this.buildUpdatedPlayerAccount(
        playerAccount,
        now,
        transition,
      )

      await this.suspensionRepository.update(liftedSuspension, transaction)
      await this.playerAccountRepository.update(
        updatedPlayerAccount,
        transaction,
      )

      await this.recordPreparedEvent(
        {
          eventType: 'player_account_suspension_lifted',
          playerAccountId: playerAccount.playerAccountId,
          correlationId: correlation.correlationId,
          causationId: correlation.causationId,
          payload: {
            ...this.buildAuditSubject(playerAccount),
            ...this.buildAuditActorContext(command),
            ...this.buildAuditReasonContext(
              command.liftReasonCode,
              command.liftReasonText,
            ),
            suspensionId: liftedSuspension.suspensionId,
            liftedAt: now.toISOString(),
            effectiveStatusBefore: transition.effectiveStatusBefore,
            effectiveStatusAfter: transition.effectiveStatusAfter,
          },
          occurredAt: now,
        },
        transaction,
      )
      await this.recordPreparedStatusChangeEvent(
        playerAccount,
        correlation,
        transition,
        now,
        liftedSuspension.suspensionId,
        'lift_suspension',
        command,
        {
          reasonCode: command.liftReasonCode,
          reasonText: command.liftReasonText,
        },
        transaction,
      )

      this.logger.info('account suspension lifted', {
        playerAccountId: playerAccount.playerAccountId,
        suspensionId: liftedSuspension.suspensionId,
        correlationId: correlation.correlationId,
        causationId: correlation.causationId,
      })

      return {
        playerAccount: updatedPlayerAccount,
        control: liftedSuspension,
        effectiveStatusBefore: transition.effectiveStatusBefore,
        effectiveStatusAfter: transition.effectiveStatusAfter,
        controlStateBefore: transition.previousControls,
        controlStateAfter: transition.nextControls,
        statusChanged: transition.statusChanged,
      }
    })
  }

  async applyFreeze(
    command: ApplyAccountFreezeCommand,
  ): Promise<FreezeAccountControlMutationResult> {
    const correlation = this.requireStateChangeMetadata(command)

    return this.database.tx(async (transaction) => {
      const now = this.clock.now()
      const playerAccount = await this.requirePlayerAccount(
        command.playerAccountId,
        transaction,
      )
      const snapshot = await this.effectiveStatusService.getSnapshot(
        playerAccount.playerAccountId,
        now,
        transaction,
      )
      const transition = applyPlayerAccountTransition({
        playerAccountId: playerAccount.playerAccountId,
        current: snapshot.controlState,
        transition: 'apply_freeze',
      })

      let linkedAccounts: LinkedPlayerAccountingAccounts

      try {
        linkedAccounts =
          await this.accountingAccountControlPort.freezeLinkedPlayerAccounts(
            this.toSyncLinkedPlayerAccountsCommand(playerAccount, command),
            transaction,
          )
        this.assertLinkedAccountsSynchronized(linkedAccounts, 'frozen')
      } catch (error) {
        await this.recordPreparedEvent(
          {
            eventType: 'player_account_freeze_apply_failed',
            playerAccountId: playerAccount.playerAccountId,
            correlationId: correlation.correlationId,
            causationId: correlation.causationId,
            payload: {
              ...this.buildAuditSubject(playerAccount),
              ...this.buildAuditActorContext(command),
              ...this.buildAuditReasonContext(
                command.reasonCode,
                command.reasonText,
              ),
              availableAccountId: playerAccount.availableAccountId,
              reservedAccountId: playerAccount.reservedAccountId,
              effectiveStatusBefore: transition.effectiveStatusBefore,
              attemptedTransition: 'apply_freeze',
            },
            occurredAt: now,
          },
          transaction,
        )

        throw new FreezeSyncFailedError(
          playerAccount.playerAccountId,
          'apply',
          {
            availableAccountId: playerAccount.availableAccountId,
            reservedAccountId: playerAccount.reservedAccountId,
          },
          error,
        )
      }

      const freeze = new AccountFreeze({
        freezeId: newAccountFreezeId(),
        playerAccountId: playerAccount.playerAccountId,
        reasonCode: command.reasonCode,
        reasonText: command.reasonText,
        ticketId: command.ticketId ?? null,
        actorType: command.actorType,
        actorId: command.actorId,
        source: command.source,
        createdAt: now,
      })
      const updatedPlayerAccount = this.buildUpdatedPlayerAccount(
        playerAccount,
        now,
        transition,
      )

      await this.freezeRepository.create(freeze, transaction)
      await this.playerAccountRepository.update(
        updatedPlayerAccount,
        transaction,
      )

      await this.recordPreparedEvent(
        {
          eventType: 'player_account_freeze_applied',
          playerAccountId: playerAccount.playerAccountId,
          correlationId: correlation.correlationId,
          causationId: correlation.causationId,
          payload: {
            ...this.buildAuditSubject(playerAccount),
            ...this.buildAuditActorContext(command),
            ...this.buildAuditReasonContext(
              command.reasonCode,
              command.reasonText,
            ),
            freezeId: freeze.freezeId,
            availableAccountId: linkedAccounts.availableAccount.accountId,
            reservedAccountId: linkedAccounts.reservedAccount.accountId,
            availableAccountStatus: linkedAccounts.availableAccount
              .status as 'frozen',
            reservedAccountStatus: linkedAccounts.reservedAccount
              .status as 'frozen',
            effectiveStatusBefore: transition.effectiveStatusBefore,
            effectiveStatusAfter: transition.effectiveStatusAfter,
          },
          occurredAt: now,
        },
        transaction,
      )
      await this.recordPreparedStatusChangeEvent(
        playerAccount,
        correlation,
        transition,
        now,
        freeze.freezeId,
        'apply_freeze',
        command,
        {
          reasonCode: command.reasonCode,
          reasonText: command.reasonText,
        },
        transaction,
      )

      this.logger.info('account freeze applied', {
        playerAccountId: playerAccount.playerAccountId,
        freezeId: freeze.freezeId,
        correlationId: correlation.correlationId,
        causationId: correlation.causationId,
      })

      return {
        playerAccount: updatedPlayerAccount,
        control: freeze,
        effectiveStatusBefore: transition.effectiveStatusBefore,
        effectiveStatusAfter: transition.effectiveStatusAfter,
        controlStateBefore: transition.previousControls,
        controlStateAfter: transition.nextControls,
        statusChanged: transition.statusChanged,
        linkedAccounts,
      }
    })
  }

  async liftFreeze(
    command: LiftAccountFreezeCommand,
  ): Promise<FreezeAccountControlMutationResult> {
    const correlation = this.requireStateChangeMetadata(command)

    return this.database.tx(async (transaction) => {
      const now = this.clock.now()
      const playerAccount = await this.requirePlayerAccount(
        command.playerAccountId,
        transaction,
      )
      const freeze = await this.requireActiveFreeze(
        playerAccount.playerAccountId,
        transaction,
      )
      const snapshot = await this.effectiveStatusService.getSnapshot(
        playerAccount.playerAccountId,
        now,
        transaction,
      )
      const transition = applyPlayerAccountTransition({
        playerAccountId: playerAccount.playerAccountId,
        current: snapshot.controlState,
        transition: 'lift_freeze',
      })

      let linkedAccounts: LinkedPlayerAccountingAccounts

      try {
        linkedAccounts =
          await this.accountingAccountControlPort.unfreezeLinkedPlayerAccounts(
            this.toSyncLinkedPlayerAccountsCommand(playerAccount, command),
            transaction,
          )
        this.assertLinkedAccountsSynchronized(linkedAccounts, 'active')
      } catch (error) {
        await this.recordPreparedEvent(
          {
            eventType: 'player_account_freeze_lift_failed',
            playerAccountId: playerAccount.playerAccountId,
            correlationId: correlation.correlationId,
            causationId: correlation.causationId,
            payload: {
              ...this.buildAuditSubject(playerAccount),
              ...this.buildAuditActorContext(command),
              ...this.buildAuditReasonContext(
                command.liftReasonCode,
                command.liftReasonText,
              ),
              freezeId: freeze.freezeId,
              availableAccountId: playerAccount.availableAccountId,
              reservedAccountId: playerAccount.reservedAccountId,
              effectiveStatusBefore: transition.effectiveStatusBefore,
              attemptedTransition: 'lift_freeze',
            },
            occurredAt: now,
          },
          transaction,
        )

        throw new FreezeSyncFailedError(
          playerAccount.playerAccountId,
          'lift',
          {
            freezeId: freeze.freezeId,
            availableAccountId: playerAccount.availableAccountId,
            reservedAccountId: playerAccount.reservedAccountId,
          },
          error,
        )
      }

      const liftedFreeze = new AccountFreeze({
        freezeId: freeze.freezeId,
        playerAccountId: freeze.playerAccountId,
        reasonCode: freeze.reasonCode,
        reasonText: freeze.reasonText,
        ticketId: freeze.ticketId,
        actorType: freeze.actorType,
        actorId: freeze.actorId,
        source: freeze.source,
        createdAt: freeze.createdAt,
        liftedAt: now,
        liftReasonCode: command.liftReasonCode,
        liftReasonText: command.liftReasonText,
      })
      const updatedPlayerAccount = this.buildUpdatedPlayerAccount(
        playerAccount,
        now,
        transition,
      )

      await this.freezeRepository.update(liftedFreeze, transaction)
      await this.playerAccountRepository.update(
        updatedPlayerAccount,
        transaction,
      )

      await this.recordPreparedEvent(
        {
          eventType: 'player_account_freeze_lifted',
          playerAccountId: playerAccount.playerAccountId,
          correlationId: correlation.correlationId,
          causationId: correlation.causationId,
          payload: {
            ...this.buildAuditSubject(playerAccount),
            ...this.buildAuditActorContext(command),
            ...this.buildAuditReasonContext(
              command.liftReasonCode,
              command.liftReasonText,
            ),
            freezeId: liftedFreeze.freezeId,
            availableAccountId: linkedAccounts.availableAccount.accountId,
            reservedAccountId: linkedAccounts.reservedAccount.accountId,
            availableAccountStatus: linkedAccounts.availableAccount
              .status as 'active',
            reservedAccountStatus: linkedAccounts.reservedAccount
              .status as 'active',
            effectiveStatusBefore: transition.effectiveStatusBefore,
            effectiveStatusAfter: transition.effectiveStatusAfter,
          },
          occurredAt: now,
        },
        transaction,
      )
      await this.recordPreparedStatusChangeEvent(
        playerAccount,
        correlation,
        transition,
        now,
        liftedFreeze.freezeId,
        'lift_freeze',
        command,
        {
          reasonCode: command.liftReasonCode,
          reasonText: command.liftReasonText,
        },
        transaction,
      )

      this.logger.info('account freeze lifted', {
        playerAccountId: playerAccount.playerAccountId,
        freezeId: liftedFreeze.freezeId,
        correlationId: correlation.correlationId,
        causationId: correlation.causationId,
      })

      return {
        playerAccount: updatedPlayerAccount,
        control: liftedFreeze,
        effectiveStatusBefore: transition.effectiveStatusBefore,
        effectiveStatusAfter: transition.effectiveStatusAfter,
        controlStateBefore: transition.previousControls,
        controlStateAfter: transition.nextControls,
        statusChanged: transition.statusChanged,
        linkedAccounts,
      }
    })
  }

  private requireStateChangeMetadata(
    command: StateChangingAccountControlCommand,
  ) {
    const correlation = requireCorrelationMetadata(command)

    if (!`${command.idempotencyKey}`.trim()) {
      throw new AccountDomainValidationError(
        'MISSING_IDEMPOTENCY_KEY',
        'idempotencyKey is required for Account Domain control operations',
        {
          playerAccountId: command.playerAccountId,
        },
      )
    }

    return correlation
  }

  private async requirePlayerAccount(
    playerAccountId: PlayerAccountId,
    transaction: Database['tx'] extends never
      ? never
      : Parameters<Parameters<Database['tx']>[0]>[0],
  ): Promise<PlayerAccount> {
    const playerAccount = await this.playerAccountRepository.getById(
      playerAccountId,
      transaction,
    )

    if (!playerAccount) {
      throw new PlayerAccountNotFoundError(playerAccountId)
    }

    return playerAccount
  }

  private async requireRestriction(
    restrictionId: AccountRestrictionId,
    playerAccountId: PlayerAccountId,
    at: Date,
    transaction: Parameters<Parameters<Database['tx']>[0]>[0],
  ): Promise<AccountRestriction> {
    const restriction = await this.restrictionRepository.getById(
      restrictionId,
      transaction,
    )

    if (!restriction) {
      throw new AppError({
        category: 'not_found',
        code: 'ACCOUNT_RESTRICTION_NOT_FOUND',
        message: `Account restriction ${restrictionId} was not found`,
        details: { restrictionId, playerAccountId },
      })
    }

    if (restriction.playerAccountId !== playerAccountId) {
      throw new AppError({
        category: 'conflict',
        code: 'ACCOUNT_RESTRICTION_PLAYER_ACCOUNT_MISMATCH',
        message:
          'The requested account restriction does not belong to the target PlayerAccount',
        details: {
          restrictionId,
          playerAccountId,
          actualPlayerAccountId: restriction.playerAccountId,
        },
      })
    }

    if (!restriction.isActive(at)) {
      throw new AppError({
        category: 'conflict',
        code: 'ACCOUNT_RESTRICTION_NOT_ACTIVE',
        message:
          'The requested account restriction is not active and cannot be lifted',
        details: {
          restrictionId,
          playerAccountId,
        },
      })
    }

    return restriction
  }

  private async requireActiveSuspension(
    playerAccountId: PlayerAccountId,
    at: Date,
    transaction: Parameters<Parameters<Database['tx']>[0]>[0],
  ): Promise<AccountSuspension> {
    const suspension =
      await this.suspensionRepository.getActiveByPlayerAccountId(
        playerAccountId,
        at,
        transaction,
      )

    if (!suspension) {
      throw new AppError({
        category: 'conflict',
        code: 'ACCOUNT_SUSPENSION_NOT_ACTIVE',
        message: 'No active suspension exists for the target PlayerAccount',
        details: { playerAccountId },
      })
    }

    return suspension
  }

  private async requireActiveFreeze(
    playerAccountId: PlayerAccountId,
    transaction: Parameters<Parameters<Database['tx']>[0]>[0],
  ): Promise<AccountFreeze> {
    const freeze = await this.freezeRepository.getActiveByPlayerAccountId(
      playerAccountId,
      transaction,
    )

    if (!freeze) {
      throw new AppError({
        category: 'conflict',
        code: 'ACCOUNT_FREEZE_NOT_ACTIVE',
        message: 'No active freeze exists for the target PlayerAccount',
        details: { playerAccountId },
      })
    }

    return freeze
  }

  private buildUpdatedPlayerAccount(
    playerAccount: PlayerAccount,
    now: Date,
    transition: PlayerAccountStateTransitionResult,
  ): PlayerAccount {
    return new PlayerAccount({
      playerAccountId: playerAccount.playerAccountId,
      userId: playerAccount.userId,
      currency: playerAccount.currency,
      accountClass: playerAccount.accountClass,
      availableAccountId: playerAccount.availableAccountId,
      reservedAccountId: playerAccount.reservedAccountId,
      createdAt: playerAccount.createdAt,
      updatedAt: now,
      statusChangedAt: resolveStatusChangedAt({
        previousStatusChangedAt: playerAccount.statusChangedAt,
        effectiveStatusBefore: transition.effectiveStatusBefore,
        effectiveStatusAfter: transition.effectiveStatusAfter,
        changedAt: now,
      }),
    })
  }

  private toSyncLinkedPlayerAccountsCommand(
    playerAccount: PlayerAccount,
    command: StateChangingAccountControlCommand,
  ): SyncLinkedPlayerAccountsCommand {
    return {
      idempotencyKey: command.idempotencyKey,
      availableAccountId: playerAccount.availableAccountId,
      reservedAccountId: playerAccount.reservedAccountId,
      correlationId: command.correlationId,
      causationId: command.causationId,
    }
  }

  private buildAuditSubject(playerAccount: PlayerAccount) {
    return {
      playerAccountId: playerAccount.playerAccountId,
      userId: playerAccount.userId,
      currency: playerAccount.currency,
    }
  }

  private buildAuditActorContext(input: {
    actorType: AccountControlActorType
    actorId: string
    source: string
    ticketId?: string | null
  }) {
    return {
      actorType: input.actorType,
      actorId: input.actorId,
      source: input.source,
      ticketId: input.ticketId ?? null,
    }
  }

  private buildAuditReasonContext(reasonCode: string, reasonText: string) {
    return {
      reasonCode,
      reasonText,
    }
  }

  private assertLinkedAccountsSynchronized(
    linkedAccounts: LinkedPlayerAccountingAccounts,
    expectedStatus: 'active' | 'frozen',
  ) {
    if (
      linkedAccounts.availableAccount.status !== expectedStatus ||
      linkedAccounts.reservedAccount.status !== expectedStatus
    ) {
      throw new AppError({
        category: 'invariant_violation',
        code: 'ACCOUNT_FREEZE_SYNC_STATUS_MISMATCH',
        message:
          'Linked Accounting Core accounts did not reach the expected synchronized status',
        details: {
          expectedStatus,
          availableAccountStatus: linkedAccounts.availableAccount.status,
          reservedAccountStatus: linkedAccounts.reservedAccount.status,
        },
      })
    }
  }

  private async recordPreparedStatusChangeEvent(
    playerAccount: PlayerAccount,
    correlation: { correlationId: string; causationId: string },
    transition: PlayerAccountStateTransitionResult,
    occurredAt: Date,
    triggeringControlId: AccountRestrictionId | AccountFreezeId | string,
    triggeringTransition: PlayerAccountTransitionType,
    actorContext: {
      actorType: AccountControlActorType
      actorId: string
      source: string
      ticketId?: string | null
    },
    reasonContext: {
      reasonCode: string
      reasonText: string
    },
    transaction: DatabaseTransaction,
  ) {
    if (!transition.statusChanged) {
      return
    }

    await this.recordPreparedEvent(
      {
        eventType: 'player_account_effective_status_changed',
        playerAccountId: playerAccount.playerAccountId,
        correlationId: correlation.correlationId,
        causationId: correlation.causationId,
        payload: {
          ...this.buildAuditSubject(playerAccount),
          ...this.buildAuditActorContext(actorContext),
          ...this.buildAuditReasonContext(
            reasonContext.reasonCode,
            reasonContext.reasonText,
          ),
          effectiveStatusBefore: transition.effectiveStatusBefore,
          effectiveStatusAfter: transition.effectiveStatusAfter,
          triggeringControlId,
          triggeringTransition,
          restrictionCount: transition.nextControls.restrictionCount,
          hasSuspension: transition.nextControls.hasSuspension,
          hasFreeze: transition.nextControls.hasFreeze,
        },
        occurredAt,
      },
      transaction,
    )
  }

  private async recordPreparedEvent<TEventType extends AccountAuditEventType>(
    event: PreparedAccountDomainAuditEvent<TEventType>,
    transaction: DatabaseTransaction,
  ) {
    if (!this.auditPort) {
      return
    }

    try {
      await this.auditPort.recordPreparedEvent(event, transaction)
    } catch (error) {
      this.logger.warn('failed to record prepared account-domain audit event', {
        eventType: event.eventType,
        playerAccountId: event.playerAccountId,
        errorMessage: error instanceof Error ? error.message : 'unknown',
      })
    }
  }
}
