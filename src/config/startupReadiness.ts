import { readdir } from 'node:fs/promises'

import type { Database, QueryResultRow } from '../shared/db/Database.js'

interface AppliedMigrationRow extends QueryResultRow {
  version: string
}

export interface StartupReadinessReport {
  checkedAt: Date
  latestAvailableMigration: string | null
  latestAppliedMigration: string | null
  pendingMigrations: string[]
}

export async function getStartupReadinessReport(
  database: Database,
  migrationsDirectory: string,
): Promise<StartupReadinessReport> {
  await database.query('SELECT 1 AS ok')

  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right))

  let appliedRows

  try {
    appliedRows = await database.query<AppliedMigrationRow>(
      'SELECT version FROM schema_migrations ORDER BY version ASC',
    )
  } catch (error) {
    throw new Error(
      `schema_migrations is unavailable; run migrations before starting nines-financial (${error instanceof Error ? error.message : String(error)})`,
    )
  }

  const appliedVersions = appliedRows.rows.map((row) => row.version)
  const appliedVersionSet = new Set(appliedVersions)

  return {
    checkedAt: new Date(),
    latestAvailableMigration: migrationFiles.at(-1) ?? null,
    latestAppliedMigration: appliedVersions.at(-1) ?? null,
    pendingMigrations: migrationFiles.filter(
      (fileName) => !appliedVersionSet.has(fileName),
    ),
  }
}

export async function assertStartupReadiness(
  database: Database,
  migrationsDirectory: string,
): Promise<void> {
  const report = await getStartupReadinessReport(database, migrationsDirectory)

  if (report.pendingMigrations.length > 0) {
    throw new Error(
      `pending migrations detected: ${report.pendingMigrations.join(', ')}`,
    )
  }
}
