import { AccountDomainValidationError } from '../errors/AccountDomainErrors.js'
import type { RestrictableAccountActionType } from '../restrictions/accountActionTypes.js'
import type {
  AccountControlActorType,
  AccountControlLiftReason,
  AccountControlReason,
} from '../types/accountDomainTypes.js'
import type {
  AccountRestrictionId,
  PlayerAccountId,
} from '../types/identifiers.js'

export interface AccountRestrictionProps {
  restrictionId: AccountRestrictionId
  playerAccountId: PlayerAccountId
  blockedActions: readonly RestrictableAccountActionType[]
  reasonCode: string
  reasonText: string
  ticketId?: string | null
  actorType: AccountControlActorType
  actorId: string
  source: string
  createdAt: Date
  expiresAt?: Date | null
  liftedAt?: Date | null
  liftReasonCode?: string | null
  liftReasonText?: string | null
}

export class AccountRestriction {
  readonly restrictionId: AccountRestrictionId

  readonly playerAccountId: PlayerAccountId

  readonly blockedActions: readonly RestrictableAccountActionType[]

  readonly reasonCode: string

  readonly reasonText: string

  readonly ticketId: string | null

  readonly actorType: AccountControlActorType

  readonly actorId: string

  readonly source: string

  readonly createdAt: Date

  readonly expiresAt: Date | null

  readonly liftedAt: Date | null

  readonly liftReasonCode: string | null

  readonly liftReasonText: string | null

  constructor(props: AccountRestrictionProps) {
    this.restrictionId = props.restrictionId
    this.playerAccountId = props.playerAccountId
    this.blockedActions = normalizeBlockedActions(
      props.blockedActions,
      this.restrictionId,
    )
    this.reasonCode = normalizeRequiredText(props.reasonCode, 'reasonCode')
    this.reasonText = normalizeRequiredText(props.reasonText, 'reasonText')
    this.ticketId = normalizeOptionalText(props.ticketId)
    this.actorType = props.actorType
    this.actorId = normalizeRequiredText(props.actorId, 'actorId')
    this.source = normalizeRequiredText(props.source, 'source')
    this.createdAt = new Date(props.createdAt)
    this.expiresAt = props.expiresAt ? new Date(props.expiresAt) : null
    this.liftedAt = props.liftedAt ? new Date(props.liftedAt) : null
    this.liftReasonCode = normalizeOptionalText(props.liftReasonCode)
    this.liftReasonText = normalizeOptionalText(props.liftReasonText)

    validateControlWindow({
      entityName: 'AccountRestriction',
      entityId: this.restrictionId,
      createdAt: this.createdAt,
      expiresAt: this.expiresAt,
      liftedAt: this.liftedAt,
      liftReasonCode: this.liftReasonCode,
      liftReasonText: this.liftReasonText,
    })
  }

  get reason(): AccountControlReason {
    return {
      reasonCode: this.reasonCode,
      reasonText: this.reasonText,
      ticketId: this.ticketId,
    }
  }

  get liftReason(): AccountControlLiftReason | null {
    if (!this.liftReasonCode || !this.liftReasonText) {
      return null
    }

    return {
      liftReasonCode: this.liftReasonCode,
      liftReasonText: this.liftReasonText,
    }
  }

  isActive(at: Date = new Date()): boolean {
    if (this.liftedAt) {
      return false
    }

    if (!this.expiresAt) {
      return true
    }

    return this.expiresAt.getTime() > at.getTime()
  }

  blocksAction(action: RestrictableAccountActionType): boolean {
    return this.blockedActions.includes(action)
  }
}

function normalizeBlockedActions(
  blockedActions: readonly RestrictableAccountActionType[],
  restrictionId: AccountRestrictionId,
): readonly RestrictableAccountActionType[] {
  const uniqueBlockedActions = [...new Set(blockedActions)]

  if (uniqueBlockedActions.length === 0) {
    throw new AccountDomainValidationError(
      'ACCOUNT_RESTRICTION_BLOCKED_ACTIONS_REQUIRED',
      'AccountRestriction must block at least one action',
      { restrictionId },
    )
  }

  return uniqueBlockedActions
}

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalizedValue = value.trim()

  if (!normalizedValue) {
    throw new AccountDomainValidationError(
      'ACCOUNT_CONTROL_REQUIRED_FIELD',
      `${fieldName} is required`,
      { fieldName },
    )
  }

  return normalizedValue
}

function normalizeOptionalText(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalizedValue = value.trim()
  return normalizedValue ? normalizedValue : null
}

function validateControlWindow(input: {
  entityName: string
  entityId: string
  createdAt: Date
  expiresAt: Date | null
  liftedAt: Date | null
  liftReasonCode: string | null
  liftReasonText: string | null
}) {
  if (
    input.expiresAt &&
    input.expiresAt.getTime() <= input.createdAt.getTime()
  ) {
    throw new AccountDomainValidationError(
      'ACCOUNT_CONTROL_EXPIRY_ORDER',
      `${input.entityName} expiresAt must be later than createdAt`,
      {
        entityId: input.entityId,
        createdAt: input.createdAt.toISOString(),
        expiresAt: input.expiresAt.toISOString(),
      },
    )
  }

  if (input.liftedAt && input.liftedAt.getTime() < input.createdAt.getTime()) {
    throw new AccountDomainValidationError(
      'ACCOUNT_CONTROL_LIFT_ORDER',
      `${input.entityName} liftedAt cannot be earlier than createdAt`,
      {
        entityId: input.entityId,
        createdAt: input.createdAt.toISOString(),
        liftedAt: input.liftedAt.toISOString(),
      },
    )
  }

  if (!input.liftedAt && (input.liftReasonCode || input.liftReasonText)) {
    throw new AccountDomainValidationError(
      'ACCOUNT_CONTROL_LIFT_REASON_WITHOUT_LIFT',
      `${input.entityName} lift reason fields require liftedAt`,
      { entityId: input.entityId },
    )
  }

  if (input.liftedAt && (!input.liftReasonCode || !input.liftReasonText)) {
    throw new AccountDomainValidationError(
      'ACCOUNT_CONTROL_MISSING_LIFT_REASON',
      `${input.entityName} must include lift reason fields when liftedAt is set`,
      { entityId: input.entityId },
    )
  }
}
