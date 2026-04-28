import type { AuditEvent } from '../../../shared/audit/AuditEvent.js'
import type { DatabaseTransaction } from '../../../shared/db/Database.js'
import { newAuditEventId } from '../../accounting/types/identifiers.js'
import type { AuditEventRepository } from '../../accounting/repositories/AuditEventRepository.js'
import { AccountDomainValidationError } from '../errors/AccountDomainErrors.js'

import {
  isAccountAuditFailureEventType,
  type AccountAuditEventType,
  type AccountAuditEntityType,
} from './accountAuditEventTypes.js'
import type { PreparedAccountDomainAuditEvent } from './accountAuditPayloads.js'

const accountAuditEntityType: AccountAuditEntityType = 'player_account'

export interface AccountDomainAuditPort {
  recordPreparedEvent<TEventType extends AccountAuditEventType>(
    event: PreparedAccountDomainAuditEvent<TEventType>,
    transaction: DatabaseTransaction,
  ): Promise<void>
}

export class AccountAuditService implements AccountDomainAuditPort {
  constructor(private readonly auditEventRepository: AuditEventRepository) {}

  async recordPreparedEvent<TEventType extends AccountAuditEventType>(
    event: PreparedAccountDomainAuditEvent<TEventType>,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    this.assertPreparedEventIsValid(event)

    await this.auditEventRepository.append(
      this.buildAuditEvent(event),
      transaction,
    )
  }

  private buildAuditEvent<TEventType extends AccountAuditEventType>(
    event: PreparedAccountDomainAuditEvent<TEventType>,
  ): AuditEvent {
    return {
      auditEventId: newAuditEventId(),
      eventType: event.eventType,
      entityType: accountAuditEntityType,
      entityId: event.playerAccountId,
      correlationId: event.correlationId,
      causationId: event.causationId,
      payload: event.payload,
      createdAt: new Date(event.occurredAt),
    }
  }

  private assertPreparedEventIsValid<TEventType extends AccountAuditEventType>(
    event: PreparedAccountDomainAuditEvent<TEventType>,
  ) {
    this.assertRequiredText(event.correlationId, 'correlationId')
    this.assertRequiredText(event.causationId, 'causationId')

    if (Number.isNaN(event.occurredAt.getTime())) {
      throw new AccountDomainValidationError(
        'INVALID_ACCOUNT_AUDIT_OCCURRED_AT',
        'Account audit event occurredAt must be a valid Date',
        { eventType: event.eventType, playerAccountId: event.playerAccountId },
      )
    }

    if (event.payload.playerAccountId !== event.playerAccountId) {
      throw new AccountDomainValidationError(
        'ACCOUNT_AUDIT_PLAYER_ACCOUNT_MISMATCH',
        'Account audit payload playerAccountId must match the event entity id',
        {
          eventType: event.eventType,
          playerAccountId: event.playerAccountId,
          payloadPlayerAccountId: event.payload.playerAccountId,
        },
      )
    }

    this.assertRequiredText(String(event.payload.userId), 'userId')
    this.assertRequiredText(event.payload.currency, 'currency')
    this.assertRequiredText(event.payload.actorId, 'actorId')
    this.assertRequiredText(event.payload.source, 'source')
    this.assertRequiredText(event.payload.reasonCode, 'reasonCode')
    this.assertRequiredText(event.payload.reasonText, 'reasonText')

    if (
      event.payload.actorType === 'admin_user' &&
      !event.payload.ticketId?.trim()
    ) {
      throw new AccountDomainValidationError(
        'ACCOUNT_AUDIT_TICKET_ID_REQUIRED',
        'ticketId is required for human admin account audit events',
        {
          eventType: event.eventType,
          playerAccountId: event.playerAccountId,
          actorType: event.payload.actorType,
        },
      )
    }

    if (
      event.eventType === 'player_account_effective_status_changed' &&
      event.payload.effectiveStatusBefore === event.payload.effectiveStatusAfter
    ) {
      throw new AccountDomainValidationError(
        'ACCOUNT_AUDIT_STATUS_CHANGE_NOT_VISIBLE',
        'Effective status change audit events require a visible effectiveStatus change',
        {
          playerAccountId: event.playerAccountId,
          effectiveStatusBefore: event.payload.effectiveStatusBefore,
          effectiveStatusAfter: event.payload.effectiveStatusAfter,
        },
      )
    }

    if (isAccountAuditFailureEventType(event.eventType)) {
      if ('effectiveStatusAfter' in event.payload) {
        throw new AccountDomainValidationError(
          'ACCOUNT_AUDIT_FAILURE_EVENT_IMPLIED_SUCCESS',
          'Freeze failure audit events must not include effectiveStatusAfter',
          {
            eventType: event.eventType,
            playerAccountId: event.playerAccountId,
          },
        )
      }
    }
  }

  private assertRequiredText(value: string, fieldName: string) {
    if (!value.trim()) {
      throw new AccountDomainValidationError(
        'ACCOUNT_AUDIT_REQUIRED_FIELD',
        `${fieldName} is required for account audit events`,
        { fieldName },
      )
    }
  }
}
