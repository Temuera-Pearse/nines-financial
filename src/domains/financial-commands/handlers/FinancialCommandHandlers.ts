import {
  applyCarryoversToRaceCommandSchema,
  applyHouseTakeCommandSchema,
  markSettlementManualReviewCommandSchema,
  releaseReservationCommandSchema,
  reserveStakeCommandSchema,
  resolveSettlementManualReviewCommandSchema,
  settleBetCommandSchema,
  voidPoolFromManualReviewCommandSchema,
  type ApplyCarryoversToRaceCommandDto,
  type ApplyCarryoversToRaceResultDto,
  type ApplyHouseTakeCommandDto,
  type ApplyHouseTakeResultDto,
  type MarkSettlementManualReviewCommandDto,
  type ReleaseReservationCommandDto,
  type ReleaseReservationResultDto,
  type ResolveSettlementManualReviewCommandDto,
  type ReserveStakeCommandDto,
  type ReserveStakeResultDto,
  type SettlementRemediationResultDto,
  type SettleBetCommandDto,
  type SettleBetResultDto,
  type VoidPoolFromManualReviewCommandDto,
} from '../dto/financialCommandDtos.js'
import { FinancialCommandService } from '../services/FinancialCommandService.js'

export class ReserveStakeHandler {
  constructor(private readonly service: FinancialCommandService) {}

  handle(command: ReserveStakeCommandDto): Promise<ReserveStakeResultDto> {
    return this.service.reserveStake(reserveStakeCommandSchema.parse(command))
  }
}

export class ReleaseReservationHandler {
  constructor(private readonly service: FinancialCommandService) {}

  handle(
    command: ReleaseReservationCommandDto,
  ): Promise<ReleaseReservationResultDto> {
    return this.service.releaseReservation(
      releaseReservationCommandSchema.parse(command),
    )
  }
}

export class SettleBetHandler {
  constructor(private readonly service: FinancialCommandService) {}

  handle(command: SettleBetCommandDto): Promise<SettleBetResultDto> {
    return this.service.settleBet(settleBetCommandSchema.parse(command))
  }
}

export class ApplyHouseTakeHandler {
  constructor(private readonly service: FinancialCommandService) {}

  handle(command: ApplyHouseTakeCommandDto): Promise<ApplyHouseTakeResultDto> {
    return this.service.applyHouseTake(
      applyHouseTakeCommandSchema.parse(command),
    )
  }
}

export class ApplyCarryoversToRaceHandler {
  constructor(private readonly service: FinancialCommandService) {}

  handle(
    command: ApplyCarryoversToRaceCommandDto,
  ): Promise<ApplyCarryoversToRaceResultDto> {
    return this.service.applyCarryoversToRace(
      applyCarryoversToRaceCommandSchema.parse(command),
    )
  }
}

export class MarkSettlementManualReviewHandler {
  constructor(private readonly service: FinancialCommandService) {}

  handle(
    command: MarkSettlementManualReviewCommandDto,
  ): Promise<SettlementRemediationResultDto> {
    return this.service.markSettlementManualReview(
      markSettlementManualReviewCommandSchema.parse(
        command,
      ) as MarkSettlementManualReviewCommandDto,
    )
  }
}

export class ResolveSettlementManualReviewHandler {
  constructor(private readonly service: FinancialCommandService) {}

  handle(
    command: ResolveSettlementManualReviewCommandDto,
  ): Promise<SettlementRemediationResultDto> {
    return this.service.resolveSettlementManualReview(
      resolveSettlementManualReviewCommandSchema.parse(
        command,
      ) as ResolveSettlementManualReviewCommandDto,
    )
  }
}

export class VoidPoolFromManualReviewHandler {
  constructor(private readonly service: FinancialCommandService) {}

  handle(
    command: VoidPoolFromManualReviewCommandDto,
  ): Promise<SettlementRemediationResultDto> {
    return this.service.voidPoolFromManualReview(
      voidPoolFromManualReviewCommandSchema.parse(
        command,
      ) as VoidPoolFromManualReviewCommandDto,
    )
  }
}
