import { AppError } from '../../../shared/types/AppError.js'

export const accountTypes = [
  'user_available',
  'user_locked',
  'user_withdrawal_reserved',
  'deposit_clearing',
  'treasury_cash',
  'house_take_revenue',
  'house_rounding_residual',
  'race_selection_pool',
  'settlement_clearing',
  'withdrawal_clearing',
  'adjustment_reserve',
] as const

export type AccountType = (typeof accountTypes)[number]

export const ownerTypes = ['user', 'platform', 'treasury', 'settlement', 'race', 'selection', 'system'] as const

export type OwnerType = (typeof ownerTypes)[number]

export const accountClasses = [
  'asset',
  'liability',
  'revenue',
  'expense',
  'equity',
] as const

export type AccountClass = (typeof accountClasses)[number]

export const normalBalances = ['debit', 'credit'] as const

export type NormalBalance = (typeof normalBalances)[number]

export const accountStatuses = ['active', 'frozen', 'closed'] as const

export type AccountStatus = (typeof accountStatuses)[number]

export const ledgerDirections = ['debit', 'credit'] as const

export type LedgerDirection = (typeof ledgerDirections)[number]

export const ledgerTransactionStatuses = ['pending', 'posted', 'rejected'] as const

export type LedgerTransactionStatus = (typeof ledgerTransactionStatuses)[number]

export const transactionTypes = [
  'deposit_pending_credit',
  'deposit_confirmed_credit',
  'bet_reserve',
  'bet_release',
  'bet_capture',
  'settlement_payout',
  'settlement_house_take',
  'withdrawal_reserve',
  'withdrawal_complete',
  'withdrawal_reversal',
  'manual_adjustment',
] as const

export type TransactionType = (typeof transactionTypes)[number]

export const referenceTypes = [
  'account',
  'deposit',
  'withdrawal',
  'bet',
  'reservation',
  'settlement',
  'manual_adjustment',
  'internal_transfer',
] as const

export type ReferenceType = (typeof referenceTypes)[number]

export interface AccountPostingPolicy {
  allowNegativeBalance: boolean
}

const accountPostingPolicies: Record<AccountType, AccountPostingPolicy> = {
  user_available: { allowNegativeBalance: false },
  user_locked: { allowNegativeBalance: false },
  user_withdrawal_reserved: { allowNegativeBalance: false },
  deposit_clearing: { allowNegativeBalance: true },
  treasury_cash: { allowNegativeBalance: true },
  house_take_revenue: { allowNegativeBalance: true },
  house_rounding_residual: { allowNegativeBalance: true },
  race_selection_pool: { allowNegativeBalance: true },
  settlement_clearing: { allowNegativeBalance: true },
  withdrawal_clearing: { allowNegativeBalance: true },
  adjustment_reserve: { allowNegativeBalance: true },
}

export interface AccountTypeClassification {
  accountClass: AccountClass
  normalBalance: NormalBalance
}

const accountTypeClassifications: Record<AccountType, AccountTypeClassification> = {
  user_available: { accountClass: 'liability', normalBalance: 'credit' },
  user_locked: { accountClass: 'liability', normalBalance: 'credit' },
  user_withdrawal_reserved: { accountClass: 'liability', normalBalance: 'credit' },
  deposit_clearing: { accountClass: 'asset', normalBalance: 'debit' },
  treasury_cash: { accountClass: 'asset', normalBalance: 'debit' },
  house_take_revenue: { accountClass: 'revenue', normalBalance: 'credit' },
  house_rounding_residual: { accountClass: 'revenue', normalBalance: 'credit' },
  race_selection_pool: { accountClass: 'liability', normalBalance: 'credit' },
  settlement_clearing: { accountClass: 'liability', normalBalance: 'credit' },
  withdrawal_clearing: { accountClass: 'liability', normalBalance: 'credit' },
  adjustment_reserve: { accountClass: 'equity', normalBalance: 'credit' },
}

export interface TransactionTypePolicy {
  adminOnly: boolean
}

const transactionTypePolicies: Record<TransactionType, TransactionTypePolicy> = {
  deposit_pending_credit: { adminOnly: false },
  deposit_confirmed_credit: { adminOnly: false },
  bet_reserve: { adminOnly: false },
  bet_release: { adminOnly: false },
  bet_capture: { adminOnly: false },
  settlement_payout: { adminOnly: false },
  settlement_house_take: { adminOnly: false },
  withdrawal_reserve: { adminOnly: false },
  withdrawal_complete: { adminOnly: false },
  withdrawal_reversal: { adminOnly: false },
  manual_adjustment: { adminOnly: true },
}

function assertMember<TValue extends string>(
  value: string,
  allowedValues: readonly TValue[],
  fieldName: string,
): TValue {
  if (allowedValues.includes(value as TValue)) {
    return value as TValue
  }

  throw new AppError({
    category: 'validation_error',
    code: 'INVALID_ACCOUNTING_ENUM',
    message: `${fieldName} must be one of the supported accounting values`,
    details: { fieldName, value, allowedValues: [...allowedValues] },
  })
}

export function toAccountType(value: string): AccountType {
  return assertMember(value, accountTypes, 'accountType')
}

export function toOwnerType(value: string): OwnerType {
  return assertMember(value, ownerTypes, 'ownerType')
}

export function toAccountStatus(value: string): AccountStatus {
  return assertMember(value, accountStatuses, 'accountStatus')
}

export function toAccountClass(value: string): AccountClass {
  return assertMember(value, accountClasses, 'accountClass')
}

export function toNormalBalance(value: string): NormalBalance {
  return assertMember(value, normalBalances, 'normalBalance')
}

export function toLedgerDirection(value: string): LedgerDirection {
  return assertMember(value, ledgerDirections, 'direction')
}

export function toLedgerTransactionStatus(value: string): LedgerTransactionStatus {
  return assertMember(value, ledgerTransactionStatuses, 'transactionStatus')
}

export function toTransactionType(value: string): TransactionType {
  return assertMember(value, transactionTypes, 'transactionType')
}

export function toReferenceType(value: string): ReferenceType {
  return assertMember(value, referenceTypes, 'referenceType')
}

export function getAccountPostingPolicy(accountType: AccountType): AccountPostingPolicy {
  return accountPostingPolicies[accountType]
}

export function getTransactionTypePolicy(transactionType: TransactionType): TransactionTypePolicy {
  return transactionTypePolicies[transactionType]
}

export function classifyAccountType(
  accountType: AccountType,
): AccountTypeClassification {
  return accountTypeClassifications[accountType]
}
