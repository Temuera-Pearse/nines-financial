import { describe, expect, it } from 'vitest'

import type { WithdrawalProviderAdapter } from '../../src/domains/withdrawals/providers/WithdrawalProviderAdapter.js'
import { SimulatedWithdrawalProviderAdapter } from '../../src/domains/withdrawals/providers/SimulatedWithdrawalProviderAdapter.js'
import { FixedClock } from '../../src/shared/time/Clock.js'

interface ContractHarness {
  adapter: WithdrawalProviderAdapter & {
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

function runWithdrawalProviderAdapterContract(
  name: string,
  createHarness: () => ContractHarness,
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

    it('parses a valid signed payload into a normalized withdrawal provider event', () => {
      const { harness, input } = signedInput()

      const normalized = harness.adapter.parseWithdrawalWebhook(input)

      expect(normalized).toMatchObject({
        provider: 'simulated',
        externalWithdrawalId: 'external-withdrawal-contract',
        externalTransactionId: 'external-tx-contract',
        withdrawalRequestId: 'wd_req_contract',
        providerStatus: 'confirmed',
        amountMinorUnits: '1000',
        currency: 'USDC',
      })
    })

    it('rejects invalid signatures', () => {
      const { harness, input } = signedInput()

      expect(() =>
        harness.adapter.parseWithdrawalWebhook({
          ...input,
          headers: {
            ...input.headers,
            'x-nines-provider-signature': 'invalid-signature',
          },
        }),
      ).toThrow(/signature is invalid/)
    })

    it('rejects missing required fields', () => {
      const { harness, input } = signedInput({ externalWithdrawalId: '' })

      expect(() => harness.adapter.parseWithdrawalWebhook(input)).toThrow(
        /payload is malformed/,
      )
    })

    it('requires externalWithdrawalId', () => {
      const { harness, input } = signedInput({ externalWithdrawalId: undefined })

      expect(() => harness.adapter.parseWithdrawalWebhook(input)).toThrow(
        /payload is malformed/,
      )
    })

    it('handles externalTransactionId deterministically', () => {
      const { harness, input } = signedInput({ externalTransactionId: null })

      const normalized = harness.adapter.parseWithdrawalWebhook(input)

      expect(normalized.externalTransactionId).toBeNull()
    })

    it('normalizes provider status deterministically', () => {
      const { harness, input } = signedInput({ providerStatus: 'sent' })

      const normalized = harness.adapter.parseWithdrawalWebhook(input)

      expect(normalized.providerStatus).toBe('unknown')
    })

    it('preserves raw payload safely', () => {
      const { harness, input } = signedInput({
        metadata: { providerTraceId: 'trace-withdrawal-contract' },
      })

      const normalized = harness.adapter.parseWithdrawalWebhook(input)

      expect(normalized.rawPayload).toMatchObject({
        metadata: { providerTraceId: 'trace-withdrawal-contract' },
      })
    })

    it('validates amount and currency fields when present', () => {
      const { harness, input } = signedInput({ amountMinorUnits: '10.25' })

      expect(() => harness.adapter.parseWithdrawalWebhook(input)).toThrow(
        /payload is malformed/,
      )
    })

    it('keeps malformed payloads out of the withdrawal domain', () => {
      const { harness, input } = signedInput({ currency: 'usdc' })

      expect(() => harness.adapter.parseWithdrawalWebhook(input)).toThrow(
        /payload is malformed/,
      )
    })
  })
}

runWithdrawalProviderAdapterContract(
  'simulated withdrawal provider adapter contract',
  () => {
    const timestamp = '2026-04-22T12:00:00.000Z'
    const nonce = 'withdrawal-contract-nonce'

    return {
      adapter: new SimulatedWithdrawalProviderAdapter({
        webhookSecret: 'withdrawal-contract-secret',
        replayWindowSeconds: 300,
        clock: new FixedClock(new Date(timestamp)),
      }),
      provider: 'simulated',
      timestamp,
      nonce,
      validPayload: {
        externalWithdrawalId: 'external-withdrawal-contract',
        externalTransactionId: 'external-tx-contract',
        withdrawalRequestId: 'wd_req_contract',
        providerStatus: 'confirmed',
        amountMinorUnits: '1000',
        currency: 'USDC',
      },
    }
  },
)
