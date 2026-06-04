import type { JsonObject } from '../../../shared/types/Json.js'

export const discrepancyStatuses = [
  'open',
  'acknowledged',
  'in_progress',
  'resolved',
  'suppressed',
] as const

export type DiscrepancyStatus = (typeof discrepancyStatuses)[number]

export const discrepancySeverities = ['info', 'warning', 'incident'] as const

export type DiscrepancySeverity = (typeof discrepancySeverities)[number]

export interface Discrepancy {
  discrepancyId: string
  dedupeKey: string
  category: string
  severity: DiscrepancySeverity
  status: DiscrepancyStatus
  entityType: string
  entityId: string
  relatedIds: JsonObject
  summary: string
  detailsPayload: JsonObject
  firstDetectedAt: Date
  lastDetectedAt: Date
  detectedAt: Date
  updatedAt: Date
  assignedToOperatorId: string | null
  resolutionReason: string | null
  resolvedAt: Date | null
}
