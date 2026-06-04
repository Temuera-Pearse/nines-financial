import {
  discrepancyWorkflowCommandSchema,
  listDiscrepanciesQuerySchema,
  operatorCommandSchema,
  riskFreezeCommandSchema,
  riskUnfreezeCommandSchema,
  type DiscrepancyWorkflowCommandDto,
  type ListDiscrepanciesQueryDto,
  type OperatorCommandDto,
  type RiskFreezeCommandDto,
  type RiskUnfreezeCommandDto,
} from '../dto/operationsDtos.js'
import { OperationsService } from '../services/OperationsService.js'

export class RunOperationalReconciliationHandler {
  constructor(private readonly service: OperationsService) {}
  handle(command: OperatorCommandDto) {
    return this.service.runReconciliationMaterialization(
      operatorCommandSchema.parse(command),
    )
  }
}

export class ListDiscrepanciesHandler {
  constructor(private readonly service: OperationsService) {}
  handle(query: ListDiscrepanciesQueryDto) {
    return this.service.listDiscrepancies(
      listDiscrepanciesQuerySchema.parse(query),
    )
  }
}

export class GetDiscrepancyHandler {
  constructor(private readonly service: OperationsService) {}
  handle(discrepancyId: string) {
    return this.service.getDiscrepancy(discrepancyId)
  }
}

export class AcknowledgeDiscrepancyHandler {
  constructor(private readonly service: OperationsService) {}
  handle(command: DiscrepancyWorkflowCommandDto) {
    return this.service.acknowledgeDiscrepancy(
      discrepancyWorkflowCommandSchema.parse(command),
    )
  }
}

export class AssignDiscrepancyHandler {
  constructor(private readonly service: OperationsService) {}
  handle(command: DiscrepancyWorkflowCommandDto) {
    return this.service.assignDiscrepancy(
      discrepancyWorkflowCommandSchema.parse(command),
    )
  }
}

export class ResolveDiscrepancyHandler {
  constructor(private readonly service: OperationsService) {}
  handle(command: DiscrepancyWorkflowCommandDto) {
    return this.service.resolveDiscrepancy(
      discrepancyWorkflowCommandSchema.parse(command),
    )
  }
}

export class SuppressDiscrepancyHandler {
  constructor(private readonly service: OperationsService) {}
  handle(command: DiscrepancyWorkflowCommandDto) {
    return this.service.suppressDiscrepancy(
      discrepancyWorkflowCommandSchema.parse(command),
    )
  }
}

export class ReopenDiscrepancyHandler {
  constructor(private readonly service: OperationsService) {}
  handle(command: DiscrepancyWorkflowCommandDto) {
    return this.service.reopenDiscrepancy(
      discrepancyWorkflowCommandSchema.parse(command),
    )
  }
}

export class LedgerBalanceCheckHandler {
  constructor(private readonly service: OperationsService) {}
  handle() {
    return this.service.getLedgerBalanceCheck()
  }
}

export class AccountingIntegrityHandler {
  constructor(private readonly service: OperationsService) {}
  handle() {
    return this.service.getAccountingIntegrity()
  }
}

export class TreasurySummaryHandler {
  constructor(private readonly service: OperationsService) {}
  handle() {
    return this.service.getTreasurySummary()
  }
}

export class FreezeRiskAccountHandler {
  constructor(private readonly service: OperationsService) {}
  handle(command: RiskFreezeCommandDto) {
    return this.service.freezeRiskAccount(riskFreezeCommandSchema.parse(command))
  }
}

export class UnfreezeRiskAccountHandler {
  constructor(private readonly service: OperationsService) {}
  handle(command: RiskUnfreezeCommandDto) {
    return this.service.unfreezeRiskAccount(
      riskUnfreezeCommandSchema.parse(command),
    )
  }
}

export class GetRiskAccountHandler {
  constructor(private readonly service: OperationsService) {}
  handle(playerId: string, currency = 'USDC') {
    return this.service.getRiskAccount(playerId, currency)
  }
}

export class RebuildBalancesOperationalHandler {
  constructor(private readonly service: OperationsService) {}
  handle(command: OperatorCommandDto & { reason?: string }) {
    return this.service.rebuildBalances(command)
  }
}

export class PlayerFinancialTimelineHandler {
  constructor(private readonly service: OperationsService) {}
  handle(playerId: string) {
    return this.service.playerFinancialTimeline(playerId)
  }
}

export class DepositTimelineHandler {
  constructor(private readonly service: OperationsService) {}
  handle(depositIntentId: string) {
    return this.service.depositTimeline(depositIntentId)
  }
}

export class WithdrawalTimelineHandler {
  constructor(private readonly service: OperationsService) {}
  handle(withdrawalRequestId: string) {
    return this.service.withdrawalTimeline(withdrawalRequestId)
  }
}
