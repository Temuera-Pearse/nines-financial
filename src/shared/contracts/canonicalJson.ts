import { createHash } from 'node:crypto'

import type { JsonValue } from '../types/Json.js'

export function canonicalizeJson(value: JsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => {
    const entry = value[key]
    if (entry === undefined) throw new TypeError(`Canonical JSON does not permit undefined at ${key}`)
    return `${JSON.stringify(key)}:${canonicalizeJson(entry)}`
  }).join(',')}}`
}

export function hashCanonicalJson(value: JsonValue): string {
  return createHash('sha256').update(canonicalizeJson(value), 'utf8').digest('hex')
}
