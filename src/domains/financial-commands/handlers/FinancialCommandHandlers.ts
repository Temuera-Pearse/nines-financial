import {
  applyHouseTakeCommandSchema,
  releaseReservationCommandSchema,
  reserveStakeCommandSchema,
  settleBetCommandSchema,
  type ApplyHouseTakeCommandDto,
  type ApplyHouseTakeResultDto,
  type ReleaseReservationCommandDto,
  type ReleaseReservationResultDto,
  type ReserveStakeCommandDto,
  type ReserveStakeResultDto,
  type SettleBetCommandDto,
  type SettleBetResultDto,
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
