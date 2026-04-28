import {
  createLogger,
  type Logger,
} from '../../../shared/observability/logger.js'
import type { Clock } from '../../../shared/time/Clock.js'
import { AppError } from '../../../shared/types/AppError.js'
import {
  InvalidLinkedCoreAccountStateError,
  PlayerAccountNotFoundError,
} from '../errors/AccountDomainErrors.js'
import type { PlayerAccount } from '../entities/PlayerAccount.js'
import type {
  AccountingAccountReadPort,
  PlayerLinkedAccountingAccountsSnapshot,
} from '../ports/AccountingAccountReadPort.js'
import type { PlayerAccountRepository } from '../repositories/PlayerAccountRepository.js'
import { AccountActionAuthorizationService } from '../restrictions/AccountActionAuthorizationService.js'
import {
  toAccountFreezeDto,
  toAccountRestrictionDto,
  toAccountSuspensionDto,
} from '../dto/accountControlDtos.js'
import {
  toAdminAccountInspectionResponseDto,
  type AdminAccountInspectionResponseDto,
} from '../dto/adminAccountDtos.js'
import {
  toPlayerAccountSummaryResponseDto,
  toPlayerBalanceResponseDto,
  type PlayerAccountSummaryResponseDto,
  type PlayerBalanceResponseDto,
} from '../dto/playerAccountDtos.js'
import type { PlayerAccountId, UserId } from '../types/identifiers.js'

import {
  AccountBalancePresentationService,
  type PresentedAccountBalances,
} from './AccountBalancePresentationService.js'
import {
  EffectiveStatusService,
  type PlayerAccountEffectiveStatusSnapshot,
} from './EffectiveStatusService.js'

export interface GetPlayerAccountByCurrencyQuery {
  userId: UserId
  currency: string
}

export interface GetAdminAccountInspectionQuery {
  playerAccountId: PlayerAccountId
}

export class PlayerAccountQueryService {
  private readonly logger: Logger

  constructor(
    private readonly playerAccountRepository: PlayerAccountRepository,
    private readonly accountingAccountReadPort: AccountingAccountReadPort,
    private readonly effectiveStatusService: EffectiveStatusService,
    private readonly balancePresentationService: AccountBalancePresentationService,
    private readonly authorizationService: AccountActionAuthorizationService,
    private readonly clock: Clock,
    logger?: Logger,
  ) {
    this.logger =
      logger ?? createLogger({ service: 'player-account-query-service' })
  }

  async getPlayerAccountSummary(
    query: GetPlayerAccountByCurrencyQuery,
  ): Promise<PlayerAccountSummaryResponseDto> {
    const view = await this.loadPlayerAccountView(query)

    return toPlayerAccountSummaryResponseDto({
      playerAccount: view.playerAccount,
      effectiveStatus: view.statusSnapshot.effectiveStatus,
      displayBalanceMinor: view.presentedBalances.displayBalanceMinor,
      spendableBalanceMinor: view.presentedBalances.spendableBalanceMinor,
      asOf: view.presentedBalances.asOf,
    })
  }

  async getPlayerBalance(
    query: GetPlayerAccountByCurrencyQuery,
  ): Promise<PlayerBalanceResponseDto> {
    const view = await this.loadPlayerAccountView(query)

    return toPlayerBalanceResponseDto({
      playerAccount: view.playerAccount,
      effectiveStatus: view.statusSnapshot.effectiveStatus,
      spendableBalanceMinor: view.presentedBalances.spendableBalanceMinor,
      reservedBalanceMinor: view.presentedBalances.reservedBalanceMinor,
      restrictedBalanceMinor: view.presentedBalances.restrictedBalanceMinor,
      displayBalanceMinor: view.presentedBalances.displayBalanceMinor,
      asOf: view.presentedBalances.asOf,
    })
  }

  async getAdminAccountInspection(
    query: GetAdminAccountInspectionQuery,
  ): Promise<AdminAccountInspectionResponseDto> {
    const playerAccount = await this.requirePlayerAccountById(
      query.playerAccountId,
    )
    const statusSnapshot = await this.effectiveStatusService.getSnapshot(
      playerAccount.playerAccountId,
    )

    this.authorizationService.assertAuthorized({
      action: 'admin_account_inspection',
      actorRole: 'admin',
      controlState: statusSnapshot.controlState,
      effectiveStatus: statusSnapshot.effectiveStatus,
    })

    const asOf = this.clock.now()
    const linkedAccounts =
      await this.requireLinkedAccountingAccounts(playerAccount)
    const presentedBalances = this.balancePresentationService.present({
      availableAccount: linkedAccounts.available.account,
      availableBalance: linkedAccounts.available.balance,
      reservedAccount: linkedAccounts.reserved.account,
      reservedBalance: linkedAccounts.reserved.balance,
      effectiveStatus: statusSnapshot.effectiveStatus,
      asOf,
    })

    this.logger.debug('loaded admin account inspection', {
      playerAccountId: playerAccount.playerAccountId,
      effectiveStatus: statusSnapshot.effectiveStatus,
    })

    return toAdminAccountInspectionResponseDto({
      playerAccount,
      effectiveStatus: statusSnapshot.effectiveStatus,
      availableAccountStatus: linkedAccounts.available.account.status,
      reservedAccountStatus: linkedAccounts.reserved.account.status,
      availableLedgerBalanceMinor:
        presentedBalances.availableLedgerBalanceMinor,
      reservedBalanceMinor: presentedBalances.reservedBalanceMinor,
      restrictedBalanceMinor: presentedBalances.restrictedBalanceMinor,
      spendableBalanceMinor: presentedBalances.spendableBalanceMinor,
      displayBalanceMinor: presentedBalances.displayBalanceMinor,
      activeRestrictionCount: statusSnapshot.controlState.restrictionCount,
      hasActiveSuspension: statusSnapshot.controlState.hasSuspension,
      hasActiveFreeze: statusSnapshot.controlState.hasFreeze,
      restrictions: statusSnapshot.restrictions.map((restriction) =>
        toAccountRestrictionDto(restriction, statusSnapshot.asOf),
      ),
      suspension: statusSnapshot.suspension
        ? toAccountSuspensionDto(statusSnapshot.suspension, statusSnapshot.asOf)
        : null,
      freeze: statusSnapshot.freeze
        ? toAccountFreezeDto(statusSnapshot.freeze)
        : null,
      asOf: presentedBalances.asOf,
    })
  }

