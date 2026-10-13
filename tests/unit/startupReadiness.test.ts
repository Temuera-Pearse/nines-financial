import path from 'node:path'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  assertStartupReadiness,
  getStartupReadinessReport,
} from '../../src/config/startupReadiness.js'
import {
  createTestDatabase,
  type TestDatabaseHarness,
} from '../support/testDatabase.js'

describe('startup readiness', () => {
  let harness: TestDatabaseHarness | undefined
  let tempDirectories: string[] = []

  afterEach(async () => {
    if (harness) {
      await harness.close()
      harness = undefined
    }
    tempDirectories = []
  })

  it('reports no pending migrations for the current schema', async () => {
    harness = await createTestDatabase()
    const migrationsDirectory = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../src/migrations',
    )

    const readiness = await getStartupReadinessReport(
      harness.database,
      migrationsDirectory,
    )

    expect(readiness.pendingMigrations).toEqual([])
    expect(readiness.latestAppliedMigration).toBe(
      '025_authoritative_result_recovery.sql',
    )
  })

  it('reports pending migrations when files exist beyond the applied schema state', async () => {
    harness = await createTestDatabase()
    const tempDirectory = await mkdtemp(
      path.join(tmpdir(), 'nines-financial-migrations-'),
    )
    tempDirectories.push(tempDirectory)

    await writeFile(
      path.join(tempDirectory, '001_initial_schema.sql'),
      '-- applied\n',
    )
    await writeFile(
      path.join(tempDirectory, '002_phase_1_5_guardrails.sql'),
      '-- applied\n',
    )
    await writeFile(path.join(tempDirectory, '003_pending.sql'), '-- pending\n')

    const readiness = await getStartupReadinessReport(
      harness.database,
      tempDirectory,
    )

    expect(readiness.pendingMigrations).toEqual(['003_pending.sql'])
    expect(readiness.latestAvailableMigration).toBe('003_pending.sql')
    await expect(
      assertStartupReadiness(harness.database, tempDirectory),
    ).rejects.toThrow('pending migrations detected: 003_pending.sql')
  })

  it('does not require inactive provider secrets for the production funding-only profile', async () => {
    harness = await createTestDatabase()
    const migrationsDirectory = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../src/migrations',
    )

    const readiness = await getStartupReadinessReport(
      harness.database,
      migrationsDirectory,
      { nodeEnv: 'production' },
    )

    expect(readiness.pendingMigrations).toEqual([])
  })

  it('fails production readiness when an explicitly active deposit provider lacks its secret', async () => {
    harness = await createTestDatabase()
    const migrationsDirectory = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../src/migrations',
    )

    await expect(
      getStartupReadinessReport(harness.database, migrationsDirectory, {
        nodeEnv: 'production',
        legacyDepositProviderEnabled: true,
      }),
    ).rejects.toThrow(
      'NINES_DEPOSIT_PROVIDER_WEBHOOK_SECRET is required when NODE_ENV=production',
    )
  })

  it('fails production readiness when an explicitly active withdrawal provider lacks its secret', async () => {
    harness = await createTestDatabase()
    const migrationsDirectory = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../src/migrations',
    )

    await expect(
      getStartupReadinessReport(harness.database, migrationsDirectory, {
        nodeEnv: 'production',
        withdrawalProviderEnabled: true,
      }),
    ).rejects.toThrow(
      'NINES_WITHDRAWAL_PROVIDER_WEBHOOK_SECRET is required when NODE_ENV=production',
    )
  })

  it('fails readiness when the withdrawal webhook replay window is invalid', async () => {
    harness = await createTestDatabase()
    const migrationsDirectory = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../src/migrations',
    )

    await expect(
      getStartupReadinessReport(harness.database, migrationsDirectory, {
        nodeEnv: 'test',
        withdrawalWebhookReplayWindowSeconds: 0,
      }),
    ).rejects.toThrow(
      'NINES_WITHDRAWAL_WEBHOOK_REPLAY_WINDOW_SECONDS must be a positive integer',
    )
  })

  it('allows local readiness defaults outside production mode', async () => {
    harness = await createTestDatabase()
    const migrationsDirectory = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../src/migrations',
    )

    const readiness = await getStartupReadinessReport(
      harness.database,
      migrationsDirectory,
      { nodeEnv: 'test' },
    )

    expect(readiness.pendingMigrations).toEqual([])
  })
})
