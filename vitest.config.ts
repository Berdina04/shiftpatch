import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { TEST_NOW } from "./tests/support/test-env";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    // The clock is pinned to TEST_NOW before any test code runs.
    env: { SHIFTPATCH_TEST_NOW: TEST_NOW },
    setupFiles: ["tests/support/pin-clock.mjs", "tests/setup.ts"],
    // All files share one real Postgres database and reset it between tests.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
