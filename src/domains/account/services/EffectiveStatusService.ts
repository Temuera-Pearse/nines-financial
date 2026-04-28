import type { Queryable } from '../../../shared/db/Database.js'
import type { AccountFreeze } from '../entities/AccountFreeze.js'
import type { AccountRestriction } from '../entities/AccountRestriction.js'
import type { AccountSuspension } from '../entities/AccountSuspension.js'
import type { AccountFreezeRepository } from '../repositories/AccountFreezeRepository.js'
import type { AccountRestrictionRepository } from '../repositories/AccountRestrictionRepository.js'
import type { AccountSuspensionRepository } from '../repositories/AccountSuspensionRepository.js'
import {
  derivePlayerAccountEffectiveStatus,
  normalizePlayerAccountControlStateSummary,
  type PlayerAccountControlStateSummary,
  type PlayerAccountEffectiveStatus,
} from '../state/playerAccountEffectiveStatus.js'
import type { PlayerAccountId } from '../types/identifiers.js'

export interface PlayerAccountEffectiveStatusSnapshot {
  playerAccountId: PlayerAccountId
  restrictions: readonly AccountRestriction[]
  suspension: AccountSuspension | null
  freeze: AccountFreeze | null
  controlState: PlayerAccountControlStateSummary
  effectiveStatus: PlayerAccountEffectiveStatus
  asOf: Date
}

export class EffectiveStatusService {
  constructor(
    private readonly restrictionRepository: AccountRestrictionRepository,
    private readonly suspensionRepository: AccountSuspensionRepository,
    private readonly freezeRepository: AccountFreezeRepository,
  ) {}

  async getSnapshot(
    playerAccountId: PlayerAccountId,
    at: Date = new Date(),
    queryable?: Queryable,
  ): Promise<PlayerAccountEffectiveStatusSnapshot> {
    const [restrictions, suspension, freeze] = await Promise.all([
      this.restrictionRepository.listActiveByPlayerAccountId(
        playerAccountId,
        at,
        queryable,
      ),
      this.suspensionRepository.getActiveByPlayerAccountId(
        playerAccountId,
        at,
        queryable,
      ),
      this.freezeRepository.getActiveByPlayerAccountId(
        playerAccountId,
        queryable,
      ),
    ])

    const controlState = normalizePlayerAccountControlStateSummary({
      restrictionCount: restrictions.length,
      hasSuspension: suspension?.isActive(at) ?? false,
      hasFreeze: freeze?.isActive() ?? false,
    })

    return {
      playerAccountId,
      restrictions,
      suspension,
      freeze,
      controlState,
      effectiveStatus: derivePlayerAccountEffectiveStatus(controlState),
      asOf: new Date(at),
    }
  }

  async getControlStateSummary(
    playerAccountId: PlayerAccountId,
    at: Date = new Date(),
    queryable?: Queryable,
  ): Promise<PlayerAccountControlStateSummary> {
    const snapshot = await this.getSnapshot(playerAccountId, at, queryable)
    return snapshot.controlState
  }

  async getEffectiveStatus(
    playerAccountId: PlayerAccountId,
    at: Date = new Date(),
    queryable?: Queryable,
  ): Promise<PlayerAccountEffectiveStatus> {
    const snapshot = await this.getSnapshot(playerAccountId, at, queryable)
    return snapshot.effectiveStatus
  }
}
