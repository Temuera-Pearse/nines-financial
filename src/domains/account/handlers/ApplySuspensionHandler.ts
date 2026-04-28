import { z } from 'zod'

import { toIdempotencyKey } from '../../../shared/idempotency/types.js'
import {
  applyAccountSuspensionRequestSchema,
  toAccountStatusEnvelopeDto,
  toAccountSuspensionDto,
  type ApplyAccountSuspensionResponseDto,
} from '../dto/accountControlDtos.js'
import { AccountControlService } from '../services/AccountControlService.js'
import { accountControlActorTypes } from '../types/accountDomainTypes.js'
import { toPlayerAccountId } from '../types/identifiers.js'

const applySuspensionHandlerCommandSchema = z.object({
  playerAccountId: z.string().trim().min(1),
  actorType: z.enum(accountControlActorTypes),
  actorId: z.string().trim().min(1),
  source: z.string().trim().min(1),
  request: applyAccountSuspensionRequestSchema,
})

export type ApplySuspensionHandlerCommand = z.infer<
  typeof applySuspensionHandlerCommandSchema
>

export class ApplySuspensionHandler {
  constructor(private readonly accountControlService: AccountControlService) {}

  async handle(
    command: ApplySuspensionHandlerCommand,
  ): Promise<ApplyAccountSuspensionResponseDto> {
    const input = applySuspensionHandlerCommandSchema.parse(command)
    const result = await this.accountControlService.applySuspension({
      playerAccountId: toPlayerAccountId(input.playerAccountId),
      actorType: input.actorType,
      actorId: input.actorId,
      source: input.source,
      idempotencyKey: toIdempotencyKey(input.request.idempotencyKey),
      correlationId: input.request.correlationId,
      causationId: input.request.causationId,
      reasonCode: input.request.reasonCode,
      reasonText: input.request.reasonText,
      ticketId: input.request.ticketId,
      expiresAt: input.request.expiresAt
        ? new Date(input.request.expiresAt)
        : null,
    })

    return {
      suspension: toAccountSuspensionDto(
        result.control,
        result.playerAccount.updatedAt,
      ),
      account: toAccountStatusEnvelopeDto({
        playerAccountId: result.playerAccount.playerAccountId,
        effectiveStatus: result.effectiveStatusAfter,
        statusChangedAt: result.playerAccount.statusChangedAt,
      }),
    }
  }
}
