import {
  approveWithdrawalRequestCommandSchema,
  cancelWithdrawalRequestCommandSchema,
  createWithdrawalRequestCommandSchema,
  finalizeWithdrawalRequestCommandSchema,
  getWithdrawalRequestCommandSchema,
  ingestWithdrawalProviderWebhookCommandSchema,
  markWithdrawalProviderFailureTerminalCommandSchema,
  markWithdrawalProviderUnknownReviewedCommandSchema,
  rejectWithdrawalRequestCommandSchema,
  releaseWithdrawalProviderFailureCommandSchema,
  submitWithdrawalRequestCommandSchema,
  syncWithdrawalProviderStatusCommandSchema,
  type ApproveWithdrawalRequestCommandDto,
  type CancelWithdrawalRequestCommandDto,
  type CreateWithdrawalRequestCommandDto,
  type FinalizeWithdrawalRequestCommandDto,
  type GetWithdrawalRequestCommandDto,
  type IngestWithdrawalProviderWebhookCommandDto,
  type MarkWithdrawalProviderFailureTerminalCommandDto,
  type MarkWithdrawalProviderUnknownReviewedCommandDto,
  type RejectWithdrawalRequestCommandDto,
  type ReleaseWithdrawalProviderFailureCommandDto,
  type SubmitWithdrawalRequestCommandDto,
  type SyncWithdrawalProviderStatusCommandDto,
  type WithdrawalProviderWebhookIngestionDto,
  type WithdrawalReconciliationReportDto,
  type WithdrawalRequestDto,
  type WithdrawalReviewItemDto,
} from '../dto/withdrawalDtos.js'
import { WithdrawalService } from '../services/WithdrawalService.js'

export class CreateWithdrawalRequestHandler {
  constructor(private readonly service: WithdrawalService) {}

  handle(
    command: CreateWithdrawalRequestCommandDto,
  ): Promise<WithdrawalRequestDto> {
    return this.service.createWithdrawalRequest(
      createWithdrawalRequestCommandSchema.parse(command),
    )
  }
}

export class GetWithdrawalRequestHandler {
  constructor(private readonly service: WithdrawalService) {}

  handle(command: GetWithdrawalRequestCommandDto): Promise<WithdrawalRequestDto> {
    return this.service.getWithdrawalRequest(
      getWithdrawalRequestCommandSchema.parse(command),
    )
  }
}

export class ListWithdrawalReviewItemsHandler {
  constructor(private readonly service: WithdrawalService) {}

  handle(): Promise<WithdrawalReviewItemDto[]> {
    return this.service.listReviewItems()
  }
}

export class DetectWithdrawalReconciliationHandler {
  constructor(private readonly service: WithdrawalService) {}

  handle(): Promise<WithdrawalReconciliationReportDto> {
    return this.service.detectReconciliation()
  }
}

export class ApproveWithdrawalRequestHandler {
  constructor(private readonly service: WithdrawalService) {}

  handle(
    command: ApproveWithdrawalRequestCommandDto,
  ): Promise<WithdrawalRequestDto> {
    return this.service.approveWithdrawalRequest(
      approveWithdrawalRequestCommandSchema.parse(command),
    )
  }
}

export class RejectWithdrawalRequestHandler {
  constructor(private readonly service: WithdrawalService) {}

  handle(command: RejectWithdrawalRequestCommandDto): Promise<WithdrawalRequestDto> {
    return this.service.rejectWithdrawalRequest(
      rejectWithdrawalRequestCommandSchema.parse(command),
    )
  }
}

export class CancelWithdrawalRequestHandler {
  constructor(private readonly service: WithdrawalService) {}

  handle(command: CancelWithdrawalRequestCommandDto): Promise<WithdrawalRequestDto> {
    return this.service.cancelWithdrawalRequest(
      cancelWithdrawalRequestCommandSchema.parse(command),
    )
  }
}

export class SubmitWithdrawalRequestHandler {
  constructor(private readonly service: WithdrawalService) {}

  handle(
    command: SubmitWithdrawalRequestCommandDto,
  ): Promise<WithdrawalRequestDto> {
    return this.service.submitWithdrawalRequest(
      submitWithdrawalRequestCommandSchema.parse(command),
    )
  }
}

export class SyncWithdrawalProviderStatusHandler {
  constructor(private readonly service: WithdrawalService) {}

  handle(
    command: SyncWithdrawalProviderStatusCommandDto,
  ): Promise<WithdrawalRequestDto> {
    return this.service.syncWithdrawalProviderStatus(
      syncWithdrawalProviderStatusCommandSchema.parse(command),
    )
  }
}

export class IngestWithdrawalProviderWebhookHandler {
  constructor(private readonly service: WithdrawalService) {}

  handle(
    command: IngestWithdrawalProviderWebhookCommandDto,
  ): Promise<WithdrawalProviderWebhookIngestionDto> {
    return this.service.ingestWithdrawalProviderWebhook(
      ingestWithdrawalProviderWebhookCommandSchema.parse(command),
    )
  }
}

export class FinalizeWithdrawalRequestHandler {
  constructor(private readonly service: WithdrawalService) {}

  handle(
    command: FinalizeWithdrawalRequestCommandDto,
  ): Promise<WithdrawalRequestDto> {
    return this.service.finalizeWithdrawalRequest(
      finalizeWithdrawalRequestCommandSchema.parse(command),
    )
  }
}

export class ReleaseWithdrawalProviderFailureHandler {
  constructor(private readonly service: WithdrawalService) {}

  handle(
    command: ReleaseWithdrawalProviderFailureCommandDto,
  ): Promise<WithdrawalRequestDto> {
    return this.service.releaseWithdrawalProviderFailure(
      releaseWithdrawalProviderFailureCommandSchema.parse(command),
    )
  }
}

export class MarkWithdrawalProviderFailureTerminalHandler {
  constructor(private readonly service: WithdrawalService) {}

  handle(
    command: MarkWithdrawalProviderFailureTerminalCommandDto,
  ): Promise<WithdrawalRequestDto> {
    return this.service.markWithdrawalProviderFailureTerminal(
      markWithdrawalProviderFailureTerminalCommandSchema.parse(command),
    )
  }
}

export class MarkWithdrawalProviderUnknownReviewedHandler {
  constructor(private readonly service: WithdrawalService) {}

  handle(
    command: MarkWithdrawalProviderUnknownReviewedCommandDto,
  ): Promise<WithdrawalRequestDto> {
    return this.service.markWithdrawalProviderUnknownReviewed(
      markWithdrawalProviderUnknownReviewedCommandSchema.parse(command),
    )
  }
}
