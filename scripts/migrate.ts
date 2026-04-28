import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadEnv } from '../src/config/env.js'
import { PostgresDatabase } from '../src/shared/db/PostgresDatabase.js'
import { runSqlMigrations } from '../src/shared/db/migrationRunner.js'

async function main() {
  const env = loadEnv()

  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to run migrations')
  }

  const migrationsDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../src/migrations',
  )

  const database = new PostgresDatabase({ connectionString: env.DATABASE_URL })

  try {
    await runSqlMigrations(database, migrationsDirectory)
  } finally {
    await database.close()
  }

  process.stdout.write(
    JSON.stringify({
      level: 'info',
      message: 'migrations applied',
      databaseUrlConfigured: true,
      migrationsDirectory,
    }) + '\n',
  )
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})