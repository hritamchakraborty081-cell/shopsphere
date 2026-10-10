import 'dotenv/config';
import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().url(),
  CORS_ORIGINS: z.string().min(1),
  APP_URL: z.string().url(),
  COOKIE_SECURE: bool.default('false'),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(168),
  PAYMENT_PROVIDER: z.enum(['mock']).default('mock'),
  PAYMENT_WEBHOOK_SECRET: z
    .string()
    .min(32, 'PAYMENT_WEBHOOK_SECRET must be at least 32 characters'),
  ENABLE_DEV_OUTBOX: bool.default('false'),
  ENABLE_DOCS: bool.default('false'),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'silent']).default('info'),
});

export type Env = z.infer<typeof schema> & { corsOrigins: string[] };

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    // Print only variable names + messages, never values.
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  const env = {
    ...parsed.data,
    corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()),
  };
  if (env.NODE_ENV === 'production') {
    // Refuse to boot with development-only conveniences enabled in production.
    if (env.ENABLE_DEV_OUTBOX) throw new Error('ENABLE_DEV_OUTBOX must be false in production');
    if (!env.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production');
    if (/change_me|dev_only/i.test(env.PAYMENT_WEBHOOK_SECRET)) {
      throw new Error('PAYMENT_WEBHOOK_SECRET must be a real random secret in production');
    }
  }
  return env;
}

export const env: Env = parseEnv(process.env);
