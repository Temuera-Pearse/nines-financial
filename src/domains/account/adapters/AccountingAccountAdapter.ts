import type {
  Database,
  DatabaseTransaction,
  Queryable,
} from '../../../shared/db/Database.js'
import type { Clock } from '../../../shared/time/Clock.js'
import { AppError } from '../../../shared/types/AppError.js'
import { Account } from '../../accounting/entities/Account.js'
import type { AccountBalance } from '../../accounting/entities/AccountBalance.js'
import type { AccountRepository } from '../../accounting/repositories/AccountRepository.js'
import {
  newAccountId,
  type AccountId,
  type OwnerId,
} from '../../accounting/types/identifiers.js'
import type { Account as AccountingAccount } from '../../accounting/entities/Account.js'
import type {
  AccountingAccountControlPort,
  CreateLinkedPlayerAccountsCommand,
  LinkedPlayerAccountingAccounts,
  SyncLinkedPlayerAccountsCommand,
} from '../ports/AccountingAccountControlPort.js'
import type {
  AccountingAccountReadPort,
  FindUserAccountingAccountCriteria,
  PlayerLinkedAccountingAccountsCriteria,
  PlayerLinkedAccountingAccountsSnapshot,
} from '../ports/AccountingAccountReadPort.js'

export class AccountingAccountAdapter
  implements AccountingAccountControlPort, AccountingAccountReadPort
{
  constructor(
    private readonly database: Database,
    private readonly accountRepository: AccountRepository,
    private readonly clock: Clock,
  ) {}

  async createLinkedPlayerAccounts(
    command: CreateLinkedPlayerAccountsCommand,
    transaction?: DatabaseTransaction,
  ): Promise<LinkedPlayerAccountingAccounts> {
    const work = async (tx: DatabaseTransaction) => {
      const availableAccount = await this.findOrCreateUserAccount(
        {
          userId: command.userId,
          currency: command.currency,
          accountType: 'user_available',
        },
        tx,
      )
      const lockedAccount = await this.findOrCreateUserAccount(
        {
          userId: command.userId,
          currency: command.currency,
          accountType: 'user_locked',
        },
        tx,
      )

      return {
        availableAccount,
        reservedAccount: lockedAccount,
      }
    }

    return transaction ? work(transaction) : this.database.tx(work)
  }

  async freezeLinkedPlayerAccounts(
    command: SyncLinkedPlayerAccountsCommand,
    transaction?: DatabaseTransaction,
  ): Promise<LinkedPlayerAccountingAccounts> {
    const work = async (tx: DatabaseTransaction) =>
      this.syncLinkedPlayerAccountStatus(command, 'frozen', tx)

    return transaction ? work(transaction) : this.database.tx(work)
  }

  async unfreezeLinkedPlayerAccounts(
    command: SyncLinkedPlayerAccountsCommand,
    transaction?: DatabaseTransaction,
  ): Promise<LinkedPlayerAccountingAccounts> {
    const work = async (tx: DatabaseTransaction) =>
      this.syncLinkedPlayerAccountStatus(command, 'active', tx)

    return transaction ? work(transaction) : this.database.tx(work)
  }

  getAccount(
    accountId: AccountId,
    queryable?: Queryable,
  ): Promise<AccountingAccount | null> {
    return this.accountRepository.getById(accountId, queryable)
  }

  getBalance(
    accountId: AccountId,
    queryable?: Queryable,
  ): Promise<AccountBalance | null> {
    return this.accountRepository.getBalance(accountId, queryable)
  }

  findUserAccount(
    criteria: FindUserAccountingAccountCriteria,
    queryable?: Queryable,
  ): Promise<AccountingAccount | null> {
    return this.accountRepository.findByOwnerAndType(
      {
        accountType: criteria.accountType,
        ownerType: 'user',
        ownerId: criteria.userId as unknown as OwnerId,
        currency: criteria.currency,
      },
      queryable,
    )
  }

  async getPlayerLinkedAccounts(
    criteria: PlayerLinkedAccountingAccountsCriteria,
    queryable?: Queryable,
  ): Promise<PlayerLinkedAccountingAccountsSnapshot | null> {
    const executor = queryable ?? this.database
    const [availableAccount, lockedAccount] = await Promise.all([
      this.accountRepository.getById(criteria.availableAccountId, executor),
      this.accountRepository.getById(criteria.reservedAccountId, executor),
    ])

    if (!availableAccount || !lockedAccount) {
      return null
    }

    const [availableBalance, lockedBalance] = await Promise.all([
      this.accountRepository.getBalance(availableAccount.accountId, executor),
      this.accountRepository.getBalance(lockedAccount.accountId, executor),
    ])

    return {
      available: {
        account: availableAccount,
        balance: availableBalance,
      },
      reserved: {
        account: lockedAccount,
        balance: lockedBalance,
      },
    }
  }

  private async findOrCreateUserAccount(
    criteria: FindUserAccountingAccountCriteria,
    transaction: DatabaseTransaction,
  ): Promise<AccountingAccount> {
    const existingAccount = await this.findUserAccount(criteria, transaction)

    if (existingAccount) {
      return existingAccount
    }

    const now = this.clock.now()
    const account = new Account({
      accountId: newAccountId(),
      accountType: criteria.accountType,
      ownerType: 'user',
      ownerId: criteria.userId as unknown as OwnerId,
      currency: criteria.currency,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })

    try {
      await this.accountRepository.create(account, transaction)
      return account
    } catch (error) {
      if (!this.isAccountUniquenessConflict(error)) {
        throw error
      }

      const racedAccount = await this.findUserAccount(criteria, transaction)

      if (!racedAccount) {
        throw error
      }

      return racedAccount
    }
  }

  private async syncLinkedPlayerAccountStatus(
    command: SyncLinkedPlayerAccountsCommand,
    expectedStatus: 'active' | 'frozen',
    transaction: DatabaseTransaction,
  ): Promise<LinkedPlayerAccountingAccounts> {
    const [availableAccount, lockedAccount] = await Promise.all([
      this.requireAccount(command.availableAccountId, transaction),
      this.requireAccount(command.reservedAccountId, transaction),
    ])
    const now = this.clock.now()
    const nextAvailableAccount =
      expectedStatus === 'frozen'
        ? availableAccount.freeze(now)
        : availableAccount.unfreeze(now)
    const nextLockedAccount =
      expectedStatus === 'frozen'
        ? lockedAccount.freeze(now)
        : lockedAccount.unfreeze(now)

    await this.accountRepository.update(nextAvailableAccount, transaction)
    await this.accountRepository.update(nextLockedAccount, transaction)

    return {
      availableAccount: nextAvailableAccount,
      reservedAccount: nextLockedAccount,
    }
  }

  private async requireAccount(
    accountId: AccountId,
    queryable: Queryable,
  ): Promise<AccountingAccount> {
    const account = await this.accountRepository.getById(accountId, queryable)

    if (!account) {
      throw new AppError({
        category: 'not_found',
        code: 'ACCOUNT_NOT_FOUND',
        message: `Accounting account ${accountId} was not found`,
        details: { accountId },
      })
    }

    return account
  }

  private isAccountUniquenessConflict(error: unknown): boolean {
    return (
      error instanceof AppError &&
      error.category === 'conflict' &&
      error.code === 'ACCOUNT_ALREADY_EXISTS'
    )
  }
}
