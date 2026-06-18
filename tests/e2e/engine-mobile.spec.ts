import { expect, test, type Page } from "@playwright/test";

/**
 * docs/010 Phase 7 AC2 — mobile (WebKit emulation). The owned surface uses the
 * EditContext polyfill on mobile exactly as on desktop WebKit/Firefox; there is
 * no native-contenteditable platform fork (docs/010 §5.8/§6.6 decision: one
 * input substrate everywhere). These prove touch caret placement, on-screen
 * keyboard editing, and that the model — not the DOM selection — stays the
 * source of truth on a touch device.
 */
const EDITING_STORY = "engine--owned-model--phase55-editing";
const API = "__IDCO_ENGINE_VIEW_API__";

type Diag = {
  blockTexts: Record<string, string>;
  selection: {
    type: string;
    focus?: { node: string; offset: number };
    anchor?: { node: string; offset: number };
  } | null;
};

async function diag(page: Page): Promise<Diag> {
  return page.evaluate((key) => {
    const api = (
      window as unknown as Record<string, { diagnostics: () => Diag }>
    )[key];
    return api.diagnostics();
  }, API);
}

async function open(page: Page): Promise<void> {
  await page.goto(`/?story=${EDITING_STORY}`, { waitUntil: "commit" });
  await page.locator("[data-engine-view-root]").waitFor({ state: "visible" });
  await page
    .locator("[data-engine-text-id]")
    .first()
    .waitFor({ state: "visible" });
}

test("AC2 a tap places the model caret in the tapped block", async ({
  page,
}) => {
  await open(page);
  const block = page.locator("[data-engine-text-id]").nth(1);
  const id = (await block.getAttribute("data-engine-block-id"))!;
  await block.tap();
  await expect
    .poll(async () => {
      const sel = (await diag(page)).selection;
      return sel?.type === "text" ? sel.focus?.node : null;
    })
    .toBe(id);
});

test("AC2 on-screen keyboard editing updates the model", async ({ page }) => {
  await open(page);
  const block = page.locator("[data-engine-text-id]").nth(1);
  const id = (await block.getAttribute("data-engine-block-id"))!;
  await block.tap();
  await expect
    .poll(async () => (await diag(page)).selection?.type)
    .toBe("text");

  // The on-screen keyboard delivers keystrokes to the focused polyfill textarea.
  await page.keyboard.type("Zed");
  await expect
    .poll(async () => (await diag(page)).blockTexts[id] ?? "")
    .toContain("Zed");
});

test("AC2 a range selection on mobile is model-authoritative, not DOM-driven", async ({
  page,
}) => {
  await open(page);
  const block = page.locator("[data-engine-text-id]").nth(1);
  const id = (await block.getAttribute("data-engine-block-id"))!;
  await block.tap();

  // Select a word range through the model (the engine's selection authority);
  // this stands in for a touch word gesture without depending on the OS loupe.
  await page.evaluate(
    ({ key, node }) => {
      const api = (
        window as unknown as Record<
          string,
          {
            diagnostics: () => { blockTexts: Record<string, string> };
            selectText: (a: string, b: number, c: string, d: number) => void;
          }
        >
      )[key];
      const text = api.diagnostics().blockTexts[node] ?? "";
      const space = text.indexOf(" ");
      const end = space > 0 ? space : Math.min(4, text.length);
      api.selectText(node, 0, node, end);
    },
    { key: API, node: id },
  );

  // The model holds a non-collapsed selection.
  const sel = (await diag(page)).selection!;
  expect(sel.type).toBe("text");
  expect(sel.anchor!.offset).not.toBe(sel.focus!.offset);

  // The native DOM selection is NOT the source of truth: it stays collapsed/empty
  // because the engine paints its own overlay (model-authoritative, docs/011 §8.1).
  const nativeCollapsed = await page.evaluate(() => {
    const selection = window.getSelection();
    return !selection || selection.isCollapsed || selection.rangeCount === 0;
  });
  expect(nativeCollapsed).toBe(true);

  // The engine paints the selection overlay from the model instead.
  expect(
    await page.locator("[data-engine-selection-rect]").count(),
  ).toBeGreaterThan(0);
});
