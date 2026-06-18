import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * docs/010 Phase 5 — block virtualization, the scale gate.
 *
 * Replaces the deleted `editor-large-document.perf.spec.ts`. It drives the
 * 5,000-block owned-model story and proves the five Phase 5 acceptance
 * criteria: a tiny mounted window (AC1), scroll drift stability (AC2),
 * scroll-to-block landing after measurement (AC3), cross-virtual copy of the
 * full model range (AC4), and a first-paint budget at book scale (AC5).
 */
const STORY = "engine--owned-model--phase55000-blocks";
const API_KEY = "__IDCO_ENGINE_VIEW_API__";
const BLOCK_COUNT = 5000;
const VIEWPORT = 480;
const OVERSCAN = 4;
const FIRST_PAINT_BUDGET_MS = 4000;

type EngineDiagnostics = {
  readonly mountedCount: number;
  readonly order: string[];
  readonly virtualized: boolean;
  readonly windowStart: number;
  readonly windowEnd: number;
  readonly totalHeight: number;
  readonly scrollTop: number;
};

type EngineApi = {
  readonly diagnostics: () => EngineDiagnostics;
  readonly scrollToBlock: (id: string) => void;
  readonly selectText: (
    anchorNode: string,
    anchorOffset: number,
    focusNode: string,
    focusOffset: number,
  ) => void;
  readonly serializeSelection: () => string;
};

test.use({ trace: "off" });

test("mounts only a viewport window for a 5,000-block document (AC1)", async ({
  page,
}) => {
  await openStory(page);
  const diag = await diagnostics(page);
  expect(diag.virtualized).toBe(true);
  expect(diag.order).toHaveLength(BLOCK_COUNT);

  const blocks = page.locator("[data-engine-block-id]");
  const domCount = await blocks.count();
  expect(domCount).toBe(diag.mountedCount);

  const blockHeight = await firstBlockHeight(blocks);
  const visible = Math.ceil(VIEWPORT / blockHeight);
  // +1 covers the block straddling the bottom edge of the viewport.
  expect(domCount).toBeLessThanOrEqual(visible + 2 * OVERSCAN + 1);
  expect(domCount).toBeLessThan(80);
});

test("returns to the start position after a free scroll top to bottom to top (AC2)", async ({
  page,
}) => {
  await openStory(page);
  // Free-scroll the scroller itself (not scroll-to-block, which would force the
  // endpoint): top to the very bottom and back, then assert no drift.
  await setScrollTop(page, 1_000_000); // clamps to the bottom
  await settle(page);
  await setScrollTop(page, 0);
  await settle(page);

  const scrollTop = await scrollerScrollTop(page);
  expect(Math.abs(scrollTop)).toBeLessThanOrEqual(2);
  // The first block must sit back at the top of the viewport: content geometry
  // did not drift across the round trip.
  const order = (await diagnostics(page)).order;
  const topDelta = await blockTopRelativeToScroller(page, order[0]!);
  expect(Number.isNaN(topDelta)).toBe(false);
  expect(Math.abs(topDelta)).toBeLessThanOrEqual(2);
});

test("scroll-to-block lands the target at the viewport top after measurement (AC3)", async ({
  page,
}) => {
  await openStory(page);
  const order = (await diagnostics(page)).order;
  const targetId = order[3200]!;

  await callEngine(page, "scrollToBlock", [targetId]);
  await settle(page);

  const delta = await blockTopRelativeToScroller(page, targetId);
  expect(Number.isNaN(delta)).toBe(false);
  expect(Math.abs(delta)).toBeLessThanOrEqual(2);
});

test.describe("variable-height document", () => {
  const VARIABLE_STORY = "engine--owned-model--phase5-variable-heights";

  async function openVariable(page: Page): Promise<void> {
    await page.goto(`/?story=${VARIABLE_STORY}`, { waitUntil: "commit" });
    await page.locator("[data-engine-view-root]").waitFor({ state: "visible" });
    await expect
      .poll(async () => (await diagnostics(page)).mountedCount)
      .toBeGreaterThan(0);
  }

  test("windows a non-uniform document to a small mounted set (AC1)", async ({
    page,
  }) => {
    await openVariable(page);
    const diag = await diagnostics(page);
    expect(diag.order).toHaveLength(BLOCK_COUNT);
    const domCount = await page.locator("[data-engine-block-id]").count();
    expect(domCount).toBe(diag.mountedCount);
    // Heights vary 1..5 lines, so the exact window count varies, but it must
    // stay a tiny viewport slice, never the whole document.
    expect(domCount).toBeLessThan(80);
  });

  test("scroll-to-block lands a target despite a wrong height estimate (AC3)", async ({
    page,
  }) => {
    await openVariable(page);
    const order = (await diagnostics(page)).order;
    for (const index of [800, 2600, 4700]) {
      await callEngine(page, "scrollToBlock", [order[index]!]);
      await settle(page);
      const delta = await blockTopRelativeToScroller(page, order[index]!);
      expect(Number.isNaN(delta), `block ${index} mounted`).toBe(false);
      expect(Math.abs(delta), `block ${index} aligned`).toBeLessThanOrEqual(2);
    }
  });
});

