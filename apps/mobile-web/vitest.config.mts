import { defineConfig } from 'vitest/config';

/** Unit tests for the app's pure modules (data adapters). E2E lives in e2e/ (Playwright). */
export default defineConfig({
  test: { name: '@st/mobile-web', include: ['src/**/*.test.ts'], environment: 'node' },
});
