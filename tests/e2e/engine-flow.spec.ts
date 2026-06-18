import { expect, test, type Page } from "@playwright/test";

const SMALL_STORY = "engine--flow-spike--small";
const FORCED_POLYFILL_STORY = "engine--flow-spike--forced-polyfill";
const LARGE_STORY = "engine--flow-spike--large";
const HUGE_STORY = "engine--flow-spike--huge";
const FLOW_KEY = "__IDCO_ENGINE_FLOW__";
const FLOW_API_KEY = "__IDCO_ENGINE_FLOW_API__";

type FlowSelection =
  | {
      type: "text";
      anchor: { node: string; offset: number };
      focus: { node: string; offset: number };
    }
  | { type: "node"; node: string }
  | { type: "gap"; node: string; side: "before" | "after" };

type FlowDiagnostics = {
  selection: FlowSelection | null;
  mountedIds: string[];
  blockTexts: Record<string, string>;
  copiedText: string;
  pastedText: string;
  searchQuery: string;
  searchHits: string[];
  renderCounts: Record<string, number>;
  dirty: {
    nodes: string[];
    selection: boolean;
    structure: boolean;
  };
  selectionRectCount: number;
  activeLeafId: string;
  activeInputBackend: "native" | "polyfill" | null;
  activeInputText: string;
  activeInputFocused: boolean;
  activeInputLastEvent: string;
  activeInputRectCount: number;
  totalBlocks: number;
  mountedCount: number;
  virtualScrollOffset: number;
  virtualViewportSize: number;
};

async function openFlowStory(page: Page, story: string) {
  await page.goto(`/?story=${story}`, { waitUntil: "commit" });
  const root = page.locator("[data-flow-root]");
  await root.waitFor({ state: "visible" });
  await expect
    .poll(async () => (await readFlow(page))?.mountedCount ?? 0)
    .toBeGreaterThan(0);
  return root;
}

function readFlow(page: Page): Promise<FlowDiagnostics | null> {
  return page.evaluate(
    (key) =>
      (window as unknown as Record<string, FlowDiagnostics | undefined>)[key] ??
      null,
    FLOW_KEY,
  );
}

async function flowDiagnostics(page: Page): Promise<FlowDiagnostics> {
  const diagnostics = await readFlow(page);
  if (!diagnostics) throw new Error("engine flow diagnostics missing");
  return diagnostics;
}

function callFlowApi<T>(
  page: Page,
  method: string,
  args: readonly unknown[] = [],
): Promise<T> {
  return page.evaluate(
    ({ apiKey, apiMethod, apiArgs }) => {
      const api = (
        window as unknown as Record<
          string,
          Record<string, (...args: unknown[]) => unknown> | undefined
        >
      )[apiKey];
      const fn = api?.[apiMethod];
      if (!fn) throw new Error(`engine flow api missing ${apiMethod}`);
      return fn(...apiArgs);
    },
    { apiArgs: args, apiKey: FLOW_API_KEY, apiMethod: method },
  ) as Promise<T>;
}

async function scrollFlowRootToBlock(page: Page, index: number): Promise<void> {
  await page.locator("[data-flow-root]").evaluate((element, blockIndex) => {
    const root = element as HTMLElement;
    root.scrollTop = blockIndex * 40;
    root.dispatchEvent(new Event("scroll", { bubbles: true }));
  }, index);
}

async function hasSelectionRectOverText(
  page: Page,
  blockId: string,
): Promise<boolean> {
  return page.evaluate((id) => {
    const text = document.querySelector(`[data-flow-text-id="${id}"]`);
    if (!text) return false;
    const textRect = text.getBoundingClientRect();
    return Array.from(document.querySelectorAll("[data-flow-selrect]")).some(
      (rectElement) => {
        const rect = rectElement.getBoundingClientRect();
        return (
          rect.bottom > textRect.top &&
          rect.top < textRect.bottom &&
          rect.right > textRect.left &&
          rect.left < textRect.right
        );
      },
    );
  }, blockId);
}

