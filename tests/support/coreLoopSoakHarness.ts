import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import http, { type Server } from 'node:http'
import { promisify } from 'node:util'

import { expect } from 'vitest'

import type { NinesIssuanceAuthorizationV1 } from '../../src/domains/issuance-authorizations/dto/NinesIssuanceAuthorization.js'
import type { FaultInjector, FaultPoint } from '../../src/shared/faults/FaultInjector.js'
import type { Clock } from '../../src/shared/time/Clock.js'
import type { JsonValue } from '../../src/shared/types/Json.js'
import {
  createRealPostgresRestartedApplication,
  createRealPostgresTestApplication,
  reconnectRealPostgresTestApplication,
  type RealPostgresTestApplicationHarness,
} from './realPostgresTestApp.js'

import { closePool as closeBackendPool, getPool as getBackendPool,
  verifyPool as verifyBackendPool } from '../../../nines-back-end/src/db/pool.js'
import { PgRaceRepository } from '../../../nines-back-end/src/db/raceRepository.js'
import { NinesFinancialWagerClient, NinesFinancialWagerClientError } from
  '../../../nines-back-end/src/financial/NinesFinancialWagerClient.js'
import { NinesFinancialRaceLifecycleClient } from
  '../../../nines-back-end/src/financial/NinesFinancialRaceLifecycleClient.js'
import { NinesFinancialRaceResultClient, NinesFinancialRaceResultClientError } from
  '../../../nines-back-end/src/financial/NinesFinancialRaceResultClient.js'
import { createNinesPlaceBetCommand, createTrustedPlayerIdentity, hashCanonicalJson,
  canonicalizeJson, type NinesPlaceBetCommandV1 } from
  '../../../nines-back-end/src/financial/ninesPlaceBetContract.js'
import { createRaceLifecycleEvent, type NinesRaceLifecycleEventV1,
  type RaceEconomicPolicyV1 } from
  '../../../nines-back-end/src/financial/raceLifecycleContract.js'
import { raceResultEvidenceHash, type NinesRaceResultV1 } from
  '../../../nines-back-end/src/financial/raceResultContract.js'
import { PgRaceLifecycleOutboxRepository, RaceLifecycleDeliveryWorker } from
  '../../../nines-back-end/src/financial/raceLifecycleOutbox.js'
import { PgRaceResultOutboxRepository, RaceResultDeliveryWorker } from
  '../../../nines-back-end/src/financial/raceResultOutbox.js'
import { signServiceMessage } from
  '../../../nines-back-end/src/financial/serviceMessageAuthentication.js'

const execFileAsync = promisify(execFile)
const keyId = 'i1-backend-financial-v1'
const secret = 'i1-backend-financial-soak-secret-at-least-32-characters'
const credentials = { 'nines-back-end': { [keyId]: secret } }
const selections = Object.freeze(Array.from({ length: 5 }, (_, index) => Object.freeze({
  runnerId: `horse-${index + 1}`, selectionId: `horse-${index + 1}`,
  displayName: `Horse ${index + 1}`,
})))
const resultChecksum = createHash('sha256').update('nines-i1-authoritative-race').digest('hex')

export interface CoreLoopSoakOptions {
  seed: string
  races: number
  players: number
  backendDatabaseUrl: string
  databaseRestartContainer?: string
  databaseRestartAtRace?: number
  runSecurityRegression?: boolean
}

export interface CoreLoopEconomicRace {
  raceIndex: number
  raceId: string
  houseTakeBps: number
  acceptedStakeMinor: string
  appliedCarryoverMinor: string
  houseTakeMinor: string
  netPoolMinor: string
  carryoverMinor: string
  winningSelectionId: string
  acceptedBets: number
  noWinner: boolean
}

export interface CoreLoopSoakReport {
  seed: string
  races: number
  players: number
  wagerCommands: number
  wagerDeliveries: number
  wagersAccepted: number
  wagersRejected: number
  settlements: number
  noWinnerRaces: number
  concurrentWagerRaces: number
  closeVsBetRaces: number
  closeVsBetAccepted: number
  closeVsBetRejected: number
  concurrentResultRaces: number
  duplicateWagerDeliveries: number
  duplicateResultDeliveries: number
  retryRecoveries: number
  faultRecoveries: number
  rebuildChecks: number
  invariantChecks: number
  issuedMinor: string
  playerAvailableMinor: string
  playerLockedMinor: string
  houseMinor: string
  carryoverMinor: string
  settlementClearingMinor: string
  ledgerTransactions: number
  ledgerEntries: number
  economicDigest: string
  deterministicRacesDigest: string
  databaseRestarted: boolean
  durationMs: number
  slowestRaceMs: number
  slowestRaceIndex: number
  deadlocks: number
  lockTimeouts: number
  connectionErrors: number
  economics: CoreLoopEconomicRace[]
}

class MutableClock implements Clock {
  constructor(private value: Date) {}
  now(): Date { return new Date(this.value) }
  set(value: Date): void { this.value = new Date(value) }
}

class SelectableFaultInjector implements FaultInjector {
  point: FaultPoint | null = null
  trigger(point: FaultPoint): void {
    if (point === this.point) throw new Error(`i1-injected:${point}`)
  }
}

function deterministicUuid(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32).split('')
  hex[12] = '4'; hex[16] = 'a'
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`
}

function seededRandom(seed: string): () => number {
  let value = Number.parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 8), 16) >>> 0
  return () => {
    value += 0x6D2B79F5
    let next = value
    next = Math.imul(next ^ (next >>> 15), next | 1)
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61)
    return ((next ^ (next >>> 14)) >>> 0) / 4_294_967_296
  }
}

const refAlphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
function raceRef(index: number, seed: string): string {
  const hash = createHash('sha256').update(`${seed}:race-ref:${index}`).digest()
  let encoded = ''
  for (let offset = 0; offset < 10; offset += 1) encoded += refAlphabet[hash[offset]! % 32]
  return `N9-${encoded.slice(0, 5)}-${encoded.slice(5)}`
}

function asRaceId(index: number, seed: string): string {
  return `race-${deterministicUuid(`${seed}:race:${index}`)}`
}

function policy(houseTakeBps: number): RaceEconomicPolicyV1 {
  return Object.freeze({ policyId: 'nines-parimutuel.v1', policyVersion: 1,
    houseTakeBps, carryoverPolicyId: 'nines-carryover.v1', carryoverPolicyVersion: 1,
    settlementAllocationPolicyId: 'nines-proportional-allocation.v1',
    settlementAllocationPolicyVersion: 1,
    roundingPolicyId: 'nines-largest-remainder.v1', roundingPolicyVersion: 1 })
}

async function listen(app: RealPostgresTestApplicationHarness['app']): Promise<{
  server: Server; baseUrl: string
}> {
  const server = http.createServer(app)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('I1 HTTP listener has no TCP address')
  return { server, baseUrl: `http://127.0.0.1:${address.port}` }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

