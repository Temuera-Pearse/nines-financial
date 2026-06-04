import type {
  FinancialBetDto,
  PoolTotalDto,
  RacePoolWithSelectionsDto,
  SelectionTotalDto,
  SettlementCarryoverDto,
  SettlementManualReviewItemDto,
  SettlementReconciliationReportDto,
  SettlementReconciliationRunSummaryDto,
} from '../dto/bettingDtos.js'
import { BettingIntakeService } from '../services/BettingIntakeService.js'

export class GetRacePoolHandler {
  constructor(private readonly service: BettingIntakeService) {}

  handle(raceId: string): Promise<RacePoolWithSelectionsDto> {
    return this.service.getRacePoolWithSelections(raceId)
  }
}

export class GetFinancialBetHandler {
  constructor(private readonly service: BettingIntakeService) {}

  handle(betId: string): Promise<FinancialBetDto> {
    return this.service.getBetById(betId)
  }
}

export class ListFinancialBetsByRaceHandler {
  constructor(private readonly service: BettingIntakeService) {}

  handle(raceId: string): Promise<FinancialBetDto[]> {
    return this.service.listBetsByRaceId(raceId)
  }
}

export class ListFinancialBetsByUserHandler {
  constructor(private readonly service: BettingIntakeService) {}

  handle(userId: string): Promise<FinancialBetDto[]> {
    return this.service.listBetsByUserId(userId)
  }
}

export class ListCarryoversHandler {
  constructor(private readonly service: BettingIntakeService) {}

  handle(criteria: {
    status?: SettlementCarryoverDto['status']
    sourceRaceId?: string
    targetRaceId?: string
  }): Promise<SettlementCarryoverDto[]> {
    return this.service.listCarryovers(criteria)
  }
}

export class GetLivePoolTotalHandler {
  constructor(private readonly service: BettingIntakeService) {}

  handle(raceId: string): Promise<PoolTotalDto> {
    return this.service.getLivePoolTotal(raceId)
  }
}

export class ListSelectionTotalsHandler {
  constructor(private readonly service: BettingIntakeService) {}

  handle(raceId: string): Promise<SelectionTotalDto[]> {
    return this.service.listSelectionTotals(raceId)
  }
}

export class DetectSettlementReconciliationHandler {
  constructor(private readonly service: BettingIntakeService) {}

  handle(raceId: string): Promise<SettlementReconciliationReportDto> {
    return this.service.detectSettlementReconciliation(raceId)
  }
}

export class ListManualReviewItemsHandler {
  constructor(private readonly service: BettingIntakeService) {}

  handle(): Promise<SettlementManualReviewItemDto[]> {
    return this.service.listManualReviewItems()
  }
}

export class RunSettlementReconciliationHandler {
  constructor(private readonly service: BettingIntakeService) {}

  handle(input: {
    raceId: string
    operatorId: string
    idempotencyKey: string
    correlationId: string
    causationId: string
  }): Promise<SettlementReconciliationRunSummaryDto> {
    return this.service.runSettlementReconciliation(input)
  }
}

export class ListSettlementReconciliationRunsHandler {
  constructor(private readonly service: BettingIntakeService) {}

  handle(criteria: {
    raceId?: string
  }): Promise<SettlementReconciliationRunSummaryDto[]> {
    return this.service.listSettlementReconciliationRuns(criteria)
  }
}
