import {
  createDepositIntentCommandSchema,
  approveProviderDepositCreditCommandSchema,
  getDepositIntentCommandSchema,
  ingestProviderDepositEventCommandSchema,
  linkProviderDepositEventCommandSchema,
  markDepositReviewedNoCreditCommandSchema,
  rejectProviderDepositEventCommandSchema,
  type ApproveProviderDepositCreditCommandDto,
  type CreateDepositIntentCommandDto,
  type DepositIntentDto,
  type DepositReconciliationReportDto,
  type DepositReviewItemDto,
  type GetDepositIntentCommandDto,
  type IngestProviderDepositEventCommandDto,
  type IngestProviderDepositEventResultDto,
  type LinkProviderDepositEventCommandDto,
  type MarkDepositReviewedNoCreditCommandDto,
  type RejectProviderDepositEventCommandDto,
  type ResolveProviderDepositEventResultDto,
} from '../dto/depositDtos.js'
import { DepositService } from '../services/DepositService.js'

export class CreateDepositIntentHandler {
  constructor(private readonly service: DepositService) {}

  handle(command: CreateDepositIntentCommandDto): Promise<DepositIntentDto> {
    return this.service.createDepositIntent(
      createDepositIntentCommandSchema.parse(command),
    )
  }
}

export class GetDepositIntentHandler {
  constructor(private readonly service: DepositService) {}

  handle(command: GetDepositIntentCommandDto): Promise<DepositIntentDto> {
    return this.service.getDepositIntent(
      getDepositIntentCommandSchema.parse(command),
    )
  }
}

export class IngestProviderDepositEventHandler {
  constructor(private readonly service: DepositService) {}

  handle(
    command: IngestProviderDepositEventCommandDto,
  ): Promise<IngestProviderDepositEventResultDto> {
    return this.service.ingestProviderDepositEvent(
      ingestProviderDepositEventCommandSchema.parse(command),
    )
  }
}

export class ListDepositReviewItemsHandler {
  constructor(private readonly service: DepositService) {}

  handle(): Promise<DepositReviewItemDto[]> {
    return this.service.listReviewItems()
  }
}

export class DetectDepositReconciliationHandler {
  constructor(private readonly service: DepositService) {}

  handle(): Promise<DepositReconciliationReportDto> {
    return this.service.detectReconciliation()
  }
}

export class MarkDepositReviewedNoCreditHandler {
  constructor(private readonly service: DepositService) {}

  handle(
    command: MarkDepositReviewedNoCreditCommandDto,
  ): Promise<ResolveProviderDepositEventResultDto> {
    return this.service.markReviewedNoCredit(
      markDepositReviewedNoCreditCommandSchema.parse(command),
    )
  }
}

export class RejectProviderDepositEventHandler {
  constructor(private readonly service: DepositService) {}

  handle(
    command: RejectProviderDepositEventCommandDto,
  ): Promise<ResolveProviderDepositEventResultDto> {
    return this.service.rejectProviderEvent(
      rejectProviderDepositEventCommandSchema.parse(command),
    )
  }
}

export class LinkProviderDepositEventHandler {
  constructor(private readonly service: DepositService) {}

  handle(
    command: LinkProviderDepositEventCommandDto,
  ): Promise<ResolveProviderDepositEventResultDto> {
    return this.service.linkProviderEventToIntent(
      linkProviderDepositEventCommandSchema.parse(command),
    )
  }
}

export class ApproveProviderDepositCreditHandler {
  constructor(private readonly service: DepositService) {}

  handle(
    command: ApproveProviderDepositCreditCommandDto,
  ): Promise<ResolveProviderDepositEventResultDto> {
    return this.service.approveProviderEventCredit(
      approveProviderDepositCreditCommandSchema.parse(command),
    )
  }
}

export class RetryProviderDepositCreditHandler {
  constructor(private readonly service: DepositService) {}

  handle(
    command: ApproveProviderDepositCreditCommandDto,
  ): Promise<ResolveProviderDepositEventResultDto> {
    return this.service.retryProviderEventCredit(
      approveProviderDepositCreditCommandSchema.parse(command),
    )
  }
}
