import { expect, test, type Page } from "@playwright/test";

/**
 * docs/010 Phase 7 — hardening beyond the named ACs (the phase is hardening, so
 * the suite goes wider than the 8 ACs): Home/End, grapheme-cluster caret motion
 * in a real browser, goal-column reset on a horizontal move, and the proof that
 * the native DOM selection never becomes the source of truth. Runs on
 * chromium/webkit/firefox.
 */
const EDITING_STORY = "engine--owned-model--phase55-editing";
const RAGGED_STORY = "engine--owned-model--phase7-ragged-lines";
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

async function open(page: Page, story: string): Promise<void> {
  await page.goto(`/?story=${story}`, { waitUntil: "commit" });
  await page.locator("[data-engine-view-root]").waitFor({ state: "visible" });
  await page
    .locator("[data-engine-text-id]")
    .first()
    .waitFor({ state: "visible" });
}

test("Home and End move the caret to the block start and end", async ({
  page,
}) => {
  await open(page, EDITING_STORY);
  const block = page.locator("[data-engine-text-id]").nth(1);
  const id = (await block.getAttribute("data-engine-block-id"))!;
  const length = (await diag(page)).blockTexts[id]!.length;
  const box = (await block.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.4, box.y + 6);

  await page.keyboard.press("Home");
  await expect
    .poll(async () => (await diag(page)).selection?.focus?.offset)
    .toBe(0);

  await page.keyboard.press("End");
  await expect
    .poll(async () => (await diag(page)).selection?.focus?.offset)
    .toBe(length);
});

test("ArrowLeft over an emoji steps the whole grapheme cluster, not a surrogate half", async ({
  page,
}) => {
  await open(page, EDITING_STORY);
  const block = page.locator("[data-engine-text-id]").nth(1);
  const id = (await block.getAttribute("data-engine-block-id"))!;
  await block.click();
  await page.keyboard.press("End");
  // Insert an astral emoji (two UTF-16 code units) at the end.
  await page.keyboard.insertText("😀");
  const length = (await diag(page)).blockTexts[id]!.length;

  await page.keyboard.press("ArrowLeft");
  // The caret jumps the whole 2-code-unit cluster, landing before the emoji,
  // never inside the surrogate pair (docs/010 Phase 7 AC1).
  await expect
    .poll(async () => (await diag(page)).selection?.focus?.offset)
    .toBe(length - 2);
});

test("a horizontal move resets the goal column", async ({ page }) => {
  await open(page, RAGGED_STORY);
  const block = page.locator("[data-engine-text-id]").first();
  const id = (await block.getAttribute("data-engine-block-id"))!;
  const text = (await diag(page)).blockTexts[id]!;
  const firstNewline = text.indexOf("\n");
  const box = (await block.boundingBox())!;

  const secondNewline = text.indexOf("\n", firstNewline + 1);
  // Caret at a low column on the long first line.
  await page.mouse.click(box.x + box.width * 0.2, box.y + 6);
  const startCol = (await diag(page)).selection!.focus!.offset;
  expect(startCol).toBeGreaterThan(0);
  expect(startCol).toBeLessThan(firstNewline);

  // Down twice holds the (low) goal column onto the third line.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  const heldCol =
    (await diag(page)).selection!.focus!.offset - secondNewline - 1;
  expect(Math.abs(heldCol - startCol)).toBeLessThanOrEqual(3);

  // Now move right along the third line (horizontal → resets the goal column),
  // then go back up: the caret must follow the NEW, higher column, not the old.
  for (let i = 0; i < 14; i += 1) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  const backOnFirst = (await diag(page)).selection!.focus!.offset;
  expect(backOnFirst).toBeLessThan(firstNewline);
  expect(backOnFirst).toBeGreaterThan(startCol + 5);
});

test("the native DOM selection never becomes the source of truth", async ({
  page,
}) => {
  await open(page, EDITING_STORY);
  const block = page.locator("[data-engine-text-id]").nth(1);
  await block.click();
  // Triple-click selects the block as a model range.
  await block.click({ clickCount: 3 });
  const sel = (await diag(page)).selection!;
  expect(sel.type).toBe("text");
  expect(sel.anchor!.offset).not.toBe(sel.focus!.offset);

  // The engine paints the range from the model; the browser's own Selection
  // stays collapsed/empty (docs/011 §8.1 — model is truth, DOM is a projection).
  const nativeCollapsed = await page.evaluate(() => {
    const selection = window.getSelection();
    return !selection || selection.isCollapsed || selection.rangeCount === 0;
  });
  expect(nativeCollapsed).toBe(true);
  expect(
    await page.locator("[data-engine-selection-rect]").count(),
  ).toBeGreaterThan(0);
});