function issuance(seed: string, playerId: string, index: number, amountMinor: bigint,
  now: Date): NinesIssuanceAuthorizationV1 {
  if (amountMinor % 10_000n !== 0n) throw new Error('I1 issuance must map exactly to NZD cents')
  const authorizationId = deterministicUuid(`${seed}:authorization:${index}`)
  const intentId = deterministicUuid(`${seed}:intent:${index}`)
  const confirmationEventId = deterministicUuid(`${seed}:confirmation:${index}`)
  const completedValuationId = deterministicUuid(`${seed}:valuation:${index}`)
  const nzdMinor = amountMinor / 10_000n
  return { schemaVersion: 1, eventType: 'nines_issuance_authorized', authorizationId,
    issuer: 'nines-api', audience: 'nines-financial', environment: 'test', playerId,
    funding: { intentId, confirmationEventId,
      evidenceIdentity: `crypto-funding-confirmation:v1:${intentId}:${confirmationEventId}`,
      requestHash: createHash('sha256').update(`${seed}:request:${index}`).digest('hex'),
      confirmationPayloadHash: createHash('sha256').update(`${seed}:confirmation-payload:${index}`).digest('hex'),
      provider: 'i1-fake-verified', paymentReference: `i1-payment-${index}` },
    valuation: { workflowId: deterministicUuid(`${seed}:workflow:${index}`),
      completedValuationId, completionKey: `funding-nzd-valuation:v1:test:${intentId}`,
      evidenceFingerprint: createHash('sha256').update(`${seed}:valuation-evidence:${index}`).digest('hex'),
      valuedAt: new Date(now.getTime() - 120_000).toISOString(),
      profileVersion: 'funding-nzd-valuation-profile-v1',
      finalNzdAmount: `${nzdMinor / 100n}.${(nzdMinor % 100n).toString().padStart(2, '0')}`,
      finalNzdMinorUnits: nzdMinor.toString(),
      calculationPolicyVersion: 'nzd-valuation-calculation-v1',
      roundingPolicyVersion: 'nzd-valuation-rounding-v1' },
    issuance: { policyVersion: 'nzd-valuation-to-nines-par-v1', currency: 'NINES',
      scale: 6, minorUnits: amountMinor.toString() },
    authorizedAt: new Date(now.getTime() - 60_000).toISOString(),
    correlationId: `issuance_${authorizationId}`, causationId: completedValuationId }
}

function lifecyclePair(seed: string, index: number, opensAt: Date, closesAt: Date,
  houseTakeBps: number): readonly [NinesRaceLifecycleEventV1, NinesRaceLifecycleEventV1] {
  const raceId = asRaceId(index, seed), publicRef = raceRef(index, seed)
  const open = createRaceLifecycleEvent({ eventType: 'nines_race_opened.v1', environment: 'test',
    raceId, raceRef: publicRef, bettingOpensAt: opensAt.toISOString(),
    bettingClosesAt: closesAt.toISOString(), selections, economicPolicy: policy(houseTakeBps),
    correlationId: raceId, causationId: `race-seeded:${raceId}`,
    occurredAt: opensAt.toISOString() })
  const close = createRaceLifecycleEvent({ eventType: 'nines_race_betting_closed.v1',
    environment: 'test', raceId, raceRef: publicRef,
    bettingOpensAt: opensAt.toISOString(), bettingClosesAt: closesAt.toISOString(), selections,
    economicPolicy: policy(houseTakeBps), correlationId: raceId,
    causationId: open.lifecycleEventId, occurredAt: closesAt.toISOString() })
  return [open, close]
}

function wagerCommand(seed: string, raceIndex: number, ordinal: number, playerId: string,
  lifecycle: NinesRaceLifecycleEventV1, selectionId: string, stakeMinor: bigint,
  requestedAt: Date, overrides: { betId?: string; idempotencyKey?: string } = {}): NinesPlaceBetCommandV1 {
  const betId = overrides.betId ?? deterministicUuid(`${seed}:bet:${raceIndex}:${ordinal}`)
  const idempotencyKey = overrides.idempotencyKey ?? `i1-wager-${seed}-${raceIndex}-${ordinal}`
  const identity = createTrustedPlayerIdentity({ playerId,
    authenticatedAt: new Date(requestedAt.getTime() - 1_000).toISOString(),
    expiresAt: new Date(requestedAt.getTime() + 60_000).toISOString(),
    assertionId: deterministicUuid(`${seed}:assertion:${raceIndex}:${ordinal}`) })
  return createNinesPlaceBetCommand({ environment: 'test', betId, playerId,
    raceId: lifecycle.raceId, raceRef: lifecycle.raceRef, selectionId,
    stakeMinor: stakeMinor.toString(), idempotencyKey, requestedAt: requestedAt.toISOString(),
    correlationId: lifecycle.raceId, causationId: lifecycle.lifecycleEventId,
    playerIdentity: identity }) as NinesPlaceBetCommandV1
}

function isNoWinnerRace(index: number): boolean {
  const cycle = index % 20
  return cycle === 5 || cycle === 6 || cycle === 15
}

function selectedPolicy(index: number): number {
  return [0, 250, 1_000, 1_750, 2_500][index % 5]!
}

type RunningApplication = {
  harness: Omit<RealPostgresTestApplicationHarness, 'close'>
  server: Server
  baseUrl: string
}

type ResultAcknowledgement = {
  result: 'settled' | 'replayed'
  settlementRunId: string
  acceptedStakeMinor: string
  appliedCarryoverMinor: string
  houseTakeMinor: string
  netPoolMinor: string
  carryoverMinor: string
}

export class CoreLoopSoakHarness {
  private readonly clock = new MutableClock(new Date('2026-09-29T00:00:00.000Z'))
  private readonly faults = new SelectableFaultInjector()
  private readonly random: () => number
  private readonly backendRaceRepository = new PgRaceRepository()
  private financial!: RealPostgresTestApplicationHarness
  private primary!: RunningApplication
  private secondary!: RunningApplication
  private wagerClients: NinesFinancialWagerClient[] = []
  private lifecycleClient!: NinesFinancialRaceLifecycleClient
  private resultClient!: NinesFinancialRaceResultClient
  private resultClients: NinesFinancialRaceResultClient[] = []
  private playerIds: string[] = []
  private initialIssuanceDate!: Date
  private raceEpoch!: Date
  private issuedMinor = 0n
  private wagerCommands = 0
  private wagerDeliveries = 0
  private wagersAccepted = 0
  private wagersRejected = 0
  private duplicateWagerDeliveries = 0
  private duplicateResultDeliveries = 0
  private retryRecoveries = 0
  private faultRecoveries = 0
  private rebuildChecks = 0
  private invariantChecks = 0
  private concurrentWagerRaces = 0
  private closeVsBetRaces = 0
  private closeVsBetAccepted = 0
  private closeVsBetRejected = 0
  private concurrentResultRaces = 0
  private databaseRestarted = false
  private deadlocks = 0
  private lockTimeouts = 0
  private connectionErrors = 0
  private slowestRaceMs = 0
  private slowestRaceIndex = -1
  private securityRequestOrdinal = 0
  private readonly economics: CoreLoopEconomicRace[] = []

