import { createHmac, timingSafeEqual } from 'node:crypto'

function signingInput(method: string, path: string, environment: string, serviceId: string,
  keyId: string, requestId: string,
  sentAt: string, contentHash: string): string {
  return ['NINES-HTTP-SIGNATURE-V1', method.toUpperCase(), path, environment,
    serviceId, keyId, requestId, sentAt, contentHash].join('\n')
}

export function signServiceMessage(input: {
  method: string
  path: string
  environment: string
  serviceId: string
  keyId: string
  requestId: string
  sentAt: string
  contentHash: string
  secret: string
}): string {
  if (input.secret.length < 32) throw new Error('Service authentication secret must contain at least 32 characters')
  return createHmac('sha256', input.secret)
    .update(signingInput(input.method, input.path, input.environment, input.serviceId,
      input.keyId, input.requestId,
      input.sentAt, input.contentHash))
    .digest('hex')
}

export function verifyServiceMessage(input: Parameters<typeof signServiceMessage>[0] & {
  signature: string
}): boolean {
  const expected = Buffer.from(signServiceMessage(input), 'hex')
  let actual: Buffer
  try { actual = Buffer.from(input.signature, 'hex') } catch { return false }
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
