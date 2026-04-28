import { afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'

import {
  createTestApplication,
  type TestApplicationHarness,
} from '../support/testApp.js'

describe('Readiness HTTP', () => {
  let harness: TestApplicationHarness | undefined

  afterEach(async () => {
    if (harness) {
      await harness.close()
      harness = undefined
    }
  })

  it('distinguishes liveness from readiness', async () => {
    harness = await createTestApplication()

    const healthResponse = await request(harness.app).get('/health')
    const readinessResponse = await request(harness.app).get('/ready')

    expect(healthResponse.status).toBe(200)
    expect(healthResponse.body.status).toBe('ok')
    expect(readinessResponse.status).toBe(200)
    expect(readinessResponse.body.status).toBe('ready')
    expect(readinessResponse.body.pendingMigrations).toEqual([])
  })
})
