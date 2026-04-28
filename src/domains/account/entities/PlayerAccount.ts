import {
  toCurrencyCode,
  type CurrencyCode,
} from '../../../shared/money/Money.js'
import type { AccountId } from '../../accounting/types/identifiers.js'
import { AccountDomainValidationError } from '../errors/AccountDomainErrors.js'
import type { PlayerAccountClass } from '../types/accountDomainTypes.js'
import type { PlayerAccountId, UserId } from '../types/identifiers.js'

export interface PlayerAccountProps {
  playerAccountId: PlayerAccountId
  userId: UserId
  currency: string
  accountClass: PlayerAccountClass
  availableAccountId: AccountId
  reservedAccountId: AccountId
  createdAt: Date
  updatedAt: Date
  statusChangedAt: Date
}

export class PlayerAccount {
  readonly playerAccountId: PlayerAccountId

  readonly userId: UserId

  readonly currency: CurrencyCode

  readonly accountClass: PlayerAccountClass

  readonly availableAccountId: AccountId

  readonly reservedAccountId: AccountId

  readonly createdAt: Date

  readonly updatedAt: Date

  readonly statusChangedAt: Date

  constructor(props: PlayerAccountProps) {
    this.playerAccountId = props.playerAccountId
    this.userId = props.userId
    this.currency = toCurrencyCode(props.currency)
    this.accountClass = props.accountClass
    this.availableAccountId = props.availableAccountId
    this.reservedAccountId = props.reservedAccountId
    this.createdAt = new Date(props.createdAt)
    this.updatedAt = new Date(props.updatedAt)
    this.statusChangedAt = new Date(props.statusChangedAt)

    if (this.availableAccountId === this.reservedAccountId) {
      throw new AccountDomainValidationError(
        'PLAYER_ACCOUNT_LINKS_MUST_BE_DISTINCT',
        'PlayerAccount available and reserved Accounting Core accounts must be distinct',
        {
          playerAccountId: this.playerAccountId,
          availableAccountId: this.availableAccountId,
          reservedAccountId: this.reservedAccountId,
        },
      )
    }

    if (this.updatedAt.getTime() < this.createdAt.getTime()) {
      throw new AccountDomainValidationError(
        'PLAYER_ACCOUNT_TIMESTAMP_ORDER',
        'PlayerAccount updatedAt cannot be earlier than createdAt',
        { playerAccountId: this.playerAccountId },
      )
    }

    if (this.statusChangedAt.getTime() < this.createdAt.getTime()) {
      throw new AccountDomainValidationError(
        'PLAYER_ACCOUNT_STATUS_CHANGED_AT_TOO_EARLY',
        'PlayerAccount statusChangedAt cannot be earlier than createdAt',
        {
          playerAccountId: this.playerAccountId,
          createdAt: this.createdAt.toISOString(),
          statusChangedAt: this.statusChangedAt.toISOString(),
        },
      )
    }

    if (this.statusChangedAt.getTime() > this.updatedAt.getTime()) {
      throw new AccountDomainValidationError(
        'PLAYER_ACCOUNT_STATUS_CHANGED_AT_TOO_LATE',
        'PlayerAccount statusChangedAt cannot be later than updatedAt',
        {
          playerAccountId: this.playerAccountId,
          updatedAt: this.updatedAt.toISOString(),
          statusChangedAt: this.statusChangedAt.toISOString(),
        },
      )
    }
  }

  belongsToUser(userId: UserId): boolean {
    return this.userId === userId
  }

  referencesCoreAccount(accountId: AccountId): boolean {
    return (
      this.availableAccountId === accountId ||
      this.reservedAccountId === accountId
    )
  }
}
