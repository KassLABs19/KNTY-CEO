import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  /** production or staging. Staging shows a banner in the app and must use its own partner secrets. */
  APP_ENV: z.enum(['production', 'staging', 'development']).default('development'),
  HOSTING_MODE: z.enum(['cloud', 'self']).default('cloud'),
  MIN_DESKTOP_VERSION: z.string().default('0.1.0'),
  PORT: z.coerce.number().default(8090),
  CORS_ORIGINS: z.string().default(''),
  LOCK_AFTER_FAILED_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  SIGN_OUT_AFTER_IDLE_MINUTES: z.coerce.number().int().positive().default(30),
  /** How long a re-entered password counts for sensitive actions such as signing payroll. */
  REAUTH_MINUTES: z.coerce.number().int().positive().default(5),
  INVITE_HOURS: z.coerce.number().int().positive().default(48),
  /** Background jobs (outbox delivery, reminders). Off in tests, which call them directly. */
  RUN_JOBS: z.enum(['on', 'off']).default('on'),
  LICENCE_PATH: z.string().default('./licence.json'),
  LICENCE_PUBLIC_KEY: z.string().default(''),
  NODE_ENV: z.string().default('development'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Server settings are missing or invalid:\n${lines}\nSee apps/server/.env.example`);
  }
  return parsed.data;
}

export const SERVER_VERSION = '0.1.0';
