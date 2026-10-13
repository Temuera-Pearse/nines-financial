import { describe, expect, it } from 'vitest'

import { CoreLoopSoakHarness } from '../support/coreLoopSoakHarness.js'

const enabled = process.env.NINES_I1_ENABLED === '1'
const i1Describe = enabled ? describe : describe.skip

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for the Stage I1 drill`)
  return value
}

function requireDisposableBackendDatabase(): string {
  const value = required('NINES_I1_BACKEND_DISPOSABLE_PG_URL')
  if (process.env.NINES_I1_BACKEND_DISPOSABLE_PG_ALLOW_RESET !== '1') {
    throw new Error('NINES_I1_BACKEND_DISPOSABLE_PG_ALLOW_RESET=1 is required')
  }
  const databaseName = new URL(value).pathname.replace(/^\//, '')
  if (!/(?:test|disposable)/i.test(databaseName) ||
      /(?:^|[_-])(?:dev|development|prod|production)(?:[_-]|$)/i.test(databaseName)) {
    throw new Error('I1 backend PostgreSQL database must be disposable test-only')
  }
  return value
}

i1Describe('Stage I1 full Nines core-loop integration', () => {
  it('runs the deterministic 100-race standard scenario twice from clean schemas', async () => {
    const backendDatabaseUrl = requireDisposableBackendDatabase()
    const financialDatabaseUrl = required('NINES_FINANCIAL_REAL_PG_URL')
    expect(new URL(backendDatabaseUrl).pathname).not.toBe(new URL(financialDatabaseUrl).pathname)
    const common = { seed: process.env.NINES_I1_SEED ?? 'nines-i1-standard-v1', races: 100,
      players: Math.max(50, Number(process.env.NINES_I1_PLAYERS ?? '50')),
      backendDatabaseUrl }
    const first = await new CoreLoopSoakHarness({ ...common, runSecurityRegression: true }).run()
    const second = await new CoreLoopSoakHarness(common).run()
    expect(second.deterministicRacesDigest).toBe(first.deterministicRacesDigest)
    expect(second.economicDigest).toBe(first.economicDigest)
    expect(first.settlements).toBe(100); expect(second.settlements).toBe(100)
    process.stdout.write(`${JSON.stringify({ event: 'i1-standard-report', first, second })}\n`)
  }, 1_800_000)

  const soakEnabled = process.env.NINES_I1_SOAK_ENABLED === '1'
  ;(soakEnabled ? it : it.skip)('runs the configurable extended soak and database restart',
    async () => {
      const races = Number(process.env.NINES_I1_SOAK_RACES ?? '1000')
      const players = Number(process.env.NINES_I1_PLAYERS ?? '50')
      if (!Number.isInteger(races) || races < 1_000) {
        throw new Error('NINES_I1_SOAK_RACES must be an integer of at least 1000')
      }
      if (!Number.isInteger(players) || players < 50) {
        throw new Error('NINES_I1_PLAYERS must be an integer of at least 50')
      }
      const report = await new CoreLoopSoakHarness({
        seed: process.env.NINES_I1_SEED ?? 'nines-i1-soak-v1', races, players,
        backendDatabaseUrl: requireDisposableBackendDatabase(),
        databaseRestartContainer: required('NINES_I1_POSTGRES_CONTAINER'),
        databaseRestartAtRace: Math.floor(races / 2), runSecurityRegression: true,
      }).run()
      expect(report.races).toBeGreaterThanOrEqual(1_000)
      expect(report.players).toBeGreaterThanOrEqual(50)
      expect(report.databaseRestarted).toBe(true)
      expect(report.deadlocks).toBe(0); expect(report.lockTimeouts).toBe(0)
      expect(report.connectionErrors).toBe(0)
      process.stdout.write(`${JSON.stringify({ event: 'i1-soak-report', report })}\n`)
    }, 7_200_000)
})