  private async loadPlayerAccountView(query: GetPlayerAccountByCurrencyQuery) {
    const playerAccount = await this.requirePlayerAccountByUserAndCurrency(
      query.userId,
      query.currency,
    )
    const statusSnapshot = await this.effectiveStatusService.getSnapshot(
      playerAccount.playerAccountId,
    )

    this.authorizationService.assertAuthorized({
      action: 'player_balance_view',
      actorRole: 'player',
      controlState: statusSnapshot.controlState,
      effectiveStatus: statusSnapshot.effectiveStatus,
    })

    const asOf = this.clock.now()
    const linkedAccounts =
      await this.requireLinkedAccountingAccounts(playerAccount)
    const presentedBalances = this.balancePresentationService.present({
      availableAccount: linkedAccounts.available.account,
      availableBalance: linkedAccounts.available.balance,
      reservedAccount: linkedAccounts.reserved.account,
      reservedBalance: linkedAccounts.reserved.balance,
      effectiveStatus: statusSnapshot.effectiveStatus,
      asOf,
    })

    this.logger.debug('loaded player account view', {
      playerAccountId: playerAccount.playerAccountId,
      userId: query.userId,
      currency: query.currency,
      effectiveStatus: statusSnapshot.effectiveStatus,
    })

    return {
      playerAccount,
      statusSnapshot,
      linkedAccounts,
      presentedBalances,
    }
  }

  private async requirePlayerAccountById(
    playerAccountId: PlayerAccountId,
  ): Promise<PlayerAccount> {
    const playerAccount =
      await this.playerAccountRepository.getById(playerAccountId)

    if (!playerAccount) {
      throw new PlayerAccountNotFoundError(playerAccountId)
    }

    return playerAccount
  }

  private async requirePlayerAccountByUserAndCurrency(
    userId: UserId,
    currency: string,
  ): Promise<PlayerAccount> {
    const playerAccount =
      await this.playerAccountRepository.findByUserAndCurrency({
        userId,
        currency,
        accountClass: 'primary',
      })

    if (!playerAccount) {
      throw new AppError({
        category: 'not_found',
        code: 'PLAYER_ACCOUNT_NOT_FOUND',
        message: 'No PlayerAccount exists for the requested user and currency',
        details: {
          userId,
          currency,
          accountClass: 'primary',
        },
      })
    }

    return playerAccount
  }

  private async requireLinkedAccountingAccounts(
    playerAccount: PlayerAccount,
  ): Promise<PlayerLinkedAccountingAccountsSnapshot> {
    const snapshot =
      await this.accountingAccountReadPort.getPlayerLinkedAccounts({
        availableAccountId: playerAccount.availableAccountId,
        reservedAccountId: playerAccount.reservedAccountId,
      })

    if (snapshot) {
      return snapshot
    }

    const availableAccount = await this.accountingAccountReadPort.getAccount(
      playerAccount.availableAccountId,
    )

    if (!availableAccount) {
      throw new InvalidLinkedCoreAccountStateError(
        playerAccount.availableAccountId,
        'Linked available Accounting Core account was not found',
        { playerAccountId: playerAccount.playerAccountId },
      )
    }

    const reservedAccount = await this.accountingAccountReadPort.getAccount(
      playerAccount.reservedAccountId,
    )

    if (!reservedAccount) {
      throw new InvalidLinkedCoreAccountStateError(
        playerAccount.reservedAccountId,
        'Linked reserved Accounting Core account was not found',
        { playerAccountId: playerAccount.playerAccountId },
      )
    }

    return {
      available: {
        account: availableAccount,
        balance: await this.accountingAccountReadPort.getBalance(
          availableAccount.accountId,
        ),
      },
      reserved: {
        account: reservedAccount,
        balance: await this.accountingAccountReadPort.getBalance(
          reservedAccount.accountId,
        ),
      },
    }
  }
}
