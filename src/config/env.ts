import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  NINES_BIND_HOST: z.string().trim().min(1).optional(),
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
  NINES_API_PLAYER_GAMEPLAY_ENABLED: z.enum(['true', 'false']).default('false'),
  NINES_LEGACY_DEPOSIT_PROVIDER_ENABLED: z.enum(['true', 'false']).optional(),
  NINES_SERVICE_AUTH_MODE: z.enum(['hmac', 'external']).default('hmac'),
  NINES_SERVICE_AUTH_HMAC_SECRET: z.string().trim().min(32).optional(),
  NINES_API_AUTH_HMAC_SECRET: z.string().trim().min(32).optional(),
  NINES_API_AUTH_KEY_ID: z.string().trim().min(1).max(128).optional(),
  NINES_API_AUTH_HMAC_ADDITIONAL_KEYS: z.string().optional(),
  NINES_BACKEND_WAGER_INTAKE_ENABLED: z.enum(['true', 'false']).default('false'),
  NINES_BACKEND_RACE_LIFECYCLE_ENABLED: z.enum(['true', 'false']).default('false'),
  NINES_BACKEND_RACE_RESULT_ENABLED: z.enum(['true', 'false']).default('false'),
  NINES_RACE_RESULT_RECOVERY_ENABLED: z.enum(['true', 'false']).default('true'),
  NINES_RACE_RESULT_RECOVERY_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  NINES_RACE_RESULT_RECOVERY_LEASE_MS: z.coerce.number().int().positive().default(30_000),
  NINES_RACE_RESULT_RECOVERY_MAX_ATTEMPTS: z.coerce.number().int().positive().max(100).default(12),
  NINES_RACE_RESULT_RECOVERY_BATCH_SIZE: z.coerce.number().int().positive().max(1000).default(25),
  NINES_BACKEND_AUTH_HMAC_SECRET: z.string().trim().min(32).optional(),
  NINES_BACKEND_AUTH_KEY_ID: z.string().trim().min(1).max(128).optional(),
  NINES_BACKEND_AUTH_HMAC_ADDITIONAL_KEYS: z.string().optional(),
  NINES_SERVICE_AUTH_REPLAY_WINDOW_SECONDS: z.coerce.number().int().positive().default(300),
  NINES_SECURITY_EVIDENCE_DELIVERY_ENABLED: z.enum(['true', 'false']).default('false'),
  NINES_SECURITY_SERVICE_BASE_URL: z.string().url().optional(),
  NINES_SECURITY_AUTH_HMAC_SECRET: z.string().trim().min(32).optional(),
  NINES_SECURITY_AUTH_KEY_ID: z.string().trim().min(1).max(128).optional(),
  NINES_SERVICE_AUTH_KEY_ID: z.string().trim().min(1).max(128).default('development-hmac-v1'),
  NINES_SERVICE_DELIVERY_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
})

export type AppEnv = Omit<z.infer<typeof envSchema>,
  'NINES_API_FUNDING_ATTESTATIONS_ENABLED' | 'NINES_API_PLAYER_GAMEPLAY_ENABLED' | 'NINES_LEGACY_DEPOSIT_PROVIDER_ENABLED' |
  'NINES_SECURITY_EVIDENCE_DELIVERY_ENABLED' | 'NINES_BACKEND_WAGER_INTAKE_ENABLED' |
  'NINES_BACKEND_RACE_LIFECYCLE_ENABLED' | 'NINES_BACKEND_RACE_RESULT_ENABLED' |
  'NINES_RACE_RESULT_RECOVERY_ENABLED'> & {
  NINES_API_FUNDING_ATTESTATIONS_ENABLED: boolean
  NINES_API_PLAYER_GAMEPLAY_ENABLED: boolean
  NINES_LEGACY_DEPOSIT_PROVIDER_ENABLED: boolean
  NINES_SECURITY_EVIDENCE_DELIVERY_ENABLED: boolean
  NINES_BACKEND_WAGER_INTAKE_ENABLED: boolean
  NINES_BACKEND_RACE_LIFECYCLE_ENABLED: boolean
  NINES_BACKEND_RACE_RESULT_ENABLED: boolean
  NINES_RACE_RESULT_RECOVERY_ENABLED: boolean
  apiAuthHmacKeys: Readonly<Record<string, string>>
  backendAuthHmacKeys: Readonly<Record<string, string>>
  securityAuthHmacSecret: string | undefined
  securityAuthKeyId: string | undefined
}

