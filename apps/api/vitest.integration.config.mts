import 'dotenv/config';
import { defineConfig } from 'vitest/config';

// Integration tests ALWAYS run against TEST_DATABASE_URL, never the development database.
const testDb = process.env.TEST_DATABASE_URL;
if (!testDb) {
  throw new Error(
    'Set TEST_DATABASE_URL (see .env.example) to a database whose name contains "test"',
  );
}
if (!/test/i.test(new URL(testDb).pathname)) {
  throw new Error('TEST_DATABASE_URL must point to a database whose name contains "test"');
}

// Main process (globalSetup) must also see the test database, never the development one.
process.env.DATABASE_URL = testDb;

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    fileParallelism: false, // files share one database
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDb,
      CORS_ORIGINS: 'http://localhost:5173',
      APP_URL: 'http://localhost:5173',
      COOKIE_SECURE: 'false',
      PAYMENT_WEBHOOK_SECRET: 'integration_test_secret_0123456789abcdef',
      ENABLE_DEV_OUTBOX: 'true',
      ENABLE_DOCS: 'false',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/generated/**', 'src/server.ts'],
      reportsDirectory: 'coverage',
    },
  },
});
