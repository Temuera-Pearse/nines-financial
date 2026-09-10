import { randomUUID } from 'node:crypto'

import type { Database, DatabaseTransaction } from '../../../shared/db/Database.js'
import { hashCanonicalJson } from '../../../shared/contracts/canonicalJson.js'
import { toIdempotencyKey } from '../../../shared/idempotency/types.js'
import type { Clock } from '../../../shared/time/Clock.js'
import { AppError } from '../../../shared/types/AppError.js'
import type { JsonObject } from '../../../shared/types/Json.js'
import type { AccountActionAuthorizationService } from '../../account/restrictions/AccountActionAuthorizationService.js'
import type { PlayerAccountProvisioningService } from '../../account/services/PlayerAccountProvisioningService.js'
import type { EffectiveStatusService } from '../../account/services/EffectiveStatusService.js'
import { toUserId } from '../../account/types/identifiers.js'
import { Account } from '../../accounting/entities/Account.js'
import type { AccountRepository } from '../../accounting/repositories/AccountRepository.js'
import type { PostingEngineService } from '../../accounting/services/PostingEngineService.js'
import { newAccountId, toOwnerId, type AccountId } from '../../accounting/types/identifiers.js'
import type { ConfirmedFundingAttestationV1, FundingAttestationResponseDto } from '../dto/ConfirmedFundingAttestation.js'
import { hashFundingAttestation } from '../dto/ConfirmedFundingAttestation.js'
import { FundingAttestationRepository } from '../repositories/FundingAttestationRepository.js'
import { applyNinesIssuancePolicy } from '../policies/NinesIssuancePolicy.js'

const MAX_AUTOMATIC_WINDOW_MS = 24 * 60 * 60_000
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60_000

export interface FundingAttestationRequestContext {
  serviceId: string
  requestId: string
  sentAt: Date
  receivedAt: Date
}

export class FundingAttestationService {
  constructor(
    private readonly database: Database,
    private readonly repository: FundingAttestationRepository,
    private readonly provisioning: PlayerAccountProvisioningService,
    private readonly accounts: AccountRepository,
    private readonly posting: PostingEngineService,
    private readonly effectiveStatus: EffectiveStatusService,
    private readonly authorization: AccountActionAuthorizationService,
    private readonly clock: Clock,
    private readonly environment: 'development' | 'test' | 'production',
  ) {}

