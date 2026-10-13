import { createHash, randomUUID } from 'node:crypto'
import type { Database, DatabaseTransaction } from '../../../shared/db/Database.js'
import { toIdempotencyKey } from '../../../shared/idempotency/types.js'
import type { Clock } from '../../../shared/time/Clock.js'
import { AppError } from '../../../shared/types/AppError.js'
import type { JsonObject } from '../../../shared/types/Json.js'
import type { AccountActionAuthorizationService } from '../../account/restrictions/AccountActionAuthorizationService.js'
import type { EffectiveStatusService } from '../../account/services/EffectiveStatusService.js'
import type { PlayerAccountProvisioningService } from '../../account/services/PlayerAccountProvisioningService.js'
import { toUserId } from '../../account/types/identifiers.js'
import { Account } from '../../accounting/entities/Account.js'
import type { AccountRepository } from '../../accounting/repositories/AccountRepository.js'
import type { PostingEngineService } from '../../accounting/services/PostingEngineService.js'
import { newAccountId, toOwnerId } from '../../accounting/types/identifiers.js'
import { hashCanonicalJson } from '../../../shared/contracts/canonicalJson.js'
import type {
  NinesIssuanceAcknowledgementV1,
  NinesIssuanceAuthorizationV1,
} from '../dto/NinesIssuanceAuthorization.js'
import { hashNinesIssuanceAuthorization } from '../dto/NinesIssuanceAuthorization.js'
import { NinesIssuanceAuthorizationRepository } from '../repositories/NinesIssuanceAuthorizationRepository.js'

const MAX_MINOR_UNITS = 99_999_999_999_999_999_999n
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60_000

export interface NinesIssuanceRequestContext {
  serviceId: string
  requestId: string
  sentAt: Date
  receivedAt: Date
}

function databaseCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code) : undefined
}

export class NinesIssuanceAuthorizationService {
  constructor(private readonly database: Database,
    private readonly repository: NinesIssuanceAuthorizationRepository,
    private readonly provisioning: PlayerAccountProvisioningService,
    private readonly accounts: AccountRepository,
    private readonly posting: PostingEngineService,
    private readonly effectiveStatus: EffectiveStatusService,
    private readonly authorization: AccountActionAuthorizationService,
    private readonly clock: Clock,
    private readonly environment: 'development' | 'test' | 'production') {}

  async consume(value: NinesIssuanceAuthorizationV1,
    requestContext: NinesIssuanceRequestContext): Promise<NinesIssuanceAcknowledgementV1> {
    const payloadHash = hashNinesIssuanceAuthorization(value)
    this.validate(value)
    const prior = await this.repository.find(value.authorizationId)
    if (prior) return this.database.tx(async (transaction) => {
      await this.recordNonce(requestContext, transaction)
      await this.repository.lock(value.authorizationId, transaction)
      const locked = await this.repository.find(value.authorizationId, transaction)
      if (!locked) throw new Error('Issuance replay disappeared while locking')
      return this.resolveReplay(locked, payloadHash)
    })

    const provisioningCommand = {
      idempotencyKey: toIdempotencyKey(`issuance-authorization:${value.playerId}:NINES`),
      userId: toUserId(value.playerId), currency: 'NINES', correlationId: value.correlationId,
      causationId: value.authorizationId,
    }
    let playerAccount
    try {
      playerAccount = await this.provisioning.provisionIfNeeded(provisioningCommand)
    } catch (error) {
      if (!['23505', '25P02'].includes(databaseCode(error) ?? '')) throw error
      playerAccount = await this.provisioning.provisionIfNeeded(provisioningCommand)
    }
    const available = await this.accounts.getById(playerAccount.availableAccountId)
    const status = await this.effectiveStatus.getSnapshot(playerAccount.playerAccountId, this.clock.now())
    this.authorization.assertAuthorized({ action: 'deposit_credit', actorRole: 'player',
      effectiveStatus: status.effectiveStatus, controlState: status.controlState,
      linkedCoreAccountId: playerAccount.availableAccountId,
      accountingCorePermitsAction: available?.status === 'active' })
    const clearing = await this.ensureClearing(value)

    try {
      return await this.database.tx(async (transaction) => {
        await this.recordNonce(requestContext, transaction)
        await this.repository.lock(value.authorizationId, transaction)
        const replay = await this.repository.find(value.authorizationId, transaction)
        if (replay) return this.resolveReplay(replay, payloadHash)
        const ledger = await this.posting.postTransferWithinTransaction({
          idempotencyKey: toIdempotencyKey(`issuance-authorization:${value.authorizationId}`),
          transactionType: 'token_purchase_issuance', referenceType: 'issuance_authorization',
          referenceId: value.authorizationId, debitAccountId: clearing.accountId,
          creditAccountId: playerAccount.availableAccountId,
          amountMinor: value.issuance.minorUnits, currency: value.issuance.currency,
          effectiveAt: value.authorizedAt, correlationId: value.correlationId,
          causationId: value.authorizationId,
        }, transaction)
        const now = this.clock.now()
        const result = await this.repository.insert({ authorization: value, hash: payloadHash,
          consumptionId: randomUUID(), ledgerTransactionId: ledger.transactionId,
          processedAt: now }, transaction)
        await this.appendEvidence(value, result, now, transaction)
        return result
      })
    } catch (error) {
      if (databaseCode(error) === '23505') throw new AppError({ category: 'conflict',
        code: 'ISSUANCE_FUNDING_ALREADY_CONSUMED',
        message: 'Funding or valuation evidence has already produced an economic effect' })
      throw error
    }
  }

