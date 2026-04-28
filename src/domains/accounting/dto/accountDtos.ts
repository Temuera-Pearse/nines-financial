import { z } from 'zod'

import type { Account } from '../entities/Account.js'
import type { AccountBalance } from '../entities/AccountBalance.js'
import { accountTypes, ownerTypes } from '../types/accountingTypes.js'

const currencyCodeSchema = z.string().trim().regex(/^[A-Z]{3,12}$/)

export const createAccountRequestSchema = z.object({
  accountType: z.enum(accountTypes),
  ownerType: z.enum(ownerTypes),
  ownerId: z.string().trim().min(1),
  currency: currencyCodeSchema,
})

export function toAccountResponseDto(account: Account) {
  return {
    accountId: account.accountId,
    accountType: account.accountType,
    accountClass: account.accountClass,
    normalBalance: account.normalBalance,
    ownerType: account.ownerType,
    ownerId: account.ownerId,
    currency: account.currency,
    status: account.status,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  }
}

export function toAccountBalanceResponseDto(balance: AccountBalance) {
  return {
    accountId: balance.accountId,
    currency: balance.balance.currency,
    balanceMinor: balance.balance.amountMinor.toString(),
    totalDebitsMinor: balance.totalDebits.amountMinor.toString(),
    totalCreditsMinor: balance.totalCredits.amountMinor.toString(),
    updatedAt: balance.updatedAt.toISOString(),
  }
}
