import type {
  CaptureReservedFundsCommand,
  PostTransferCommand,
  ReleaseReservedFundsCommand,
  ReserveFundsCommand,
} from '../accounting/commands/ledgerCommands.js'
import type { LedgerTransaction } from '../accounting/entities/LedgerTransaction.js'

// Treasury owns deposits and withdrawals, but it must call Accounting Core for all postings.
// Treasury must never mutate balances directly or write ledger rows itself.
export interface TreasuryAccountingPort {
  postDeposit(command: PostTransferCommand): Promise<LedgerTransaction>
  reserveWithdrawal(command: ReserveFundsCommand): Promise<LedgerTransaction>
  completeWithdrawal(command: CaptureReservedFundsCommand): Promise<LedgerTransaction>
  reverseWithdrawal(command: ReleaseReservedFundsCommand): Promise<LedgerTransaction>
}