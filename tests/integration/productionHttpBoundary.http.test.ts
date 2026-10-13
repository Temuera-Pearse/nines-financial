import request from 'supertest'
import type { Express } from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createApp,
  productionHttpRoutes,
  resolveHttpRouteProfile,
} from '../../src/app.js'
import {
  createTestApplication,
  type TestApplicationHarness,
} from '../support/testApp.js'

const apiSecret = 'production-api-financial-secret-at-least-32'
const productionCredentials = {
  'nines-api': { 'api-financial-v1': apiSecret },
}
const backendCredentials = {
  'nines-back-end': {
    'backend-wager-v1': 'production-backend-financial-secret-at-least-32',
  },
}

interface ExpressRouteLayer {
  route?: {
    path: string
    methods: Record<string, boolean>
  }
  handle?: { stack?: ExpressRouteLayer[] }
}

function explicitRouteInventory(app: Express): string[] {
  const root = app as Express & { _router?: { stack?: ExpressRouteLayer[] } }
  const inventory: string[] = []
  const visit = (layers: ExpressRouteLayer[] = []): void => {
    for (const layer of layers) {
      if (layer.route) {
        for (const [method, enabled] of Object.entries(layer.route.methods)) {
          if (enabled) inventory.push(`${method.toUpperCase()} ${layer.route.path}`)
        }
      }
      visit(layer.handle?.stack)
    }
  }
  visit(root._router?.stack)
  return inventory.sort((left, right) => left.localeCompare(right))
}

function approvedInventory(fundingEnabled: boolean, wagerEnabled: boolean,
  lifecycleEnabled: boolean, resultEnabled: boolean, gameplayEnabled = false): string[] {
  return productionHttpRoutes
    .filter((route) =>
      !['/internal/v1/funding-attestations', '/internal/v1/nines-issuance-authorizations',
        '/internal/v1/wagers/place-bet', '/internal/v1/race-lifecycle-events',
        '/internal/v1/race-results', '/internal/v1/player-gameplay-state'].includes(route.path) ||
      (route.path === '/internal/v1/wagers/place-bet' ? wagerEnabled :
        route.path === '/internal/v1/race-lifecycle-events' ? lifecycleEnabled :
          route.path === '/internal/v1/race-results' ? resultEnabled :
            route.path === '/internal/v1/player-gameplay-state' ? gameplayEnabled : fundingEnabled),
    )
    .map((route) => `${route.method} ${route.path}`)
    .sort((left, right) => left.localeCompare(right))
}

