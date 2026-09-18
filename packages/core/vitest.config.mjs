import { defineConfig } from "vitest/config";

export default defineConfig({
  // Tests are compiled by tsc first so restricted CI hosts do not need to
  // launch esbuild's helper process.
  esbuild: false,
  test: {
    include: [".test-dist/tests/**/*.test.js"],
    maxWorkers: 1,
    pool: "threads",
  },
});
