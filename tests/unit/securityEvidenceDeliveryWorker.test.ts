import { describe, expect, it } from 'vitest'

import type { Database } from '../../src/shared/db/Database.js'
import { SecurityEvidenceDeliveryWorker } from '../../src/shared/outbox/SecurityEvidenceDeliveryWorker.js'

describe('Financial Security evidence delivery leases', () => {
  it('does not let a stale worker regress delivered evidence', async () => {
    const state = { status: 'pending', token: '' }
    const database = { async query(sql: string, parameters: unknown[] = []) {
      if (sql.includes('RETURNING event_id,payload,attempt_count,lease_token')) {
        state.token = String(parameters[0])
        return { rows: [{ event_id: '51db44bb-3d4f-4232-af3f-9c005681a21e',
          payload: { event: 'financial' }, attempt_count: 1, lease_token: state.token }], rowCount: 1 }
      }
      if (sql.includes('WHERE event_id=$1 AND lease_token=$4')) {
        const owned = state.token === parameters[3] && state.status !== 'delivered'
        if (owned) state.status = String(parameters[1])
        return { rows: [], rowCount: owned ? 1 : 0 }
      }
      throw new Error(`Unexpected query: ${sql}`)
    } } as unknown as Database
    const fetcher = async () => {
      state.status = 'delivered'; state.token = 'newer-financial-security-lease'
      return new Response('temporary', { status: 500 })
    }
    const worker = new SecurityEvidenceDeliveryWorker(database, 'http://security.test', 'test',
      'financial-worker-lease-test-secret-32', 'test-key', 1000, fetcher,
      () => new Date('2026-09-02T00:00:00.000Z'))
    await (worker as unknown as { deliverOne(): Promise<void> }).deliverOne()
    expect(state).toEqual({ status: 'delivered', token: 'newer-financial-security-lease' })
  })
})
