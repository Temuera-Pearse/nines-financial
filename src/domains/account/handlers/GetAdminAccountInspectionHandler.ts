import { z } from 'zod'

import type { AdminAccountInspectionResponseDto } from '../dto/adminAccountDtos.js'
import { PlayerAccountQueryService } from '../services/PlayerAccountQueryService.js'
import { toPlayerAccountId } from '../types/identifiers.js'

const getAdminAccountInspectionCommandSchema = z.object({
  playerAccountId: z.string().trim().min(1),
})

export type GetAdminAccountInspectionCommand = z.infer<
  typeof getAdminAccountInspectionCommandSchema
>

export class GetAdminAccountInspectionHandler {
  constructor(
    private readonly playerAccountQueryService: PlayerAccountQueryService,
  ) {}

  async handle(
    command: GetAdminAccountInspectionCommand,
  ): Promise<AdminAccountInspectionResponseDto> {
    const input = getAdminAccountInspectionCommandSchema.parse(command)

    return this.playerAccountQueryService.getAdminAccountInspection({
      playerAccountId: toPlayerAccountId(input.playerAccountId),
    })
  }
}
