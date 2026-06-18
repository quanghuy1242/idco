import { defineConfig, devices } from "@playwright/test";

const serverHost = process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1";
const serverPort = Number(process.env.PLAYWRIGHT_SERVER_PORT ?? 61000);
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://${serverHost}:${serverPort}`;
const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL;

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  outputDir: "test-results/playwright",
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(browserChannel ? { channel: browserChannel } : {}),
      },
    },
    // docs/010 Phase 2 (the cross-browser foundation gate) adds the webkit and
    // firefox projects. They run only the engine specs — the legacy
    // chromium-tuned editor perf specs (G2) stay chromium-only. The browser
    // binaries must be provisioned with `pnpm exec playwright install webkit
    // firefox` (and, on Linux, the host libraries via
    // `pnpm exec playwright install-deps`); see tests/e2e/engine-input.spec.ts.
    {
      name: "webkit",
      testMatch: /engine-.*\.spec\.ts/,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "firefox",
      testMatch: /engine-.*\.spec\.ts/,
      use: { ...devices["Desktop Firefox"] },
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
    command: `pnpm exec ladle serve --host ${serverHost} --port ${serverPort} --noWatch`,
    reuseExistingServer: true,
    timeout: 120_000,
    url: baseURL,
  },
});
