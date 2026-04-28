import type { AuditEvent } from '../../../shared/audit/AuditEvent.js'
import type {
  Database,
  DatabaseTransaction,
  QueryResultRow,
  Queryable,
} from '../../../shared/db/Database.js'
import {
  createLogger,
  type Logger,
} from '../../../shared/observability/logger.js'
import type { Clock } from '../../../shared/time/Clock.js'
import { AppError } from '../../../shared/types/AppError.js'
import type { JsonObject } from '../../../shared/types/Json.js'
import { newAuditEventId } from '../types/identifiers.js'
import type { AuditEventRepository } from '../repositories/AuditEventRepository.js'

interface BalanceVerificationRow extends QueryResultRow {
  account_id: string
  account_currency: string
  normal_balance: 'debit' | 'credit'
  balance_currency: string
  balance_normal_balance: 'debit' | 'credit'
  recorded_balance_minor: string | number
  recorded_total_debits_minor: string | number
  recorded_total_credits_minor: string | number
  derived_total_debits_minor: string | number
  derived_total_credits_minor: string | number
}

export interface AccountBalanceMismatch {
  accountId: string
  accountCurrency: string
  balanceCurrency: string
  recordedBalanceMinor: string
  derivedBalanceMinor: string
  recordedTotalDebitsMinor: string
  derivedTotalDebitsMinor: string
  recordedTotalCreditsMinor: string
  derivedTotalCreditsMinor: string
}

export interface BalanceVerificationReport {
  verifiedAt: Date
  totalAccounts: number
  mismatchCount: number
  mismatches: AccountBalanceMismatch[]
}

export interface RebuildBalancesCommand {
  correlationId: string
  causationId: string
}

export interface BalanceRebuildResult {
  rebuiltAt: Date
  rebuiltAccountCount: number
  mismatchCountBefore: number
}

function toMinorUnits(value: string | number): bigint {
  return typeof value === 'number' ? BigInt(value) : BigInt(value)
}

export class BalanceMaintenanceService {
  private readonly logger: Logger

  constructor(
    private readonly database: Database,
    private readonly auditEventRepository: AuditEventRepository,
    private readonly clock: Clock,
    logger?: Logger,
  ) {
    this.logger =
      logger ?? createLogger({ service: 'balance-maintenance-service' })
  }

  async verifyBalances(): Promise<BalanceVerificationReport> {
    const verifiedAt = this.clock.now()
    const rows = await this.listBalanceVerificationRows(this.database)

    return this.toVerificationReport(rows, verifiedAt)
  }

  async rebuildBalances(
    command: RebuildBalancesCommand,
  ): Promise<BalanceRebuildResult> {
    return this.database.tx(async (transaction) => {
      const rebuiltAt = this.clock.now()
      const mismatchesBefore = this.toVerificationReport(
        await this.listBalanceVerificationRows(transaction),
        rebuiltAt,
      )

      await transaction.query('DELETE FROM account_balances')
      await transaction.query(
        `
          INSERT INTO account_balances (
            account_id,
            currency,
            normal_balance,
            balance_minor,
            total_debits_minor,
            total_credits_minor,
            updated_at
          )
          SELECT
            a.account_id,
            a.currency,
            a.normal_balance,
            CASE a.normal_balance
              WHEN 'debit' THEN
                COALESCE(SUM(CASE WHEN e.direction = 'debit' THEN e.amount_minor ELSE 0::NUMERIC(20, 0) END), 0::NUMERIC(20, 0))
                  - COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount_minor ELSE 0::NUMERIC(20, 0) END), 0::NUMERIC(20, 0))
              ELSE
                COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount_minor ELSE 0::NUMERIC(20, 0) END), 0::NUMERIC(20, 0))
                  - COALESCE(SUM(CASE WHEN e.direction = 'debit' THEN e.amount_minor ELSE 0::NUMERIC(20, 0) END), 0::NUMERIC(20, 0))
            END AS balance_minor,
            COALESCE(SUM(CASE WHEN e.direction = 'debit' THEN e.amount_minor ELSE 0::NUMERIC(20, 0) END), 0::NUMERIC(20, 0))
              AS total_debits_minor,
            COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount_minor ELSE 0::NUMERIC(20, 0) END), 0::NUMERIC(20, 0))
              AS total_credits_minor,
            $1::TIMESTAMPTZ
          FROM accounts a
          LEFT JOIN ledger_entries e ON e.account_id = a.account_id
          GROUP BY a.account_id, a.currency, a.normal_balance
          ORDER BY a.account_id ASC
        `,
        [rebuiltAt],
      )

      const verificationAfter = this.toVerificationReport(
        await this.listBalanceVerificationRows(transaction),
        rebuiltAt,
      )

      if (verificationAfter.mismatchCount > 0) {
        throw new AppError({
          category: 'invariant_violation',
          code: 'BALANCE_REBUILD_VERIFICATION_FAILED',
          message:
            'Balance read model rebuild completed but verification still found mismatches',
          details: {
            mismatchCount: verificationAfter.mismatchCount,
          },
        })
      }

      await this.auditEventRepository.append(
        this.buildAuditEvent(
          'account_balance_read_model_rebuilt',
          'system',
          'account_balances',
          {
            rebuiltAccountCount: verificationAfter.totalAccounts,
            mismatchCountBefore: mismatchesBefore.mismatchCount,
            mismatchCountAfter: verificationAfter.mismatchCount,
          },
          command,
          rebuiltAt,
        ),
        transaction,
      )

      this.logger.info('account balance read model rebuilt', {
        rebuiltAccountCount: verificationAfter.totalAccounts,
        mismatchCountBefore: mismatchesBefore.mismatchCount,
        correlationId: command.correlationId,
        causationId: command.causationId,
      })

      return {
        rebuiltAt,
        rebuiltAccountCount: verificationAfter.totalAccounts,
        mismatchCountBefore: mismatchesBefore.mismatchCount,
      }
    })
  }

