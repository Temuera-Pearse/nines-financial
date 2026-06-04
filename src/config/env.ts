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
})

export type AppEnv = z.infer<typeof envSchema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return envSchema.parse(source)
}
