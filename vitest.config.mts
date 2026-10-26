import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "supabase", "apps/mobile-web"],
    coverage: {
      provider: "v8",
      include: ["packages/domain/src/**", "packages/payments/src/**", "supabase/functions/_shared/**/*.ts"],
      exclude: ["**/index.ts", "**/*.d.ts"],
    },
  },
});
