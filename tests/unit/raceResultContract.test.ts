import fs from 'node:fs'
import path from 'node:path'
import { describe,expect,it } from 'vitest'

import { ninesRaceResultV1Schema,raceResultEvidenceHash,
  type NinesRaceResultV1 } from '../../src/domains/race-results/dto/NinesRaceResult.js'

const fixture=JSON.parse(fs.readFileSync(path.resolve(process.cwd(),
  'contracts/nines-race-result-v1.fixtures.json'),'utf8')) as Record<string,NinesRaceResultV1>

describe('NinesRaceResultV1 contract',()=>{
  it('validates canonical result/replay fixtures and reproduces their hashes',()=>{
    for(const name of ['validResult','replay','conflict']){
      const result=ninesRaceResultV1Schema.parse(fixture[name])
      const {evidenceHash:_hash,...evidence}=result
      expect(raceResultEvidenceHash(evidence)).toBe(result.evidenceHash)
    }
    expect(fixture.replay).toEqual(fixture.validResult)
    expect(fixture.conflict!.resultId).toBe(fixture.validResult!.resultId)
    expect(fixture.conflict!.evidenceHash).not.toBe(fixture.validResult!.evidenceHash)
  })

  it('rejects malformed authority, winner mapping, order, version, and checksum',()=>{
    const valid=fixture.validResult!
    for(const mutation of [
      {...valid,issuer:'other'},
      {...valid,audience:'other'},
      {...valid,resultVersion:0},
      {...valid,winningSelectionId:'horse-2'},
      {...valid,finishOrder:['horse-2','horse-1','horse-3']},
      {...valid,finishOrder:['horse-1','horse-1','horse-3']},
      {...valid,raceChecksum:'bad'},
      {...valid,causationId:'other'},
    ]) expect(ninesRaceResultV1Schema.safeParse(mutation).success).toBe(false)
  })
})
