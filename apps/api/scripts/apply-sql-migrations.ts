/**
 * FALLBACK migration runner: applies every migration.sql under prisma/migrations in order using plain `pg`.
 *
 * The official path is `prisma migrate deploy` (npm run db:migrate). This script exists for
 * environments where Prisma's schema-engine binary cannot be downloaded (e.g. offline sandboxes).
 * It tracks applied files in its own table "_applied_sql_migrations" and must NOT be mixed with
 * `prisma migrate deploy` on the same database.
 */
import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

export async function applySqlMigrations(
  connectionString: string,
  reset = false,
): Promise<string[]> {
  const dir = join(__dirname, '..', 'prisma', 'migrations');
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const client = new Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    if (reset) {
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    }
    await client.query(
      'CREATE TABLE IF NOT EXISTS "_applied_sql_migrations" (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    );
    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM "_applied_sql_migrations"')).rows.map(
        (r) => r.name,
      ),
    );
    for (const name of names) {
      if (done.has(name)) continue;
      const sql = readFileSync(join(dir, name, 'migration.sql'), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO "_applied_sql_migrations"(name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        applied.push(name);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.end();
  }
  return applied;
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  applySqlMigrations(url).then(
    (applied) =>
      console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Nothing to apply'),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
