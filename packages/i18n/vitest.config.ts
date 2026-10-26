import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@st/i18n",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