test("copies the full model range across the offscreen middle (AC4)", async ({
  page,
}) => {
  await openStory(page);
  const order = (await diagnostics(page)).order;
  const startId = order[3]!;
  const endId = order[900]!;

  // Select to past the end of block 900; the offset clamps to its full length.
  await callEngine(page, "selectText", [startId, 0, endId, 9999]);
  const diag = await diagnostics(page);
  // block 900 is far outside the mounted window, so a DOM-bound copy would miss it.
  expect(diag.windowEnd).toBeLessThan(900);

  // Fire a real copy event at the view and read what the handler wrote to the
  // clipboard payload, so the onCopy path (not just serializeSelection) is
  // exercised end to end.
  const copied = await page.evaluate(() => {
    const root = document.querySelector("[data-engine-view-root]");
    if (!root) return "";
    const data = new DataTransfer();
    const event = new ClipboardEvent("copy", {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    root.dispatchEvent(event);
    return data.getData("text/plain");
  });
  const lines = copied.split("\n");
  expect(lines).toHaveLength(898);
  expect(lines[0]).toContain("block 4:");
  expect(copied).toContain("block 500:");
  expect(lines.at(-1)).toContain("block 901:");
});

test("first paint for 5,000 blocks stays within budget (AC5)", async ({
  page,
}) => {
  await page.goto(`/?story=${STORY}`, { waitUntil: "commit" });
  // Measure from the moment the engine root attaches to the first windowed
  // paint, excluding Ladle/navigation boot so the number reflects the mount
  // cost of windowing 5,000 blocks rather than the dev server.
  await page.locator("[data-engine-view-root]").waitFor({ state: "attached" });
  const startedAt = await page.evaluate(() => performance.now());
  await expect
    .poll(async () => (await diagnostics(page)).mountedCount)
    .toBeGreaterThan(0);
  const paintedAt = await page.evaluate(() => performance.now());
  const diag = await diagnostics(page);
  // Only the viewport window mounted; 5,000 blocks were never all in the DOM.
  expect(diag.order).toHaveLength(BLOCK_COUNT);
  expect(diag.mountedCount).toBeLessThan(80);
  expect(paintedAt - startedAt).toBeLessThan(FIRST_PAINT_BUDGET_MS);
});

async function openStory(page: Page): Promise<void> {
  await page.goto(`/?story=${STORY}`, { waitUntil: "commit" });
  await page.locator("[data-engine-view-root]").waitFor({ state: "visible" });
  await expect
    .poll(async () => (await diagnostics(page)).mountedCount)
    .toBeGreaterThan(0);
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
  method: "scrollToBlock" | "selectText",
  args: readonly unknown[],
): Promise<void> {
  await page.evaluate(
    ({ apiKey, apiMethod, apiArgs }) => {
      const api = (window as unknown as Record<string, EngineApi | undefined>)[
        apiKey
      ];
      if (!api) throw new Error("owned-model engine view API missing");
      (api[apiMethod] as (...inner: unknown[]) => void)(...apiArgs);
    },
    { apiArgs: args, apiKey: API_KEY, apiMethod: method },
  );
}

async function settle(page: Page): Promise<void> {
  // Two frames let the scroll state, window recompute, and post-measure
  // correction all flush before assertions read geometry.
  for (let index = 0; index < 4; index += 1) {
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
  }
}

async function scrollerScrollTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const scroller = document.querySelector("[data-engine-view-root]");
    return scroller instanceof HTMLElement ? scroller.scrollTop : Number.NaN;
  });
}

async function setScrollTop(page: Page, value: number): Promise<void> {
  await page.evaluate((top) => {
    const scroller = document.querySelector("[data-engine-view-root]");
    if (scroller instanceof HTMLElement) {
      scroller.scrollTop = top;
      scroller.dispatchEvent(new Event("scroll"));
    }
  }, value);
}

async function blockTopRelativeToScroller(
  page: Page,
  id: string,
): Promise<number> {
  return page.evaluate((blockId) => {
    const scroller = document.querySelector("[data-engine-view-root]");
    const target = document.querySelector(
      `[data-engine-block-id="${blockId}"]`,
    );
    if (!scroller || !target) return Number.NaN;
    return (
      target.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    );
  }, id);
}

async function firstBlockHeight(blocks: Locator): Promise<number> {
  const box = await blocks.first().boundingBox();
  return box ? box.height : 1;
}
