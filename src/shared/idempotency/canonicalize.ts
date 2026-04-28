import { createHash } from 'node:crypto'

import type { JsonValue } from '../types/Json.js'

function canonicalize(value: JsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`
  }

  const keys = Object.keys(value).sort()
  const canonicalEntries = keys.map((key) => {
    const entryValue = value[key]

    if (entryValue === undefined) {
      throw new TypeError(`JSON payload must not contain undefined values at key ${key}`)
    }

    return `${JSON.stringify(key)}:${canonicalize(entryValue)}`
  })

  return `{${canonicalEntries.join(',')}}`
}

export function hashRequestPayload(payload: JsonValue): string {
  return createHash('sha256').update(canonicalize(payload)).digest('hex')
}