  constructor(private readonly options: CoreLoopSoakOptions) {
    if (options.races < 1 || options.players < 2) throw new Error('I1 requires races and players')
    this.random = seededRandom(options.seed)
  }

  async run(): Promise<CoreLoopSoakReport> {
    const startedAt = Date.now()
    await this.initialize()
    try {
      await this.issuePlayers()
      if (this.options.runSecurityRegression) await this.verifySecurityAndBoundaries()
      for (let raceIndex = 0; raceIndex < this.options.races; raceIndex += 1) {
        const raceStartedAt = Date.now()
        if (raceIndex === Math.floor(this.options.races / 2)) await this.restartFinancialService()
        await this.runRace(raceIndex)
        const duration = Date.now() - raceStartedAt
        if (duration > this.slowestRaceMs) {
          this.slowestRaceMs = duration
          this.slowestRaceIndex = raceIndex
        }
        if ((raceIndex + 1) % 25 === 0 || raceIndex + 1 === this.options.races) {
          await this.verifyAndRebuild(raceIndex)
        }
        if ((raceIndex + 1) % 100 === 0) {
          process.stdout.write(`${JSON.stringify({ event: 'i1-progress', seed: this.options.seed,
            racesCompleted: raceIndex + 1, targetRaces: this.options.races,
            wagerDeliveries: this.wagerDeliveries })}\n`)
        }
      }
      const totals = await this.fullRunTotals()
      const deterministicEconomics = this.economics.filter((item) => item.raceIndex % 9 !== 0)
      const playerBalances = await this.playerBalanceSnapshot()
      const economicDigest = createHash('sha256').update(canonicalizeJson({
        economics: deterministicEconomics, playerBalances,
        issuedMinor: this.issuedMinor.toString(),
        playerAvailableMinor: totals.playerAvailableMinor,
        playerLockedMinor: totals.playerLockedMinor,
        houseMinor: totals.houseMinor, carryoverMinor: totals.carryoverMinor,
        settlementClearingMinor: totals.settlementClearingMinor,
      } as unknown as JsonValue)).digest('hex')
      const deterministicRacesDigest = createHash('sha256').update(
        canonicalizeJson(deterministicEconomics as unknown as JsonValue)).digest('hex')
      return {
        seed: this.options.seed, races: this.options.races, players: this.options.players,
        wagerCommands: this.wagerCommands, wagerDeliveries: this.wagerDeliveries,
        wagersAccepted: this.wagersAccepted, wagersRejected: this.wagersRejected,
        settlements: this.economics.length,
        noWinnerRaces: this.economics.filter((item) => item.noWinner).length,
        concurrentWagerRaces: this.concurrentWagerRaces,
        closeVsBetRaces: this.closeVsBetRaces,
        closeVsBetAccepted: this.closeVsBetAccepted,
        closeVsBetRejected: this.closeVsBetRejected,
        concurrentResultRaces: this.concurrentResultRaces,
        duplicateWagerDeliveries: this.duplicateWagerDeliveries,
        duplicateResultDeliveries: this.duplicateResultDeliveries,
        retryRecoveries: this.retryRecoveries, faultRecoveries: this.faultRecoveries,
        rebuildChecks: this.rebuildChecks, invariantChecks: this.invariantChecks,
        issuedMinor: this.issuedMinor.toString(),
        playerAvailableMinor: totals.playerAvailableMinor,
        playerLockedMinor: totals.playerLockedMinor,
        houseMinor: totals.houseMinor, carryoverMinor: totals.carryoverMinor,
        settlementClearingMinor: totals.settlementClearingMinor,
        ledgerTransactions: totals.ledgerTransactions, ledgerEntries: totals.ledgerEntries,
        economicDigest, deterministicRacesDigest,
        databaseRestarted: this.databaseRestarted,
        durationMs: Date.now() - startedAt, slowestRaceMs: this.slowestRaceMs,
        slowestRaceIndex: this.slowestRaceIndex, deadlocks: this.deadlocks,
        lockTimeouts: this.lockTimeouts, connectionErrors: this.connectionErrors,
        economics: this.economics,
      }
    } finally {
      await this.close()
    }
  }

  private appOptions() {
    return { wagerIntakeEnabled: true, raceLifecycleEnabled: true, raceResultEnabled: true,
      backendServiceAuthCredentials: credentials, clock: this.clock, faultInjector: this.faults }
  }

  private async initialize(): Promise<void> {
    this.initialIssuanceDate = new Date()
    this.raceEpoch = new Date(this.initialIssuanceDate.getTime() + 60_000)
    this.clock.set(this.initialIssuanceDate)
    process.env.DATABASE_URL = this.options.backendDatabaseUrl
    process.env.NINES_RACE_DATA_PERSISTENCE_ENABLED = 'true'
    await verifyBackendPool()
    await getBackendPool().query(`truncate table race_result_outbox, race_lifecycle_outbox,
      race_artifacts, races restart identity cascade`)
    this.financial = await createRealPostgresTestApplication(this.appOptions())
    const primaryListener = await listen(this.financial.app)
    this.primary = { harness: this.financial, ...primaryListener }
    const secondHarness = createRealPostgresRestartedApplication(this.financial, this.appOptions())
    const secondaryListener = await listen(secondHarness.app)
    this.secondary = { harness: secondHarness, ...secondaryListener }
    this.configureClients()
  }

  private configureClients(): void {
    const common = { environment: 'test' as const, keyId, secret,
      clock: () => this.clock.now(), timeoutMs: 10_000, maxAttempts: 2 }
    this.wagerClients = [this.primary.baseUrl, this.secondary.baseUrl].map((baseUrl) =>
      new NinesFinancialWagerClient({ ...common, baseUrl }))
    this.lifecycleClient = new NinesFinancialRaceLifecycleClient({
      ...common, baseUrl: this.primary.baseUrl })
    this.resultClient = new NinesFinancialRaceResultClient({
      ...common, baseUrl: this.primary.baseUrl })
    this.resultClients = [this.primary.baseUrl, this.secondary.baseUrl].map((baseUrl) =>
      new NinesFinancialRaceResultClient({ ...common, baseUrl }))
  }

