import { z } from 'zod'

import { toIdempotencyKey } from '../../../shared/idempotency/types.js'
import {
  applyAccountFreezeRequestSchema,
  toAccountStatusEnvelopeDto,
  toAccountingCoreSyncDto,
  toAccountFreezeDto,
  type ApplyAccountFreezeResponseDto,
} from '../dto/accountControlDtos.js'
import { AccountControlService } from '../services/AccountControlService.js'
import { accountControlActorTypes } from '../types/accountDomainTypes.js'
import { toPlayerAccountId } from '../types/identifiers.js'

const applyFreezeHandlerCommandSchema = z.object({
  playerAccountId: z.string().trim().min(1),
  actorType: z.enum(accountControlActorTypes),
  actorId: z.string().trim().min(1),
  source: z.string().trim().min(1),
  request: applyAccountFreezeRequestSchema,
})

export type ApplyFreezeHandlerCommand = z.infer<
  typeof applyFreezeHandlerCommandSchema
>

export class ApplyFreezeHandler {
  constructor(private readonly accountControlService: AccountControlService) {}

  async handle(
    command: ApplyFreezeHandlerCommand,
  ): Promise<ApplyAccountFreezeResponseDto> {
    const input = applyFreezeHandlerCommandSchema.parse(command)
    const result = await this.accountControlService.applyFreeze({
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
