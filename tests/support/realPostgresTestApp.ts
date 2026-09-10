import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Express } from 'express'

import { createApp } from '../../src/app.js'
import {
  buildApplicationContainer,
  type ApplicationContainer,
} from '../../src/config/serviceFactory.js'
import { PostgresDatabase } from '../../src/shared/db/PostgresDatabase.js'
import type { Database, Queryable } from '../../src/shared/db/Database.js'
import { runSqlMigrations } from '../../src/shared/db/migrationRunner.js'
import { FixedClock } from '../../src/shared/time/Clock.js'
import type { FaultInjector } from '../../src/shared/faults/FaultInjector.js'
import type { Logger } from '../../src/shared/observability/logger.js'

class SilentLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  child(): Logger {
    return this
  }
}

const setupLockTimeoutMs = 5_000
const setupStatementTimeoutMs = 60_000

function debugRealPostgresSetupEnabled(): boolean {
  return process.env.NINES_FINANCIAL_REAL_PG_DEBUG === '1'
}

function logRealPostgresSetup(
  message: string,
  context: Record<string, unknown> = {},
): void {
  if (!debugRealPostgresSetupEnabled()) {
    return
  }

  process.stderr.write(
    `${JSON.stringify({
      level: 'debug',
      component: 'real-postgres-drill-harness',
      message,
      ...context,
    })}\n`,
  )
}

async function timedSetupStep<T>(
  step: string,
  work: () => Promise<T> | T,
): Promise<T> {
  const startedAt = Date.now()
  logRealPostgresSetup(`${step}:start`)

  try {
    const result = await work()
    logRealPostgresSetup(`${step}:complete`, {
      durationMs: Date.now() - startedAt,
    })
    return result
  } catch (error) {
    logRealPostgresSetup(`${step}:failed`, {
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

async function applySetupTimeouts(queryable: Queryable): Promise<void> {
  await queryable.query(`SET LOCAL lock_timeout = '${setupLockTimeoutMs}ms'`)
  await queryable.query(
    `SET LOCAL statement_timeout = '${setupStatementTimeoutMs}ms'`,
  )
}

export interface RealPostgresTestApplicationHarness {
  app: Express
  database: Database
  container: ApplicationContainer
  close(): Promise<void>
}

function buildHarnessForDatabase(
  database: Database,
  options: {
    faultInjector?: FaultInjector
  } = {},
): Omit<RealPostgresTestApplicationHarness, 'close'> {
  const clock = new FixedClock(new Date('2026-04-22T12:00:00.000Z'))
  const container = buildApplicationContainer({
    database,
    clock,
    faultInjector: options.faultInjector,
    depositProviderWebhookSecret: 'test-deposit-webhook-secret',
    withdrawalProviderWebhookSecret: 'test-withdrawal-webhook-secret',
    logger: new SilentLogger(),
  })

  return {
    app: createApp({ ...container.services, ...container.handlers }, {
      readinessCheck: async () => ({
        checkedAt: clock.now(),
        latestAvailableMigration:
          '018_legacy_deposit_credit_exactly_once.sql',
        latestAppliedMigration:
          '018_legacy_deposit_credit_exactly_once.sql',
        pendingMigrations: [],
      }),
    }),
    database,
    container,
  }
}

function requireRealPostgresUrl(): string {
  const startedAt = Date.now()
  logRealPostgresSetup('requireRealPostgresUrl:start')
  const url = process.env.NINES_FINANCIAL_REAL_PG_URL

  if (!url) {
    throw new Error('NINES_FINANCIAL_REAL_PG_URL is required')
  }

  if (process.env.NINES_FINANCIAL_REAL_PG_ALLOW_RESET !== '1') {
    throw new Error(
      'NINES_FINANCIAL_REAL_PG_ALLOW_RESET=1 is required because the harness drops and recreates the public schema',
    )
  }

  const parsed = new URL(url)
  const databaseName = parsed.pathname.replace(/^\//, '')

  if (
    !/test|local|dev/i.test(databaseName) &&
    process.env.NINES_FINANCIAL_REAL_PG_ALLOW_NON_TEST_DB !== '1'
  ) {
    throw new Error(
      'Refusing to reset a database whose name does not include test/local/dev. Set NINES_FINANCIAL_REAL_PG_ALLOW_NON_TEST_DB=1 only for a disposable database.',
    )
  }

  logRealPostgresSetup('requireRealPostgresUrl:complete', {
    durationMs: Date.now() - startedAt,
    databaseName,
  })

  return url
}

async function resetPublicSchema(database: Database): Promise<void> {
  await database.tx(async (transaction) => {
    await applySetupTimeouts(transaction)
    await timedSetupStep('resetPublicSchema.dropPublic', () =>
      transaction.query('DROP SCHEMA IF EXISTS public CASCADE'),
    )
    await timedSetupStep('resetPublicSchema.createPublic', () =>
      transaction.query('CREATE SCHEMA public'),
    )
  })
}

export function realPostgresDrillsEnabled(): boolean {
  return Boolean(process.env.NINES_FINANCIAL_REAL_PG_URL)
}

export async function createRealPostgresTestApplication(
  options: {
    faultInjector?: FaultInjector
  } = {},
): Promise<RealPostgresTestApplicationHarness> {
  return timedSetupStep('createRealPostgresTestApplication', async () => {
    const database = new PostgresDatabase({
      connectionString: requireRealPostgresUrl(),
      max: 30,
      options: `-c lock_timeout=${setupLockTimeoutMs}ms -c statement_timeout=${setupStatementTimeoutMs}ms`,
    })
    const migrationsDirectory = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../src/migrations',
    )

    try {
      await timedSetupStep('resetPublicSchema', () => resetPublicSchema(database))
      await timedSetupStep('runSqlMigrations', () =>
        runSqlMigrations(database, migrationsDirectory, {
          beforeMigration: applySetupTimeouts,
          onMigrationStart: (fileName) => {
            logRealPostgresSetup('migration:start', { fileName })
          },
          onMigrationComplete: (fileName, durationMs) => {
            logRealPostgresSetup('migration:complete', {
              fileName,
              durationMs,
            })
          },
        }),
      )

      const harness = await timedSetupStep('buildApplicationContainer', () =>
        buildHarnessForDatabase(database, options),
      )

      const result = {
        ...harness,
        close: async () => {
          await database.close()
        },
      }
      logRealPostgresSetup('createRealPostgresTestApplication:return')

      return result
    } catch (error) {
      await database.close().catch((closeError: unknown) => {
        logRealPostgresSetup('createRealPostgresTestApplication.closeFailed', {
          error:
            closeError instanceof Error ? closeError.message : String(closeError),
        })
      })
      throw error
    }
  })
}

export function createRealPostgresRestartedApplication(
  harness: RealPostgresTestApplicationHarness,
  options: {
    faultInjector?: FaultInjector
  } = {},
): Omit<RealPostgresTestApplicationHarness, 'close'> {
  return buildHarnessForDatabase(harness.database, options)
}
