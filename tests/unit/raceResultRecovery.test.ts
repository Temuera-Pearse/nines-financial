import { describe,expect,it } from 'vitest'

import { loadEnv } from '../../src/config/env.js'
import { classifyRaceResultRecoveryFailure } from '../../src/domains/race-results/services/RaceResultRecoveryWorker.js'
import { AppError } from '../../src/shared/types/AppError.js'

describe('authoritative result recovery failure classification',()=>{
  it('keeps explicitly retryable and infrastructure failures transient',()=>{
    expect(classifyRaceResultRecoveryFailure(new AppError({category:'conflict',
      code:'POOL_NOT_READY',message:'pool projection is not ready',retryable:true})))
      .toMatchObject({kind:'transient',code:'POOL_NOT_READY'})
    expect(classifyRaceResultRecoveryFailure(Object.assign(new Error('deadlock'),{code:'40P01'})))
      .toMatchObject({kind:'transient',code:'POSTGRES_40P01'})
    expect(classifyRaceResultRecoveryFailure(new Error('connection reset')))
      .toMatchObject({kind:'transient',code:'UNEXPECTED_ERROR'})
  })

  it('escalates immutable authority and database evidence conflicts',()=>{
    expect(classifyRaceResultRecoveryFailure(new AppError({category:'conflict',
      code:'RACE_RESULT_LIFECYCLE_CONFLICT',message:'immutable close differs'})))
      .toMatchObject({kind:'immutable',code:'RACE_RESULT_LIFECYCLE_CONFLICT'})
    expect(classifyRaceResultRecoveryFailure(Object.assign(new Error('check violation'),{code:'23514'})))
      .toMatchObject({kind:'immutable',code:'POSTGRES_23514'})
  })
})

describe('authoritative result recovery configuration',()=>{
  it('defaults autonomous recovery to bounded operational settings',()=>{
    const env=loadEnv({NODE_ENV:'test'})
    expect(env).toMatchObject({NINES_RACE_RESULT_RECOVERY_ENABLED:true,
      NINES_RACE_RESULT_RECOVERY_POLL_INTERVAL_MS:1000,
      NINES_RACE_RESULT_RECOVERY_LEASE_MS:30_000,
      NINES_RACE_RESULT_RECOVERY_MAX_ATTEMPTS:12,
      NINES_RACE_RESULT_RECOVERY_BATCH_SIZE:25})
  })

  it('rejects unbounded or non-positive recovery settings',()=>{
    expect(()=>loadEnv({NODE_ENV:'test',NINES_RACE_RESULT_RECOVERY_MAX_ATTEMPTS:'101'})).toThrow()
    expect(()=>loadEnv({NODE_ENV:'test',NINES_RACE_RESULT_RECOVERY_LEASE_MS:'0'})).toThrow()
  })
})
