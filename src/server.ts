import { createServer } from 'node:http'

import { createApp } from './app.js'
import {
  assertStartupReadiness,
  getStartupReadinessReport,
  resolveServerMigrationsDirectory,
} from './config/startupReadiness.js'
import { buildApplicationContainer } from './config/serviceFactory.js'
import { loadServerEnv } from './config/env.js'
import { PostgresDatabase } from './shared/db/PostgresDatabase.js'
import { createLogger } from './shared/observability/logger.js'
import { SecurityEvidenceDeliveryWorker } from './shared/outbox/SecurityEvidenceDeliveryWorker.js'
import { RaceResultRecoveryWorker } from './domains/race-results/services/RaceResultRecoveryWorker.js'

async function main() {
  const env = loadServerEnv()

  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to start nines-financial')
  }

  const migrationsDirectory = resolveServerMigrationsDirectory(import.meta.url)
  const logger = createLogger({ service: 'nines-financial' })
  const database = new PostgresDatabase({ connectionString: env.DATABASE_URL })

  await assertStartupReadiness(database, migrationsDirectory, {
    nodeEnv: env.NODE_ENV,
    legacyDepositProviderEnabled: env.NINES_LEGACY_DEPOSIT_PROVIDER_ENABLED,
    withdrawalProviderEnabled: false,
    depositProviderWebhookSecret: env.NINES_DEPOSIT_PROVIDER_WEBHOOK_SECRET,
    withdrawalProviderWebhookSecret:
      env.NINES_WITHDRAWAL_PROVIDER_WEBHOOK_SECRET,
    withdrawalWebhookReplayWindowSeconds:
      env.NINES_WITHDRAWAL_WEBHOOK_REPLAY_WINDOW_SECONDS,
  })

  const container = buildApplicationContainer({
    database,
    environment: env.NODE_ENV,
    raceResultSettlementLeaseMs: env.NINES_RACE_RESULT_RECOVERY_LEASE_MS,
    depositProviderWebhookSecret: env.NINES_DEPOSIT_PROVIDER_WEBHOOK_SECRET,
    depositWebhookReplayWindowSeconds:
      env.NINES_DEPOSIT_WEBHOOK_REPLAY_WINDOW_SECONDS,
    withdrawalProviderWebhookSecret:
      env.NINES_WITHDRAWAL_PROVIDER_WEBHOOK_SECRET,
    withdrawalWebhookReplayWindowSeconds:
      env.NINES_WITHDRAWAL_WEBHOOK_REPLAY_WINDOW_SECONDS,
    logger,
  })
  const server = createServer(
    createApp({ ...container.services, ...container.handlers }, {
      database,
      environment: env.NODE_ENV,
      fundingAttestationsEnabled: env.NINES_API_FUNDING_ATTESTATIONS_ENABLED,
      playerGameplayReadEnabled: env.NINES_API_PLAYER_GAMEPLAY_ENABLED,
      legacyDepositProviderEnabled: env.NINES_LEGACY_DEPOSIT_PROVIDER_ENABLED,
      serviceAuthCredentials: { 'nines-api': env.apiAuthHmacKeys },
      wagerIntakeEnabled: env.NINES_BACKEND_WAGER_INTAKE_ENABLED,
      raceLifecycleEnabled: env.NINES_BACKEND_RACE_LIFECYCLE_ENABLED,
      raceResultEnabled: env.NINES_BACKEND_RACE_RESULT_ENABLED,
      backendServiceAuthCredentials: { 'nines-back-end': env.backendAuthHmacKeys },
      serviceAuthReplayWindowSeconds: env.NINES_SERVICE_AUTH_REPLAY_WINDOW_SECONDS,
      readinessCheck: async () =>
        getStartupReadinessReport(database, migrationsDirectory, {
          nodeEnv: env.NODE_ENV,
          legacyDepositProviderEnabled:
            env.NINES_LEGACY_DEPOSIT_PROVIDER_ENABLED,
          withdrawalProviderEnabled: false,
          depositProviderWebhookSecret:
            env.NINES_DEPOSIT_PROVIDER_WEBHOOK_SECRET,
          withdrawalProviderWebhookSecret:
            env.NINES_WITHDRAWAL_PROVIDER_WEBHOOK_SECRET,
          withdrawalWebhookReplayWindowSeconds:
            env.NINES_WITHDRAWAL_WEBHOOK_REPLAY_WINDOW_SECONDS,
        }),
    }),
  )
  const securityWorker = env.NINES_SECURITY_EVIDENCE_DELIVERY_ENABLED
    ? new SecurityEvidenceDeliveryWorker(database, env.NINES_SECURITY_SERVICE_BASE_URL!,
      env.NODE_ENV, env.securityAuthHmacSecret!, env.securityAuthKeyId!,
      env.NINES_SERVICE_DELIVERY_POLL_INTERVAL_MS) : null
  const raceResultRecoveryWorker = env.NINES_BACKEND_RACE_RESULT_ENABLED &&
    env.NINES_RACE_RESULT_RECOVERY_ENABLED
    ? new RaceResultRecoveryWorker(database, container.services.raceResultSettlementService,
      logger.child({ component: 'race-result-recovery' }), {
        pollIntervalMs: env.NINES_RACE_RESULT_RECOVERY_POLL_INTERVAL_MS,
        leaseMs: env.NINES_RACE_RESULT_RECOVERY_LEASE_MS,
        maxAttempts: env.NINES_RACE_RESULT_RECOVERY_MAX_ATTEMPTS,
        batchSize: env.NINES_RACE_RESULT_RECOVERY_BATCH_SIZE,
      }) : null

  // Startup recovery runs only after migration readiness and before accepting
  // HTTP traffic. start() also schedules the periodic recovery scan.
  await raceResultRecoveryWorker?.start()

  server.listen(env.PORT, env.NINES_BIND_HOST, () => {
    process.stdout.write(
      JSON.stringify({
        level: 'info',
        message: 'nines-financial listening',
        port: env.PORT,
        host: env.NINES_BIND_HOST ?? null,
      }) + '\n',
    )
  })
  securityWorker?.start()

  async function shutdown() {
    await raceResultRecoveryWorker?.stop()
    await securityWorker?.stop()
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
