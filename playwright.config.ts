import os from "node:os";
import { defineConfig, devices } from "@playwright/test";

const serverHost = process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1";
const serverPort = Number(process.env.PLAYWRIGHT_SERVER_PORT ?? 61000);
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://${serverHost}:${serverPort}`;
const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL;

// Each browser worker needs ~1.8 GiB of headroom. Playwright's default
// (half the cores) ignores RAM, so on a many-core / low-RAM host like WSL
// (16 cores but a ~6 GiB cap) it spawns 8 workers that swap-thrash, which is
// both slow and makes the load-sensitive `.perf` specs miss their budgets.
// Cap workers by whichever of cores/RAM is the tighter bound. Override with
// PLAYWRIGHT_WORKERS or the `--workers` CLI flag (which wins over this).
const workers =
  process.env.PLAYWRIGHT_WORKERS !== undefined
    ? Number(process.env.PLAYWRIGHT_WORKERS)
    : Math.max(
        1,
        Math.min(
          Math.floor(os.cpus().length / 2),
          Math.floor(os.totalmem() / 1024 ** 3 / 1.8),
        ),
      );

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  outputDir: "test-results/playwright",
  workers,
  projects: [
    {
      name: "chromium",
      // The mobile-touch spec needs a touch-enabled device; it runs only on the
      // mobile project below (docs/010 Phase 7 AC2). The `.perf` budget specs are
      // load-sensitive, so they run on the dedicated `chromium-perf` project
      // (serially, via `pnpm test:e2e:perf`) instead of under parallel load here.
      testIgnore: [/engine-mobile\.spec\.ts/, /\.perf\.spec\.ts/],
      use: {
        ...devices["Desktop Chrome"],
        ...(browserChannel ? { channel: browserChannel } : {}),
      },
    },
    // The `.perf` specs are timing-budget assertions tuned on Chromium. They
    // must run free of contention or the numbers are noise, so they live on
    // their own project and `pnpm test:e2e:perf` runs it with `--workers=1`.
    // This mirrors CI, where the `editor-perf` job runs the perf specs in
    // isolation on a dedicated runner.
    {
      name: "chromium-perf",
      testMatch: /\.perf\.spec\.ts/,
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
    // webkit/firefox run the engine correctness specs only. The `.perf` specs
    // are budget assertions tuned on Chromium and are load-sensitive, so they
    // stay chromium-only (running them across browsers under parallel load only
    // produces flaky timing numbers, not signal); the mobile spec runs on its
    // own touch project.
    {
      name: "webkit",
      testIgnore: [/engine-mobile\.spec\.ts/, /\.perf\.spec\.ts/],
      testMatch: /engine-.*\.spec\.ts/,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "firefox",
      testIgnore: [/engine-mobile\.spec\.ts/, /\.perf\.spec\.ts/],
      testMatch: /engine-.*\.spec\.ts/,
      use: { ...devices["Desktop Firefox"] },
    },
    // docs/010 Phase 7 AC2 — mobile (WebKit emulation, touch + on-screen
    // keyboard). The owned surface uses the EditContext polyfill on mobile; there
    // is no native-contenteditable platform fork (docs/010 §5.8/§6.6 decision).
    {
      name: "mobile-webkit",
      testMatch: /engine-mobile\.spec\.ts/,
      use: { ...devices["iPhone 13"] },
    },
    // A touch-enabled Chromium device for the touch-gesture specs (AC8 long-press
    // / grip drag / selection toolbar). WebKit cannot construct synthetic
    // `Touch`/`TouchEvent` objects ("Illegal constructor"), so the gesture tests
    // that dispatch a real touch sequence run here; the model behaviour is
    // identical (the engine forces the EditContext polyfill on every browser).
    {
      name: "mobile-chromium",
      testMatch: /engine-mobile\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
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
