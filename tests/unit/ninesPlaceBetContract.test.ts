import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  ninesPlaceBetCommandV1Schema,
  ninesPlaceBetEvidenceHash,
  ninesPlaceBetResultV1Schema,
} from '../../src/domains/betting/dto/NinesPlaceBetCommand.js'
import { hashCanonicalJson } from '../../src/shared/contracts/canonicalJson.js'
import type { JsonObject } from '../../src/shared/types/Json.js'

const fixture = JSON.parse(fs.readFileSync(path.resolve(
  process.cwd(), 'contracts/nines-place-bet-v1.fixtures.json'), 'utf8')) as Record<string, any>

describe('NinesPlaceBetCommandV1 fixture', () => {
  it('reproduces canonical command and response hashes', () => {
    const command = ninesPlaceBetCommandV1Schema.parse(fixture.command)
    const { evidenceHash: _evidenceHash, ...evidence } = command
    expect(ninesPlaceBetEvidenceHash(evidence)).toBe(fixture.hashes.commandEvidenceHash)
    expect(hashCanonicalJson(command as unknown as JsonObject)).toBe(fixture.hashes.commandTransportHash)
    for (const key of ['acceptedResponse', 'replayResponse', 'rejectionResponse'] as const) {
      const result = ninesPlaceBetResultV1Schema.parse(fixture[key])
      const hashKey = key === 'acceptedResponse' ? 'acceptedResponseHash' :
        key === 'replayResponse' ? 'replayResponseHash' : 'rejectionResponseHash'
      expect(hashCanonicalJson(result as unknown as JsonObject)).toBe(fixture.hashes[hashKey])
    }
  })

  it('rejects forged player binding and non-NINES stake evidence', () => {
    expect(ninesPlaceBetCommandV1Schema.safeParse({ ...fixture.command,
      playerIdentity: { ...fixture.command.playerIdentity,
        subjectPlayerId: '55555555-5555-4555-8555-555555555555' } }).success).toBe(false)
    expect(ninesPlaceBetCommandV1Schema.safeParse({ ...fixture.command,
      stake: { currency: 'USDC', scale: 6, minorUnits: '20000000' } }).success).toBe(false)
    expect(ninesPlaceBetCommandV1Schema.safeParse({ ...fixture.command,
      playerIdentity: { ...fixture.command.playerIdentity,
        expiresAt: '2026-04-22T12:10:00.000Z' } }).success).toBe(false)
  })
})
