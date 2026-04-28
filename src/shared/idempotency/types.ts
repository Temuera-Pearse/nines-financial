import type { JsonObject } from '../types/Json.js'
import { brandString, type Brand } from '../ids/brand.js'

export type IdempotencyKey = Brand<string, 'IdempotencyKey'>

export type IdempotencyStatus = 'in_progress' | 'completed' | 'failed'

export interface IdempotencyRecord<TResponse extends JsonObject = JsonObject> {
  idempotencyKey: IdempotencyKey
  commandType: string
  requestHash: string
  responseSnapshot: TResponse | null
  status: IdempotencyStatus
  createdAt: Date
  updatedAt: Date
  expiresAt?: Date
}

export interface IdempotencyReplay<TResponse extends JsonObject = JsonObject> {
  kind: 'replay'
  record: IdempotencyRecord<TResponse>
}

export interface IdempotencyReservation {
  kind: 'reserved'
  idempotencyKey: IdempotencyKey
}

export type IdempotencyDecision<TResponse extends JsonObject = JsonObject> =
  | IdempotencyReplay<TResponse>
  | IdempotencyReservation

export function toIdempotencyKey(value: string): IdempotencyKey {
  return brandString<IdempotencyKey['__brand']>(value, 'idempotencyKey')
}