  private async issuePlayers(): Promise<void> {
    const now = this.clock.now()
    this.playerIds = Array.from({ length: this.options.players }, (_, index) =>
      deterministicUuid(`${this.options.seed}:player:${index}`))
    for (let index = 0; index < this.playerIds.length; index += 1) {
      const amount = index === 0 ? 90_000_000_000_000_000_000n :
        BigInt(100 + ((index * 37) % 900)) * 1_000_000n
      const authorization = issuance(this.options.seed, this.playerIds[index]!, index, amount, now)
      const context = { serviceId: 'nines-api',
        requestId: deterministicUuid(`${this.options.seed}:issuance-request:${index}:1`),
        sentAt: now, receivedAt: now }
      const first = await this.financial.container.services.ninesIssuanceAuthorizationService
        .consume(authorization, context)
      expect(first.result).toBe('accepted')
      if (index < 5) {
        const replay = await this.financial.container.services.ninesIssuanceAuthorizationService
          .consume(authorization, { ...context,
            requestId: deterministicUuid(`${this.options.seed}:issuance-request:${index}:2`) })
        expect(replay.result).toBe('already_consumed')
        expect(replay.ledgerTransactionId).toBe(first.ledgerTransactionId)
        this.retryRecoveries += 1
      }
      this.issuedMinor += amount
    }
    const issued = await this.financial.database.query<{ amount: string }>(`select
      coalesce(sum(issued_minor_units),0)::text amount
      from nines_issuance_authorization_consumptions`)
    expect(issued.rows[0]?.amount).toBe(this.issuedMinor.toString())
  }

  private lifecycleWorker(client: Pick<NinesFinancialRaceLifecycleClient, 'deliver'> =
    this.lifecycleClient): RaceLifecycleDeliveryWorker {
    return new RaceLifecycleDeliveryWorker(new PgRaceLifecycleOutboxRepository(), client, 1,
      () => this.clock.now())
  }

  private resultWorker(client: Pick<NinesFinancialRaceResultClient, 'deliver'> =
    this.resultClient): RaceResultDeliveryWorker {
    return new RaceResultDeliveryWorker(new PgRaceResultOutboxRepository(), client, 1,
      () => this.clock.now())
  }

  private async runRace(raceIndex: number): Promise<void> {
    const opensAt = new Date(this.raceEpoch.getTime() + raceIndex * 7_200_000)
    const closesAt = new Date(opensAt.getTime() + 3_600_000)
    const completedAt = new Date(closesAt.getTime() + 60_000)
    const houseTakeBps = selectedPolicy(raceIndex)
    const [open, close] = lifecyclePair(this.options.seed, raceIndex, opensAt, closesAt,
      houseTakeBps)
    this.clock.set(opensAt)
    await this.backendRaceRepository.upsertSeededRace({ raceId: open.raceId,
      raceRef: open.raceRef, seed: `${this.options.seed}:${raceIndex}`,
      scheduledStartTime: closesAt, checksum: resultChecksum,
      config: { stage: 'I1', raceIndex }, eventsCount: 0, lifecycleEvents: [open, close] })

    const restartProbe = Boolean(this.options.databaseRestartContainer &&
      raceIndex === this.options.databaseRestartAtRace)
    if (restartProbe) {
      const failedWorker = this.lifecycleWorker({ deliver: async () => {
        throw new Error('i1-deliberate-pre-database-restart-delivery-failure')
      } })
      expect(await failedWorker.runOnce()).toBe(true)
      await this.restartDatabase()
      this.clock.set(new Date(opensAt.getTime() + 1_000))
      expect(await this.lifecycleWorker().runOnce()).toBe(true)
      this.retryRecoveries += 1
    } else if (raceIndex === 3) {
      const failedWorker = this.lifecycleWorker({ deliver: async () => {
        throw new Error('i1-deliberate-lifecycle-worker-failure')
      } })
      expect(await failedWorker.runOnce()).toBe(true)
      this.clock.set(new Date(opensAt.getTime() + 1_000))
      expect(await this.lifecycleWorker().runOnce()).toBe(true)
      this.retryRecoveries += 1
    } else {
      expect(await this.lifecycleWorker().runOnce()).toBe(true)
    }

    if (raceIndex % 17 === 0) {
      const replay = await this.lifecycleClient.deliver(open)
      expect(replay.result).toBe('replayed')
      this.retryRecoveries += 1
    }
    const carryover = await this.financial.container.services.financialCommandService
      .applyCarryoversToRace({ targetRaceId: open.raceId, currency: 'NINES',
        idempotencyKey: `i1-carryover:${open.raceId}`, correlationId: open.raceId,
        causationId: open.lifecycleEventId })
    const carryoverReplay = await this.financial.container.services.financialCommandService
      .applyCarryoversToRace({ targetRaceId: open.raceId, currency: 'NINES',
        idempotencyKey: `i1-carryover:${open.raceId}`, correlationId: open.raceId,
        causationId: open.lifecycleEventId })
    expect(carryoverReplay).toEqual(carryover)

    await this.placeRaceWagers(raceIndex, open, closesAt)
    await this.backendRaceRepository.markRaceStarted(open.raceId,
      new Date(closesAt.getTime() - 5_000))

    this.clock.set(closesAt)
    if (raceIndex % 9 === 0) await this.closeAgainstWager(raceIndex, open)
    else expect(await this.lifecycleWorker().runOnce()).toBe(true)
    if (raceIndex % 23 === 0) {
      const replay = await this.lifecycleClient.deliver(close)
      expect(replay.result).toBe('replayed')
      this.retryRecoveries += 1
    }

    const winner = selections[0]!.selectionId
    const finishOrder = selections.map((selection) => selection.runnerId)
    this.clock.set(completedAt)
    await this.backendRaceRepository.markRaceFinished({ raceId: open.raceId,
      actualEndTime: completedAt, checksum: resultChecksum, winnerId: winner, finishOrder,
      finishTimesMs: Object.fromEntries(finishOrder.map((id, offset) => [id, 60_000 + offset])),
      config: { stage: 'I1', raceIndex }, hasTickStream: true,
      hasPrecomputedPaths: true, eventsCount: 300, persistenceStatus: 'saved',
      lifecycleStatus: 'finished' })

    const result = await this.readBackendResult(open.raceId)
    await this.deliverResult(raceIndex, result)
    const acknowledgement = await this.readAcknowledgement(result.resultId)
    await this.auditRace(raceIndex, result, acknowledgement, houseTakeBps)
  }

  private async availableMinor(playerId: string): Promise<bigint> {
    const result = await this.financial.database.query<{ balance_minor: string }>(`select
      coalesce(b.balance_minor,0)::text balance_minor from accounts a
      left join account_balances b using(account_id)
      where a.owner_type='user' and a.owner_id=$1 and a.account_type='user_available'
        and a.currency='NINES'`, [playerId])
    return BigInt(result.rows[0]?.balance_minor ?? '0')
  }

