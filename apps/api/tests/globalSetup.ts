import { applySqlMigrations } from '../scripts/apply-sql-migrations';

/** Recreate the schema in the isolated TEST database once per run. */
export default async function setup() {
  const url = process.env.DATABASE_URL!;
  if (!/test/i.test(new URL(url).pathname))
    throw new Error('Refusing to reset a non-test database');
  await applySqlMigrations(url, true);
}
