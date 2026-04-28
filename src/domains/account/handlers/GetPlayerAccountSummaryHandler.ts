import { z } from 'zod'

import {
  playerAccountCurrencyParamsSchema,
  type PlayerAccountSummaryResponseDto,
} from '../dto/playerAccountDtos.js'
import { PlayerAccountQueryService } from '../services/PlayerAccountQueryService.js'
import { toUserId } from '../types/identifiers.js'

const getPlayerAccountSummaryCommandSchema =
  playerAccountCurrencyParamsSchema.extend({
    userId: z.string().trim().min(1),
  })

export type GetPlayerAccountSummaryCommand = z.infer<
  typeof getPlayerAccountSummaryCommandSchema
>

export class GetPlayerAccountSummaryHandler {
  constructor(
    private readonly playerAccountQueryService: PlayerAccountQueryService,
  ) {}

  async handle(
    command: GetPlayerAccountSummaryCommand,
  ): Promise<PlayerAccountSummaryResponseDto> {
    const input = getPlayerAccountSummaryCommandSchema.parse(command)

    return this.playerAccountQueryService.getPlayerAccountSummary({
      userId: toUserId(input.userId),
      currency: input.currency,
    })
  }
}
