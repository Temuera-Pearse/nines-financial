import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

import { AppError } from '../../../shared/types/AppError.js'
import {
  isJsonValue,
  type JsonObject,
} from '../../../shared/types/Json.js'

import type {
  DepositProviderAdapter,
  NormalizedProviderDepositEvent,
  ProviderTransactionLookup,
  ProviderTransactionSnapshot,
  ProviderWebhookInput,
} from './DepositProviderAdapter.js'

const timestampHeader = 'x-nines-provider-timestamp'
const nonceHeader = 'x-nines-provider-nonce'
const signatureHeader = 'x-nines-provider-signature'
const defaultReplayWindowSeconds = 300

const minorUnitStringSchema = z
  .string()
  .trim()
  .regex(/^[0-9]+$/)
  .refine((value) => /^[0-9]+$/.test(value) && BigInt(value) > 0n)

const webhookPayloadSchema = z.object({
  providerEventId: z.string().trim().min(1),
  externalTransactionId: z.string().trim().min(1),
  depositIntentId: z.string().trim().min(1).nullable().optional(),
  destinationReference: z.string().trim().min(1).nullable().optional(),
  amountMinor: minorUnitStringSchema,
  currency: z.string().trim().regex(/^[A-Z]{3,12}$/),
  confirmationCount: z.number().int().min(0).nullable().optional(),
  confirmed: z.boolean().optional(),
})

export interface SimulatedDepositProviderAdapterOptions {
  webhookSecret?: string | null | undefined
  replayWindowSeconds?: number | undefined
  clock?: { now(): Date } | undefined
}

export class SimulatedDepositProviderAdapter implements DepositProviderAdapter {
  private readonly webhookSecret: string | null
  private readonly replayWindowSeconds: number
  private readonly clock: { now(): Date }

  constructor(options: SimulatedDepositProviderAdapterOptions | string | null = null) {
    if (typeof options === 'string' || options === null) {
      this.webhookSecret = options
      this.replayWindowSeconds = defaultReplayWindowSeconds
      this.clock = { now: () => new Date() }
      return
    }

    this.webhookSecret = options.webhookSecret ?? null
    this.replayWindowSeconds =
      options.replayWindowSeconds ?? defaultReplayWindowSeconds
    this.clock = options.clock ?? { now: () => new Date() }
  }

  verifyWebhookSignature(input: ProviderWebhookInput): void {
    if (!this.webhookSecret) {
      throw new AppError({
        category: 'forbidden',
        code: 'DEPOSIT_WEBHOOK_SECRET_NOT_CONFIGURED',
        message: 'Deposit provider webhook secret is not configured',
      })
    }

    const timestamp = input.headers[timestampHeader]?.trim()
    const nonce = input.headers[nonceHeader]?.trim()
    const signature = input.headers[signatureHeader]?.trim()

    if (!timestamp) {
      throw new AppError({
        category: 'forbidden',
        code: 'DEPOSIT_WEBHOOK_TIMESTAMP_MISSING',
        message: 'Deposit provider webhook timestamp is required',
      })
    }

    const receivedAt = parseProviderTimestamp(timestamp)

    if (!receivedAt) {
      throw new AppError({
        category: 'forbidden',
        code: 'DEPOSIT_WEBHOOK_TIMESTAMP_MALFORMED',
        message: 'Deposit provider webhook timestamp is malformed',
      })
    }

    const nowMs = this.clock.now().getTime()
    const timestampMs = receivedAt.getTime()
    const replayWindowMs = this.replayWindowSeconds * 1000

    if (timestampMs < nowMs - replayWindowMs) {
      throw new AppError({
        category: 'forbidden',
        code: 'DEPOSIT_WEBHOOK_TIMESTAMP_TOO_OLD',
        message: 'Deposit provider webhook timestamp is outside the replay window',
      })
    }

    if (timestampMs > nowMs + replayWindowMs) {
      throw new AppError({
        category: 'forbidden',
        code: 'DEPOSIT_WEBHOOK_TIMESTAMP_TOO_FAR_IN_FUTURE',
        message: 'Deposit provider webhook timestamp is too far in the future',
      })
    }

    if (!nonce) {
      throw new AppError({
        category: 'forbidden',
        code: 'DEPOSIT_WEBHOOK_NONCE_MISSING',
        message: 'Deposit provider webhook nonce is required',
      })
    }

    if (!signature) {
      throw new AppError({
        category: 'forbidden',
        code: 'DEPOSIT_WEBHOOK_SIGNATURE_MISSING',
        message: 'Deposit provider webhook signature is required',
      })
    }

    const expected = this.signPayload(input.body, timestamp, nonce, input.rawBody)

    if (!constantTimeEquals(signature, expected)) {
      throw new AppError({
        category: 'forbidden',
        code: 'DEPOSIT_WEBHOOK_SIGNATURE_INVALID',
        message: 'Deposit provider webhook signature is invalid',
      })
    }
  }

  parseDepositWebhook(
    input: ProviderWebhookInput,
  ): NormalizedProviderDepositEvent {
    this.verifyWebhookSignature(input)
    return this.normalizeProviderDepositEvent(input.body, input.provider)
  }

  normalizeProviderDepositEvent(
    payload: unknown,
    provider: string,
  ): NormalizedProviderDepositEvent {
    const parsed = webhookPayloadSchema.safeParse(payload)

    if (!parsed.success) {
      throw new AppError({
        category: 'validation_error',
        code: 'DEPOSIT_WEBHOOK_PAYLOAD_MALFORMED',
        message: 'Deposit provider webhook payload is malformed',
        details: {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
            code: issue.code,
          })),
        },
      })
    }

    const confirmationCount = parsed.data.confirmationCount ?? null

    return {
      providerEventId: parsed.data.providerEventId,
      provider,
      externalTransactionId: parsed.data.externalTransactionId,
      depositIntentId: parsed.data.depositIntentId ?? null,
      destinationReference: parsed.data.destinationReference ?? null,
      amountMinor: parsed.data.amountMinor,
      currency: parsed.data.currency,
      confirmationCount,
      confirmed: parsed.data.confirmed ?? (confirmationCount ?? 0) > 0,
      rawPayload: toJsonObject(payload),
    }
  }

  async getProviderTransaction(
    lookup: ProviderTransactionLookup,
  ): Promise<ProviderTransactionSnapshot> {
    return {
      exists: false,
      provider: lookup.provider,
      externalTransactionId: lookup.externalTransactionId,
      amountMinor: null,
      currency: null,
      confirmationCount: null,
      confirmed: false,
      destinationReference: null,
      depositIntentId: null,
      rawPayload: {},
    }
  }

  signPayload(
    payload: unknown,
    timestamp?: string,
    nonce?: string,
    rawBody?: Buffer | string,
  ): string {
    const timestampForSignature = timestamp ?? ''
    const nonceForSignature = nonce ?? ''
    const rawBodyForSignature =
      typeof rawBody === 'string'
        ? rawBody
        : Buffer.isBuffer(rawBody)
          ? rawBody.toString('utf8')
          : stableStringify(payload)

    return createHmac('sha256', this.webhookSecret ?? '')
      .update(
        `${timestampForSignature}.${nonceForSignature}.${rawBodyForSignature}`,
      )
      .digest('hex')
  }
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
