import { z } from 'zod'

import { toIdempotencyKey } from '../../../shared/idempotency/types.js'
import {
  liftAccountRestrictionRequestSchema,
  toAccountRestrictionDto,
  toAccountStatusEnvelopeDto,
  type LiftAccountRestrictionResponseDto,
} from '../dto/accountControlDtos.js'
import { AccountControlService } from '../services/AccountControlService.js'
import { accountControlActorTypes } from '../types/accountDomainTypes.js'
import {
  toAccountRestrictionId,
  toPlayerAccountId,
} from '../types/identifiers.js'

const liftRestrictionHandlerCommandSchema = z.object({
  playerAccountId: z.string().trim().min(1),
  restrictionId: z.string().trim().min(1),
  actorType: z.enum(accountControlActorTypes),
  actorId: z.string().trim().min(1),
  source: z.string().trim().min(1),
  request: liftAccountRestrictionRequestSchema,
})

export type LiftRestrictionHandlerCommand = z.infer<
  typeof liftRestrictionHandlerCommandSchema
>

export class LiftRestrictionHandler {
  constructor(private readonly accountControlService: AccountControlService) {}

  async handle(
    command: LiftRestrictionHandlerCommand,
  ): Promise<LiftAccountRestrictionResponseDto> {
    const input = liftRestrictionHandlerCommandSchema.parse(command)
    const result = await this.accountControlService.liftRestriction({
      playerAccountId: toPlayerAccountId(input.playerAccountId),
      restrictionId: toAccountRestrictionId(input.restrictionId),
      actorType: input.actorType,
      actorId: input.actorId,
      source: input.source,
      idempotencyKey: toIdempotencyKey(input.request.idempotencyKey),
      correlationId: input.request.correlationId,
      causationId: input.request.causationId,
      liftReasonCode: input.request.reasonCode,
      liftReasonText: input.request.reasonText,
      ticketId: input.request.ticketId,
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
