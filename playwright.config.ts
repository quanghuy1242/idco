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
