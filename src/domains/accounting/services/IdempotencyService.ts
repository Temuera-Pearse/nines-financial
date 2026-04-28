import { hashRequestPayload } from '../../../shared/idempotency/canonicalize.js'
import type {
  IdempotencyDecision,
  IdempotencyKey,
  IdempotencyRecord,
} from '../../../shared/idempotency/types.js'
import type { DatabaseTransaction } from '../../../shared/db/Database.js'
import type { Clock } from '../../../shared/time/Clock.js'
import { AppError } from '../../../shared/types/AppError.js'
import type { JsonObject } from '../../../shared/types/Json.js'
import type { IdempotencyRepository } from '../repositories/IdempotencyRepository.js'

export class IdempotencyService {
  constructor(
    private readonly repository: IdempotencyRepository,
    private readonly clock: Clock,
  ) {}

  async begin(
    commandType: string,
    idempotencyKey: IdempotencyKey,
    requestPayload: JsonObject,
    transaction: DatabaseTransaction,
  ): Promise<IdempotencyDecision> {
    const requestHash = hashRequestPayload(requestPayload)
    const existingRecord = await this.repository.getByKey(
      commandType,
      idempotencyKey,
      transaction,
    )

    if (!existingRecord) {
      const now = this.clock.now()
      const created = await this.repository.createIfAbsent(
        {
          idempotencyKey,
          commandType,
          requestHash,
          responseSnapshot: null,
          status: 'in_progress',
          createdAt: now,
          updatedAt: now,
        },
        transaction,
      )

      if (created) {
        return {
          kind: 'reserved',
          idempotencyKey,
        }
      }

      const racedRecord = await this.repository.getByKey(
        commandType,
        idempotencyKey,
        transaction,
      )

      if (!racedRecord) {
        throw new AppError({
          category: 'internal_error',
          code: 'IDEMPOTENCY_RECORD_RACE_MISSING',
          message:
            'Idempotency record could not be loaded after a concurrent reservation race',
          details: {
            commandType,
            idempotencyKey,
          },
        })
      }

      return this.resolveExistingRecord(
        commandType,
        idempotencyKey,
        requestHash,
        racedRecord,
      )
    }

    return this.resolveExistingRecord(
      commandType,
      idempotencyKey,
      requestHash,
      existingRecord,
    )
  }

  async complete(
    commandType: string,
    idempotencyKey: IdempotencyKey,
    requestPayload: JsonObject,
    responseSnapshot: JsonObject,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    const record = await this.requireRecord(
      commandType,
      idempotencyKey,
      transaction,
    )
    const requestHash = hashRequestPayload(requestPayload)

    if (record.requestHash !== requestHash) {
      throw new AppError({
        category: 'idempotency_conflict',
        code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
        message:
          'The provided idempotency key was already used with a different request payload',
        details: {
          commandType,
          idempotencyKey,
        },
      })
    }

    await this.repository.update(
      {
        ...record,
        responseSnapshot,
        status: 'completed',
        updatedAt: this.clock.now(),
      },
      transaction,
    )
  }

  private resolveExistingRecord(
    commandType: string,
    idempotencyKey: IdempotencyKey,
    requestHash: string,
    existingRecord: IdempotencyRecord,
  ): IdempotencyDecision {
    if (existingRecord.requestHash !== requestHash) {
      throw new AppError({
        category: 'idempotency_conflict',
        code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
        message:
          'The provided idempotency key was already used with a different request payload',
        details: {
          commandType,
          idempotencyKey,
        },
      })
    }

    if (
      existingRecord.status === 'completed' &&
      existingRecord.responseSnapshot
    ) {
      return {
        kind: 'replay',
        record: existingRecord,
      }
    }

    if (existingRecord.status === 'in_progress') {
      throw new AppError({
        category: 'conflict',
        code: 'IDEMPOTENCY_IN_PROGRESS',
        message: 'An in-flight command already exists for this idempotency key',
        details: {
          commandType,
          idempotencyKey,
        },
        retryable: true,
      })
    }

    throw new AppError({
      category: 'conflict',
      code: 'IDEMPOTENCY_FAILED_RECORD',
      message:
        'A previous failed attempt exists for this idempotency key and requires investigation',
      details: {
        commandType,
        idempotencyKey,
      },
    })
  }

  private async requireRecord(
    commandType: string,
    idempotencyKey: IdempotencyKey,
    transaction: DatabaseTransaction,
  ): Promise<IdempotencyRecord> {
    const record = await this.repository.getByKey(
      commandType,
      idempotencyKey,
      transaction,
    )

    if (!record) {
      throw new AppError({
        category: 'internal_error',
        code: 'IDEMPOTENCY_RECORD_MISSING',
        message: 'Expected idempotency record to exist before completion',
        details: {
          commandType,
          idempotencyKey,
        },
      })
    }

    return record
  }
}