  private recordWager(result: Awaited<ReturnType<NinesFinancialWagerClient['placeBet']>>,
    command = true): void {
    if (command) this.wagerCommands += 1
    this.wagerDeliveries += 1
    if (result.result === 'accepted') this.wagersAccepted += 1
    else if (result.result === 'rejected') this.wagersRejected += 1
  }

  private async placeRaceWagers(raceIndex: number, open: NinesRaceLifecycleEventV1,
    closesAt: Date): Promise<void> {
    const noWinner = isNoWinnerRace(raceIndex)
    const requestedAt = new Date(closesAt.getTime() - 30_000)
    this.clock.set(requestedAt)
    for (let ordinal = 0; ordinal < 10; ordinal += 1) {
      const playerIndex = 1 + ((raceIndex * 11 + ordinal) % (this.playerIds.length - 1))
      const playerId = this.playerIds[playerIndex]!
      const available = await this.availableMinor(playerId)
      if (available <= 0n) continue
      let stake = BigInt(100_000 + Math.floor(this.random() * 900_000))
      if (raceIndex === 1 && ordinal === 0) stake = available
      if (stake > available) stake = available
      const selectionIndex = noWinner ? 1 + (ordinal % 4) : ordinal % 5
      const command = wagerCommand(this.options.seed, raceIndex, ordinal, playerId, open,
        selections[selectionIndex]!.selectionId, stake, requestedAt)
      if (raceIndex === 7 && ordinal === 0) {
        this.faults.point = 'place_bet.after_reservation_before_bet_persist'
        await expect(this.wagerClients[0]!.placeBet(command)).rejects
          .toBeInstanceOf(NinesFinancialWagerClientError)
        this.wagerDeliveries += 2
        this.faults.point = null
        const recovered = await this.wagerClients[1]!.placeBet(command)
        this.recordWager(recovered)
        this.faultRecoveries += 1
      } else if (raceIndex === 2 && ordinal === 0) {
        const normalFetch = fetch
        let lost = false
        const ambiguousFetch: typeof fetch = async (...args) => {
          const response = await normalFetch(...args)
          if (!lost && response.ok) { lost = true; throw new Error('i1-response-lost-after-commit') }
          return response
        }
        const client = new NinesFinancialWagerClient({ baseUrl: this.primary.baseUrl,
          environment: 'test', keyId, secret, clock: () => this.clock.now(), maxAttempts: 2,
          timeoutMs: 10_000, fetchImplementation: ambiguousFetch })
        const recovered = await client.placeBet(command)
        this.recordWager(recovered)
        this.wagerDeliveries += 1
        this.duplicateWagerDeliveries += 1
        this.retryRecoveries += 1
      } else {
        const first = await this.wagerClients[ordinal % 2]!.placeBet(command)
        this.recordWager(first)
        if (raceIndex % 7 === 0 && ordinal === 1) {
          const deliveries = await Promise.all([
            this.wagerClients[0]!.placeBet(command), this.wagerClients[1]!.placeBet(command)])
          expect(deliveries.every((item) => item.result === 'replayed')).toBe(true)
          this.wagerDeliveries += 2
          this.duplicateWagerDeliveries += 2
        }
        if (raceIndex % 13 === 0 && ordinal === 2) {
          const conflicting = wagerCommand(this.options.seed, raceIndex, ordinal + 10_000,
            playerId, open, selections[selectionIndex]!.selectionId, stake + 1n, requestedAt,
            { idempotencyKey: command.idempotencyKey })
          await expect(this.wagerClients[1]!.placeBet(conflicting)).rejects
            .toMatchObject({ status: 409 })
          this.wagerCommands += 1; this.wagerDeliveries += 1; this.wagersRejected += 1
        }
        if (raceIndex % 19 === 0 && ordinal === 3) {
          const conflicting = wagerCommand(this.options.seed, raceIndex, ordinal + 20_000,
            playerId, open, selections[selectionIndex]!.selectionId, stake, requestedAt,
            { betId: command.betId })
          await expect(this.wagerClients[1]!.placeBet(conflicting)).rejects
            .toMatchObject({ status: 409 })
          this.wagerCommands += 1; this.wagerDeliveries += 1; this.wagersRejected += 1
        }
      }
    }

    if (raceIndex === 0) {
      const command = wagerCommand(this.options.seed, raceIndex, 90_000, this.playerIds[0]!, open,
        noWinner ? selections[1]!.selectionId : selections[0]!.selectionId,
        80_000_000_000_000_000_000n, requestedAt)
      this.recordWager(await this.wagerClients[0]!.placeBet(command))
    }
    if (raceIndex % 10 === 0) await this.concurrentBalanceWagers(raceIndex, open, requestedAt)
  }

  private async concurrentBalanceWagers(raceIndex: number, open: NinesRaceLifecycleEventV1,
    requestedAt: Date): Promise<void> {
    const playerId = this.playerIds[1 + (raceIndex % (this.playerIds.length - 1))]!
    const available = await this.availableMinor(playerId)
    if (available < 2n) return
    const stake = available / 2n + 1n
    const commands = [0, 1].map((offset) => wagerCommand(this.options.seed, raceIndex,
      100_000 + offset, playerId, open, selections[0]!.selectionId, stake, requestedAt))
    const responses = await Promise.all(commands.map((command, index) =>
      this.wagerClients[index]!.placeBet(command)))
    expect(responses.filter((item) => item.result === 'accepted')).toHaveLength(1)
    expect(responses.filter((item) => item.result === 'rejected')).toHaveLength(1)
    this.wagerCommands += 2; this.wagerDeliveries += 2
    this.wagersAccepted += 1; this.wagersRejected += 1; this.concurrentWagerRaces += 1
  }

  private async closeAgainstWager(raceIndex: number,
    open: NinesRaceLifecycleEventV1): Promise<void> {
    const playerId = this.playerIds[this.playerIds.length - 1]!
    const command = wagerCommand(this.options.seed, raceIndex, 200_000, playerId, open,
      selections[0]!.selectionId, 1n, new Date(this.clock.now().getTime() - 1))
    const [wager] = await Promise.all([
      this.wagerClients[raceIndex % 2]!.placeBet(command), this.lifecycleWorker().runOnce()])
    expect(['accepted', 'rejected']).toContain(wager.result)
    this.recordWager(wager)
    this.closeVsBetRaces += 1
    if (wager.result === 'accepted') this.closeVsBetAccepted += 1
    else this.closeVsBetRejected += 1
  }

  private async readBackendResult(raceId: string): Promise<NinesRaceResultV1> {
    const result = await getBackendPool().query<{ payload: NinesRaceResultV1 }>(
      `select payload from race_result_outbox where race_id=$1`, [raceId])
    expect(result.rowCount).toBe(1)
    return result.rows[0]!.payload
  }

