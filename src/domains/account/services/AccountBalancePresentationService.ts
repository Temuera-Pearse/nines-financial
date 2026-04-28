import { Money } from '../../../shared/money/Money.js'
import { AccountBalance } from '../../accounting/entities/AccountBalance.js'
import type { Account } from '../../accounting/entities/Account.js'
import type { PlayerAccountEffectiveStatus } from '../state/playerAccountEffectiveStatus.js'

export interface AccountBalancePresentationInput {
  availableAccount: Account
  availableBalance: AccountBalance | null
  reservedAccount: Account
  reservedBalance: AccountBalance | null
  effectiveStatus: PlayerAccountEffectiveStatus
  asOf: Date
}

export interface PresentedAccountBalances {
  availableLedgerBalanceMinor: bigint
  reservedBalanceMinor: bigint
  restrictedBalanceMinor: bigint
  spendableBalanceMinor: bigint
  displayBalanceMinor: bigint
  asOf: Date
}

export class AccountBalancePresentationService {
  present(input: AccountBalancePresentationInput): PresentedAccountBalances {
    const availableBalance =
      input.availableBalance ??
      AccountBalance.zero(
        input.availableAccount.accountId,
        input.availableAccount.currency,
        input.asOf,
      )
    const reservedBalance =
      input.reservedBalance ??
      AccountBalance.zero(
        input.reservedAccount.accountId,
        input.reservedAccount.currency,
        input.asOf,
      )

    const restrictedBalance =
      input.effectiveStatus === 'frozen'
        ? availableBalance.balance
        : Money.zero(availableBalance.balance.currency)
    const spendableBalance =
      input.effectiveStatus === 'frozen'
        ? Money.zero(availableBalance.balance.currency)
        : availableBalance.balance
    const displayBalance = availableBalance.balance.add(reservedBalance.balance)

    return {
      availableLedgerBalanceMinor: availableBalance.balance.amountMinor,
      reservedBalanceMinor: reservedBalance.balance.amountMinor,
      restrictedBalanceMinor: restrictedBalance.amountMinor,
      spendableBalanceMinor: spendableBalance.amountMinor,
      displayBalanceMinor: displayBalance.amountMinor,
      asOf: new Date(input.asOf),
    }
  }
}
