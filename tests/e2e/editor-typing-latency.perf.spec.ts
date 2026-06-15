import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * FINDINGS ONLY — no assertions that gate behavior. This measures typing
 * latency in a decorator-heavy document and compares it against the small
 * "full editor" control, the way the user feels lag when holding Backspace.
 *
 * It records three things per scenario so we can see WHERE the cost is:
 *   1. per-keystroke latency (wall clock across 2 rAF, same method as
 *      editor-backspace.perf.spec.ts),
 *   2. main-thread blocking during the burst (PerformanceObserver longtasks),
 *   3. the editor scheduler dashboard, to attribute cost to named tasks.
 *
 * The point is to show whether Phase 0 decorator virtualization changes typing
 * latency at all (hypothesis: it does not, because the per-keystroke cost is
 * Lexical element-node reconciliation + giant contenteditable layout, not
 * decorator React bodies).
 */

type PerfMetrics = {
  readonly average: number;
  readonly max: number;
  readonly p50: number;
  readonly p95: number;
  readonly samples: number;
};

type BlockingMetrics = {
  readonly longTasks: number;
  readonly totalBlockingMs: number;
  readonly longestTaskMs: number;
};

type SchedulerTask = {
  readonly label: string;
  readonly lane: string;
  readonly maxMs: number;
  readonly runs: number;
  readonly overBudgetRuns: number;
};

type BurstMetrics = {
  readonly deliverMs: number;
  readonly longTasks: number;
  readonly totalBlockingMs: number;
  readonly longestTaskMs: number;
};

type ScenarioResult = {
  readonly name: string;
  readonly story: string;
  readonly decoratorBodies: number;
  readonly domNodes: number;
  readonly backspace: PerfMetrics;
  readonly backspaceBlocking: BlockingMetrics;
  readonly burst: BurstMetrics;
  readonly topTasks: readonly SchedulerTask[];
};

type Scenario = {
  readonly name: string;
  readonly story: string;
  readonly caretAnchor: string;
};

const SEED = "abcdefghijklmnopqrstuvwxyz".repeat(25);
const BACKSPACE_SAMPLES = 120; // ~5s of held Backspace at ~24/s
const BURST_KEYS = 120; // back-to-back, no frame wait — simulates key-repeat backlog

const scenarios: readonly Scenario[] = [
  {
    name: "small full editor (control)",
    story: "packages-editor--rich-text-editor--full-editor",
    caretAnchor: "Body text with",
  },
  {
    name: "decorator-heavy standard",
    story: "packages-editor--rich-text-editor--decorator-heavy-standard",
    caretAnchor: "Prose ahead of the widgets in section 1",
  },
  {
    name: "decorator-heavy virtualized (Phase 0)",
    story: "packages-editor--rich-text-editor--decorator-heavy-virtualized",
    caretAnchor: "Prose ahead of the widgets in section 1",
  },
  {
    // Realistic case: type mid-document. Clicking this paragraph auto-scrolls
    // it into view, mounting the decorator bodies around the caret — the
    // "where the user actually is" scenario, not the cheap top of the doc.
    name: "decorator-heavy virtualized — mid-document",
    story: "packages-editor--rich-text-editor--decorator-heavy-virtualized",
    caretAnchor: "Prose ahead of the widgets in section 65",
  },
];

test.use({ trace: "off" });

test("typing latency findings: small vs decorator-heavy (standard/virtualized)", async ({
  page,
}, testInfo) => {
  // The standard heavy scenario can spend ~0.5s per keystroke, so the four
  // bursts together far exceed the default 60s per-test budget.
  test.setTimeout(360_000);
  const plainBaseline = await measurePlainBaseline(page);
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    results.push(await measureScenario(page, scenario));
  }

  const report = {
    recordedAt: new Date().toISOString(),
    note: "Findings only. Per-keystroke latency has a ~2-rAF floor; the plain-contenteditable baseline shows that floor. The signal is the delta above it and the blocking-time / scheduler rows.",
    plainContentEditableBaseline: plainBaseline,
    scenarios: results,
  };
  await writeReport(report, testInfo);
  console.log(
    `typing latency findings:\n${formatTable(plainBaseline, results)}`,
  );
  console.log(`scheduler attribution:\n${formatScheduler(results)}`);

  // Findings only: assert we actually collected the samples, nothing about speed.
  for (const result of results) {
    expect(result.backspace.samples).toBe(BACKSPACE_SAMPLES);
  }
});