test("active leaf reuses the EditContext controller and does not rerender siblings", async ({
  page,
}, testInfo) => {
  await openFlowStory(page, SMALL_STORY);
  const host = page.locator("[data-flow-active-leaf-host]");

  await host.click();
  await expect
    .poll(async () => (await flowDiagnostics(page)).activeInputFocused)
    .toBe(true);
  await expect
    .poll(() =>
      host.evaluate((element) => getComputedStyle(element).outlineStyle),
    )
    .toBe("none");
  const before = await flowDiagnostics(page);
  expect(before.activeInputBackend).toBe(
    testInfo.project.name === "chromium" ? "native" : "polyfill",
  );

  await page.keyboard.type("!");
  await expect
    .poll(async () => (await flowDiagnostics(page)).activeInputText)
    .toBe("Alpha active text!");
  await expect(page.locator('[data-flow-text-id="a"]')).toHaveText(
    "Alpha active text!",
  );

  const after = await flowDiagnostics(page);
  expect(after.renderCounts.a).toBe(before.renderCounts.a);
  expect(after.renderCounts.b).toBe(before.renderCounts.b);
  expect(after.renderCounts.c).toBe(before.renderCounts.c);
  expect(after.dirty.nodes).toEqual(["a"]);

  await page.locator('[data-flow-text-id="c"]').click();
  await expect
    .poll(async () => (await flowDiagnostics(page)).activeLeafId)
    .toBe("c");
  await page.keyboard.type("!");
  await expect
    .poll(async () => (await flowDiagnostics(page)).activeInputText)
    .toContain("!");
  await expect(page.locator('[data-flow-text-id="c"]')).toContainText("!");
});

test("forced FlowSpike uses the forced polyfill through the shared controller", async ({
  page,
}) => {
  await openFlowStory(page, FORCED_POLYFILL_STORY);
  const host = page.locator("[data-flow-active-leaf-host]");

  await host.click();
  await expect
    .poll(async () => (await flowDiagnostics(page)).activeInputBackend)
    .toBe("polyfill");
  await expect(host).toHaveAttribute("data-editcontext-active", "");
});

test("flow selection, object projection, gaps, and model paste are model-owned", async ({
  page,
}) => {
  await openFlowStory(page, SMALL_STORY);

  const selected = await callFlowApi<FlowDiagnostics>(page, "selectText", [
    "a",
    0,
    "c",
    "Charlie".length,
  ]);
  expect(selected.selection?.type).toBe("text");
  expect(selected.selectionRectCount).toBeGreaterThan(0);
  const rectCountWithMiddle = selected.selectionRectCount;

  const copiedWithMiddle = await callFlowApi<string>(page, "copySelection");
  expect(copiedWithMiddle).toContain("Alpha active text");
  expect(copiedWithMiddle).toContain("Bravo hidden middle");
  expect(copiedWithMiddle).toContain("[Schema card]");
  expect(copiedWithMiddle).toContain("[unsupported object] Raw widget");

  await callFlowApi<void>(page, "setMiddleMounted", [false]);
  await expect
    .poll(async () => (await flowDiagnostics(page)).mountedIds.includes("b"))
    .toBe(false);
  const withoutMiddle = await flowDiagnostics(page);
  expect(withoutMiddle.selectionRectCount).toBeLessThan(rectCountWithMiddle);

  const copiedWithoutMountedMiddle = await callFlowApi<string>(
    page,
    "copySelection",
  );
  expect(copiedWithoutMountedMiddle).toContain("Bravo hidden middle");

  await callFlowApi<FlowDiagnostics>(page, "selectNode", ["obj"]);
  expect(await callFlowApi<string>(page, "copySelection")).toBe(
    "[Schema card]",
  );
  expect(await callFlowApi<string[]>(page, "search", ["schema"])).toEqual([
    "obj",
  ]);

  await callFlowApi<FlowDiagnostics>(page, "selectNode", ["raw"]);
  expect(await callFlowApi<string>(page, "copySelection")).toContain(
    "[unsupported object] Raw widget",
  );

  const gap = await callFlowApi<FlowDiagnostics>(page, "selectGap", [
    "obj",
    "before",
  ]);
  expect(gap.selection).toEqual({ node: "obj", side: "before", type: "gap" });
  expect(gap.selectionRectCount).toBe(1);

  await callFlowApi<FlowDiagnostics>(page, "selectText", [
    "a",
    0,
    "c",
    "Charlie".length,
  ]);
  await callFlowApi<void>(page, "pasteText", ["replacement"]);
  await expect
    .poll(async () => (await flowDiagnostics(page)).blockTexts.a)
    .toBe("replacement tail text");
});

