import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { ninesRaceLifecycleEventV1Schema, raceLifecycleEvidenceHash,
  raceLifecyclePolicyHash, raceLifecycleSelectionSetHash,
  type NinesRaceLifecycleEventV1 } from '../../src/domains/race-lifecycle/dto/RaceLifecycleEvent.js'

interface LifecycleFixture { validOpen:NinesRaceLifecycleEventV1; validClose:NinesRaceLifecycleEventV1;
  replay:NinesRaceLifecycleEventV1; conflict:NinesRaceLifecycleEventV1 }
const fixture = JSON.parse(fs.readFileSync(path.resolve(process.cwd(),
  'contracts/nines-race-lifecycle-v1.fixtures.json'), 'utf8')) as LifecycleFixture

describe('race lifecycle contract', () => {
  it('independently validates canonical fixtures and hashes', () => {
    for (const name of ['validOpen', 'validClose', 'replay', 'conflict'] as const) {
      const event = ninesRaceLifecycleEventV1Schema.parse(fixture[name])
      const { evidenceHash: _hash, ...evidence } = event
      expect(raceLifecycleEvidenceHash(evidence)).toBe(event.evidenceHash)
    }
    expect(fixture.replay).toEqual(fixture.validOpen)
    expect(fixture.conflict.lifecycleEventId).toBe(fixture.validOpen.lifecycleEventId)
    expect(fixture.conflict.evidenceHash).not.toBe(fixture.validOpen.evidenceHash)
  })

  it('freezes runner identity and versioned economic policy evidence', () => {
    const open = ninesRaceLifecycleEventV1Schema.parse(fixture.validOpen)
    expect(open.selections.every((entry) => entry.runnerId === entry.selectionId)).toBe(true)
    expect(raceLifecycleSelectionSetHash(open.selections)).toMatch(/^[0-9a-f]{64}$/)
    expect(raceLifecyclePolicyHash(open.economicPolicy)).toMatch(/^[0-9a-f]{64}$/)
    expect(open.economicPolicy).toMatchObject({ policyId: 'nines-parimutuel.v1',
      houseTakeBps: 1000, roundingPolicyId: 'nines-largest-remainder.v1' })
    expect(ninesRaceLifecycleEventV1Schema.safeParse({ ...open,
      selections: [...open.selections].reverse() }).success).toBe(false)
    expect(ninesRaceLifecycleEventV1Schema.safeParse({ ...open,
      selections: open.selections.map((entry, index) => index === 0
        ? { ...entry, selectionId: 'invented-selection' } : entry) }).success).toBe(false)
  })
})
