import type { JsonObject } from '../types/Json.js'

export type FaultPoint =
  | 'settlement.after_state_record_creation_before_ledger_posting'
  | 'settlement.after_ledger_posting_before_state_finalization'
  | 'settlement.after_outbox_before_response'
  | 'carryover.after_ledger_posting_before_state_finalization'
  | 'deposit.after_event_record_before_credit'
  | 'deposit.after_ledger_posting_before_state_finalization'
  | 'withdrawal.after_request_record_before_reservation'
  | 'withdrawal.after_reservation_posting_before_state_finalization'
  | 'withdrawal.after_release_posting_before_state_finalization'
  | 'withdrawal.after_mark_submitting_before_provider_submission'
  | 'withdrawal.after_provider_submission_persisted_before_state_update'
  | 'withdrawal.after_provider_submission_accepted_before_audit'
  | 'withdrawal.after_provider_status_sync_before_audit'
  | 'withdrawal.after_finalization_ledger_posted_before_state_update'
  | 'withdrawal.after_finalization_state_update_before_audit'
  | 'withdrawal.after_provider_failure_release_posted_before_state_update'
  | 'withdrawal.after_provider_failure_release_state_update_before_audit'
  | 'withdrawal.after_webhook_receipt_before_provider_event'
  | 'withdrawal.after_provider_event_persisted_before_status_update'
  | 'withdrawal.after_provider_webhook_status_update_before_audit'
  | 'reconciliation.before_run_persist'
  | 'reconciliation.after_run_persist_before_response'

export interface FaultInjector {
  trigger(point: FaultPoint, context: JsonObject): Promise<void> | void
}

export class NoopFaultInjector implements FaultInjector {
  trigger(): void {}
}
