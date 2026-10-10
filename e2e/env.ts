import { config } from 'dotenv';
import { join } from 'node:path';

// Shared by playwright.config.ts and global-setup.ts. The E2E database is isolated from dev and unit-test databases.
export const API_PORT = 4100;
export const WEB_PORT = 5273;
// Local developers keep connection strings in apps/api/.env (git-ignored); CI sets E2E_DATABASE_URL directly.
config({ path: join(__dirname, '..', 'apps', 'api', '.env') });
const fromEnv = process.env.E2E_DATABASE_URL;
if (!fromEnv)
  throw new Error(
    'Set E2E_DATABASE_URL (a database whose name contains "e2e" or "test"); see .env.example',
  );
export const E2E_DB: string = fromEnv;
// Fixture password for the throwaway E2E database only (seeded from SEED_DEMO_PASSWORD below). Not a real credential.
export const DEMO_PASSWORD = 'Demo@Pass12345';
export const apiEnv = {
  NODE_ENV: 'development',
  PORT: String(API_PORT),
  DATABASE_URL: E2E_DB,
  CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
  APP_URL: `http://localhost:${WEB_PORT}`,
  COOKIE_SECURE: 'false',
  PAYMENT_WEBHOOK_SECRET: 'e2e_only_secret_0123456789abcdef0123456789',
  ENABLE_DEV_OUTBOX: 'true',
  ENABLE_DOCS: 'false',
  LOG_LEVEL: 'warn',
  SEED_DEMO_PASSWORD: DEMO_PASSWORD,
};
