import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@st/supabase",
    environment: "node",
    // Relative to the scan dir, so it works with or without `--dir tests` (the npm script passes it).
    include: ["**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // PGlite boots a WASM Postgres per test file (~5-13s); cap parallel workers to keep memory sane.
    maxWorkers: 4,
  },
});
