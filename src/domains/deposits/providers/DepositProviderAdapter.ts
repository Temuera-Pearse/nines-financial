import type { JsonObject } from '../../../shared/types/Json.js'

export interface ProviderWebhookInput {
  provider: string
  headers: Record<string, string | undefined>
  body: unknown
  rawBody?: Buffer | string | undefined
}

export interface NormalizedProviderDepositEvent {
  providerEventId: string
  provider: string
  externalTransactionId: string
  depositIntentId: string | null
  destinationReference: string | null
  amountMinor: string
  currency: string
  confirmationCount: number | null
  confirmed: boolean
  rawPayload: JsonObject
}

export interface ProviderTransactionLookup {
  provider: string
  externalTransactionId: string
}

export interface ProviderTransactionSnapshot {
  exists: boolean
  provider: string
  externalTransactionId: string
  amountMinor: string | null
  currency: string | null
  confirmationCount: number | null
  confirmed: boolean
  destinationReference: string | null
  depositIntentId: string | null
  rawPayload: JsonObject
}

export interface DepositProviderAdapter {
  verifyWebhookSignature(input: ProviderWebhookInput): void
  parseDepositWebhook(input: ProviderWebhookInput): NormalizedProviderDepositEvent
  normalizeProviderDepositEvent(
    payload: unknown,
    provider: string,
  ): NormalizedProviderDepositEvent
  getProviderTransaction(
    lookup: ProviderTransactionLookup,
  ): Promise<ProviderTransactionSnapshot>
}
