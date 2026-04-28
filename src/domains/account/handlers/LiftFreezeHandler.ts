import { z } from 'zod'

import { toIdempotencyKey } from '../../../shared/idempotency/types.js'
import {
  liftAccountFreezeRequestSchema,
  toAccountStatusEnvelopeDto,
  toAccountingCoreSyncDto,
  toAccountFreezeDto,
  type LiftAccountFreezeResponseDto,
} from '../dto/accountControlDtos.js'
import { AccountControlService } from '../services/AccountControlService.js'
import { accountControlActorTypes } from '../types/accountDomainTypes.js'
import { toPlayerAccountId } from '../types/identifiers.js'

const liftFreezeHandlerCommandSchema = z.object({
  playerAccountId: z.string().trim().min(1),
  actorType: z.enum(accountControlActorTypes),
  actorId: z.string().trim().min(1),
  source: z.string().trim().min(1),
  request: liftAccountFreezeRequestSchema,
})

export type LiftFreezeHandlerCommand = z.infer<
  typeof liftFreezeHandlerCommandSchema
>

export class LiftFreezeHandler {
  constructor(private readonly accountControlService: AccountControlService) {}

  async handle(
    command: LiftFreezeHandlerCommand,
  ): Promise<LiftAccountFreezeResponseDto> {
    const input = liftFreezeHandlerCommandSchema.parse(command)
    const result = await this.accountControlService.liftFreeze({
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
      freeze: toAccountFreezeDto(result.control),
      accountingCoreSync: toAccountingCoreSyncDto({
        availableAccountId: result.linkedAccounts.availableAccount.accountId,
        availableAccountStatus: result.linkedAccounts.availableAccount.status,
        reservedAccountId: result.linkedAccounts.reservedAccount.accountId,
        reservedAccountStatus: result.linkedAccounts.reservedAccount.status,
      }),
      account: toAccountStatusEnvelopeDto({
        playerAccountId: result.playerAccount.playerAccountId,
        effectiveStatus: result.effectiveStatusAfter,
        statusChangedAt: result.playerAccount.statusChangedAt,
      }),
    }
  }
}
