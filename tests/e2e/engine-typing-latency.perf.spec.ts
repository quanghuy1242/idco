import { expect, test, type Page } from "@playwright/test";

const STORY = "engine--owned-model--phase4300-blocks";
const API_KEY = "__IDCO_ENGINE_VIEW_API__";
const PERF_DASHBOARD_KEY = "__IDCO_EDITOR_PERF__";
const TYPE_SAMPLES = 48;

type EngineDiagnostics = {
  readonly activeNodeId: string | null;
  readonly blockTexts: Record<string, string>;
  readonly mountedCount: number;
  readonly order: string[];
  readonly renderCounts: Record<string, number>;
  readonly scheduler: {
    readonly overBudgetRuns: number;
    readonly tasks: Array<{
      readonly label: string;
      readonly lane: string;
      readonly maxMs: number;
      readonly overBudgetRuns: number;
      readonly runs: number;
    }>;
  };
  readonly selectionOverlayRenderCount: number;
  readonly selectionRectCount: number;
};

type EngineApi = {
  readonly diagnostics: () => EngineDiagnostics;
  readonly focusBlock: (id: string) => void;
  readonly selectText: (
    anchorNode: string,
    anchorOffset: number,
    focusNode: string,
    focusOffset: number,
  ) => void;
};

test.use({ trace: "off" });

test("owned-model React view edits 300 mounted blocks with continuous selection", async ({
  page,
}) => {
  await openEngineStory(page);
  const before = await diagnostics(page);
  expect(before.mountedCount).toBe(300);
  const first = before.order[0]!;
  const target = before.order[150]!;
  const next = before.order[151]!;
  const last = before.order.at(-1)!;

  await callEngine(page, "focusBlock", [target]);
  await page.keyboard.type("!");
  await expect
    .poll(async () => (await diagnostics(page)).blockTexts[target])
    .toContain("!");

  const afterType = await diagnostics(page);
  expect(afterType.renderCounts[first]).toBe(before.renderCounts[first]);
  expect(afterType.renderCounts[target]).toBeGreaterThan(
    before.renderCounts[target] ?? 0,
  );
  expect(afterType.selectionOverlayRenderCount).toBeGreaterThan(
    before.selectionOverlayRenderCount,
  );

  await callEngine(page, "selectText", [
    first,
    0,
    last,
    Math.min(12, afterType.blockTexts[last]!.length),
  ]);
  await expect
    .poll(async () => (await diagnostics(page)).selectionRectCount)
    .toBeGreaterThan(2);

  await callEngine(page, "selectText", [
    target,
    afterType.blockTexts[target]!.length,
    target,
    afterType.blockTexts[target]!.length,
  ]);
  await callEngine(page, "focusBlock", [target]);
  await page.keyboard.press("ArrowDown");
  await expect
    .poll(async () => (await diagnostics(page)).activeNodeId)
    .toBe(next);
});

test("owned-model typing latency stays in budget and reports engine frame metrics", async ({
  page,
}) => {
  await openEngineStory(page);
  const initial = await diagnostics(page);
  const target = initial.order[120]!;
  await callEngine(page, "selectText", [
    target,
    initial.blockTexts[target]!.length,
    target,
    initial.blockTexts[target]!.length,
  ]);
  await callEngine(page, "focusBlock", [target]);
  await page.evaluate((dashboardKey) => {
    (
      window as unknown as Record<
        string,
        { readonly reset?: () => void } | undefined
      >
    )[dashboardKey]?.reset?.();
  }, PERF_DASHBOARD_KEY);

  const samples: number[] = [];
  for (let index = 0; index < TYPE_SAMPLES; index += 1) {
    const startedAt = await page.evaluate(() => performance.now());
    await page.keyboard.type("x");
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    samples.push(
      await page.evaluate((start) => performance.now() - start, startedAt),
    );
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const diag = await diagnostics(page);
  const overlayTask = diag.scheduler.tasks.find(
    (task) => task.label === "engine-selection-overlay",
  );

  expect(diag.blockTexts[target]).toContain("x".repeat(TYPE_SAMPLES));
  expect(p95).toBeLessThan(120);
  expect(overlayTask).toMatchObject({
    label: "engine-selection-overlay",
    lane: "frame",
    overBudgetRuns: 0,
  });
  expect(diag.scheduler.overBudgetRuns).toBe(0);
});

async function openEngineStory(page: Page): Promise<void> {
  await page.goto(`/?story=${STORY}`, { waitUntil: "commit" });
  await page.locator("[data-engine-view-root]").waitFor({ state: "visible" });
  await expect
    .poll(async () => (await diagnostics(page)).mountedCount)
    .toBe(300);
}

async function diagnostics(page: Page): Promise<EngineDiagnostics> {
  return page.evaluate((apiKey) => {
    const api = (window as unknown as Record<string, EngineApi | undefined>)[
      apiKey
    ];
    if (!api) throw new Error("owned-model engine view API missing");
    return api.diagnostics();
  }, API_KEY);
}

async function callEngine(
  page: Page,
  method: keyof Omit<EngineApi, "diagnostics">,
  args: readonly unknown[],
): Promise<void> {
  await page.evaluate(
    ({ apiKey, apiMethod, apiArgs }) => {
      const api = (window as unknown as Record<string, EngineApi | undefined>)[
        apiKey
      ];
      if (!api) throw new Error("owned-model engine view API missing");
      (api[apiMethod] as (...innerArgs: unknown[]) => void)(...apiArgs);
    },
    { apiArgs: args, apiKey: API_KEY, apiMethod: method },
  );
}
