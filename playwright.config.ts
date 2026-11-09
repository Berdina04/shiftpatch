import { defineConfig, devices } from "@playwright/test";
import { testProcessEnv } from "./tests/support/test-env";

// Runs against a production build (`npm run build` first) on the test
// database, which global-setup migrates and resets to the seed.
const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next start --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    env: testProcessEnv() as Record<string, string>,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
