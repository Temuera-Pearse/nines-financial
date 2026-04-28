import type { Logger } from '../../src/shared/observability/logger.js'
import { FixedClock } from '../../src/shared/time/Clock.js'
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
): Promise<TestApplicationHarness> {
  const databaseHarness = await createTestDatabase()
  const container = buildApplicationContainer({
    database: databaseHarness.database,
    clock: new FixedClock(now),
    logger: new SilentLogger(),
  })

  return {
    ...databaseHarness,
    container,
    app: createApp({ ...container.services, ...container.handlers }, {
      readinessCheck: async () => ({
        checkedAt: now,
        latestAvailableMigration:
          '003_phase_2_5_financial_authority_hardening.sql',
        latestAppliedMigration:
          '003_phase_2_5_financial_authority_hardening.sql',
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