  private async deliverResult(raceIndex: number, result: NinesRaceResultV1): Promise<void> {
    const faultPoints: FaultPoint[] = ['race_result.after_accept_before_settlement',
      'settlement.after_ledger_posting_before_state_finalization',
      'race_result.after_settlement_before_result_completion',
      'race_result.after_completion_before_response']
    if (raceIndex >= 20 && raceIndex < 24) {
      this.faults.point = faultPoints[raceIndex - 20]!
      expect(await this.resultWorker().runOnce()).toBe(true)
      this.faults.point = null
      this.clock.set(new Date(this.clock.now().getTime() + 1_000))
      const retriedFromOutbox = await this.resultWorker().runOnce()
      if (!retriedFromOutbox) {
        const delivered = await getBackendPool().query<{ delivered: boolean }>(`select
          delivered_at is not null delivered from race_result_outbox where result_id=$1`,
        [result.resultId])
        expect(delivered.rows[0]?.delivered).toBe(true)
      }
      this.faultRecoveries += 1
      return
    }
    if (raceIndex === 6) {
      const failed = this.resultWorker({ deliver: async () => {
        throw new Error('i1-deliberate-result-worker-failure')
      } })
      expect(await failed.runOnce()).toBe(true)
      this.clock.set(new Date(this.clock.now().getTime() + 1_000))
      expect(await this.resultWorker().runOnce()).toBe(true)
      this.retryRecoveries += 1
      return
    }
    if (raceIndex % 10 === 0) {
      const attempts = await Promise.allSettled(Array.from({ length: 8 }, (_, index) =>
        this.resultClients[index % 2]!.deliver(result)))
      const failures = attempts.filter((item): item is PromiseRejectedResult =>
        item.status === 'rejected')
      if (failures.length > 0) throw new Error(`Concurrent result delivery failed: ${failures.map(
        ({ reason }) => reason instanceof NinesFinancialRaceResultClientError
          ? `${reason.status}:${reason.code}:${reason.retryable}` : String(reason)).join(',')}`)
      const deliveries = attempts.map((item) => (item as PromiseFulfilledResult<
        Awaited<ReturnType<NinesFinancialRaceResultClient['deliver']>>>).value)
      const settledResponses = deliveries.filter((item) => item.result === 'settled').length
      const replayedResponses = deliveries.filter((item) => item.result === 'replayed').length
      expect(settledResponses).toBeLessThanOrEqual(1)
      expect(settledResponses + replayedResponses).toBe(8)
      this.duplicateResultDeliveries += replayedResponses
      this.concurrentResultRaces += 1
      expect(await this.resultWorker().runOnce()).toBe(true)
      this.duplicateResultDeliveries += 1
      await this.assertResultConflicts(result)
      return
    }
    expect(await this.resultWorker().runOnce()).toBe(true)
    if (raceIndex % 11 === 0) {
      const replay = await this.resultClient.deliver(result)
      expect(replay.result).toBe('replayed')
      this.duplicateResultDeliveries += 1
    }
  }

  private async assertResultConflicts(result: NinesRaceResultV1): Promise<void> {
    const alternateWinner = selections[1]!.selectionId
    const changed = { ...result, winningRunnerId: alternateWinner,
      winningSelectionId: alternateWinner,
      finishOrder: [alternateWinner, selections[0]!.selectionId,
        ...selections.slice(2).map((item) => item.selectionId)] }
    const conflict = { ...changed,
      evidenceHash: raceResultEvidenceHash((({ evidenceHash: _ignored, ...rest }) => rest)(changed)) }
    await expect(this.resultClients[1]!.deliver(conflict)).rejects
      .toBeInstanceOf(NinesFinancialRaceResultClientError)
    const newIdentityBase = { ...conflict,
      resultId: deterministicUuid(`${this.options.seed}:conflicting-result:${result.raceId}`) }
    const newIdentity = { ...newIdentityBase,
      evidenceHash: raceResultEvidenceHash((({ evidenceHash: _ignored, ...rest }) => rest)(newIdentityBase)) }
    await expect(this.resultClients[1]!.deliver(newIdentity)).rejects.toMatchObject({ status: 409 })
  }

  private async readAcknowledgement(resultId: string): Promise<ResultAcknowledgement> {
    const result = await this.financial.database.query<{ acknowledgement: ResultAcknowledgement }>(
      `select acknowledgement from authoritative_race_results where result_id=$1`, [resultId])
    expect(result.rowCount).toBe(1)
    return result.rows[0]!.acknowledgement
  }

