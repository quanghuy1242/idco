import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:61000";

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  outputDir: "test-results/playwright",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  testDir: "tests/e2e",
  timeout: 60_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev:ladle",
    reuseExistingServer: true,
    timeout: 120_000,
    url: baseURL,
  },
});