  async consume(attestation: ConfirmedFundingAttestationV1,
    requestContext?: FundingAttestationRequestContext): Promise<FundingAttestationResponseDto> {
    const payloadHash = hashFundingAttestation(attestation)
    this.validate(attestation)
    const prior = await this.repository.find(attestation.fundingAttestationId)
    if (prior) {
      if (!requestContext) return this.resolveReplay(prior, payloadHash)
      return this.database.tx(async (transaction) => {
        await this.recordNonce(requestContext, transaction)
        await this.repository.lock(attestation.fundingAttestationId, transaction)
        const lockedPrior = await this.repository.find(attestation.fundingAttestationId, transaction)
        if (!lockedPrior) throw new Error('Funding attestation replay disappeared while locking')
        return this.resolveReplay(lockedPrior, payloadHash)
      })
    }

    let prepared: { availableAccountId: AccountId; clearing: Account;
      issuance: ReturnType<typeof applyNinesIssuancePolicy> } | null = null
    if (!this.isPastAutomaticDeadline(attestation, this.clock.now())) {
      const playerAccount = await this.provisioning.provisionIfNeeded({
        idempotencyKey: toIdempotencyKey(`funding-attestation:${attestation.playerId}:NINES`),
        userId: toUserId(attestation.playerId),
        currency: 'NINES',
        correlationId: attestation.correlationId,
        causationId: attestation.causationId,
      })
      const available = await this.accounts.getById(playerAccount.availableAccountId)
      const status = await this.effectiveStatus.getSnapshot(playerAccount.playerAccountId, this.clock.now())
      this.authorization.assertAuthorized({
        action: 'deposit_credit', actorRole: 'player', effectiveStatus: status.effectiveStatus,
        controlState: status.controlState, linkedCoreAccountId: playerAccount.availableAccountId,
        accountingCorePermitsAction: available?.status === 'active',
      })
      prepared = { availableAccountId: playerAccount.availableAccountId,
        clearing: await this.ensureClearing(attestation),
        issuance: applyNinesIssuancePolicy(attestation.externalPayment) }
    }

    return this.database.tx(async (transaction) => {
      if (requestContext) await this.recordNonce(requestContext, transaction)
      await this.repository.lock(attestation.fundingAttestationId, transaction)
      const replay = await this.repository.find(attestation.fundingAttestationId, transaction)
      if (replay) return this.resolveReplay(replay, payloadHash)
      if (await this.repository.sourceExists(attestation.provider.name,
        attestation.provider.paymentReference, transaction)) {
        throw new AppError({ category: 'conflict', code: 'FUNDING_SOURCE_ALREADY_CONSUMED',
          message: 'The provider confirmation source has already been consumed' })
      }
      if (await this.repository.fundingIntentExists(attestation.fundingIntentId, transaction)) {
        throw new AppError({ category: 'conflict', code: 'FUNDING_INTENT_ALREADY_CONSUMED',
          message: 'The funding intent has already produced an economic effect' })
      }
      const decisionAt = this.clock.now()
      if (this.isPastAutomaticDeadline(attestation, decisionAt)) {
        return this.insertReview(attestation, payloadHash,
          'AUTOMATIC_PROCESSING_WINDOW_EXPIRED', decisionAt, transaction)
      }
      if (!prepared) throw new Error('Funding attestation preparation was unavailable before issuance')
      const ledger = await this.posting.postTransferWithinTransaction({
        idempotencyKey: toIdempotencyKey(`funding-attestation:${attestation.fundingAttestationId}`),
        transactionType: 'token_purchase_issuance', referenceType: 'funding_attestation',
        referenceId: attestation.fundingAttestationId, debitAccountId: prepared.clearing.accountId,
        creditAccountId: prepared.availableAccountId,
        amountMinor: prepared.issuance.minorUnits, currency: prepared.issuance.currency,
        effectiveAt: attestation.confirmedAt, correlationId: attestation.correlationId,
        causationId: attestation.causationId,
      }, transaction)
      const now = this.clock.now()
      const result = await this.repository.insert({
        consumptionId: randomUUID(), attestationId: attestation.fundingAttestationId,
        hash: payloadHash, issuer: attestation.issuer, environment: attestation.environment,
        playerId: attestation.playerId, fundingIntentId: attestation.fundingIntentId,
        provider: attestation.provider.name, paymentReference: attestation.provider.paymentReference,
        confirmationEventId: attestation.provider.confirmationEventId,
        atomicUnits: attestation.externalPayment.atomicUnits, outcome: 'accepted',
        policyVersion: prepared.issuance.policyVersion, issuedMinorUnits: prepared.issuance.minorUnits,
        ledgerTransactionId: ledger.transactionId, reasonCode: null,
        correlationId: attestation.correlationId, causationId: attestation.causationId,
        payload: attestation, now,
      }, transaction)
      await this.appendEvidence(attestation, result, now, transaction)
      return result
    })
  }

  private validate(attestation: ConfirmedFundingAttestationV1): void {
    if (attestation.environment !== this.environment) throw new AppError({
      category: 'validation_error', code: 'ATTESTATION_ENVIRONMENT_MISMATCH',
      message: 'Attestation environment does not match this service',
    })
    if (attestation.externalPayment.asset !== 'USDC' || attestation.externalPayment.scale !== 6) {
      throw new AppError({ category: 'validation_error', code: 'UNSUPPORTED_PURCHASE_ASSET',
        message: 'Only scale-6 USDC can be converted under the current issuance policy' })
    }
    const confirmedAt = Date.parse(attestation.confirmedAt)
    const issuedAt = Date.parse(attestation.issuedAt)
    const automaticUntil = Date.parse(attestation.automaticProcessingUntil)
    const eligibilityAt = Date.parse(attestation.purchaseEligibility.evaluatedAt)
    const now = this.clock.now().getTime()
    if (confirmedAt > issuedAt || eligibilityAt > issuedAt || automaticUntil <= issuedAt ||
        automaticUntil - issuedAt > MAX_AUTOMATIC_WINDOW_MS ||
        confirmedAt > now + MAX_FUTURE_CLOCK_SKEW_MS || issuedAt > now + MAX_FUTURE_CLOCK_SKEW_MS) {
      throw new AppError({ category: 'validation_error', code: 'INVALID_AUTOMATIC_PROCESSING_WINDOW',
        message: 'Attestation timestamps do not satisfy the automatic processing policy' })
    }
  }

