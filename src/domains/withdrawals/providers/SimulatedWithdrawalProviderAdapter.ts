import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

import { AppError } from '../../../shared/types/AppError.js'
import {
  isJsonValue,
  type JsonObject,
} from '../../../shared/types/Json.js'

import type { WithdrawalProviderStatus } from '../entities/WithdrawalProviderSubmission.js'

import type {
  NormalizedWithdrawalProviderEvent,
  SubmitWithdrawalProviderInput,
  WithdrawalDestinationValidation,
  WithdrawalDestinationValidationInput,
  WithdrawalProviderAdapter,
  WithdrawalProviderStatusInput,
  WithdrawalProviderStatusResult,
  WithdrawalProviderSubmissionResult,
  WithdrawalProviderWebhookInput,
} from './WithdrawalProviderAdapter.js'

const timestampHeader = 'x-nines-provider-timestamp'
const nonceHeader = 'x-nines-provider-nonce'
const signatureHeader = 'x-nines-provider-signature'
const defaultReplayWindowSeconds = 300

const providerStatusSet = new Set<WithdrawalProviderStatus>([
  'accepted',
  'pending',
  'confirmed',
  'failed',
  'rejected',
  'unknown',
])

const minorUnitStringSchema = z
  .string()
  .trim()
  .regex(/^[0-9]+$/)
  .refine((value) => /^[0-9]+$/.test(value) && BigInt(value) > 0n)

const webhookPayloadSchema = z.object({
  externalWithdrawalId: z.string().trim().min(1),
  externalTransactionId: z.string().trim().min(1).nullable().optional(),
  withdrawalRequestId: z.string().trim().min(1).nullable().optional(),
  providerStatus: z.string().trim().min(1),
  amountMinorUnits: minorUnitStringSchema.nullable().optional(),
  amountMinor: minorUnitStringSchema.nullable().optional(),
  currency: z.string().trim().regex(/^[A-Z]{3,12}$/).nullable().optional(),
})

export interface SimulatedWithdrawalProviderAdapterOptions {
  webhookSecret?: string | null | undefined
  replayWindowSeconds?: number | undefined
  clock?: { now(): Date } | undefined
}

