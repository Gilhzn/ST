import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@st/domain",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
