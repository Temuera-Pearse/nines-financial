import { Router, type Request } from 'express'
import type { GetPlayerBalanceHandler } from '../../domains/account/handlers/GetPlayerBalanceHandler.js'
import type { Database } from '../../shared/db/Database.js'
import { hashCanonicalJson } from '../../shared/contracts/canonicalJson.js'
import { isValidServiceRequestId, verifyServiceMessage } from '../../shared/security/ServiceMessageAuthentication.js'
import { AppError } from '../../shared/types/AppError.js'
import type { JsonValue } from '../../shared/types/Json.js'
import type { QueryResultRow } from 'pg'

export const PLAYER_GAMEPLAY_STATE_PATH = '/internal/v1/player-gameplay-state'
const SCHEMA_VERSION = 'nines-player-gameplay-query.v1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RACE_REF = /^N9-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/

interface GameplayBetRow extends QueryResultRow {
  bet_id: string
  race_ref: string
  selection_id: string
  stake_minor: string | number
  status: string
  rejection_code: string | null
  accepted_at: Date | string | null
  updated_at: Date | string
  pool_status: string
  winning_selection_id: string | null
  settlement_status: string | null
  settled_at: Date | string | null
  payout_minor: string | number | null
}

function requiredHeader(request: Request, name: string): string {
  const value = request.header(name)?.trim()
  if (!value) throw new AppError({ category: 'forbidden', code: 'SERVICE_AUTH_MISSING',
    message: `Missing required service authentication header ${name}` })
  return value
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

export function createPlayerGameplayRouter(options: {
  database: Database
  getPlayerBalanceHandler: GetPlayerBalanceHandler
  environment: 'development' | 'test' | 'production'
  credentials: Readonly<Record<string, Readonly<Record<string, string>>>>
  replayWindowSeconds?: number
  clock?: () => Date
}): Router {
  const router = Router()
  const clock = options.clock ?? (() => new Date())
  const replayWindowMs = (options.replayWindowSeconds ?? 300) * 1000

  router.post(PLAYER_GAMEPLAY_STATE_PATH, async (request, response, next) => {
    try {
      const serviceId = requiredHeader(request, 'x-nines-service-id')
      const keyId = requiredHeader(request, 'x-nines-key-id')
      const requestId = requiredHeader(request, 'x-nines-request-id')
      const sentAt = requiredHeader(request, 'x-nines-sent-at')
      const contentHash = requiredHeader(request, 'x-nines-content-sha256')
      const signature = requiredHeader(request, 'x-nines-signature')
      const secret = options.credentials[serviceId]?.[keyId]
      const receivedAt = clock()
      const sentAtMs = Date.parse(sentAt)
      if (serviceId !== 'nines-api' || !secret || secret.length < 32 ||
          !isValidServiceRequestId(requestId) || !Number.isFinite(sentAtMs) ||
          Math.abs(receivedAt.getTime() - sentAtMs) > replayWindowMs ||
          hashCanonicalJson(request.body as JsonValue) !== contentHash ||
          !verifyServiceMessage({ method: request.method, path: PLAYER_GAMEPLAY_STATE_PATH,
            environment: options.environment, serviceId, keyId, requestId, sentAt,
            contentHash, signature, secret })) {
        throw new AppError({ category: 'forbidden', code: 'SERVICE_AUTH_FAILED',
          message: 'Service authentication failed' })
      }
      const body = request.body as { schemaVersion?: unknown; playerId?: unknown; raceRef?: unknown }
      if (body.schemaVersion !== SCHEMA_VERSION || typeof body.playerId !== 'string' ||
          !UUID.test(body.playerId) || (body.raceRef !== null &&
          (typeof body.raceRef !== 'string' || !RACE_REF.test(body.raceRef)))) {
        throw new AppError({ category: 'validation_error', code: 'INVALID_GAMEPLAY_QUERY',
          message: 'Player gameplay query is invalid' })
      }
      try {
        await options.database.query(`INSERT INTO service_request_nonces
          (service_id,request_id,sent_at,received_at) VALUES ($1,$2,$3,$4)`,
        [serviceId, requestId, new Date(sentAtMs), receivedAt])
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
          throw new AppError({ category: 'conflict', code: 'SERVICE_REQUEST_REPLAY',
            message: 'This authenticated request was already received' })
        }
        throw error
      }

      const balancePayload = await options.getPlayerBalanceHandler.handle({
        userId: body.playerId,
        currency: 'NINES',
      })
      const bets = await options.database.query<GameplayBetRow>(`
        SELECT b.bet_id,b.selection_id,b.stake_minor,b.status,b.rejection_code,
          b.accepted_at,b.updated_at,p.race_ref,p.status AS pool_status,
          result.winning_selection_id,result.settlement_status,result.settled_at,
          settled_bet.value->>'payoutMinor' AS payout_minor
        FROM financial_bets b
        JOIN race_pools p ON p.race_id=b.race_id AND p.currency=b.currency
        LEFT JOIN authoritative_race_results result
          ON result.race_id=b.race_id AND result.currency=b.currency
        LEFT JOIN settlement_runs run ON run.settlement_run_id=result.settlement_run_id
        LEFT JOIN LATERAL jsonb_array_elements(
          COALESCE(run.result_snapshot->'settledBets','[]'::jsonb)
        ) settled_bet(value) ON settled_bet.value->>'betId'=b.bet_id
        WHERE b.user_id=$1 AND b.currency='NINES'
          AND ($2::text IS NULL OR p.race_ref=$2)
        ORDER BY b.created_at DESC LIMIT 50`, [body.playerId, body.raceRef])

      response.status(200).json({
        schemaVersion: 'nines-player-gameplay-state.v1',
        balance: {
          currency: 'NINES',
          scale: 6,
          availableMinor: balancePayload.balance.spendableBalanceMinor,
          lockedMinor: balancePayload.balance.reservedBalanceMinor,
          displayMinor: balancePayload.balance.displayBalanceMinor,
          effectiveStatus: balancePayload.balance.effectiveStatus,
          asOf: balancePayload.balance.asOf,
        },
        wagers: bets.rows.map((row) => ({
          betId: row.bet_id,
          raceRef: row.race_ref,
          selectionId: row.selection_id,
          stakeMinor: row.stake_minor.toString(),
          status: row.status,
          rejectionCode: row.rejection_code,
          acceptedAt: iso(row.accepted_at),
          updatedAt: iso(row.updated_at),
          poolStatus: row.pool_status,
          winningSelectionId: row.winning_selection_id,
          settlementStatus: row.settlement_status,
          settledAt: iso(row.settled_at),
          payoutMinor: row.payout_minor?.toString() ?? null,
        })),
      })
    } catch (error) {
      next(error)
    }
  })
  return router
}
