import { z } from 'zod'

import {
  playerAccountCurrencyParamsSchema,
  type PlayerBalanceResponseDto,
} from '../dto/playerAccountDtos.js'
import { PlayerAccountQueryService } from '../services/PlayerAccountQueryService.js'
import { toUserId } from '../types/identifiers.js'

const getPlayerBalanceCommandSchema = playerAccountCurrencyParamsSchema.extend({
  userId: z.string().trim().min(1),
})

export type GetPlayerBalanceCommand = z.infer<
  typeof getPlayerBalanceCommandSchema
>

export class GetPlayerBalanceHandler {
  constructor(
    private readonly playerAccountQueryService: PlayerAccountQueryService,
  ) {}

  async handle(
    command: GetPlayerBalanceCommand,
  ): Promise<PlayerBalanceResponseDto> {
    const input = getPlayerBalanceCommandSchema.parse(command)

    return this.playerAccountQueryService.getPlayerBalance({
      userId: toUserId(input.userId),
      currency: input.currency,
    })
  }
}