  private validate(value: NinesIssuanceAuthorizationV1): void {
    if (value.environment !== this.environment) throw new AppError({
      category: 'validation_error', code: 'ISSUANCE_ENVIRONMENT_MISMATCH',
      message: 'Issuance authorization environment does not match this service' })
    let issued: bigint
    let nzdCents: bigint
    try { issued = BigInt(value.issuance.minorUnits); nzdCents = BigInt(value.valuation.finalNzdMinorUnits) }
    catch { throw new AppError({ category: 'validation_error', code: 'ISSUANCE_AMOUNT_INVALID',
      message: 'Issuance authorization contains malformed exact integer evidence' }) }
    if (issued <= 0n || issued > MAX_MINOR_UNITS || issued !== nzdCents * 10_000n) {
      throw new AppError({ category: 'validation_error', code: 'ISSUANCE_AMOUNT_INVALID',
        message: 'Issuance authorization amount violates the supported exact policy' })
    }
    const expectedNzd = `${nzdCents / 100n}.${(nzdCents % 100n).toString().padStart(2, '0')}`
    const authorizedAt = Date.parse(value.authorizedAt)
    const valuedAt = Date.parse(value.valuation.valuedAt)
    if (value.valuation.finalNzdAmount !== expectedNzd || value.causationId !== value.valuation.completedValuationId ||
        value.funding.evidenceIdentity !== `crypto-funding-confirmation:v1:${value.funding.intentId}:${value.funding.confirmationEventId}` ||
        valuedAt > authorizedAt || authorizedAt > this.clock.now().getTime() + MAX_FUTURE_CLOCK_SKEW_MS) {
      throw new AppError({ category: 'validation_error', code: 'ISSUANCE_EVIDENCE_INVALID',
        message: 'Issuance authorization evidence is internally inconsistent' })
    }
  }

  private resolveReplay(prior: { hash: string; acknowledgement: NinesIssuanceAcknowledgementV1 },
    hash: string): NinesIssuanceAcknowledgementV1 {
    if (prior.hash !== hash) throw new AppError({ category: 'idempotency_conflict',
      code: 'ISSUANCE_AUTHORIZATION_PAYLOAD_CONFLICT',
      message: 'Authorization identity was reused with different evidence' })
    return prior.acknowledgement
  }

  private async recordNonce(context: NinesIssuanceRequestContext,
    transaction: DatabaseTransaction): Promise<void> {
    try {
      await transaction.query(`INSERT INTO service_request_nonces
        (service_id,request_id,sent_at,received_at) VALUES ($1,$2,$3,$4)`,
      [context.serviceId,context.requestId,context.sentAt,context.receivedAt])
    } catch (error) {
      if (databaseCode(error) === '23505') throw new AppError({ category: 'conflict',
        code: 'SERVICE_REQUEST_REPLAY', message: 'This authenticated request was already received' })
      throw error
    }
  }

  private async ensureClearing(value: NinesIssuanceAuthorizationV1): Promise<Account> {
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

  private async appendEvidence(value: NinesIssuanceAuthorizationV1,
    result: NinesIssuanceAcknowledgementV1, now: Date,
    transaction: DatabaseTransaction): Promise<void> {
    const eventId = randomUUID()
    const payload: JsonObject = { schemaVersion: 1, eventId,
      eventType: 'financial.nines_issuance_consumed.v1', sourceService: 'nines-financial',
      environment: this.environment, authorizationId: value.authorizationId,
      authorizationPayloadHash: result.authorizationPayloadHash,
      financialConsumptionId: result.financialConsumptionId,
      ledgerTransactionId: result.ledgerTransactionId, playerId: value.playerId,
      issuedCurrency: 'NINES', issuedMinorUnits: value.issuance.minorUnits,
      occurredAt: now.toISOString(), correlationId: value.correlationId,
      causationId: value.authorizationId }
    await transaction.query(`INSERT INTO security_evidence_outbox
      (event_id,event_type,funding_attestation_id,issuance_authorization_id,payload,payload_hash,
       next_attempt_at,created_at) VALUES ($1,$2,NULL,$3,$4::jsonb,$5,$6,$6)`,
    [eventId,payload.eventType,value.authorizationId,JSON.stringify(payload),
      hashCanonicalJson(payload),now])
  }
}