test("large FlowSpike keeps mounting bounded while copying offscreen model text", async ({
  page,
}) => {
  await openFlowStory(page, LARGE_STORY);
  const host = page.locator("[data-flow-active-leaf-host]");
  const initial = await flowDiagnostics(page);

  expect(initial.totalBlocks).toBe(1000);
  expect(initial.mountedCount).toBeLessThan(40);
  expect(initial.mountedIds).toContain("block-3");
  expect(initial.mountedIds).not.toContain("block-900");

  await host.click();
  const before = await flowDiagnostics(page);
  await page.keyboard.type("!");
  await expect
    .poll(async () => (await flowDiagnostics(page)).activeInputText)
    .toBe("Large block 3 content!");
  const afterTyping = await flowDiagnostics(page);
  expect(afterTyping.renderCounts["block-3"]).toBe(
    before.renderCounts["block-3"],
  );
  expect(afterTyping.renderCounts["block-4"]).toBe(
    before.renderCounts["block-4"],
  );
  await scrollFlowRootToBlock(page, 1);
  await expect
    .poll(async () => (await flowDiagnostics(page)).mountedIds)
    .toContain("block-3");
  await expect
    .poll(async () => (await flowDiagnostics(page)).activeInputText)
    .toBe("Large block 3 content!");
  await expect(page.locator('[data-flow-text-id="block-3"]')).toHaveText(
    "Large block 3 content!",
  );

  await callFlowApi<FlowDiagnostics>(page, "selectText", [
    "block-3",
    0,
    "block-900",
    "Large block 900".length,
  ]);
  const copied = await callFlowApi<string>(page, "copySelection");
  expect(copied).toContain("Large block 500 content");
  expect(copied).toContain("Large block 900");

  await scrollFlowRootToBlock(page, 900);
  await expect
    .poll(async () => (await flowDiagnostics(page)).mountedIds)
    .toContain("block-900");
  await expect(page.locator('[data-flow-text-id="block-900"]')).toHaveText(
    "Large block 900 content",
  );
  await expect
    .poll(async () => hasSelectionRectOverText(page, "block-900"))
    .toBe(true);
  const scrolled = await flowDiagnostics(page);
  expect(scrolled.virtualScrollOffset).toBeGreaterThan(0);
  expect(scrolled.mountedIds).not.toContain("block-3");

  await page.locator('[data-flow-text-id="block-900"]').click();
  await expect
    .poll(async () => (await flowDiagnostics(page)).activeLeafId)
    .toBe("block-900");
  await page.keyboard.type("!");
  await expect
    .poll(async () => (await flowDiagnostics(page)).activeInputText)
    .toContain("!");

  await openFlowStory(page, HUGE_STORY);
  const huge = await flowDiagnostics(page);
  expect(huge.totalBlocks).toBe(5000);
  expect(huge.mountedCount).toBeLessThan(40);
  expect(huge.mountedIds).not.toContain("block-4500");
  await callFlowApi<FlowDiagnostics>(page, "selectText", [
    "block-3",
    0,
    "block-4500",
    "Large block 4500".length,
  ]);
  const hugeCopied = await callFlowApi<string>(page, "copySelection");
  expect(hugeCopied).toContain("Large block 2500 content");
  expect(hugeCopied).toContain("Large block 4500");

  await scrollFlowRootToBlock(page, 4500);
  await expect
    .poll(async () => (await flowDiagnostics(page)).mountedIds)
    .toContain("block-4500");
  await expect(page.locator('[data-flow-text-id="block-4500"]')).toHaveText(
    "Large block 4500 content",
  );
});
