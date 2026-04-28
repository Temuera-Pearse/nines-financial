import { z } from 'zod'

import { toIdempotencyKey } from '../../../shared/idempotency/types.js'
import {
  liftAccountSuspensionRequestSchema,
  toAccountStatusEnvelopeDto,
  toAccountSuspensionDto,
  type LiftAccountSuspensionResponseDto,
} from '../dto/accountControlDtos.js'
import { AccountControlService } from '../services/AccountControlService.js'
import { accountControlActorTypes } from '../types/accountDomainTypes.js'
import { toPlayerAccountId } from '../types/identifiers.js'

const liftSuspensionHandlerCommandSchema = z.object({
  playerAccountId: z.string().trim().min(1),
  actorType: z.enum(accountControlActorTypes),
  actorId: z.string().trim().min(1),
  source: z.string().trim().min(1),
  request: liftAccountSuspensionRequestSchema,
})

export type LiftSuspensionHandlerCommand = z.infer<
  typeof liftSuspensionHandlerCommandSchema
>

export class LiftSuspensionHandler {
  constructor(private readonly accountControlService: AccountControlService) {}

  async handle(
    command: LiftSuspensionHandlerCommand,
  ): Promise<LiftAccountSuspensionResponseDto> {
    const input = liftSuspensionHandlerCommandSchema.parse(command)
    const result = await this.accountControlService.liftSuspension({
      playerAccountId: toPlayerAccountId(input.playerAccountId),
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