function parseAdditionalKeys(value: string | undefined, name: string): Record<string, string> {
  if (value === undefined) return {}
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new Error(`${name} must be a JSON object`) }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object`)
  }
  const result: Record<string, string> = {}
  for (const [keyId, secret] of Object.entries(parsed)) {
    if (!keyId.trim() || keyId.length > 128 || keyId !== keyId.trim()) {
      throw new Error(`${name} contains an invalid key ID`)
    }
    if (typeof secret !== 'string' || secret.trim().length < 32) {
      throw new Error(`${name} contains an invalid HMAC secret`)
    }
    result[keyId] = secret.trim()
  }
  return result
}

function resolveCredentialPair(input: { explicitSecret: string | undefined;
  explicitKeyId: string | undefined; legacySecret: string | undefined;
  legacyKeyId: string; production: boolean; enabled: boolean;
  secretName: string; keyIdName: string }) {
  if ((input.explicitSecret === undefined) !== (input.explicitKeyId === undefined)) {
    throw new Error(`${input.secretName} and ${input.keyIdName} must be configured together`)
  }
  const secret = input.explicitSecret ?? (input.production ? undefined : input.legacySecret)
  const keyId = input.explicitKeyId ?? (input.production || !input.legacySecret
    ? undefined : input.legacyKeyId)
  if (input.enabled && (!secret || !keyId)) {
    throw new Error(`${input.secretName} and ${input.keyIdName} are required when the integration is enabled`)
  }
  return { secret, keyId }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.parse(source)
  const fundingEnabled = parsed.NINES_API_FUNDING_ATTESTATIONS_ENABLED === 'true'
  const playerGameplayEnabled = parsed.NINES_API_PLAYER_GAMEPLAY_ENABLED === 'true'
  const legacyEnabled = parsed.NINES_LEGACY_DEPOSIT_PROVIDER_ENABLED === undefined
    ? parsed.NODE_ENV !== 'production'
    : parsed.NINES_LEGACY_DEPOSIT_PROVIDER_ENABLED === 'true'
  if (parsed.NODE_ENV === 'production' && fundingEnabled && legacyEnabled) {
    throw new Error('Legacy deposit provider lifecycle and API funding attestations cannot both be enabled in production')
  }
  if (parsed.NODE_ENV === 'production' && legacyEnabled) {
    throw new Error(
      'Legacy deposit provider lifecycle is not available in the production funding-only HTTP profile',
    )
  }
  if (fundingEnabled && parsed.NINES_SERVICE_AUTH_MODE === 'external') {
    throw new Error('External production service authenticator is not configured in this build')
  }
  const apiCredential = resolveCredentialPair({
    explicitSecret: parsed.NINES_API_AUTH_HMAC_SECRET,
    explicitKeyId: parsed.NINES_API_AUTH_KEY_ID,
    legacySecret: parsed.NINES_SERVICE_AUTH_HMAC_SECRET,
    legacyKeyId: parsed.NINES_SERVICE_AUTH_KEY_ID,
    production: parsed.NODE_ENV === 'production', enabled: fundingEnabled || playerGameplayEnabled,
    secretName: 'NINES_API_AUTH_HMAC_SECRET', keyIdName: 'NINES_API_AUTH_KEY_ID',
  })
  const additionalApiKeys = parseAdditionalKeys(parsed.NINES_API_AUTH_HMAC_ADDITIONAL_KEYS,
    'NINES_API_AUTH_HMAC_ADDITIONAL_KEYS')
  const apiAuthHmacKeys: Record<string, string> = { ...additionalApiKeys }
  if (apiCredential.keyId && apiCredential.secret) {
    if (apiAuthHmacKeys[apiCredential.keyId] !== undefined) {
      throw new Error('NINES_API_AUTH_HMAC_ADDITIONAL_KEYS duplicates NINES_API_AUTH_KEY_ID')
    }
    apiAuthHmacKeys[apiCredential.keyId] = apiCredential.secret
  }
  const wagerIntakeEnabled = parsed.NINES_BACKEND_WAGER_INTAKE_ENABLED === 'true'
  const raceLifecycleEnabled = parsed.NINES_BACKEND_RACE_LIFECYCLE_ENABLED === 'true'
  const raceResultEnabled = parsed.NINES_BACKEND_RACE_RESULT_ENABLED === 'true'
  const raceResultRecoveryEnabled = parsed.NINES_RACE_RESULT_RECOVERY_ENABLED === 'true'
  const backendCredential = resolveCredentialPair({
    explicitSecret: parsed.NINES_BACKEND_AUTH_HMAC_SECRET,
    explicitKeyId: parsed.NINES_BACKEND_AUTH_KEY_ID,
    legacySecret: undefined,
    legacyKeyId: 'development-backend-hmac-v1',
    production: parsed.NODE_ENV === 'production',
    enabled: wagerIntakeEnabled || raceLifecycleEnabled || raceResultEnabled,
    secretName: 'NINES_BACKEND_AUTH_HMAC_SECRET', keyIdName: 'NINES_BACKEND_AUTH_KEY_ID',
  })
  const backendAuthHmacKeys: Record<string, string> = parseAdditionalKeys(
    parsed.NINES_BACKEND_AUTH_HMAC_ADDITIONAL_KEYS,
    'NINES_BACKEND_AUTH_HMAC_ADDITIONAL_KEYS')
  if (backendCredential.keyId && backendCredential.secret) {
    if (backendAuthHmacKeys[backendCredential.keyId] !== undefined) {
      throw new Error('NINES_BACKEND_AUTH_HMAC_ADDITIONAL_KEYS duplicates NINES_BACKEND_AUTH_KEY_ID')
    }
    backendAuthHmacKeys[backendCredential.keyId] = backendCredential.secret
  }
  const securityDeliveryEnabled = parsed.NINES_SECURITY_EVIDENCE_DELIVERY_ENABLED === 'true'
  const securityCredential = resolveCredentialPair({
    explicitSecret: parsed.NINES_SECURITY_AUTH_HMAC_SECRET,
    explicitKeyId: parsed.NINES_SECURITY_AUTH_KEY_ID,
    legacySecret: parsed.NINES_SERVICE_AUTH_HMAC_SECRET,
    legacyKeyId: parsed.NINES_SERVICE_AUTH_KEY_ID,
    production: parsed.NODE_ENV === 'production', enabled: securityDeliveryEnabled,
    secretName: 'NINES_SECURITY_AUTH_HMAC_SECRET', keyIdName: 'NINES_SECURITY_AUTH_KEY_ID',
  })
  if (securityDeliveryEnabled && !parsed.NINES_SECURITY_SERVICE_BASE_URL) {
    throw new Error('NINES_SECURITY_SERVICE_BASE_URL is required when Security evidence delivery is enabled')
  }
  if (parsed.NODE_ENV === 'production' && securityDeliveryEnabled &&
      !parsed.NINES_SECURITY_SERVICE_BASE_URL?.startsWith('https://')) {
    throw new Error('NINES_SECURITY_SERVICE_BASE_URL must use HTTPS in production')
  }
  if (parsed.NODE_ENV === 'production' && fundingEnabled && securityDeliveryEnabled &&
      securityCredential.secret && Object.values(apiAuthHmacKeys).includes(securityCredential.secret)) {
    throw new Error('API inbound and Security outbound integrations must use different HMAC secrets')
  }
  return { ...parsed, NINES_API_FUNDING_ATTESTATIONS_ENABLED: fundingEnabled,
    NINES_API_PLAYER_GAMEPLAY_ENABLED: playerGameplayEnabled,
    NINES_LEGACY_DEPOSIT_PROVIDER_ENABLED: legacyEnabled,
    NINES_BACKEND_WAGER_INTAKE_ENABLED: wagerIntakeEnabled,
    NINES_BACKEND_RACE_LIFECYCLE_ENABLED: raceLifecycleEnabled,
    NINES_BACKEND_RACE_RESULT_ENABLED: raceResultEnabled,
    NINES_RACE_RESULT_RECOVERY_ENABLED: raceResultRecoveryEnabled,
    NINES_SECURITY_EVIDENCE_DELIVERY_ENABLED: securityDeliveryEnabled,
    apiAuthHmacKeys, backendAuthHmacKeys,
    securityAuthHmacSecret: securityCredential.secret,
    securityAuthKeyId: securityCredential.keyId }
}

export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  if (!source.NODE_ENV?.trim()) {
    throw new Error(
      'NODE_ENV must be explicitly set to development, test, or production when starting nines-financial',
    )
  }

  return loadEnv(source)
}