async function measureScenario(
  page: Page,
  scenario: Scenario,
): Promise<ScenarioResult> {
  await page.goto(`/?story=${scenario.story}`, { waitUntil: "commit" });
  const editable = page.getByRole("textbox", {
    exact: true,
    name: "Book section",
  });
  await expect(editable).toBeVisible();
  // Let virtualization/initial mount settle before we touch the editor.
  await settle(page);
  const { decoratorBodies, domNodes } = await readDomStats(page);

  // Place the caret in a real text paragraph and seed it so held Backspace has
  // local content to delete (isolating per-keystroke reconcile cost).
  await editable
    .getByText(scenario.caretAnchor, { exact: false })
    .first()
    .click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(SEED);

  await resetDashboard(page);
  await startBlockingObserver(page);
  const backspace = await measureInteraction(
    page,
    "backspace",
    BACKSPACE_SAMPLES,
  );
  const backspaceBlocking = await readBlocking(page);

  // Re-seed, then fire Backspace back-to-back with NO frame wait — this builds
  // the input backlog that real OS key-repeat creates and that the paced
  // measurement above deliberately avoids. `deliverMs` is the wall time to push
  // all keys through; on a blocked main thread the protocol acks stall and it
  // balloons far past the smooth floor.
  await page.keyboard.insertText(SEED);
  const burst = await measureBurst(page, BURST_KEYS);

  await page.waitForTimeout(250);
  const topTasks = await readTopTasks(page);

  return {
    name: scenario.name,
    story: scenario.story,
    decoratorBodies,
    domNodes,
    backspace,
    backspaceBlocking,
    burst,
    topTasks,
  };
}

async function measureBurst(page: Page, count: number): Promise<BurstMetrics> {
  await startBlockingObserver(page);
  const startedAt = await page.evaluate(() => performance.now());
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press("Backspace");
  }
  const deliverMs = await page.evaluate(
    (start) => performance.now() - start,
    startedAt,
  );
  // Let any queued main-thread work drain so blocking is fully captured.
  await page.waitForTimeout(500);
  const blocking = await readBlocking(page);
  return {
    deliverMs: round(deliverMs),
    longTasks: blocking.longTasks,
    totalBlockingMs: blocking.totalBlockingMs,
    longestTaskMs: blocking.longestTaskMs,
  };
}

async function measurePlainBaseline(page: Page): Promise<PerfMetrics> {
  await page.setContent(
    `<div role="textbox" aria-label="Plain" contenteditable="true">${SEED}</div>`,
  );
  await page.getByRole("textbox", { name: "Plain" }).click();
  await page.keyboard.press("Control+End");
  return measureInteraction(page, "backspace", 80);
}

async function readDomStats(page: Page) {
  return page.evaluate(() => ({
    decoratorBodies: document.querySelectorAll("[data-decorator-body]").length,
    domNodes: document.querySelectorAll("*").length,
  }));
}

async function startBlockingObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as unknown as {
      idcoLongTasks: number[];
      idcoLtObserver?: PerformanceObserver;
    };
    target.idcoLongTasks = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        target.idcoLongTasks.push(entry.duration);
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
    target.idcoLtObserver = observer;
  });
}

async function readBlocking(page: Page): Promise<BlockingMetrics> {
  const durations = await page.evaluate(() => {
    const target = window as unknown as {
      idcoLongTasks?: number[];
      idcoLtObserver?: PerformanceObserver;
    };
    target.idcoLtObserver?.disconnect();
    return target.idcoLongTasks ?? [];
  });
  return {
    longTasks: durations.length,
    // Total Blocking Time: each long task blocks for its duration beyond 50ms.
    totalBlockingMs: Number(
      durations
        .reduce((total, ms) => total + Math.max(0, ms - 50), 0)
        .toFixed(1),
    ),
    longestTaskMs: Number(
      (durations.length ? Math.max(...durations) : 0).toFixed(1),
    ),
  };
}

