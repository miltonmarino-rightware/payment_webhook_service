import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.spec.ts",
      "tests/**/*.test.tsx",
      "tests/**/*.spec.tsx",
    ],
    environment: "node",
    passWithNoTests: false,
  },
});
