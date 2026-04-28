import { AccountDomainValidationError } from '../errors/AccountDomainErrors.js'
import type {
  AccountControlActorType,
  AccountControlLiftReason,
  AccountControlReason,
} from '../types/accountDomainTypes.js'
import type {
  AccountSuspensionId,
  PlayerAccountId,
} from '../types/identifiers.js'

export interface AccountSuspensionProps {
  suspensionId: AccountSuspensionId
  playerAccountId: PlayerAccountId
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

export class AccountSuspension {
  readonly suspensionId: AccountSuspensionId

  readonly playerAccountId: PlayerAccountId

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

  constructor(props: AccountSuspensionProps) {
    this.suspensionId = props.suspensionId
    this.playerAccountId = props.playerAccountId
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
      entityName: 'AccountSuspension',
      entityId: this.suspensionId,
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
