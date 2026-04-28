import { z } from 'zod'

import type { ErrorCategory } from '../../../shared/types/AppError.js'
import type { JsonObject } from '../../../shared/types/Json.js'
import type { AccountStatus } from '../../accounting/types/accountingTypes.js'
import type { AccountFreeze } from '../entities/AccountFreeze.js'
import type { AccountRestriction } from '../entities/AccountRestriction.js'
import type { AccountSuspension } from '../entities/AccountSuspension.js'
import type { PlayerAccountEffectiveStatus } from '../state/playerAccountEffectiveStatus.js'
import { restrictableAccountActionTypes } from '../restrictions/accountActionTypes.js'

const reasonCodeSchema = z.string().trim().min(1)
const reasonTextSchema = z.string().trim().min(1)
const ticketIdSchema = z.string().trim().min(1)
const optionalIsoTimestampSchema = z.string().trim().min(1).nullable()
const idempotencyKeySchema = z.string().trim().min(1)
const correlationIdSchema = z.string().trim().min(1)
const causationIdSchema = z.string().trim().min(1)

export const stateChangingAccountControlRequestMetadataSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  correlationId: correlationIdSchema,
  causationId: causationIdSchema,
})

export const applyAccountRestrictionRequestSchema =
  stateChangingAccountControlRequestMetadataSchema.extend({
    blockedActions: z.array(z.enum(restrictableAccountActionTypes)).nonempty(),
    reasonCode: reasonCodeSchema,
    reasonText: reasonTextSchema,
    ticketId: ticketIdSchema,
    expiresAt: optionalIsoTimestampSchema.optional(),
  })

export const liftAccountRestrictionRequestSchema =
  stateChangingAccountControlRequestMetadataSchema.extend({
    reasonCode: reasonCodeSchema,
    reasonText: reasonTextSchema,
    ticketId: ticketIdSchema,
  })

export const applyAccountSuspensionRequestSchema =
  stateChangingAccountControlRequestMetadataSchema.extend({
    reasonCode: reasonCodeSchema,
    reasonText: reasonTextSchema,
    ticketId: ticketIdSchema,
    expiresAt: optionalIsoTimestampSchema.optional(),
  })

export const liftAccountSuspensionRequestSchema =
  stateChangingAccountControlRequestMetadataSchema.extend({
    reasonCode: reasonCodeSchema,
    reasonText: reasonTextSchema,
    ticketId: ticketIdSchema,
  })

export const applyAccountFreezeRequestSchema =
  stateChangingAccountControlRequestMetadataSchema.extend({
    reasonCode: reasonCodeSchema,
    reasonText: reasonTextSchema,
    ticketId: ticketIdSchema,
  })

export const liftAccountFreezeRequestSchema =
  stateChangingAccountControlRequestMetadataSchema.extend({
    reasonCode: reasonCodeSchema,
    reasonText: reasonTextSchema,
    ticketId: ticketIdSchema,
  })

export type ApplyAccountRestrictionRequestDto = z.infer<
  typeof applyAccountRestrictionRequestSchema
>

export type LiftAccountRestrictionRequestDto = z.infer<
  typeof liftAccountRestrictionRequestSchema
>

export type ApplyAccountSuspensionRequestDto = z.infer<
  typeof applyAccountSuspensionRequestSchema
>

export type LiftAccountSuspensionRequestDto = z.infer<
  typeof liftAccountSuspensionRequestSchema
>

export type ApplyAccountFreezeRequestDto = z.infer<
  typeof applyAccountFreezeRequestSchema
>

export type LiftAccountFreezeRequestDto = z.infer<
  typeof liftAccountFreezeRequestSchema
>

export interface AccountStatusEnvelopeDto {
  playerAccountId: string
  effectiveStatus: PlayerAccountEffectiveStatus
  statusChangedAt: string
}

export interface AccountRestrictionDto {
  restrictionId: string
  playerAccountId: string
  blockedActions: readonly string[]
  reasonCode: string
  reasonText: string
  ticketId: string | null
  createdAt: string
  expiresAt: string | null
  active: boolean
  liftedAt?: string | null
  liftReasonCode?: string | null
  liftReasonText?: string | null
}

export interface AccountSuspensionDto {
  suspensionId: string
  playerAccountId: string
  reasonCode: string
  reasonText: string
  ticketId: string | null
  createdAt: string
  expiresAt: string | null
  active: boolean
  liftedAt?: string | null
  liftReasonCode?: string | null
  liftReasonText?: string | null
}

