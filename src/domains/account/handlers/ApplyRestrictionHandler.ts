import { z } from 'zod'

import { toIdempotencyKey } from '../../../shared/idempotency/types.js'
import {
  applyAccountRestrictionRequestSchema,
  toAccountRestrictionDto,
  toAccountStatusEnvelopeDto,
  type ApplyAccountRestrictionResponseDto,
} from '../dto/accountControlDtos.js'
import { AccountControlService } from '../services/AccountControlService.js'
import { accountControlActorTypes } from '../types/accountDomainTypes.js'
import { toPlayerAccountId } from '../types/identifiers.js'

const applyRestrictionHandlerCommandSchema = z.object({
  playerAccountId: z.string().trim().min(1),
  actorType: z.enum(accountControlActorTypes),
  actorId: z.string().trim().min(1),
  source: z.string().trim().min(1),
  request: applyAccountRestrictionRequestSchema,
})

export type ApplyRestrictionHandlerCommand = z.infer<
  typeof applyRestrictionHandlerCommandSchema
>

export class ApplyRestrictionHandler {
  constructor(private readonly accountControlService: AccountControlService) {}

  async handle(
    command: ApplyRestrictionHandlerCommand,
  ): Promise<ApplyAccountRestrictionResponseDto> {
    const input = applyRestrictionHandlerCommandSchema.parse(command)
    const result = await this.accountControlService.applyRestriction({
      playerAccountId: toPlayerAccountId(input.playerAccountId),
      actorType: input.actorType,
      actorId: input.actorId,
      source: input.source,
      idempotencyKey: toIdempotencyKey(input.request.idempotencyKey),
      correlationId: input.request.correlationId,
      causationId: input.request.causationId,
      blockedActions: input.request.blockedActions,
      reasonCode: input.request.reasonCode,
      reasonText: input.request.reasonText,
      ticketId: input.request.ticketId,
      expiresAt: input.request.expiresAt
        ? new Date(input.request.expiresAt)
        : null,
    })

    return {
      restriction: toAccountRestrictionDto(
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