describe('first-production HTTP boundary', () => {
  let harness: TestApplicationHarness | undefined

  afterEach(async () => {
    await harness?.close()
    harness = undefined
  })

  it('mounts only health, readiness, funding, wagering, lifecycle, and result boundaries', async () => {
    harness = await createTestApplication()
    const readinessCheck = vi.fn(async () => ({
      checkedAt: new Date('2026-04-22T12:00:00.000Z'),
      latestAvailableMigration: '018_internal_migration_name.sql',
      latestAppliedMigration: '018_internal_migration_name.sql',
      pendingMigrations: [],
    }))
    const app = createApp(
      { ...harness.container.services, ...harness.container.handlers },
      {
        database: harness.database,
        environment: 'production',
        fundingAttestationsEnabled: true,
        legacyDepositProviderEnabled: false,
        serviceAuthCredentials: productionCredentials,
        wagerIntakeEnabled: true,
        raceLifecycleEnabled: true,
        raceResultEnabled: true,
        backendServiceAuthCredentials: backendCredentials,
        readinessCheck,
      },
    )

    expect(resolveHttpRouteProfile('production')).toBe(
      'production-funding-only',
    )
    expect(explicitRouteInventory(app)).toEqual(approvedInventory(true, true, true, true))
    expect((await request(app).get('/health')).body).toEqual({ status: 'ok' })

    const ready = await request(app).get('/ready')
    expect(ready.status).toBe(200)
    expect(ready.body).toEqual({ status: 'ready' })
    expect(readinessCheck).toHaveBeenCalledOnce()

    const funding = await request(app)
      .post('/internal/v1/funding-attestations')
      .send({})
    expect(funding.status).toBe(403)
    expect(funding.body.error.code).toBe('SERVICE_AUTH_MISSING')
    const issuance = await request(app)
      .post('/internal/v1/nines-issuance-authorizations')
      .send({})
    expect(issuance.status).toBe(403)
    expect(issuance.body.error.code).toBe('SERVICE_AUTH_MISSING')
    const wager = await request(app)
      .post('/internal/v1/wagers/place-bet')
      .send({})
    expect(wager.status).toBe(403)
    expect(wager.body.error.code).toBe('SERVICE_AUTH_MISSING')
    const lifecycle = await request(app)
      .post('/internal/v1/race-lifecycle-events')
      .send({})
    expect(lifecycle.status).toBe(403)
    expect(lifecycle.body.error.code).toBe('SERVICE_AUTH_MISSING')
    const result = await request(app).post('/internal/v1/race-results').send({})
    expect(result.status).toBe(403)
    expect(result.body.error.code).toBe('SERVICE_AUTH_MISSING')

    const excludedRoutes: ReadonlyArray<
      readonly ['get' | 'post', string]
    > = [
      ['post', '/accounts'],
      ['get', '/accounts/account-1'],
      ['get', '/player/accounts/NINES/balance'],
      ['get', '/admin/health'],
      ['post', '/ledger/transactions'],
      ['post', '/ledger/reservations'],
      ['post', '/commands/place-bet'],
      ['post', '/commands/settle-bet'],
      ['get', '/races/race-1/pool'],
      ['get', '/bets/bet-1'],
      ['get', '/players/player-1/bets'],
      ['get', '/carryovers'],
      ['post', '/withdrawal-requests'],
      ['post', '/provider-events/withdrawals/webhook/simulated'],
      ['post', '/deposit-intents'],
      ['post', '/provider-events/deposits/webhook/simulated'],
      ['post', '/system/balances/rebuild'],
      ['post', '/admin/accounts/player-account-1/freeze'],
      ['post', '/admin/operations/reconciliation/run'],
    ]

    for (const [method, path] of excludedRoutes) {
      const response = method === 'get'
        ? await request(app).get(path)
        : await request(app).post(path).send({})
      expect(response.status, `${method.toUpperCase()} ${path}`).toBe(404)
    }

    expect((await request(app).head('/health')).status).toBe(404)
    expect((await request(app).head('/ready')).status).toBe(404)
    expect((await request(app).options('/health')).status).toBe(404)
    expect((await request(app).options('/ready')).status).toBe(404)
    expect((await request(app)
      .options('/internal/v1/funding-attestations')).status).toBe(404)
    expect((await request(app)
      .post('/INTERNAL/V1/FUNDING-ATTESTATIONS').send({})).status).toBe(404)
    expect((await request(app)
      .post('/internal/v1/funding-attestations/').send({})).status).toBe(404)
    expect((await request(app)
      .post('/internal/v1/funding-attestations/.').send({})).status).toBe(404)
    expect((await request(app)
      .post('/internal//v1/funding-attestations').send({})).status).toBe(404)
    expect((await request(app)
      .post('/internal/v1/%66unding-attestations').send({})).status).toBe(404)
    expect((await request(app)
      .put('/internal/v1/funding-attestations').send({})).status).toBe(404)
    expect((await request(app)
      .post('/internal/v1/funding-attestations?probe=true').send({})).status)
      .toBe(403)
  })

  it('removes funding from both the effective and explicit inventory when disabled', async () => {
    harness = await createTestApplication()
    const app = createApp(
      { ...harness.container.services, ...harness.container.handlers },
      {
        environment: 'production',
        fundingAttestationsEnabled: false,
      },
    )

    expect(explicitRouteInventory(app)).toEqual(approvedInventory(false, false, false, false))
    expect((await request(app)
      .post('/internal/v1/funding-attestations').send({})).status).toBe(404)
    expect((await request(app)
      .post('/internal/v1/nines-issuance-authorizations').send({})).status).toBe(404)
    expect((await request(app)
      .post('/internal/v1/wagers/place-bet').send({})).status).toBe(404)
    expect((await request(app)
      .post('/internal/v1/race-lifecycle-events').send({})).status).toBe(404)
    expect((await request(app)
      .post('/internal/v1/race-results').send({})).status).toBe(404)
    expect((await request(app).get('/health')).status).toBe(200)
    expect((await request(app).get('/ready')).status).toBe(200)
  })

  it('sanitizes production readiness failure details', async () => {
    harness = await createTestApplication()
    const app = createApp(
      { ...harness.container.services, ...harness.container.handlers },
      {
        environment: 'production',
        readinessCheck: async () => {
          throw new Error(
            'postgres://private-host/internal-db migration-secret.sql',
          )
        },
      },
    )

    const response = await request(app).get('/ready')
    expect(response.status).toBe(503)
    expect(response.body).toEqual({ status: 'not_ready' })
  })

  it('reports sanitized not-ready when migrations are pending', async () => {
    harness = await createTestApplication()
    const app = createApp(
      { ...harness.container.services, ...harness.container.handlers },
      {
        environment: 'production',
        readinessCheck: async () => ({
          checkedAt: new Date('2026-04-22T12:00:00.000Z'),
          latestAvailableMigration: '020_pending.sql',
          latestAppliedMigration: '019_internal_wagering_nines.sql',
          pendingMigrations: ['020_pending.sql'],
        }),
      },
    )

    const response = await request(app).get('/ready')
    expect(response.status).toBe(503)
    expect(response.body).toEqual({ status: 'not_ready' })
    expect(response.text).not.toContain('020_pending.sql')
  })

  it('keeps the broad route surface explicit in test and development profiles', async () => {
    harness = await createTestApplication()
    const services = {
      ...harness.container.services,
      ...harness.container.handlers,
    }
    const testApp = createApp(services, {
      environment: 'test',
      legacyDepositProviderEnabled: true,
    })
    const developmentApp = createApp(services, {
      environment: 'development',
      legacyDepositProviderEnabled: true,
    })

    expect(resolveHttpRouteProfile('test')).toBe('full-simulation')
    expect(resolveHttpRouteProfile('development')).toBe('full-simulation')
    expect(() => resolveHttpRouteProfile(undefined as never)).toThrow(
      'environment must be explicitly configured',
    )
    expect(() => createApp(services, undefined as never)).toThrow(
      'environment must be explicitly configured',
    )
    expect((await request(testApp).get('/admin/health')).status).toBe(200)
    expect((await request(testApp).post('/accounts').send({})).status).not.toBe(404)
    expect((await request(testApp).post('/withdrawal-requests').send({})).status).not.toBe(404)
    expect((await request(testApp).post('/deposit-intents').send({})).status).not.toBe(404)
    expect((await request(developmentApp).get('/admin/health')).status).toBe(200)
  })
})
