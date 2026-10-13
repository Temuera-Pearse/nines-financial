import type { Logger } from '../../src/shared/observability/logger.js'
import { FixedClock, type Clock } from '../../src/shared/time/Clock.js'
import type { FaultInjector } from '../../src/shared/faults/FaultInjector.js'
import { createApp } from '../../src/app.js'
import {
  buildApplicationContainer,
  type ApplicationContainer,
} from '../../src/config/serviceFactory.js'

import { createTestDatabase, type TestDatabaseHarness } from './testDatabase.js'

class SilentLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  child(): Logger {
    return this
  }
}

export interface TestApplicationHarness extends TestDatabaseHarness {
  app: ReturnType<typeof createApp>
  container: ApplicationContainer
}

export async function createTestApplication(
  now: Date = new Date('2026-04-22T12:00:00.000Z'),
  options: {
    faultInjector?: FaultInjector
    clock?: Clock
    wagerIntakeEnabled?: boolean
    raceLifecycleEnabled?: boolean
    raceResultEnabled?: boolean
    backendServiceAuthCredentials?: Readonly<Record<string, Readonly<Record<string, string>>>>
    boundaryClock?: () => Date
  } = {},
): Promise<TestApplicationHarness> {
  const databaseHarness = await createTestDatabase()
  const clock = options.clock ?? new FixedClock(now)
  const container = buildApplicationContainer({
    database: databaseHarness.database,
    clock,
    faultInjector: options.faultInjector,
    depositProviderWebhookSecret: 'test-deposit-webhook-secret',
    withdrawalProviderWebhookSecret: 'test-withdrawal-webhook-secret',
    logger: new SilentLogger(),
  })

  return {
    ...databaseHarness,
    container,
    app: createApp({ ...container.services, ...container.handlers }, {
      database: databaseHarness.database,
      environment: 'test',
      ...(options.wagerIntakeEnabled === undefined ? {} : {
        wagerIntakeEnabled: options.wagerIntakeEnabled,
      }),
      ...(options.raceLifecycleEnabled === undefined ? {} : {
        raceLifecycleEnabled: options.raceLifecycleEnabled,
      }),
      ...(options.raceResultEnabled === undefined ? {} : {
        raceResultEnabled: options.raceResultEnabled,
      }),
      ...(options.backendServiceAuthCredentials === undefined ? {} : {
        backendServiceAuthCredentials: options.backendServiceAuthCredentials,
      }),
      ...(options.boundaryClock === undefined ? {} : {
        boundaryClock: options.boundaryClock,
      }),
      readinessCheck: async () => ({
        checkedAt: now,
        latestAvailableMigration:
          '025_authoritative_result_recovery.sql',
        latestAppliedMigration:
          '025_authoritative_result_recovery.sql',
        pendingMigrations: [],
      }),
    }),
  }
}

export function stateChangingHeaders(
  idempotencyKey: string,
  correlationId = `corr_${idempotencyKey}`,
  causationId = `cause_${idempotencyKey}`,
): Record<string, string> {
  return {
    'idempotency-key': idempotencyKey,
    'x-correlation-id': correlationId,
    'x-causation-id': causationId,
  }
}