export interface AccountFreezeDto {
  freezeId: string
  playerAccountId: string
  reasonCode: string
  reasonText: string
  ticketId: string | null
  createdAt: string
  active: boolean
  liftedAt?: string | null
  liftReasonCode?: string | null
  liftReasonText?: string | null
}

export interface AccountingCoreSyncDto {
  availableAccountId: string
  availableAccountStatus: AccountStatus
  reservedAccountId: string
  reservedAccountStatus: AccountStatus
}

export interface ApplyAccountRestrictionResponseDto {
  restriction: AccountRestrictionDto
  account: AccountStatusEnvelopeDto
}

export interface LiftAccountRestrictionResponseDto {
  restriction: AccountRestrictionDto
  account: AccountStatusEnvelopeDto
}

export interface ApplyAccountSuspensionResponseDto {
  suspension: AccountSuspensionDto
  account: AccountStatusEnvelopeDto
}

export interface LiftAccountSuspensionResponseDto {
  suspension: AccountSuspensionDto
  account: AccountStatusEnvelopeDto
}

export interface ApplyAccountFreezeResponseDto {
  freeze: AccountFreezeDto
  accountingCoreSync: AccountingCoreSyncDto
  account: AccountStatusEnvelopeDto
}

export interface LiftAccountFreezeResponseDto {
  freeze: AccountFreezeDto
  accountingCoreSync: AccountingCoreSyncDto
  account: AccountStatusEnvelopeDto
}

export interface AccountDomainApiErrorResponseDto {
  error: {
    category: ErrorCategory
    code: string
    message: string
    retryable: boolean
    details: JsonObject | null
  }
}

export function toAccountStatusEnvelopeDto(input: {
  playerAccountId: string
  effectiveStatus: PlayerAccountEffectiveStatus
  statusChangedAt: Date
}): AccountStatusEnvelopeDto {
  return {
    playerAccountId: input.playerAccountId,
    effectiveStatus: input.effectiveStatus,
    statusChangedAt: input.statusChangedAt.toISOString(),
  }
}

export function toAccountRestrictionDto(
  restriction: AccountRestriction,
  activeAt: Date = new Date(),
): AccountRestrictionDto {
  return {
    restrictionId: restriction.restrictionId,
    playerAccountId: restriction.playerAccountId,
    blockedActions: restriction.blockedActions,
    reasonCode: restriction.reasonCode,
    reasonText: restriction.reasonText,
    ticketId: restriction.ticketId,
    createdAt: restriction.createdAt.toISOString(),
    expiresAt: restriction.expiresAt?.toISOString() ?? null,
    active: restriction.isActive(activeAt),
    liftedAt: restriction.liftedAt?.toISOString() ?? null,
    liftReasonCode: restriction.liftReasonCode,
    liftReasonText: restriction.liftReasonText,
  }
}

export function toAccountSuspensionDto(
  suspension: AccountSuspension,
  activeAt: Date = new Date(),
): AccountSuspensionDto {
  return {
    suspensionId: suspension.suspensionId,
    playerAccountId: suspension.playerAccountId,
    reasonCode: suspension.reasonCode,
    reasonText: suspension.reasonText,
    ticketId: suspension.ticketId,
    createdAt: suspension.createdAt.toISOString(),
    expiresAt: suspension.expiresAt?.toISOString() ?? null,
    active: suspension.isActive(activeAt),
    liftedAt: suspension.liftedAt?.toISOString() ?? null,
    liftReasonCode: suspension.liftReasonCode,
    liftReasonText: suspension.liftReasonText,
  }
}

export function toAccountFreezeDto(freeze: AccountFreeze): AccountFreezeDto {
  return {
    freezeId: freeze.freezeId,
    playerAccountId: freeze.playerAccountId,
    reasonCode: freeze.reasonCode,
    reasonText: freeze.reasonText,
    ticketId: freeze.ticketId,
    createdAt: freeze.createdAt.toISOString(),
    active: freeze.isActive(),
    liftedAt: freeze.liftedAt?.toISOString() ?? null,
    liftReasonCode: freeze.liftReasonCode,
    liftReasonText: freeze.liftReasonText,
  }
}

export function toAccountingCoreSyncDto(input: {
  availableAccountId: string
  availableAccountStatus: AccountStatus
  reservedAccountId: string
  reservedAccountStatus: AccountStatus
}): AccountingCoreSyncDto {
  return {
    availableAccountId: input.availableAccountId,
    availableAccountStatus: input.availableAccountStatus,
    reservedAccountId: input.reservedAccountId,
    reservedAccountStatus: input.reservedAccountStatus,
  }
}