  private async listBalanceVerificationRows(
    queryable: Queryable,
  ): Promise<BalanceVerificationRow[]> {
    const result = await queryable.query<BalanceVerificationRow>(
      `
        SELECT
          a.account_id,
          a.currency AS account_currency,
          a.normal_balance,
          COALESCE(b.currency, a.currency) AS balance_currency,
          COALESCE(b.normal_balance, a.normal_balance) AS balance_normal_balance,
          COALESCE(b.balance_minor, 0::NUMERIC(20, 0)) AS recorded_balance_minor,
          COALESCE(b.total_debits_minor, 0::NUMERIC(20, 0)) AS recorded_total_debits_minor,
          COALESCE(b.total_credits_minor, 0::NUMERIC(20, 0)) AS recorded_total_credits_minor,
          COALESCE(SUM(CASE WHEN e.direction = 'debit' THEN e.amount_minor ELSE 0::NUMERIC(20, 0) END), 0::NUMERIC(20, 0))
            AS derived_total_debits_minor,
          COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount_minor ELSE 0::NUMERIC(20, 0) END), 0::NUMERIC(20, 0))
            AS derived_total_credits_minor
        FROM accounts a
        LEFT JOIN account_balances b ON b.account_id = a.account_id
        LEFT JOIN ledger_entries e ON e.account_id = a.account_id
        GROUP BY
          a.account_id,
          a.currency,
          a.normal_balance,
          b.normal_balance,
          b.currency,
          b.balance_minor,
          b.total_debits_minor,
          b.total_credits_minor
        ORDER BY a.account_id ASC
      `,
    )

    return result.rows
  }

  private toVerificationReport(
    rows: readonly BalanceVerificationRow[],
    verifiedAt: Date,
  ): BalanceVerificationReport {
    const mismatches = rows.flatMap((row) => {
      const recordedBalanceMinor = toMinorUnits(row.recorded_balance_minor)
      const recordedTotalDebitsMinor = toMinorUnits(
        row.recorded_total_debits_minor,
      )
      const recordedTotalCreditsMinor = toMinorUnits(
        row.recorded_total_credits_minor,
      )
      const derivedTotalDebitsMinor = toMinorUnits(
        row.derived_total_debits_minor,
      )
      const derivedTotalCreditsMinor = toMinorUnits(
        row.derived_total_credits_minor,
      )
      const derivedBalanceMinor =
        row.normal_balance === 'debit'
          ? derivedTotalDebitsMinor - derivedTotalCreditsMinor
          : derivedTotalCreditsMinor - derivedTotalDebitsMinor
      const hasMismatch =
        row.account_currency !== row.balance_currency ||
        row.normal_balance !== row.balance_normal_balance ||
        recordedBalanceMinor !== derivedBalanceMinor ||
        recordedTotalDebitsMinor !== derivedTotalDebitsMinor ||
        recordedTotalCreditsMinor !== derivedTotalCreditsMinor

      if (!hasMismatch) {
        return []
      }

      return [
        {
          accountId: row.account_id,
          accountCurrency: row.account_currency,
          balanceCurrency: row.balance_currency,
          recordedBalanceMinor: recordedBalanceMinor.toString(),
          derivedBalanceMinor: derivedBalanceMinor.toString(),
          recordedTotalDebitsMinor: recordedTotalDebitsMinor.toString(),
          derivedTotalDebitsMinor: derivedTotalDebitsMinor.toString(),
          recordedTotalCreditsMinor: recordedTotalCreditsMinor.toString(),
          derivedTotalCreditsMinor: derivedTotalCreditsMinor.toString(),
        } satisfies AccountBalanceMismatch,
      ]
    })

    return {
      verifiedAt,
      totalAccounts: rows.length,
      mismatchCount: mismatches.length,
      mismatches,
    }
  }

  private buildAuditEvent(
    eventType: string,
    entityType: string,
    entityId: string,
    payload: JsonObject,
    correlation: { correlationId: string; causationId: string },
    createdAt: Date,
  ): AuditEvent {
    return {
      auditEventId: newAuditEventId(),
      eventType,
      entityType,
      entityId,
      correlationId: correlation.correlationId,
      causationId: correlation.causationId,
      payload,
      createdAt,
    }
  }
}
