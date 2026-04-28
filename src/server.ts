import path from 'node:path'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

import { createApp } from './app.js'
import {
  assertStartupReadiness,
  getStartupReadinessReport,
} from './config/startupReadiness.js'
import { buildApplicationContainer } from './config/serviceFactory.js'
import { loadEnv } from './config/env.js'
import { PostgresDatabase } from './shared/db/PostgresDatabase.js'
import { createLogger } from './shared/observability/logger.js'

async function main() {
  const env = loadEnv()

  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to start nines-financial')
  }

  const migrationsDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    './migrations',
  )
  const logger = createLogger({ service: 'nines-financial' })
  const database = new PostgresDatabase({ connectionString: env.DATABASE_URL })

  await assertStartupReadiness(database, migrationsDirectory)

  const container = buildApplicationContainer({
    database,
    logger,
  })
  const server = createServer(
    createApp({ ...container.services, ...container.handlers }, {
      readinessCheck: async () =>
        getStartupReadinessReport(database, migrationsDirectory),
    }),
  )

  server.listen(env.PORT, () => {
    process.stdout.write(
      JSON.stringify({
        level: 'info',
        message: 'nines-financial listening',
        port: env.PORT,
      }) + '\n',
    )
  })

  async function shutdown() {
    await database.close()
    server.close()
  }

  process.once('SIGINT', () => {
    void shutdown()
  })

  process.once('SIGTERM', () => {
    void shutdown()
  })
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exitCode = 1
})
