import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import type { Database, QueryResultRow } from './Database.js'

interface AppliedMigrationRow extends QueryResultRow {
  version: string
}

export async function runSqlMigrations(database: Database, migrationsDirectory: string): Promise<void> {
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

    await database.tx(async (transaction) => {
      await transaction.query(sql)
      await transaction.query('INSERT INTO schema_migrations (version) VALUES ($1)', [fileName])
    })
  }
}