import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

type PerfMetrics = {
  readonly average: number;
  readonly max: number;
  readonly p50: number;
  readonly p95: number;
  readonly samples: number;
};

type PerfAction = "backspace" | "insert-text";

type EditorPerfTaskSnapshot = {
  readonly averageMs: number;
  readonly budgetMs: number;
  readonly coalescedUpdates: number;
  readonly continuedRuns: number;
  readonly droppedUpdates: number;
  readonly label: string;
  readonly lane: string;
  readonly maxMs: number;
  readonly overBudgetRuns: number;
  readonly priority: number;
  readonly runs: number;
};

type EditorPerfSnapshot = {
  readonly coalescedUpdates: number;
  readonly droppedUpdates: number;
  readonly frameBudgetMs: number;
  readonly generatedAt: string;
  readonly idleBudgetMs: number;
  readonly overBudgetRuns: number;
  readonly pendingTasks: number;
  readonly runs: number;
  readonly tasks: readonly EditorPerfTaskSnapshot[];
};

type EditorPerfReport = {
  readonly baseline: PerfMetrics;
  readonly ci: {
    readonly commit: string | null;
    readonly ref: string | null;
    readonly runId: string | null;
  };
  readonly editor: PerfMetrics;
  readonly recordedAt: string;
  readonly scenario: string;
  readonly scheduler: EditorPerfSnapshot;
};

type EditorPerfScenario = {
  readonly name: string;
  readonly story: string;
  readonly action: PerfAction;
  readonly samples: number;
  readonly prepare: (page: Page) => Promise<void>;
  readonly p50HeadroomMs?: number;
};

const FULL_EDITOR_STORY = "packages-editor--rich-text-editor--full-editor";
const SIDE_TOC_STORY =
  "packages-editor--rich-text-editor--side-table-of-contents";

const scenarios: readonly EditorPerfScenario[] = [
  {
    action: "backspace",
    name: "full editor held Backspace",
    prepare: (page) => prepareEditorEnd(page, "Book section"),
    samples: 120,
    story: FULL_EDITOR_STORY,
  },
  {
    action: "insert-text",
    name: "full editor rapid text insertion",
    prepare: (page) => prepareEditorEnd(page, "Book section"),
    samples: 100,
    story: FULL_EDITOR_STORY,
  },
  {
    action: "backspace",
    name: "side TOC held Backspace",
    prepare: (page) => prepareEditorEnd(page, "Book section"),
    samples: 100,
    story: SIDE_TOC_STORY,
  },
  {
    action: "insert-text",
    name: "side TOC rapid text insertion",
    prepare: (page) => prepareEditorEnd(page, "Book section"),
    samples: 90,
    story: SIDE_TOC_STORY,
  },
  {
    action: "insert-text",
    name: "table cell rapid text insertion",
    prepare: prepareTableCell,
    samples: 90,
    story: FULL_EDITOR_STORY,
  },
];

test.use({ trace: "off" });

for (const scenario of scenarios) {
  test(`rich text editor performance: ${scenario.name}`, async ({
    page,
  }, testInfo) => {
    const slowWarnings: string[] = [];
    page.on("console", (message) => {
      if (
        message.type() === "warning" &&
        message.text().includes("[idco-editor] slow update listener")
      ) {
        slowWarnings.push(message.text());
      }
    });

    const baseline = await measurePlainContentEditable(
      page,
      scenario.action,
      Math.min(80, scenario.samples),
    );

    await page.goto(`/?story=${scenario.story}`);
    await scenario.prepare(page);
    await resetEditorPerfDashboard(page);
    slowWarnings.length = 0;

    const editor = await measureInteraction(
      page,
      scenario.action,
      scenario.samples,
    );
    await page.waitForTimeout(250);
    const scheduler = await readEditorPerfDashboard(page);
    expect(
      scheduler,
      "editor perf dashboard should be installed",
    ).not.toBeNull();
    const report = createEditorPerfReport({
      baseline,
      editor,
      scenario: scenario.name,
      scheduler,
    });
    await writeEditorPerfReport(report, testInfo);
    console.log(
      `editor perf metrics: ${JSON.stringify({
        baseline,
        editor,
        scenario: scenario.name,
        scheduler: {
          coalescedUpdates: scheduler.coalescedUpdates,
          overBudgetRuns: scheduler.overBudgetRuns,
          tasks: scheduler.tasks.map((task) => ({
            coalescedUpdates: task.coalescedUpdates,
            label: task.label,
            lane: task.lane,
            maxMs: task.maxMs,
            overBudgetRuns: task.overBudgetRuns,
            runs: task.runs,
          })),
        },
      })}`,
    );

    expect(editor.samples).toBe(scenario.samples);
    expect(editor.p50).toBeLessThan(
      baseline.p50 +
        (scenario.p50HeadroomMs ??
          Number(process.env.EDITOR_PERF_P50_HEADROOM_MS ?? 12)),
    );
    expect(editor.p95).toBeLessThan(
      Number(process.env.EDITOR_PERF_P95_BUDGET_MS ?? 120),
    );
    expect(
      scheduler.overBudgetRuns,
      schedulerBudgetMessage(scheduler),
    ).toBeLessThanOrEqual(
      Number(process.env.EDITOR_PERF_MAX_OVER_BUDGET_RUNS ?? 0),
    );
    expect(slowWarnings, slowWarnings.join("\n")).toHaveLength(0);
  });
}

