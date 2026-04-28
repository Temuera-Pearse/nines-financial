import { describe, expect, it } from 'vitest'

import type { DatabaseTransaction } from '../../src/shared/db/Database.js'
import {
  toIdempotencyKey,
  type IdempotencyKey,
  type IdempotencyRecord,
} from '../../src/shared/idempotency/types.js'
import { FixedClock } from '../../src/shared/time/Clock.js'
import { AppError } from '../../src/shared/types/AppError.js'
import type { IdempotencyRepository } from '../../src/domains/accounting/repositories/IdempotencyRepository.js'
import { IdempotencyService } from '../../src/domains/accounting/services/IdempotencyService.js'

class InMemoryIdempotencyRepository implements IdempotencyRepository {
  private readonly records = new Map<string, IdempotencyRecord>()

  async getByKey(
    commandType: string,
    idempotencyKey: IdempotencyKey,
  ): Promise<IdempotencyRecord | null> {
    return this.records.get(`${commandType}:${idempotencyKey}`) ?? null
  }

  async createIfAbsent(record: IdempotencyRecord): Promise<boolean> {
    const compositeKey = `${record.commandType}:${record.idempotencyKey}`

    if (this.records.has(compositeKey)) {
      return false
    }

    this.records.set(`${record.commandType}:${record.idempotencyKey}`, record)
    return true
  }

  async update(record: IdempotencyRecord): Promise<void> {
    this.records.set(`${record.commandType}:${record.idempotencyKey}`, record)
  }
}

class RaceyIdempotencyRepository implements IdempotencyRepository {
  private readonly records = new Map<string, IdempotencyRecord>()

  private createAttempts = 0

  async getByKey(
    commandType: string,
    idempotencyKey: IdempotencyKey,
  ): Promise<IdempotencyRecord | null> {
    return this.records.get(`${commandType}:${idempotencyKey}`) ?? null
  }

  async createIfAbsent(record: IdempotencyRecord): Promise<boolean> {
    this.createAttempts += 1

    if (this.createAttempts === 1) {
      this.records.set(`${record.commandType}:${record.idempotencyKey}`, record)
      return false
    }

    if (this.records.has(`${record.commandType}:${record.idempotencyKey}`)) {
      return false
    }

    this.records.set(`${record.commandType}:${record.idempotencyKey}`, record)
    return true
  }

  async update(record: IdempotencyRecord): Promise<void> {
    this.records.set(`${record.commandType}:${record.idempotencyKey}`, record)
  }
}

const noopTransaction = {
  query: async () => ({ rows: [], rowCount: 0 }),
} as DatabaseTransaction

describe('IdempotencyService', () => {
  it('replays the original response for the same key and payload', async () => {
    const service = new IdempotencyService(
      new InMemoryIdempotencyRepository(),
      new FixedClock(new Date('2026-04-22T12:00:00.000Z')),
    )

    const key = toIdempotencyKey('idem-1')
    const firstDecision = await service.begin(
      'post_transaction',
      key,
      { requestId: 'one' },
      noopTransaction,
    )

    expect(firstDecision.kind).toBe('reserved')

    await service.complete(
      'post_transaction',
      key,
      { requestId: 'one' },
      { transactionId: 'txn_1' },
      noopTransaction,
    )

    const replayDecision = await service.begin(
      'post_transaction',
      key,
      { requestId: 'one' },
      noopTransaction,
    )

    expect(replayDecision.kind).toBe('replay')
    if (replayDecision.kind === 'replay') {
      expect(replayDecision.record.responseSnapshot).toEqual({
        transactionId: 'txn_1',
      })
      expect(replayDecision.record.status).toBe('completed')
    }
  })

  it('rejects the same key with a different payload', async () => {
    const service = new IdempotencyService(
      new InMemoryIdempotencyRepository(),
      new FixedClock(new Date('2026-04-22T12:00:00.000Z')),
    )

    const key = toIdempotencyKey('idem-2')
    await service.begin(
      'post_transaction',
      key,
      { requestId: 'one' },
      noopTransaction,
    )

    await expect(
      service.begin(
        'post_transaction',
        key,
        { requestId: 'two' },
        noopTransaction,
      ),
    ).rejects.toMatchObject({
      category: 'idempotency_conflict',
      code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
    } satisfies Partial<AppError>)
  })

  it('treats a concurrent reservation race as an in-progress conflict instead of a duplicate-insert failure', async () => {
    const service = new IdempotencyService(
      new RaceyIdempotencyRepository(),
      new FixedClock(new Date('2026-04-22T12:00:00.000Z')),
    )

    await expect(
      service.begin(
        'post_transaction',
        toIdempotencyKey('idem-race'),
        { requestId: 'one' },
        noopTransaction,
      ),
    ).rejects.toMatchObject({
      category: 'conflict',
      code: 'IDEMPOTENCY_IN_PROGRESS',
      retryable: true,
    } satisfies Partial<AppError>)
  })
})
