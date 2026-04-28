import type {
  CaptureReservedFundsCommand,
  ReleaseReservedFundsCommand,
  ReserveFundsCommand,
} from '../accounting/commands/ledgerCommands.js'
import type { LedgerTransaction } from '../accounting/entities/LedgerTransaction.js'

// Bet intake requests reservation changes through Accounting Core. It must not update balances
// or persist ledger entries itself.
export interface BetIntakeAccountingPort {
  reserveBetFunds(command: ReserveFundsCommand): Promise<LedgerTransaction>
  releaseBetFunds(command: ReleaseReservedFundsCommand): Promise<LedgerTransaction>
  captureBetFunds(command: CaptureReservedFundsCommand): Promise<LedgerTransaction>
}