import { randomUUID } from 'node:crypto'

import { brandString, type Brand } from '../../../shared/ids/brand.js'

export type WithdrawalRequestId = Brand<string, 'WithdrawalRequestId'>
export type WithdrawalProviderEventId = Brand<string, 'WithdrawalProviderEventId'>
export type WithdrawalProviderWebhookReceiptId = Brand<
  string,
  'WithdrawalProviderWebhookReceiptId'
>

export function toWithdrawalRequestId(value: string): WithdrawalRequestId {
  return brandString<WithdrawalRequestId['__brand']>(
    value,
    'withdrawalRequestId',
  )
}

export function newWithdrawalRequestId(): WithdrawalRequestId {
  return toWithdrawalRequestId(`wd_req_${randomUUID()}`)
}

export function toWithdrawalProviderEventId(
  value: string,
): WithdrawalProviderEventId {
  return brandString<WithdrawalProviderEventId['__brand']>(
    value,
    'withdrawalProviderEventId',
  )
}

export function newWithdrawalProviderEventId(): WithdrawalProviderEventId {
  return toWithdrawalProviderEventId(`wd_evt_${randomUUID()}`)
}

export function toWithdrawalProviderWebhookReceiptId(
  value: string,
): WithdrawalProviderWebhookReceiptId {
  return brandString<WithdrawalProviderWebhookReceiptId['__brand']>(
    value,
    'withdrawalProviderWebhookReceiptId',
  )
}

export function newWithdrawalProviderWebhookReceiptId(): WithdrawalProviderWebhookReceiptId {
  return toWithdrawalProviderWebhookReceiptId(`wd_wh_${randomUUID()}`)
}
