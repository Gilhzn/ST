import { defineConfig } from 'vitest/config';

/** Unit tests for the app's pure modules (data adapters). E2E lives in e2e/ (Playwright). */
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
