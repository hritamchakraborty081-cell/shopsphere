import { defineConfig, devices } from '@playwright/test';
import { API_PORT, WEB_PORT, apiEnv } from './env';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1, // tests share one seeded database
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  globalSetup: './global-setup.ts',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /responsive/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /responsive/ },
  ],
  webServer: [
    {
      command: 'npx tsx src/server.ts',
      cwd: '../apps/api',
      env: apiEnv,
      url: `http://localhost:${API_PORT}/api/v1/ready`,
      reuseExistingServer: !!process.env.E2E_REUSE,
      timeout: 60_000,
    },
    {
      command: `npx vite preview --port ${WEB_PORT} --strictPort`,
      cwd: '../apps/web',
      env: { API_URL: `http://localhost:${API_PORT}` },
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !!process.env.E2E_REUSE,
      timeout: 60_000,
    },
  ],
});