  private async auditRace(raceIndex: number, result: NinesRaceResultV1,
    acknowledgement: ResultAcknowledgement, houseTakeBps: number): Promise<void> {
    const integrity = await this.financial.database.query<{
      accepted_stake: string; economic_bets: string; result_count: string; run_count: string
      captures: string; house_posts: string; unsettled: string; missing_reservation: string
    }>(`select
      coalesce((select sum(stake_minor) from financial_bets
        where race_id=$1 and status<>'rejected'),0)::text accepted_stake,
      (select count(*) from financial_bets where race_id=$1 and status<>'rejected')::text economic_bets,
      (select count(*) from authoritative_race_results where race_id=$1
        and settlement_status='completed')::text result_count,
      (select count(*) from settlement_runs where race_id=$1 and status='completed')::text run_count,
      (select count(*) from ledger_transactions where transaction_type='bet_capture'
        and correlation_id=$1)::text captures,
      (select count(*) from ledger_transactions where transaction_type='settlement_house_take'
        and correlation_id=$1)::text house_posts,
      (select count(*) from financial_bets where race_id=$1
        and status not in ('settled_win','settled_loss','rejected'))::text unsettled,
      (select count(*) from financial_bets where race_id=$1
        and status<>'rejected' and reservation_transaction_id is null)::text missing_reservation`,
    [result.raceId])
    const row = integrity.rows[0]!
    expect(row.result_count).toBe('1'); expect(row.run_count).toBe('1')
    expect(row.captures).toBe(row.economic_bets); expect(row.unsettled).toBe('0')
    expect(row.missing_reservation).toBe('0')
    const accepted = BigInt(row.accepted_stake)
    const applied = BigInt(acknowledgement.appliedCarryoverMinor)
    const house = accepted * BigInt(houseTakeBps) / 10_000n
    const net = accepted + applied - house
    const noWinner = isNoWinnerRace(raceIndex)
    expect(acknowledgement.acceptedStakeMinor).toBe(accepted.toString())
    expect(acknowledgement.houseTakeMinor).toBe(house.toString())
    expect(acknowledgement.netPoolMinor).toBe(net.toString())
    expect(acknowledgement.carryoverMinor).toBe((noWinner ? net : 0n).toString())
    expect(row.house_posts).toBe(house > 0n ? '1' : '0')

    const backend = await getBackendPool().query<{
      status: string; lifecycle_delivered: string; result_delivered: string
    }>(`select r.lifecycle_status status,
      (select count(*) from race_lifecycle_outbox where race_id=r.race_id
        and delivered_at is not null)::text lifecycle_delivered,
      (select count(*) from race_result_outbox where race_id=r.race_id
        and delivered_at is not null)::text result_delivered
      from races r where r.race_id=$1`, [result.raceId])
    expect(backend.rows[0]).toEqual({ status: 'finished', lifecycle_delivered: '2',
      result_delivered: '1' })

    const ledger = await this.financial.database.query<{ unbalanced: string; nonpositive: string }>(
      `select
       (select count(*) from (select transaction_id from ledger_entries group by transaction_id
         having sum(case when direction='debit' then amount_minor else 0 end)<>
                sum(case when direction='credit' then amount_minor else 0 end)) broken)::text unbalanced,
       (select count(*) from ledger_entries where amount_minor<=0)::text nonpositive`)
    expect(ledger.rows[0]).toEqual({ unbalanced: '0', nonpositive: '0' })
    const balances = await this.financial.database.query<{ negative: string; locked: string }>(
      `select count(*) filter(where b.balance_minor<0)::text negative,
       coalesce(sum(b.balance_minor) filter(where a.account_type='user_locked'),0)::text locked
       from accounts a join account_balances b using(account_id)
       where a.currency='NINES'`)
    expect(balances.rows[0]).toEqual({ negative: '0', locked: '0' })
    const verification = await this.financial.container.services.balanceMaintenanceService
      .verifyBalances()
    expect(verification.mismatchCount).toBe(0)

    if (raceIndex % 31 === 0) {
      await expect(this.financial.database.query(`update race_pools set house_take_bps=$2
        where race_id=$1`, [result.raceId, houseTakeBps === 0 ? 1 : 0])).rejects.toThrow()
      await expect(this.financial.database.query(`update authoritative_race_results
        set winning_selection_id='horse-2' where result_id=$1`, [result.resultId]))
        .rejects.toThrow()
    }
    this.economics.push({ raceIndex, raceId: result.raceId, houseTakeBps,
      acceptedStakeMinor: accepted.toString(), appliedCarryoverMinor: applied.toString(),
      houseTakeMinor: house.toString(), netPoolMinor: net.toString(),
      carryoverMinor: (noWinner ? net : 0n).toString(),
      winningSelectionId: result.winningSelectionId,
      acceptedBets: Number(row.economic_bets), noWinner })
    this.invariantChecks += 1
  }

  private async verifyAndRebuild(raceIndex: number): Promise<void> {
    const before = await this.financial.container.services.balanceMaintenanceService.verifyBalances()
    expect(before.mismatchCount).toBe(0)
    const rebuilt = await this.financial.container.services.balanceMaintenanceService.rebuildBalances({
      correlationId: `i1-rebuild:${this.options.seed}:${raceIndex}`,
      causationId: `i1-race:${raceIndex}` })
    expect(rebuilt.mismatchCountBefore).toBe(0)
    const after = await this.financial.container.services.balanceMaintenanceService.verifyBalances()
    expect(after.mismatchCount).toBe(0)
    this.rebuildChecks += 1
  }

  private async playerBalanceSnapshot(): Promise<Record<string, { available: string; locked: string }>> {
    const result = await this.financial.database.query<{
      owner_id: string; account_type: string; balance_minor: string
    }>(`select a.owner_id,a.account_type,coalesce(b.balance_minor,0)::text balance_minor
       from accounts a left join account_balances b using(account_id)
       where a.owner_type='user' and a.owner_id=any($1::text[])
         and a.account_type in ('user_available','user_locked') order by a.owner_id,a.account_type`,
    [this.playerIds])
    return Object.fromEntries(this.playerIds.slice().sort().map((playerId) => [playerId, {
      available: result.rows.find((row) => row.owner_id === playerId &&
        row.account_type === 'user_available')?.balance_minor ?? '0',
      locked: result.rows.find((row) => row.owner_id === playerId &&
        row.account_type === 'user_locked')?.balance_minor ?? '0' }]))
  }

  private async fullRunTotals(): Promise<{
    playerAvailableMinor: string; playerLockedMinor: string; houseMinor: string
    carryoverMinor: string; settlementClearingMinor: string
    ledgerTransactions: number; ledgerEntries: number
  }> {
    const result = await this.financial.database.query<{
      player_available: string; player_locked: string; house: string; carryover: string
      clearing: string; transactions: string; entries: string
    }>(`select
      coalesce(sum(b.balance_minor) filter(where a.account_type='user_available'),0)::text player_available,
      coalesce(sum(b.balance_minor) filter(where a.account_type='user_locked'),0)::text player_locked,
      coalesce(sum(b.balance_minor) filter(where a.account_type='house_take_revenue'),0)::text house,
      coalesce(sum(b.balance_minor) filter(where a.account_type='race_selection_pool'),0)::text carryover,
      coalesce(sum(b.balance_minor) filter(where a.account_type='settlement_clearing'),0)::text clearing,
      (select count(*) from ledger_transactions)::text transactions,
      (select count(*) from ledger_entries)::text entries
      from accounts a join account_balances b using(account_id) where a.currency='NINES'`)
    const row = result.rows[0]!
    const conserved = BigInt(row.player_available) + BigInt(row.player_locked) +
      BigInt(row.house) + BigInt(row.carryover) + BigInt(row.clearing)
    expect(conserved).toBe(this.issuedMinor)
    expect(row.player_locked).toBe('0'); expect(row.clearing).toBe('0')
    const counts = await this.financial.database.query<{
      pools: string; results: string; runs: string; duplicates: string
    }>(`select (select count(*) from race_pools where lifecycle_managed)::text pools,
      (select count(*) from authoritative_race_results)::text results,
      (select count(*) from settlement_runs where status='completed')::text runs,
      (select count(*) from (select idempotency_key from ledger_transactions
        group by idempotency_key having count(*)>1) d)::text duplicates`)
    expect(counts.rows[0]).toEqual({ pools: this.options.races.toString(),
      results: this.options.races.toString(), runs: this.options.races.toString(),
      duplicates: '0' })
    return { playerAvailableMinor: row.player_available, playerLockedMinor: row.player_locked,
      houseMinor: row.house, carryoverMinor: row.carryover,
      settlementClearingMinor: row.clearing, ledgerTransactions: Number(row.transactions),
      ledgerEntries: Number(row.entries) }
  }

