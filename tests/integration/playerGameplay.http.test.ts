import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { createPlayerGameplayRouter, PLAYER_GAMEPLAY_STATE_PATH } from '../../src/handlers/http/playerGameplayRoutes.js'
import { errorHandler } from '../../src/handlers/http/errorHandler.js'
import { hashCanonicalJson } from '../../src/shared/contracts/canonicalJson.js'
import { signServiceMessage } from '../../src/shared/security/ServiceMessageAuthentication.js'

const secret = 'api-financial-test-secret-at-least-32-characters'
const now = new Date('2026-10-01T00:00:20.000Z')

describe('player gameplay state boundary', () => {
  it('returns authoritative available/locked balance and settled wager outcome', async () => {
    const database = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ bet_id: 'bet-1', race_ref: 'N9-ABCDE-FGHJK',
        selection_id: 'horse-1', stake_minor: '1250000', status: 'settled_win',
        rejection_code: null, accepted_at: now, updated_at: now, pool_status: 'settled',
        winning_selection_id: 'horse-1', settlement_status: 'completed', settled_at: now,
        payout_minor: '2300000' }], rowCount: 1 }) }
    const getPlayerBalanceHandler = { handle: vi.fn(async () => ({ balance: {
      playerAccountId: 'account-1', currency: 'NINES', effectiveStatus: 'active',
      spendableBalanceMinor: '11050000', reservedBalanceMinor: '0',
      restrictedBalanceMinor: '0', displayBalanceMinor: '11050000', asOf: now.toISOString(),
    } })) }
    const app = express().use(express.json()).use(createPlayerGameplayRouter({
      database: database as never, getPlayerBalanceHandler: getPlayerBalanceHandler as never,
      environment: 'test', credentials: { 'nines-api': { 'api-financial-v1': secret } },
      clock: () => now,
    })).use(errorHandler)
    const body = { schemaVersion: 'nines-player-gameplay-query.v1',
      playerId: '6e91af93-fdef-42ec-bc45-b252e7352879', raceRef: 'N9-ABCDE-FGHJK' }
    const requestId = '6ef4fbb9-d34a-4570-bd26-f71bf06f6b9d'
    const contentHash = hashCanonicalJson(body)
    const signature = signServiceMessage({ method: 'POST', path: PLAYER_GAMEPLAY_STATE_PATH,
      environment: 'test', serviceId: 'nines-api', keyId: 'api-financial-v1', requestId,
      sentAt: now.toISOString(), contentHash, secret })
    const response = await request(app).post(PLAYER_GAMEPLAY_STATE_PATH)
      .set({ 'x-nines-service-id': 'nines-api', 'x-nines-key-id': 'api-financial-v1',
        'x-nines-request-id': requestId, 'x-nines-sent-at': now.toISOString(),
        'x-nines-content-sha256': contentHash, 'x-nines-signature': signature })
      .send(body)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ schemaVersion: 'nines-player-gameplay-state.v1',
      balance: { availableMinor: '11050000', lockedMinor: '0', currency: 'NINES', scale: 6 },
      wagers: [{ betId: 'bet-1', raceRef: body.raceRef, status: 'settled_win',
        payoutMinor: '2300000', winningSelectionId: 'horse-1' }] })
    expect(getPlayerBalanceHandler.handle).toHaveBeenCalledWith({
      userId: body.playerId, currency: 'NINES',
    })
  })
})
