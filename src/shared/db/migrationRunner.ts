import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import type { Database, DatabaseTransaction, QueryResultRow } from './Database.js'

interface AppliedMigrationRow extends QueryResultRow {
  version: string
}

export interface SqlMigrationRunnerOptions {
  beforeMigration?: (
    transaction: DatabaseTransaction,
    fileName: string,
  ) => Promise<void>
  onMigrationStart?: (fileName: string) => void
  onMigrationComplete?: (fileName: string, durationMs: number) => void
}

export async function runSqlMigrations(
  database: Database,
  migrationsDirectory: string,
  options: SqlMigrationRunnerOptions = {},
): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  const files = (await readdir(migrationsDirectory))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right))

  const appliedRows = await database.query<AppliedMigrationRow>(
    'SELECT version FROM schema_migrations ORDER BY version ASC',
  )
  const appliedVersions = new Set(appliedRows.rows.map((row) => row.version))

  for (const fileName of files) {
    if (appliedVersions.has(fileName)) {
      continue
    }

    const sql = await readFile(path.join(migrationsDirectory, fileName), 'utf8')
    const startedAt = Date.now()

    options.onMigrationStart?.(fileName)

    await database.tx(async (transaction) => {
      await options.beforeMigration?.(transaction, fileName)
      await transaction.query(sql)
      await transaction.query('INSERT INTO schema_migrations (version) VALUES ($1)', [fileName])
    })

    options.onMigrationComplete?.(fileName, Date.now() - startedAt)
  }
}
