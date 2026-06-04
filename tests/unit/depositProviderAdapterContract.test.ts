import { describe, expect, it } from 'vitest'

import type { DepositProviderAdapter } from '../../src/domains/deposits/providers/DepositProviderAdapter.js'
import { SimulatedDepositProviderAdapter } from '../../src/domains/deposits/providers/SimulatedDepositProviderAdapter.js'
import { FixedClock } from '../../src/shared/time/Clock.js'

interface ContractAdapterHarness {
  adapter: DepositProviderAdapter & {
    signPayload(
      payload: unknown,
      timestamp?: string,
      nonce?: string,
      rawBody?: Buffer | string,
    ): string
  }
  provider: string
  validPayload: Record<string, unknown>
  timestamp: string
  nonce: string
}

function runDepositProviderAdapterContract(
  name: string,
  createHarness: () => ContractAdapterHarness,
): void {
  describe(name, () => {
    function signedInput(overrides: Record<string, unknown> = {}) {
      const harness = createHarness()
      const body = { ...harness.validPayload, ...overrides }
      const rawBody = JSON.stringify(body)

      return {
        harness,
        input: {
          provider: harness.provider,
          body,
          rawBody,
          headers: {
            'x-nines-provider-timestamp': harness.timestamp,
            'x-nines-provider-nonce': harness.nonce,
            'x-nines-provider-signature': harness.adapter.signPayload(
              body,
              harness.timestamp,
              harness.nonce,
              rawBody,
            ),
          },
        },
      }
    }

    it('parses a valid signed payload into a normalized provider deposit event', () => {
      const { harness, input } = signedInput()

      const normalized = harness.adapter.parseDepositWebhook(input)

      expect(normalized).toMatchObject({
        providerEventId: 'provider-event-contract',
        provider: 'simulated',
        externalTransactionId: 'external-tx-contract',
        amountMinor: '1000',
        currency: 'USDC',
        confirmationCount: 6,
        confirmed: true,
      })
    })

    it('rejects invalid signatures', () => {
      const { harness, input } = signedInput()

      expect(() =>
        harness.adapter.parseDepositWebhook({
          ...input,
          headers: {
            ...input.headers,
            'x-nines-provider-signature': 'invalid-signature',
          },
        }),
      ).toThrow(/signature is invalid/)
    })

    it('rejects missing required provider fields', () => {
      const { harness, input } = signedInput({ providerEventId: undefined })

      expect(() => harness.adapter.parseDepositWebhook(input)).toThrow(
        /payload is malformed/,
      )
    })

    it('normalizes amounts as positive minor-unit strings', () => {
      const { harness, input } = signedInput({ amountMinor: '000123' })

      const normalized = harness.adapter.parseDepositWebhook(input)

      expect(normalized.amountMinor).toBe('000123')
      expect(typeof normalized.amountMinor).toBe('string')
    })

    it('normalizes currency consistently and rejects non-canonical casing', () => {
      const { harness, input } = signedInput({ currency: 'usdc' })

      expect(() => harness.adapter.parseDepositWebhook(input)).toThrow(
        /payload is malformed/,
      )
    })

    it('requires externalTransactionId', () => {
      const { harness, input } = signedInput({ externalTransactionId: '' })

      expect(() => harness.adapter.parseDepositWebhook(input)).toThrow(
        /payload is malformed/,
      )
    })

    it('derives confirmation status deterministically', () => {
      const { harness, input } = signedInput({
        confirmed: undefined,
        confirmationCount: 2,
      })

      const normalized = harness.adapter.parseDepositWebhook(input)

      expect(normalized.confirmed).toBe(true)
    })

    it('preserves raw payload safely as a JSON object', () => {
      const { harness, input } = signedInput({
        metadata: { providerTraceId: 'trace-contract' },
      })

      const normalized = harness.adapter.parseDepositWebhook(input)

      expect(normalized.rawPayload).toMatchObject({
        metadata: { providerTraceId: 'trace-contract' },
      })
    })

    it('keeps malformed payloads out of the deposit domain', () => {
      const { harness, input } = signedInput({ amountMinor: '10.25' })

      expect(() => harness.adapter.parseDepositWebhook(input)).toThrow(
        /payload is malformed/,
      )
    })
  })
}

runDepositProviderAdapterContract('simulated deposit provider adapter contract', () => {
  const timestamp = '2026-04-22T12:00:00.000Z'
  const nonce = 'contract-nonce'

  return {
    adapter: new SimulatedDepositProviderAdapter({
      webhookSecret: 'contract-secret',
      clock: new FixedClock(new Date(timestamp)),
      replayWindowSeconds: 300,
    }),
    provider: 'simulated',
    timestamp,
    nonce,
    validPayload: {
      providerEventId: 'provider-event-contract',
      externalTransactionId: 'external-tx-contract',
      amountMinor: '1000',
      currency: 'USDC',
      confirmationCount: 6,
      confirmed: true,
    },
  }
})
