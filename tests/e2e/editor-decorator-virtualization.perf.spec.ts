import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * docs/009 §6.1.1 — Phase 0 benchmark. Compares a decorator-heavy document
 * rendered with decorator-body virtualization off vs on, in the same single
 * Lexical root. The headline numbers are how many decorator bodies stay mounted
 * and the resulting DOM weight; we also record time-to-ready. Virtualization
 * must bound the mounted bodies while leaving selection/undo/JSON untouched.
 */

const STANDARD_STORY =
  "packages-editor--rich-text-editor--decorator-heavy-standard";
const VIRTUALIZED_STORY =
  "packages-editor--rich-text-editor--decorator-heavy-virtualized";
const SECTION_SHELL_STORY =
  "packages-editor--rich-text-editor--decorator-heavy-section-shell";

type StoryMetrics = {
  readonly mountedBodies: number;
  readonly placeholders: number;
  readonly reportedMounted: number;
  readonly reportedTotal: number;
  readonly domNodes: number;
  readonly readyMs: number;
  readonly peakMountedDuringScroll: number;
};

type SectionShellMetrics = {
  readonly blockCount: number;
  readonly domNodes: number;
  readonly measuredHeightCount: number;
  readonly readyMs: number;
  readonly renderedSectionCount: number;
  readonly sectionCount: number;
  readonly totalHeight: number;
};

test.use({ trace: "off" });

test("decorator virtualization: bounded mounted bodies and DOM weight", async ({
  page,
}, testInfo) => {
  const standard = await measureStory(page, STANDARD_STORY);
  const virtualized = await measureStory(page, VIRTUALIZED_STORY);
  const sectionShell = await measureSectionShellStory(
    page,
    SECTION_SHELL_STORY,
  );

  const report = {
    recordedAt: new Date().toISOString(),
    ci: {
      commit: process.env.GITHUB_SHA ?? null,
      ref: process.env.GITHUB_REF_NAME ?? process.env.GITHUB_REF ?? null,
      runId: process.env.GITHUB_RUN_ID ?? null,
    },
    standard,
    sectionShell,
    virtualized,
    deltas: {
      mountedBodiesReductionPct: reductionPct(
        standard.mountedBodies,
        virtualized.mountedBodies,
      ),
      domNodeReductionPct: reductionPct(
        standard.domNodes,
        virtualized.domNodes,
      ),
      readyMsReductionPct: reductionPct(standard.readyMs, virtualized.readyMs),
      sectionShellDomNodeReductionPct: reductionPct(
        standard.domNodes,
        sectionShell.domNodes,
      ),
      sectionShellReadyMsReductionPct: reductionPct(
        standard.readyMs,
        sectionShell.readyMs,
      ),
    },
  };
  await writeReport(report, testInfo);
  console.log(`decorator virtualization benchmark:\n${formatTable(report)}`);

  // The standard story really does mount every decorator body.
  expect(standard.mountedBodies).toBeGreaterThan(200);
  expect(standard.placeholders).toBe(0);

  // Virtualization bounds the mounted bodies to roughly viewport + overscan,
  // far below the full set, and reserves the rest as placeholders.
  expect(virtualized.placeholders).toBeGreaterThan(0);
  expect(virtualized.mountedBodies).toBeLessThan(standard.mountedBodies * 0.5);
  expect(virtualized.reportedTotal).toBe(standard.reportedTotal);

  // DOM weight drops because the offscreen code editors / callouts are gone.
  expect(virtualized.domNodes).toBeLessThan(standard.domNodes);

  // Scrolling the whole document mounts more bodies than the resting top view
  // (proving the scroll actually exercised promotion), but the peak stays well
  // bounded below the full set — it never approaches "everything mounted".
  expect(virtualized.peakMountedDuringScroll).toBeGreaterThan(
    virtualized.mountedBodies,
  );
  expect(virtualized.peakMountedDuringScroll).toBeLessThan(
    standard.mountedBodies * 0.5,
  );

  expect(sectionShell.blockCount).toBe(521);
  expect(sectionShell.renderedSectionCount).toBeLessThan(
    sectionShell.sectionCount,
  );
  expect(sectionShell.domNodes).toBeLessThan(standard.domNodes);
});

async function measureStory(page: Page, story: string): Promise<StoryMetrics> {
  const startedAt = Date.now();
  await page.goto(`/?story=${story}`, { waitUntil: "commit" });
  const editable = page.getByRole("textbox", {
    exact: true,
    name: "Book section",
  });
  await expect(editable).toBeVisible();
  // Wait for the first decorator markers to exist so "ready" includes the
  // initial decorator-body mount the user actually waits on.
  await page
    .locator("[data-decorator-body], [data-decorator-placeholder]")
    .first()
    .waitFor({ state: "attached" });
  const readyMs = Date.now() - startedAt;

  // Let the IntersectionObserver settle the initial visible/placeholder split.
  await settle(page);
  const initial = await readCounts(page);

  // Step the real scroll container through the whole document and sample the
  // highest mounted-body count seen. This is the number that proves the mounted
  // set stays bounded rather than accumulating as the user reads.
  const peakMountedDuringScroll = await scrollAndSamplePeak(page);

  return {
    mountedBodies: initial.mountedBodies,
    placeholders: initial.placeholders,
    reportedMounted: initial.reportedMounted,
    reportedTotal: initial.reportedTotal,
    domNodes: initial.domNodes,
    readyMs,
    peakMountedDuringScroll,
  };
}

