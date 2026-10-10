import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// In development the API is proxied so the browser sees ONE origin: HttpOnly cookies and CSRF work
// exactly like production (where nginx does the same proxying).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.API_URL ?? 'http://localhost:4000', changeOrigin: false },
    },
  },
  preview: {
    port: 5173,
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:4000' } },
  },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test-setup.ts'], css: false },
});
