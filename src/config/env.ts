import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).optional(),
  NINES_DEPOSIT_PROVIDER_WEBHOOK_SECRET: z.string().min(1).optional(),
  NINES_DEPOSIT_WEBHOOK_REPLAY_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(300),
  NINES_WITHDRAWAL_PROVIDER_WEBHOOK_SECRET: z.string().min(1).optional(),
  NINES_WITHDRAWAL_WEBHOOK_REPLAY_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(300),
  NINES_API_FUNDING_ATTESTATIONS_ENABLED: z.enum(['true', 'false']).optional(),
  NINES_LEGACY_DEPOSIT_PROVIDER_ENABLED: z.enum(['true', 'false']).optional(),
  NINES_SERVICE_AUTH_MODE: z.enum(['hmac', 'external']).default('hmac'),
  NINES_SERVICE_AUTH_HMAC_SECRET: z.string().min(32).optional(),
  NINES_SERVICE_AUTH_REPLAY_WINDOW_SECONDS: z.coerce.number().int().positive().default(300),
  NINES_SECURITY_EVIDENCE_DELIVERY_ENABLED: z.enum(['true', 'false']).default('false'),
  NINES_SECURITY_SERVICE_BASE_URL: z.string().url().optional(),
  NINES_SERVICE_AUTH_KEY_ID: z.string().min(1).default('development-hmac-v1'),
  NINES_SERVICE_DELIVERY_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
})

export type AppEnv = Omit<z.infer<typeof envSchema>,
  'NINES_API_FUNDING_ATTESTATIONS_ENABLED' | 'NINES_LEGACY_DEPOSIT_PROVIDER_ENABLED' |
  'NINES_SECURITY_EVIDENCE_DELIVERY_ENABLED'> & {
  NINES_API_FUNDING_ATTESTATIONS_ENABLED: boolean
  NINES_LEGACY_DEPOSIT_PROVIDER_ENABLED: boolean
  NINES_SECURITY_EVIDENCE_DELIVERY_ENABLED: boolean
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.parse(source)
  const fundingEnabled = parsed.NINES_API_FUNDING_ATTESTATIONS_ENABLED === 'true'
  const legacyEnabled = parsed.NINES_LEGACY_DEPOSIT_PROVIDER_ENABLED === undefined
    ? parsed.NODE_ENV !== 'production'
    : parsed.NINES_LEGACY_DEPOSIT_PROVIDER_ENABLED === 'true'
  if (fundingEnabled && !parsed.NINES_SERVICE_AUTH_HMAC_SECRET) {
    throw new Error('NINES_SERVICE_AUTH_HMAC_SECRET is required when API funding attestations are enabled')
  }
  if (parsed.NODE_ENV === 'production' && fundingEnabled && legacyEnabled) {
    throw new Error('Legacy deposit provider lifecycle and API funding attestations cannot both be enabled in production')
  }
  if (parsed.NODE_ENV === 'production' && fundingEnabled && parsed.NINES_SERVICE_AUTH_MODE === 'hmac') {
    throw new Error('Production funding attestations require a production service authenticator; HMAC is development/test only')
  }
  if (fundingEnabled && parsed.NINES_SERVICE_AUTH_MODE === 'external') {
    throw new Error('External production service authenticator is not configured in this build')
  }
  const securityDeliveryEnabled = parsed.NINES_SECURITY_EVIDENCE_DELIVERY_ENABLED === 'true'
  if (securityDeliveryEnabled && (!parsed.NINES_SECURITY_SERVICE_BASE_URL || !parsed.NINES_SERVICE_AUTH_HMAC_SECRET)) {
    throw new Error('Security evidence delivery requires service URL and HMAC secret')
  }
  if (parsed.NODE_ENV === 'production' && securityDeliveryEnabled) {
    throw new Error('Production security evidence delivery requires a production service authenticator')
  }
  return { ...parsed, NINES_API_FUNDING_ATTESTATIONS_ENABLED: fundingEnabled,
    NINES_LEGACY_DEPOSIT_PROVIDER_ENABLED: legacyEnabled,
    NINES_SECURITY_EVIDENCE_DELIVERY_ENABLED: securityDeliveryEnabled }
}