async function measureSectionShellStory(
  page: Page,
  story: string,
): Promise<SectionShellMetrics> {
  const startedAt = Date.now();
  await page.goto(`/?story=${story}`, { waitUntil: "commit" });
  await page
    .locator("[data-large-document-shell]")
    .waitFor({ state: "visible" });
  await expect
    .poll(() =>
      page.evaluate(() => window["__IDCO_LARGE_DOC__"]?.sectionCount ?? 0),
    )
    .toBeGreaterThan(0);
  await settle(page);
  const readyMs = Date.now() - startedAt;
  const snapshot = await page.evaluate(() => {
    const value = window["__IDCO_LARGE_DOC__"];
    if (!value) throw new Error("Missing large-document diagnostics");
    return value;
  });
  return {
    ...snapshot,
    domNodes: await page.locator("*").count(),
    readyMs,
  };
}

async function readCounts(page: Page) {
  return page.evaluate(() => {
    const reported = (
      window as {
        __IDCO_DECORATOR_VIRT__?: {
          mountedBodies: number;
          totalBodies: number;
        };
      }
    )["__IDCO_DECORATOR_VIRT__"];
    return {
      mountedBodies: document.querySelectorAll("[data-decorator-body]").length,
      placeholders: document.querySelectorAll("[data-decorator-placeholder]")
        .length,
      reportedMounted: reported?.mountedBodies ?? 0,
      reportedTotal: reported?.totalBodies ?? 0,
      domNodes: document.querySelectorAll("*").length,
    };
  });
}

async function scrollAndSamplePeak(page: Page): Promise<number> {
  return page.evaluate(async () => {
    // The editor lives in an inner overflow container (e.g. Ladle's main), so
    // the window does not scroll — walk up from a decorator marker to the real
    // scrollable ancestor.
    const marker = document.querySelector(
      "[data-decorator-body], [data-decorator-placeholder]",
    );
    let scroller =
      (document.scrollingElement as HTMLElement | null) ??
      document.documentElement;
    for (
      let element = marker?.parentElement ?? null;
      element;
      element = element.parentElement
    ) {
      const style = getComputedStyle(element);
      if (
        element.scrollHeight > element.clientHeight + 4 &&
        /(auto|scroll)/.test(style.overflowY)
      ) {
        scroller = element;
        break;
      }
    }

    const distance = scroller.scrollHeight - scroller.clientHeight;
    const steps = 24;
    let peak = 0;
    for (let index = 0; index <= steps; index += 1) {
      scroller.scrollTop = (distance * index) / steps;
      // Let the IntersectionObserver and the resulting React commit settle.
      await new Promise<void>((resolve) => setTimeout(resolve, 120));
      peak = Math.max(
        peak,
        document.querySelectorAll("[data-decorator-body]").length,
      );
    }
    return peak;
  });
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => setTimeout(resolve, 200)),
        );
      }),
  );
}

function reductionPct(before: number, after: number): number {
  if (before <= 0) return 0;
  return Number((((before - after) / before) * 100).toFixed(1));
}

function formatTable(report: {
  sectionShell: SectionShellMetrics;
  standard: StoryMetrics;
  virtualized: StoryMetrics;
  deltas: {
    mountedBodiesReductionPct: number;
    domNodeReductionPct: number;
    readyMsReductionPct: number;
    sectionShellDomNodeReductionPct: number;
    sectionShellReadyMsReductionPct: number;
  };
}): string {
  const rows = [
    ["metric", "standard", "phase 0", "section shell"],
    [
      "mounted decorator bodies",
      String(report.standard.mountedBodies),
      String(report.virtualized.mountedBodies),
      "0",
    ],
    [
      "placeholders",
      String(report.standard.placeholders),
      String(report.virtualized.placeholders),
      "sections",
    ],
    [
      "total DOM nodes",
      String(report.standard.domNodes),
      String(report.virtualized.domNodes),
      String(report.sectionShell.domNodes),
    ],
    [
      "time to ready (ms)",
      String(report.standard.readyMs),
      String(report.virtualized.readyMs),
      String(report.sectionShell.readyMs),
    ],
    [
      "peak mounted during scroll",
      String(report.standard.peakMountedDuringScroll),
      String(report.virtualized.peakMountedDuringScroll),
      "",
    ],
    [
      "rendered sections",
      "n/a",
      "n/a",
      `${report.sectionShell.renderedSectionCount}/${report.sectionShell.sectionCount}`,
    ],
    [
      "DOM reduction",
      "",
      `${report.deltas.domNodeReductionPct}%`,
      `${report.deltas.sectionShellDomNodeReductionPct}%`,
    ],
    [
      "ready reduction",
      "",
      `${report.deltas.readyMsReductionPct}%`,
      `${report.deltas.sectionShellReadyMsReductionPct}%`,
    ],
  ];
  const widths = rows[0].map((_, col) =>
    Math.max(...rows.map((row) => row[col].length)),
  );
  return rows
    .map((row) =>
      row.map((cell, col) => cell.padEnd(widths[col])).join("  |  "),
    )
    .join("\n");
}

async function writeReport(report: unknown, testInfo: TestInfo): Promise<void> {
  const reportDir =
    process.env.EDITOR_PERF_REPORT_DIR ??
    join(process.cwd(), "test-results", "editor-perf");
  await mkdir(reportDir, { recursive: true });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(join(reportDir, "decorator-virtualization.json"), json);
  await writeFile(testInfo.outputPath("decorator-virtualization.json"), json);
}
