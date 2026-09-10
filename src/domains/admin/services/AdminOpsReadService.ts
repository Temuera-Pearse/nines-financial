import type {
  Database,
  QueryResultRow,
} from '../../../shared/db/Database.js'
import type { Clock } from '../../../shared/time/Clock.js'

type AmountRow = QueryResultRow & {
  count: number
  amount_minor: string | number | null
  oldest_created_at?: Date | string | null
}

type TreasuryBalanceRow = QueryResultRow & {
  currency: string
  available_minor: string | number | null
  reserved_minor: string | number | null
  display_minor: string | number | null
}

type PlatformBalanceRow = QueryResultRow & {
  account_type: string
  currency: string
  balance_minor: string | number | null
}

type SettlementRow = QueryResultRow & {
  race_id: string
  status: string
  gross_pool: string | number
  house_take: string | number
  net_pool: string | number
  total_winning_stake: string | number
  settled_at: Date | string | null
}

type ReconciliationRow = QueryResultRow & {
  open_discrepancies: number
  critical_discrepancies: number
  warning_discrepancies: number
  last_run_at: Date | string | null
}

type LedgerHealthRow = QueryResultRow & {
  transaction_count: number
  account_count: number
}

function asMinorString(value: string | number | null | undefined): string {
  return String(value ?? 0)
}