  private async signedPost(path: string, body: unknown, options: {
    environment?: 'test' | 'production'; requestId?: string; authenticated?: boolean
  } = {}): Promise<Response> {
    const canonicalBody = canonicalizeJson(body as JsonValue)
    const contentHash = hashCanonicalJson(body as JsonValue)
    const requestId = options.requestId ?? deterministicUuid(
      `${this.options.seed}:security-request:${path}:${this.securityRequestOrdinal++}`)
    const sentAt = this.clock.now().toISOString()
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (options.authenticated !== false) Object.assign(headers, {
      'x-nines-service-id': 'nines-back-end', 'x-nines-key-id': keyId,
      'x-nines-request-id': requestId, 'x-nines-sent-at': sentAt,
      'x-nines-content-sha256': contentHash,
      'x-nines-signature': signServiceMessage({ method: 'POST', path,
        environment: options.environment ?? 'test', serviceId: 'nines-back-end', keyId,
        requestId, sentAt, contentHash, secret }) })
    return fetch(new URL(path, this.primary.baseUrl), { method: 'POST', headers,
      body: canonicalBody })
  }

  private async verifySecurityAndBoundaries(): Promise<void> {
    for (const path of ['/internal/v1/wagers/place-bet',
      '/internal/v1/race-lifecycle-events', '/internal/v1/race-results']) {
      expect([401, 403]).toContain(
        (await this.signedPost(path, {}, { authenticated: false })).status)
    }
    const now = this.clock.now()
    const fakeLifecycle = lifecyclePair(this.options.seed, 999_999, now,
      new Date(now.getTime() + 60_000), 1_000)[0]
    const valid = wagerCommand(this.options.seed, 999_999, 0, this.playerIds[0]!,
      fakeLifecycle, selections[0]!.selectionId, 1n, now)
    const replayId = deterministicUuid(`${this.options.seed}:security-replay`)
    expect([200, 201]).toContain((await this.signedPost('/internal/v1/wagers/place-bet', valid,
      { requestId: replayId })).status)
    expect([403, 409]).toContain((await this.signedPost('/internal/v1/wagers/place-bet', valid,
      { requestId: replayId })).status)
    expect((await this.signedPost('/internal/v1/wagers/place-bet', valid,
      { environment: 'production' })).status).toBe(403)

    const forgedBase = { ...valid, playerIdentity: { ...valid.playerIdentity,
      subjectPlayerId: this.playerIds[1]! } }
    const { evidenceHash: _forgedEvidenceHash, ...forgedEvidence } = forgedBase
    const forged = { ...forgedBase,
      evidenceHash: hashCanonicalJson(forgedEvidence as unknown as JsonValue) }
    expect((await this.signedPost('/internal/v1/wagers/place-bet', forged)).status).toBe(400)
    const ledgerBefore = await this.financial.database.query<{ count: string }>(
      `select count(*)::text count from ledger_transactions`)
    for (const malformed of ['0', '-1', '1.5', 'NaN', '100000000000000000000']) {
      const malformedBase = { ...valid, betId: deterministicUuid(
        `${this.options.seed}:malformed:${malformed}`),
        idempotencyKey: `i1-malformed-${malformed}`,
        stake: { ...valid.stake, minorUnits: malformed } }
      const { evidenceHash: _malformedEvidenceHash, ...malformedEvidence } = malformedBase
      const malformedCommand = { ...malformedBase,
        evidenceHash: hashCanonicalJson(malformedEvidence as unknown as JsonValue) }
      const response = await this.signedPost('/internal/v1/wagers/place-bet', malformedCommand)
      expect([400, 422]).toContain(response.status)
    }
    const ledgerAfter = await this.financial.database.query<{ count: string }>(
      `select count(*)::text count from ledger_transactions`)
    expect(ledgerAfter.rows[0]?.count).toBe(ledgerBefore.rows[0]?.count)
  }

  private async restartFinancialService(): Promise<void> {
    await closeServer(this.primary.server)
    const restarted = createRealPostgresRestartedApplication(this.financial, this.appOptions())
    const listener = await listen(restarted.app)
    this.primary = { harness: restarted, ...listener }
    this.configureClients()
    const firstAuthorization = issuance(this.options.seed, this.playerIds[0]!, 0,
      90_000_000_000_000_000_000n, this.initialIssuanceDate)
    const replay = await restarted.container.services.ninesIssuanceAuthorizationService.consume(
      firstAuthorization, { serviceId: 'nines-api',
        requestId: deterministicUuid(`${this.options.seed}:issuance-after-restart`),
        sentAt: this.clock.now(), receivedAt: this.clock.now() })
    expect(replay.result).toBe('already_consumed')
    this.retryRecoveries += 1
  }

  private async restartDatabase(): Promise<void> {
    if (!this.options.databaseRestartContainer) return
    await closeServer(this.primary.server)
    await closeServer(this.secondary.server)
    await this.financial.close()
    await closeBackendPool()
    await execFileAsync('docker', ['restart', this.options.databaseRestartContainer])
    let ready = false
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        await execFileAsync('docker', ['exec', this.options.databaseRestartContainer,
          'pg_isready', '-U', 'nines_i1', '-d', 'nines_i1_admin'])
        ready = true
        break
      } catch {
        await new Promise<void>((resolve) => setTimeout(resolve, 500))
      }
    }
    if (!ready) throw new Error('Disposable PostgreSQL did not become ready after restart')
    let hostReady = false
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        await verifyBackendPool()
        hostReady = true
        break
      } catch {
        await closeBackendPool().catch(() => {})
        await new Promise<void>((resolve) => setTimeout(resolve, 500))
      }
    }
    if (!hostReady) throw new Error('Disposable PostgreSQL host port did not recover after restart')
    this.financial = reconnectRealPostgresTestApplication(this.appOptions())
    const primaryListener = await listen(this.financial.app)
    this.primary = { harness: this.financial, ...primaryListener }
    const secondHarness = createRealPostgresRestartedApplication(this.financial, this.appOptions())
    const secondaryListener = await listen(secondHarness.app)
    this.secondary = { harness: secondHarness, ...secondaryListener }
    this.configureClients()
    const evidence = await this.financial.database.query<{ results: string; races: string }>(
      `select (select count(*)::text from authoritative_race_results) results,
       (select count(*)::text from race_pools where status='settled') races`)
    expect(evidence.rows[0]?.results).toBe(evidence.rows[0]?.races)
    this.databaseRestarted = true
    this.retryRecoveries += 1
  }

  private async close(): Promise<void> {
    await closeServer(this.primary?.server).catch(() => {})
    await closeServer(this.secondary?.server).catch(() => {})
    await this.financial?.close().catch(() => {})
    await closeBackendPool().catch(() => {})
    delete process.env.DATABASE_URL
    delete process.env.NINES_RACE_DATA_PERSISTENCE_ENABLED
  }
}