async function resetEditorPerfDashboard(page: Page): Promise<void> {
  await page.evaluate(() => {
    window["__IDCO_EDITOR_PERF__"]?.reset();
  });
}

async function readEditorPerfDashboard(
  page: Page,
): Promise<EditorPerfSnapshot> {
  return page.evaluate(() => {
    const snapshot = window["__IDCO_EDITOR_PERF__"]?.snapshot();
    if (!snapshot) {
      throw new Error("Missing window editor perf dashboard");
    }
    return snapshot;
  });
}

function createEditorPerfReport({
  baseline,
  editor,
  scenario,
  scheduler,
}: {
  readonly baseline: PerfMetrics;
  readonly editor: PerfMetrics;
  readonly scenario: string;
  readonly scheduler: EditorPerfSnapshot;
}): EditorPerfReport {
  return {
    baseline,
    ci: {
      commit: process.env.GITHUB_SHA ?? null,
      ref: process.env.GITHUB_REF_NAME ?? process.env.GITHUB_REF ?? null,
      runId: process.env.GITHUB_RUN_ID ?? null,
    },
    editor,
    recordedAt: new Date().toISOString(),
    scenario,
    scheduler,
  };
}

async function writeEditorPerfReport(
  report: EditorPerfReport,
  testInfo: TestInfo,
): Promise<void> {
  const reportDir =
    process.env.EDITOR_PERF_REPORT_DIR ??
    join(process.cwd(), "test-results", "editor-perf");
  await mkdir(reportDir, { recursive: true });
  const reportJson = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(
    join(reportDir, `${slugifyReportName(report.scenario)}.json`),
    reportJson,
  );
  await appendFile(
    join(reportDir, "history.ndjson"),
    `${JSON.stringify(report)}\n`,
  );
  const testReportPath = testInfo.outputPath("editor-perf-report.json");
  await mkdir(dirname(testReportPath), { recursive: true });
  await writeFile(testReportPath, reportJson);
}

function schedulerBudgetMessage(snapshot: EditorPerfSnapshot): string {
  return JSON.stringify(
    snapshot.tasks
      .filter((task) => task.overBudgetRuns > 0)
      .map((task) => ({
        budgetMs: task.budgetMs,
        label: task.label,
        lane: task.lane,
        maxMs: task.maxMs,
        overBudgetRuns: task.overBudgetRuns,
        runs: task.runs,
      })),
    null,
    2,
  );
}

function slugifyReportName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function prepareEditorEnd(
  page: Page,
  label: string,
  seed = "abcdefghijklmnopqrstuvwxyz".repeat(25),
): Promise<void> {
  const editable = page.getByRole("textbox", { exact: true, name: label });
  await expect(editable).toBeVisible();
  await editable.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(seed);
}

async function prepareTableCell(page: Page): Promise<void> {
  const editable = page.getByRole("textbox", {
    exact: true,
    name: "Book section",
  });
  await expect(editable).toBeVisible();
  await editable.getByText("Live", { exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("abcdefghijklmnopqrstuvwxyz".repeat(10));
}

async function measurePlainContentEditable(
  page: Page,
  action: PerfAction,
  count: number,
): Promise<PerfMetrics> {
  await page.setContent(
    `<div role="textbox" aria-label="Plain" contenteditable="true">${"abcdefghijklmnopqrstuvwxyz".repeat(20)}</div>`,
  );
  await page.getByRole("textbox", { name: "Plain" }).click();
  await page.keyboard.press("Control+End");
  return measureInteraction(page, action, count);
}

async function measureInteraction(
  page: Page,
  action: PerfAction,
  count: number,
): Promise<PerfMetrics> {
  const samples: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const startedAt = await page.evaluate(() => performance.now());
    await runAction(page, action);
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
    average:
      samples.reduce((total, sample) => total + sample, 0) / samples.length,
    max: Math.max(...samples),
    p50: percentile(0.5),
    p95: percentile(0.95),
    samples: samples.length,
  };
}

async function runAction(page: Page, action: PerfAction): Promise<void> {
  if (action === "backspace") {
    await page.keyboard.press("Backspace");
    return;
  }
  await page.keyboard.insertText("x");
}
