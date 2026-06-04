import { describe, expect, it } from 'vitest'

import { SimulatedWithdrawalProviderAdapter } from '../../src/domains/withdrawals/providers/SimulatedWithdrawalProviderAdapter.js'
import type { WithdrawalRequest } from '../../src/domains/withdrawals/entities/WithdrawalRequest.js'
import { toWithdrawalRequestId } from '../../src/domains/withdrawals/types/withdrawalIdentifiers.js'
import { toUserId } from '../../src/domains/account/types/identifiers.js'
import { toPlayerAccountId } from '../../src/domains/account/types/identifiers.js'
import { toLedgerTransactionId } from '../../src/domains/accounting/types/identifiers.js'

function withdrawalRequest(
  overrides: Partial<WithdrawalRequest> = {},
): WithdrawalRequest {
  const now = new Date('2026-04-22T12:00:00.000Z')

  return {
    withdrawalRequestId: toWithdrawalRequestId('wd_req_adapter_contract'),
    playerId: toUserId('withdrawal-provider-adapter-player'),
    playerAccountId: toPlayerAccountId('pa_withdrawal_provider_adapter'),
    currency: 'USDC',
    amountMinorUnits: '1000',
    destinationKind: 'simulated_external_account',
    destinationReference: 'simulated-destination',
    provider: 'simulated',
    status: 'submission_pending',
    idempotencyKey: 'withdrawal-provider-adapter-create',
    correlationId: 'corr_withdrawal_provider_adapter',
    causationId: 'cause_withdrawal_provider_adapter',
    reservationLedgerTransactionId: toLedgerTransactionId('txn_reservation'),
    releaseLedgerTransactionId: null,
    finalizationLedgerTransactionId: null,
    reviewReasonCode: null,
    reviewReasonText: null,
    failureReasonCode: null,
    failureReasonText: null,
    createdAt: now,
    updatedAt: now,
    requestedAt: now,
    reservedAt: now,
    approvedAt: now,
    rejectedAt: null,
    cancelledAt: null,
    ...overrides,
  }
}

describe('SimulatedWithdrawalProviderAdapter', () => {
  it('submits a normalized simulated withdrawal with stable provider references', async () => {
    const adapter = new SimulatedWithdrawalProviderAdapter({
      clock: { now: () => new Date('2026-04-22T12:00:00.000Z') },
    })

    const result = await adapter.submitWithdrawal({
      withdrawalRequest: withdrawalRequest(),
      providerIdempotencyKey: 'provider-idempotency-key',
    })

    expect(result).toMatchObject({
      provider: 'simulated',
      providerStatus: 'accepted',
      providerIdempotencyKey: 'provider-idempotency-key',
      rawPayload: {
        simulated: true,
        action: 'submit_withdrawal',
      },
    })
    expect(result.externalWithdrawalId).toMatch(/^sim_wd_/)
    expect(result.externalTransactionId).toMatch(/^sim_tx_/)
  })

  it('normalizes simulated provider statuses deterministically', () => {
    const adapter = new SimulatedWithdrawalProviderAdapter()

    expect(
      adapter.normalizeWithdrawalStatus({ providerStatus: 'confirmed' }),
    ).toBe('confirmed')
    expect(() => adapter.normalizeWithdrawalStatus({ providerStatus: 'sent' }))
      .toThrowError('Withdrawal provider status payload is malformed')
  })

  it('rejects unsupported destinations at the adapter boundary', () => {
    const adapter = new SimulatedWithdrawalProviderAdapter()

    expect(
      adapter.validateDestination({
        provider: 'simulated',
        currency: 'USDC',
        destinationKind: 'simulated_external_account',
        destinationReference: 'destination',
      }),
    ).toMatchObject({ valid: true })
    expect(
      adapter.validateDestination({
        provider: 'real_provider',
        currency: 'USDC',
        destinationKind: 'simulated_external_account',
        destinationReference: 'destination',
      }),
    ).toMatchObject({
      valid: false,
      reasonCode: 'WITHDRAWAL_PROVIDER_NOT_SUPPORTED',
    })
  })
})
