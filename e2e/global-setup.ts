import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { apiEnv } from './env';

/** Fresh schema + seed data before every E2E run (isolated e2e database only). */
export default function globalSetup() {
  if (!/e2e|test/i.test(new URL(apiEnv.DATABASE_URL).pathname))
    throw new Error('Refusing to reset a non-test database');
  const cwd = join(__dirname, '..', 'apps', 'api');
  const env = { ...process.env, ...apiEnv };
  execSync(
    "npx tsx -e \"require('./scripts/apply-sql-migrations').applySqlMigrations(process.env.DATABASE_URL, true).then(()=>console.log('e2e db migrated'))\"",
    { cwd, env, stdio: 'inherit' },
  );
  execSync('npx tsx prisma/seed.ts', { cwd, env, stdio: 'inherit' });
}