  private resolveReplay(prior: { hash: string; result: FundingAttestationResponseDto }, hash: string) {
    if (prior.hash !== hash) throw new AppError({ category: 'idempotency_conflict',
      code: 'FUNDING_ATTESTATION_PAYLOAD_CONFLICT',
      message: 'The funding attestation identifier was reused with a different payload' })
    return prior.result
  }

  private isPastAutomaticDeadline(attestation: ConfirmedFundingAttestationV1, at: Date): boolean {
    return at.getTime() >= Date.parse(attestation.automaticProcessingUntil)
  }

  private async insertReview(attestation: ConfirmedFundingAttestationV1, hash: string,
    reasonCode: string, now: Date, transaction: DatabaseTransaction): Promise<FundingAttestationResponseDto> {
    const result = await this.repository.insert({ consumptionId: randomUUID(),
      attestationId: attestation.fundingAttestationId, hash, issuer: attestation.issuer,
      environment: attestation.environment, playerId: attestation.playerId,
      fundingIntentId: attestation.fundingIntentId, provider: attestation.provider.name,
      paymentReference: attestation.provider.paymentReference,
      confirmationEventId: attestation.provider.confirmationEventId,
      atomicUnits: attestation.externalPayment.atomicUnits, outcome: 'review_required',
      policyVersion: null, issuedMinorUnits: null, ledgerTransactionId: null, reasonCode,
      correlationId: attestation.correlationId, causationId: attestation.causationId,
      payload: attestation, now }, transaction)
    await this.appendEvidence(attestation, result, now, transaction)
    return result
  }

  private async recordNonce(context: FundingAttestationRequestContext,
    transaction: DatabaseTransaction): Promise<void> {
    try {
      await transaction.query(`INSERT INTO service_request_nonces
        (service_id,request_id,sent_at,received_at) VALUES ($1,$2,$3,$4)`,
      [context.serviceId, context.requestId, context.sentAt, context.receivedAt])
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
        throw new AppError({ category: 'conflict', code: 'SERVICE_REQUEST_REPLAY',
          message: 'This authenticated service request was already received' })
      }
      throw error
    }
  }

  private async ensureClearing(attestation: ConfirmedFundingAttestationV1): Promise<Account> {
    const ownerId = toOwnerId('nines-token-purchase-clearing')
    const existing = await this.accounts.findByOwnerAndType({ accountType: 'token_purchase_clearing',
      ownerType: 'platform', ownerId, currency: 'NINES' })
    if (existing) return existing
    const now = this.clock.now()
    const account = new Account({ accountId: newAccountId(), accountType: 'token_purchase_clearing',
      ownerType: 'platform', ownerId, currency: 'NINES', status: 'active', createdAt: now, updatedAt: now })
    try { await this.accounts.create(account); return account } catch (error) {
      const raced = await this.accounts.findByOwnerAndType({ accountType: 'token_purchase_clearing',
        ownerType: 'platform', ownerId, currency: 'NINES' })
      if (raced) return raced
      throw error
    }
  }

  private async appendEvidence(attestation: ConfirmedFundingAttestationV1,
    result: FundingAttestationResponseDto, now: Date, transaction: import('../../../shared/db/Database.js').DatabaseTransaction) {
    const eventId = randomUUID()
    const payload: JsonObject = { schemaVersion: 1, eventId,
      eventType: 'financial.nines_issuance_decided.v1', sourceService: 'nines-financial',
      environment: this.environment, fundingAttestationId: attestation.fundingAttestationId,
      occurredAt: now.toISOString(), correlationId: attestation.correlationId,
      causationId: attestation.causationId, attestationPayloadHash: result.attestationPayloadHash,
      outcome: result.outcome, issuancePolicyVersion: result.issuancePolicyVersion,
      issuedCurrency: result.issuedCurrency, issuedMinorUnits: result.issuedMinorUnits,
      ledgerTransactionId: result.ledgerTransactionId }
    await transaction.query(`INSERT INTO security_evidence_outbox
      (event_id,event_type,funding_attestation_id,payload,payload_hash,next_attempt_at,created_at)
      VALUES ($1,$2,$3,$4::jsonb,$5,$6,$6)`, [eventId, payload.eventType,
      attestation.fundingAttestationId, JSON.stringify(payload), hashCanonicalJson(payload), now])
  }
}
