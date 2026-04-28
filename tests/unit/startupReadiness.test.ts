import path from 'node:path'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { getStartupReadinessReport } from '../../src/config/startupReadiness.js'
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
      '003_phase_2_5_financial_authority_hardening.sql',
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
  })
})