async function resetDashboard(page: Page): Promise<void> {
  await page.evaluate(() => {
    window["__IDCO_EDITOR_PERF__"]?.reset();
  });
}

async function readTopTasks(page: Page): Promise<readonly SchedulerTask[]> {
  return page.evaluate(() => {
    const snapshot = window["__IDCO_EDITOR_PERF__"]?.snapshot();
    if (!snapshot) return [];
    return [...snapshot.tasks]
      .sort((left, right) => right.maxMs - left.maxMs)
      .slice(0, 5)
      .map((task) => ({
        label: task.label,
        lane: task.lane,
        maxMs: task.maxMs,
        runs: task.runs,
        overBudgetRuns: task.overBudgetRuns,
      }));
  });
}

async function measureInteraction(
  page: Page,
  action: "backspace" | "insert-text",
  count: number,
): Promise<PerfMetrics> {
  const samples: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const startedAt = await page.evaluate(() => performance.now());
    if (action === "backspace") {
      await page.keyboard.press("Backspace");
    } else {
      await page.keyboard.insertText("x");
    }
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    const duration = await page.evaluate(
      (start) => performance.now() - start,
      startedAt,
    );
    samples.push(duration);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  return {
    average: round(
      samples.reduce((total, sample) => total + sample, 0) / samples.length,
    ),
    max: round(Math.max(...samples)),
    p50: round(percentile(0.5)),
    p95: round(percentile(0.95)),
    samples: samples.length,
  };
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => setTimeout(resolve, 250)),
        );
      }),
  );
}

function round(value: number): number {
  return Number(value.toFixed(1));
}

function formatTable(
  baseline: PerfMetrics,
  results: readonly ScenarioResult[],
): string {
  const header = [
    "scenario",
    "decoBodies",
    "domNodes",
    "paced p50",
    "paced p95",
    "paced max",
    "paced blockMs",
    "burst deliverMs",
    "burst blockMs",
    "burst longTasks",
  ];
  const rows = [
    header,
    [
      "plain contenteditable (floor)",
      "—",
      "—",
      String(baseline.p50),
      String(baseline.p95),
      String(baseline.max),
      "—",
      "—",
      "—",
      "—",
    ],
    ...results.map((result) => [
      result.name,
      String(result.decoratorBodies),
      String(result.domNodes),
      String(result.backspace.p50),
      String(result.backspace.p95),
      String(result.backspace.max),
      String(result.backspaceBlocking.totalBlockingMs),
      String(result.burst.deliverMs),
      String(result.burst.totalBlockingMs),
      String(result.burst.longTasks),
    ]),
  ];
  const widths = header.map((_, col) =>
    Math.max(...rows.map((row) => row[col].length)),
  );
  return rows
    .map((row) => row.map((cell, col) => cell.padEnd(widths[col])).join(" | "))
    .join("\n");
}

function formatScheduler(results: readonly ScenarioResult[]): string {
  return results
    .map((result) => {
      const lines = result.topTasks
        .map(
          (task) =>
            `    ${task.label} [${task.lane}] maxMs=${task.maxMs} runs=${task.runs} overBudget=${task.overBudgetRuns}`,
        )
        .join("\n");
      return `  ${result.name}:\n${lines}`;
    })
    .join("\n");
}

async function writeReport(report: unknown, testInfo: TestInfo): Promise<void> {
  const reportDir =
    process.env.EDITOR_PERF_REPORT_DIR ??
    join(process.cwd(), "test-results", "editor-perf");
  await mkdir(reportDir, { recursive: true });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(join(reportDir, "typing-latency.json"), json);
  await writeFile(testInfo.outputPath("typing-latency.json"), json);
}
