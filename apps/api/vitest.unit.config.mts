import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://unused:unused@localhost:5432/unused',
      CORS_ORIGINS: 'http://localhost:5173',
      APP_URL: 'http://localhost:5173',
      PAYMENT_WEBHOOK_SECRET: 'unit_test_secret_unit_test_secret_1234',
    },
  },
});
