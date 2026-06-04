import {
  createRacePoolCommandSchema,
  freezePoolCommandSchema,
  placeBetCommandSchema,
  registerPoolSelectionCommandSchema,
  type CreateRacePoolCommandDto,
  type FreezePoolCommandDto,
  type PlaceBetCommandDto,
  type PlaceBetResultDto,
  type PoolSelectionDto,
  type RacePoolDto,
  type RegisterPoolSelectionCommandDto,
} from '../dto/bettingDtos.js'
import { BettingIntakeService } from '../services/BettingIntakeService.js'

export class CreateRacePoolHandler {
  constructor(private readonly service: BettingIntakeService) {}

  handle(command: CreateRacePoolCommandDto): Promise<RacePoolDto> {
    return this.service.createRacePool(createRacePoolCommandSchema.parse(command))
  }
}

export class RegisterPoolSelectionHandler {
  constructor(private readonly service: BettingIntakeService) {}

  handle(
    command: RegisterPoolSelectionCommandDto,
  ): Promise<PoolSelectionDto> {
    return this.service.registerPoolSelection(
      registerPoolSelectionCommandSchema.parse(command),
    )
  }
}

export class FreezePoolHandler {
  constructor(private readonly service: BettingIntakeService) {}

  handle(command: FreezePoolCommandDto): Promise<RacePoolDto> {
    return this.service.freezePool(freezePoolCommandSchema.parse(command))
  }
}

export class PlaceBetHandler {
  constructor(private readonly service: BettingIntakeService) {}

  handle(command: PlaceBetCommandDto): Promise<PlaceBetResultDto> {
    return this.service.placeBet(placeBetCommandSchema.parse(command))
  }
}