function asCount(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function degradedReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class AdminOpsReadService {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async getHealth() {
    const degradedFlags: string[] = []
    let databaseStatus: 'ok' | 'degraded' = 'ok'
    let ledgerStatus: 'ok' | 'degraded' = 'ok'
    let ledgerTransactionCount = 0
    let accountCount = 0

    try {
      await this.database.query('SELECT 1 AS ok')
    } catch (error) {
      databaseStatus = 'degraded'
      degradedFlags.push(`database_unavailable:${degradedReason(error)}`)
    }

    try {
      const ledger = await this.database.query<LedgerHealthRow>(
        `
          SELECT
            (SELECT count(*)::int FROM ledger_transactions) AS transaction_count,
            (SELECT count(*)::int FROM accounts) AS account_count
        `,
      )
      ledgerTransactionCount = asCount(ledger.rows[0]?.transaction_count)
      accountCount = asCount(ledger.rows[0]?.account_count)
    } catch (error) {
      ledgerStatus = 'degraded'
      degradedFlags.push(`ledger_unavailable:${degradedReason(error)}`)
    }

    return {
      serviceName: 'nines-financial',
      service: 'nines-financial',
      status: degradedFlags.length === 0 ? 'ok' : 'degraded',
      uptimeSeconds: process.uptime(),
      timestamp: this.clock.now().toISOString(),
      database: {
        status: databaseStatus,
        checked: true,
      },
      ledger: {
        status: ledgerStatus,
        checked: true,
        transactionCount: ledgerTransactionCount,
        accountCount,
      },
      degradedFlags,
    }
  }

  async getTreasurySummary(currency = 'USDC') {
    const degradedFlags: string[] = []
    let balances: TreasuryBalanceRow | undefined
    let platformClearingBalances: Array<{
      accountType: string
      currency: string
      balanceMinor: string
      balanceMinorUnits: string
    }> = []
    let pendingDeposits = emptyPendingSummary(currency)
    let pendingWithdrawals = emptyPendingSummary(currency)

    try {
      const result = await this.database.query<TreasuryBalanceRow>(
        `
          SELECT
            $1::text AS currency,
            COALESCE(sum(CASE WHEN a.account_type = 'user_available' THEN COALESCE(b.balance_minor, 0) ELSE 0 END), 0::NUMERIC(20,0)) AS available_minor,
            COALESCE(sum(CASE WHEN a.account_type IN ('user_locked', 'user_withdrawal_reserved') THEN COALESCE(b.balance_minor, 0) ELSE 0 END), 0::NUMERIC(20,0)) AS reserved_minor,
            COALESCE(sum(CASE WHEN a.account_type IN ('user_available', 'user_locked', 'user_withdrawal_reserved') THEN COALESCE(b.balance_minor, 0) ELSE 0 END), 0::NUMERIC(20,0)) AS display_minor
          FROM accounts a
          LEFT JOIN account_balances b ON b.account_id = a.account_id
          WHERE a.currency = $1
            AND a.account_type IN ('user_available', 'user_locked', 'user_withdrawal_reserved')
        `,
        [currency],
      )
      balances = result.rows[0]
    } catch (error) {
      degradedFlags.push(`player_balance_aggregates_unavailable:${degradedReason(error)}`)
    }

    try {
      const result = await this.database.query<PlatformBalanceRow>(
        `
          SELECT
            a.account_type,
            a.currency,
            COALESCE(sum(COALESCE(b.balance_minor, 0)), 0::NUMERIC(20,0)) AS balance_minor
          FROM accounts a
          LEFT JOIN account_balances b ON b.account_id = a.account_id
          WHERE a.currency = $1
            AND a.account_type IN (
              'deposit_clearing',
              'token_purchase_clearing',
              'treasury_cash',
              'settlement_clearing',
              'withdrawal_clearing',
              'house_take_revenue',
              'house_rounding_residual',
              'adjustment_reserve'
            )
          GROUP BY a.account_type, a.currency
          ORDER BY a.account_type
        `,
        [currency],
      )
      platformClearingBalances = result.rows.map((row) => ({
        accountType: row.account_type,
        currency: row.currency,
        balanceMinor: asMinorString(row.balance_minor),
        balanceMinorUnits: asMinorString(row.balance_minor),
      }))
    } catch (error) {
      degradedFlags.push(`platform_clearing_balances_unavailable:${degradedReason(error)}`)
    }

    try {
      pendingDeposits = await this.getPendingDeposits(currency)
    } catch (error) {
      degradedFlags.push(`pending_deposits_unavailable:${degradedReason(error)}`)
    }

    try {
      pendingWithdrawals = await this.getPendingWithdrawals(currency)
    } catch (error) {
      degradedFlags.push(`pending_withdrawals_unavailable:${degradedReason(error)}`)
    }

    return {
      source: 'ledger_and_workflow_read_models',
      currency,
      checkedAt: this.clock.now().toISOString(),
      totalPlayerAvailableBalance: asMinorString(balances?.available_minor),
      totalPlayerAvailableBalanceMinor: asMinorString(balances?.available_minor),
      totalPlayerAvailableBalanceMinorUnits: asMinorString(balances?.available_minor),
      totalPlayerReservedBalance: asMinorString(balances?.reserved_minor),
      totalPlayerReservedBalanceMinor: asMinorString(balances?.reserved_minor),
      totalPlayerReservedBalanceMinorUnits: asMinorString(balances?.reserved_minor),
      totalPlayerDisplayBalance: asMinorString(balances?.display_minor),
      totalPlayerDisplayBalanceMinor: asMinorString(balances?.display_minor),
      totalPlayerDisplayBalanceMinorUnits: asMinorString(balances?.display_minor),
      platformClearingBalances,
      pendingDepositCount: pendingDeposits.count,
      pendingDepositAmount: pendingDeposits.totalAmount,
      pendingDepositAmountMinor: pendingDeposits.totalAmountMinor,
      pendingDepositAmountMinorUnits: pendingDeposits.totalAmountMinorUnits,
      pendingWithdrawalCount: pendingWithdrawals.count,
      pendingWithdrawalAmount: pendingWithdrawals.totalAmount,
      pendingWithdrawalAmountMinor: pendingWithdrawals.totalAmountMinor,
      pendingWithdrawalAmountMinorUnits: pendingWithdrawals.totalAmountMinorUnits,
      degraded: degradedFlags.length > 0,
      degradedFlags,
    }
  }

  async getRecentSettlements(limit = 10) {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)))
    try {
      const result = await this.database.query<SettlementRow>(
        `
          SELECT
            settlement_runs.race_id,
            settlement_runs.status,
            settlement_runs.total_pool_minor AS gross_pool,
            settlement_runs.house_take_minor AS house_take,
            settlement_runs.net_pool_minor AS net_pool,
            COALESCE(sum(financial_bets.stake_minor), 0::NUMERIC(20,0)) AS total_winning_stake,
            settlement_runs.completed_at AS settled_at
          FROM settlement_runs
          LEFT JOIN financial_bets
            ON financial_bets.settlement_run_id = settlement_runs.settlement_run_id
           AND financial_bets.selection_id = settlement_runs.winning_selection_id
          GROUP BY
            settlement_runs.settlement_run_id,
            settlement_runs.race_id,
            settlement_runs.status,
            settlement_runs.total_pool_minor,
            settlement_runs.house_take_minor,
            settlement_runs.net_pool_minor,
            settlement_runs.completed_at,
            settlement_runs.updated_at,
            settlement_runs.created_at
          ORDER BY COALESCE(settlement_runs.completed_at, settlement_runs.updated_at, settlement_runs.created_at) DESC,
                   settlement_runs.settlement_run_id DESC
          LIMIT ${safeLimit}
        `,
      )

      return {
        source: 'settlement_runs',
        notImplemented: false,
        degraded: false,
        degradedFlags: [],
        settlements: result.rows.map((row) => ({
          raceId: row.race_id,
          status: row.status,
          grossPool: asMinorString(row.gross_pool),
          grossPoolMinor: asMinorString(row.gross_pool),
          houseTake: asMinorString(row.house_take),
          houseTakeMinor: asMinorString(row.house_take),
          netPool: asMinorString(row.net_pool),
          netPoolMinor: asMinorString(row.net_pool),
          totalWinningStake: asMinorString(row.total_winning_stake),
          totalWinningStakeMinor: asMinorString(row.total_winning_stake),
          settledAt: toIsoString(row.settled_at),
        })),
      }
    } catch (error) {
      return {
        source: 'settlement_runs',
        notImplemented: true,
        degraded: true,
        degradedFlags: [`settlements_unavailable:${degradedReason(error)}`],
        settlements: [],
      }
    }
  }

  async getPendingDeposits(currency = 'USDC') {
    try {
      const result = await this.database.query<AmountRow>(
        `
          SELECT
            count(*)::int AS count,
            COALESCE(sum(COALESCE(expected_amount_minor, 0)), 0::NUMERIC(20,0)) AS amount_minor,
            min(created_at) AS oldest_created_at
          FROM deposit_intents
          WHERE currency = $1
            AND status IN (
              'created',
              'awaiting_external_payment',
              'detected',
              'confirmed',
              'review_required'
            )
        `,
        [currency],
      )
      const row = result.rows[0]
      return pendingSummaryFromRow(currency, row, {
        source: 'deposit_intents',
        notImplemented: false,
        degraded: false,
        degradedFlags: [],
      })
    } catch (error) {
      return {
        ...emptyPendingSummary(currency),
        source: 'deposit_intents',
        notImplemented: true,
        degraded: true,
        degradedFlags: [`pending_deposits_unavailable:${degradedReason(error)}`],
      }
    }
  }

  async getPendingWithdrawals(currency = 'USDC') {
    try {
      const result = await this.database.query<AmountRow>(
        `
          SELECT
            count(*)::int AS count,
            COALESCE(sum(amount_minor_units), 0::NUMERIC(20,0)) AS amount_minor,
            min(created_at) AS oldest_created_at
          FROM withdrawal_requests
          WHERE currency = $1
            AND status IN (
              'requested',
              'reservation_pending',
              'reserved',
              'review_required',
              'approved',
              'submission_pending',
              'submitting',
              'submitted',
              'provider_pending',
              'provider_confirmed',
              'provider_failed',
              'provider_rejected',
              'provider_unknown'
            )
        `,
        [currency],
      )
      const row = result.rows[0]
      return pendingSummaryFromRow(currency, row, {
        source: 'withdrawal_requests',
        notImplemented: false,
        degraded: false,
        degradedFlags: [],
      })
    } catch (error) {
      return {
        ...emptyPendingSummary(currency),
        source: 'withdrawal_requests',
        notImplemented: true,
        degraded: true,
        degradedFlags: [`pending_withdrawals_unavailable:${degradedReason(error)}`],
      }
    }
  }

  async getReconciliationSummary() {
    try {
      const result = await this.database.query<ReconciliationRow>(
        `
          SELECT
            COALESCE(sum(CASE WHEN status NOT IN ('resolved', 'suppressed') THEN 1 ELSE 0 END), 0)::int AS open_discrepancies,
            COALESCE(sum(CASE WHEN status NOT IN ('resolved', 'suppressed') AND severity = 'incident' THEN 1 ELSE 0 END), 0)::int AS critical_discrepancies,
            COALESCE(sum(CASE WHEN status NOT IN ('resolved', 'suppressed') AND severity = 'warning' THEN 1 ELSE 0 END), 0)::int AS warning_discrepancies,
            max(last_detected_at) AS last_run_at
          FROM operational_discrepancies
        `,
      )
      const row = result.rows[0]
      return {
        source: 'operational_discrepancies',
        notImplemented: false,
        degraded: false,
        degradedFlags: [],
        openDiscrepancies: asCount(row?.open_discrepancies),
        criticalDiscrepancies: asCount(row?.critical_discrepancies),
        warningDiscrepancies: asCount(row?.warning_discrepancies),
        lastRunAt: toIsoString(row?.last_run_at),
      }
    } catch (error) {
      return {
        source: 'operational_discrepancies',
        notImplemented: true,
        degraded: true,
        degradedFlags: [`reconciliation_summary_unavailable:${degradedReason(error)}`],
        openDiscrepancies: 0,
        criticalDiscrepancies: 0,
        warningDiscrepancies: 0,
        lastRunAt: null,
      }
    }
  }
}

function emptyPendingSummary(currency: string) {
  return {
    source: 'empty',
    notImplemented: false,
    degraded: false,
    degradedFlags: [] as string[],
    currency,
    count: 0,
    totalAmount: '0',
    totalAmountMinor: '0',
    totalAmountMinorUnits: '0',
    oldestCreatedAt: null as string | null,
  }
}

function pendingSummaryFromRow(
  currency: string,
  row: AmountRow | undefined,
  metadata: {
    source: string
    notImplemented: boolean
    degraded: boolean
    degradedFlags: string[]
  },
) {
  const amount = asMinorString(row?.amount_minor)
  return {
    ...metadata,
    currency,
    count: asCount(row?.count),
    totalAmount: amount,
    totalAmountMinor: amount,
    totalAmountMinorUnits: amount,
    oldestCreatedAt: toIsoString(row?.oldest_created_at),
  }
}