export class SimulatedWithdrawalProviderAdapter
  implements WithdrawalProviderAdapter
{
  private readonly webhookSecret: string | null
  private readonly replayWindowSeconds: number
  private readonly clock: { now(): Date }

  constructor(options: SimulatedWithdrawalProviderAdapterOptions = {}) {
    this.webhookSecret = options.webhookSecret ?? null
    this.replayWindowSeconds =
      options.replayWindowSeconds ?? defaultReplayWindowSeconds
    this.clock = options.clock ?? { now: () => new Date() }
  }

  async submitWithdrawal(
    input: SubmitWithdrawalProviderInput,
  ): Promise<WithdrawalProviderSubmissionResult> {
    const providerStatus = this.statusFromDestination(
      input.withdrawalRequest.destinationReference,
      'accepted',
    )
    const stableReference = stableProviderReference(
      input.providerIdempotencyKey,
    )
    const submittedAt = this.clock.now()

    return {
      provider: input.withdrawalRequest.provider,
      externalWithdrawalId: `sim_wd_${stableReference}`,
      externalTransactionId:
        providerStatus === 'accepted' || providerStatus === 'pending'
          ? `sim_tx_${stableReference}`
          : null,
      providerStatus,
      submittedAt,
      providerIdempotencyKey: input.providerIdempotencyKey,
      rawPayload: {
        simulated: true,
        action: 'submit_withdrawal',
        withdrawalRequestId: input.withdrawalRequest.withdrawalRequestId,
        providerStatus,
        externalWithdrawalId: `sim_wd_${stableReference}`,
        externalTransactionId:
          providerStatus === 'accepted' || providerStatus === 'pending'
            ? `sim_tx_${stableReference}`
            : null,
        submittedAt: submittedAt.toISOString(),
      },
    }
  }

  async getWithdrawalStatus(
    input: WithdrawalProviderStatusInput,
  ): Promise<WithdrawalProviderStatusResult> {
    const providerStatus =
      input.simulatedProviderStatus ??
      this.statusFromDestination(
        input.withdrawalRequest.destinationReference,
        input.currentProviderStatus === 'accepted'
          ? 'pending'
          : input.currentProviderStatus,
      )
    const syncedAt = this.clock.now()

    return {
      providerStatus,
      syncedAt,
      rawPayload: {
        simulated: true,
        action: 'sync_withdrawal_status',
        withdrawalRequestId: input.withdrawalRequest.withdrawalRequestId,
        provider: input.provider,
        externalWithdrawalId: input.externalWithdrawalId,
        externalTransactionId: input.externalTransactionId,
        providerStatus,
        syncedAt: syncedAt.toISOString(),
      },
    }
  }

  normalizeWithdrawalStatus(payload: unknown): WithdrawalProviderStatus {
    const rawStatus =
      payload &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      'providerStatus' in payload
        ? (payload as { providerStatus?: unknown }).providerStatus
        : null

    if (typeof rawStatus === 'string' && providerStatusSet.has(rawStatus as WithdrawalProviderStatus)) {
      return rawStatus as WithdrawalProviderStatus
    }

    throw new AppError({
      category: 'validation_error',
      code: 'WITHDRAWAL_PROVIDER_STATUS_MALFORMED',
      message: 'Withdrawal provider status payload is malformed',
    })
  }

  verifyWebhookSignature(input: WithdrawalProviderWebhookInput): void {
    if (!this.webhookSecret) {
      throw new AppError({
        category: 'forbidden',
        code: 'WITHDRAWAL_WEBHOOK_SECRET_NOT_CONFIGURED',
        message: 'Withdrawal provider webhook secret is not configured',
      })
    }

    const timestamp = input.headers[timestampHeader]?.trim()
    const nonce = input.headers[nonceHeader]?.trim()
    const signature = input.headers[signatureHeader]?.trim()

    if (!timestamp) {
      throw new AppError({
        category: 'forbidden',
        code: 'WITHDRAWAL_WEBHOOK_TIMESTAMP_MISSING',
        message: 'Withdrawal provider webhook timestamp is required',
      })
    }

    const providerTimestamp = parseProviderTimestamp(timestamp)

    if (!providerTimestamp) {
      throw new AppError({
        category: 'forbidden',
        code: 'WITHDRAWAL_WEBHOOK_TIMESTAMP_MALFORMED',
        message: 'Withdrawal provider webhook timestamp is malformed',
      })
    }

    const timestampMs = providerTimestamp.getTime()
    const nowMs = this.clock.now().getTime()
    const replayWindowMs = this.replayWindowSeconds * 1000

    if (timestampMs < nowMs - replayWindowMs) {
      throw new AppError({
        category: 'forbidden',
        code: 'WITHDRAWAL_WEBHOOK_TIMESTAMP_TOO_OLD',
        message: 'Withdrawal provider webhook timestamp is outside the replay window',
      })
    }

    if (timestampMs > nowMs + replayWindowMs) {
      throw new AppError({
        category: 'forbidden',
        code: 'WITHDRAWAL_WEBHOOK_TIMESTAMP_TOO_FAR_IN_FUTURE',
        message: 'Withdrawal provider webhook timestamp is too far in the future',
      })
    }

    if (!nonce) {
      throw new AppError({
        category: 'forbidden',
        code: 'WITHDRAWAL_WEBHOOK_NONCE_MISSING',
        message: 'Withdrawal provider webhook nonce is required',
      })
    }

    if (!signature) {
      throw new AppError({
        category: 'forbidden',
        code: 'WITHDRAWAL_WEBHOOK_SIGNATURE_MISSING',
        message: 'Withdrawal provider webhook signature is required',
      })
    }

    const expected = this.signPayload(input.body, timestamp, nonce, input.rawBody)

    if (!constantTimeEquals(signature, expected)) {
      throw new AppError({
        category: 'forbidden',
        code: 'WITHDRAWAL_WEBHOOK_SIGNATURE_INVALID',
        message: 'Withdrawal provider webhook signature is invalid',
      })
    }
  }

  parseWithdrawalWebhook(
    input: WithdrawalProviderWebhookInput,
  ): NormalizedWithdrawalProviderEvent {
    this.verifyWebhookSignature(input)
    return this.normalizeWithdrawalProviderEvent(input.body, input.provider)
  }

  normalizeWithdrawalProviderEvent(
    payload: unknown,
    provider: string,
  ): NormalizedWithdrawalProviderEvent {
    const parsed = webhookPayloadSchema.safeParse(payload)

    if (!parsed.success) {
      throw new AppError({
        category: 'validation_error',
        code: 'WITHDRAWAL_WEBHOOK_PAYLOAD_MALFORMED',
        message: 'Withdrawal provider webhook payload is malformed',
        details: {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
            code: issue.code,
          })),
        },
      })
    }

    const providerStatus = providerStatusSet.has(
      parsed.data.providerStatus as WithdrawalProviderStatus,
    )
      ? (parsed.data.providerStatus as WithdrawalProviderStatus)
      : 'unknown'

    return {
      provider,
      externalWithdrawalId: parsed.data.externalWithdrawalId,
      externalTransactionId: parsed.data.externalTransactionId ?? null,
      withdrawalRequestId: parsed.data.withdrawalRequestId ?? null,
      providerStatus,
      amountMinorUnits:
        parsed.data.amountMinorUnits ?? parsed.data.amountMinor ?? null,
      currency: parsed.data.currency ?? null,
      rawPayload: toJsonObject(payload),
    }
  }

  validateDestination(
    input: WithdrawalDestinationValidationInput,
  ): WithdrawalDestinationValidation {
    if (input.provider !== 'simulated') {
      return {
        valid: false,
        reasonCode: 'WITHDRAWAL_PROVIDER_NOT_SUPPORTED',
        reasonText: 'Withdrawal provider is not supported by the simulated adapter',
      }
    }

    if (input.currency !== 'USDC') {
      return {
        valid: false,
        reasonCode: 'WITHDRAWAL_CURRENCY_NOT_SUPPORTED',
        reasonText: 'Withdrawal currency is not supported by the simulated adapter',
      }
    }

    if (input.destinationKind !== 'simulated_external_account') {
      return {
        valid: false,
        reasonCode: 'WITHDRAWAL_DESTINATION_KIND_NOT_SUBMITTABLE',
        reasonText: 'Withdrawal destination kind cannot be submitted externally',
      }
    }

    if (!input.destinationReference.trim()) {
      return {
        valid: false,
        reasonCode: 'WITHDRAWAL_DESTINATION_REFERENCE_REQUIRED',
        reasonText: 'Withdrawal destination reference is required',
      }
    }

    return {
      valid: true,
      reasonCode: null,
      reasonText: null,
    }
  }

  private statusFromDestination(
    destinationReference: string,
    fallback: WithdrawalProviderStatus,
  ): WithdrawalProviderStatus {
    const prefix = destinationReference.split(':')[0]?.trim()

    if (prefix && providerStatusSet.has(prefix as WithdrawalProviderStatus)) {
      return prefix as WithdrawalProviderStatus
    }

    return fallback
  }

  signPayload(
    payload: unknown,
    timestamp?: string,
    nonce?: string,
    rawBody?: Buffer | string,
  ): string {
    const rawBodyForSignature =
      typeof rawBody === 'string'
        ? rawBody
        : Buffer.isBuffer(rawBody)
          ? rawBody.toString('utf8')
          : stableStringify(payload)

    return createHmac('sha256', this.webhookSecret ?? '')
      .update(`${timestamp ?? ''}.${nonce ?? ''}.${rawBodyForSignature}`)
      .digest('hex')
  }
}

function stableProviderReference(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8')
  const rightBuffer = Buffer.from(right, 'utf8')

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

function parseProviderTimestamp(value: string): Date | null {
  if (/^[0-9]{10}$/.test(value)) {
    const date = new Date(Number(value) * 1000)
    return Number.isNaN(date.getTime()) ? null : date
  }

  if (/^[0-9]{13}$/.test(value)) {
    const date = new Date(Number(value))
    return Number.isNaN(date.getTime()) ? null : date
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function stableStringify(value: unknown): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  if (typeof value === 'object' && value !== null) {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object)
      .sort()
      .filter((key) => object[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
      .join(',')}}`
  }

  return 'null'
}

export function toJsonObject(value: unknown): JsonObject {
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
