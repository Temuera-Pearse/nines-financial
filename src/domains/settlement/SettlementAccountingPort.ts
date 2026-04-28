import type { PostTransferCommand } from '../accounting/commands/ledgerCommands.js'
import type { LedgerTransaction } from '../accounting/entities/LedgerTransaction.js'

// Settlement determines outcomes and emits instructions. Accounting Core performs all postings.
// Settlement must never bypass Accounting Core and write ledger entries directly.
export interface SettlementAccountingPort {
  postSettlementPayout(command: PostTransferCommand): Promise<LedgerTransaction>
  postHouseTake(command: PostTransferCommand): Promise<LedgerTransaction>
}