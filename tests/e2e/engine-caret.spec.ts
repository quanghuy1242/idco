import { expect, test, type Page } from "@playwright/test";

/**
 * docs/010 Phase 5 follow-up — real caret/selection interaction.
 *
 * The Phase 5 perf spec drives the engine through its API; this one drives it
 * like a user (pointer + keyboard) on the variable-height (multi-line) story,
 * because the click-to-position, focus-follows-caret, and vertical-line bugs
 * only show up under genuine interaction. What stays Phase 7 (IME, goal-column
 * persistence, a11y) is documented in the plan, not asserted here.
 */
const STORY = "engine--owned-model--phase5-variable-heights";
const API = "__IDCO_ENGINE_VIEW_API__";

type Focus = { node: string; offset: number } | null;

async function focus(page: Page): Promise<Focus> {
  return page.evaluate((key) => {
    const sel = (
      window as unknown as Record<
        string,
        { diagnostics: () => { selection: unknown } }
      >
    )[key].diagnostics().selection as {
      type: string;
      focus?: { node: string; offset: number };
    } | null;
    return sel?.type === "text" && sel.focus
      ? { node: sel.focus.node, offset: sel.focus.offset }
      : null;
  }, API);
}

async function blockText(page: Page, id: string): Promise<string> {
  return page.evaluate(
    ({ key, blockId }) =>
      (
        window as unknown as Record<
          string,
          { diagnostics: () => { blockTexts: Record<string, string> } }
        >
      )[key].diagnostics().blockTexts[blockId] ?? "",
    { blockId: id, key: API },
  );
}

async function open(page: Page): Promise<void> {
  await page.goto(`/?story=${STORY}`, { waitUntil: "commit" });
  await page.locator("[data-engine-view-root]").waitFor({ state: "visible" });
  await page
    .locator("[data-engine-block-id]")
    .first()
    .waitFor({ state: "visible" });
}

test("clicking inside a block places the caret at the click, not the end", async ({
  page,
}) => {
  await open(page);
  const block = page.locator("[data-engine-block-id]").nth(2);
  const id = (await block.getAttribute("data-engine-block-id"))!;
  const text = await blockText(page, id);
  const box = (await block.boundingBox())!;

  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
  const placed = await focus(page);
  expect(placed?.node).toBe(id);
  // Genuinely mid-text: not 0, not the end.
  expect(placed!.offset).toBeGreaterThan(0);
  expect(placed!.offset).toBeLessThan(text.length);

  // Typing inserts at the caret, not appended.
  await page.keyboard.type("Z");
  const after = await blockText(page, id);
  expect(after.length).toBe(text.length + 1);
  expect(after[placed!.offset]).toBe("Z");
});

test("arrow keys keep working after the caret crosses a block boundary", async ({
  page,
}) => {
  await open(page);
  const block = page.locator("[data-engine-block-id]").nth(1);
  const id = (await block.getAttribute("data-engine-block-id"))!;
  const text = await blockText(page, id);
  const box = (await block.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);

  // Walk to the end of the block, then one more press crosses into the next.
  let guard = text.length + 4;
  let current = await focus(page);
  while (current && current.node === id && guard-- > 0) {
    await page.keyboard.press("ArrowRight");
    current = await focus(page);
  }
  expect(current).not.toBeNull();
  expect(current!.node).not.toBe(id); // crossed the boundary
  const afterCross = current!;

  // The decisive check: a key press AFTER crossing still moves the caret.
  await page.keyboard.press("ArrowRight");
  const moved = await focus(page);
  expect(moved).not.toEqual(afterCross);
});

test("ArrowDown moves by visual line inside a wrapped multi-line block", async ({
  page,
}) => {
  await open(page);
  // Block index 2 wraps to several lines in the variable-height story.
  const block = page.locator("[data-engine-block-id]").nth(2);
  const id = (await block.getAttribute("data-engine-block-id"))!;
  const box = (await block.boundingBox())!;
  // Click near the top-left so the caret starts on the first visual line.
  await page.mouse.click(box.x + box.width * 0.1, box.y + 4);
  const start = await focus(page);
  expect(start?.node).toBe(id);

  await page.keyboard.press("ArrowDown");
  const down = await focus(page);
  // Still the same block, but a later offset: it moved down one rendered line,
  // it did not jump to the next block.
  expect(down?.node).toBe(id);
  expect(down!.offset).toBeGreaterThan(start!.offset);
});

test("the caret blinks and is a thin insertion bar", async ({ page }) => {
  await open(page);
  const block = page.locator("[data-engine-block-id]").nth(2);
  const box = (await block.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);

  const caret = await page.evaluate(() => {
    const node = document.querySelector("[data-engine-caret]");
    if (!(node instanceof HTMLElement)) return null;
    const style = getComputedStyle(node);
    return {
      animationName: style.animationName,
      width: Number.parseFloat(style.width),
    };
  });
  expect(caret).not.toBeNull();
  expect(caret!.animationName).not.toBe("none");
  expect(caret!.width).toBeLessThanOrEqual(2);
});

async function serialize(page: Page): Promise<string> {
  return page.evaluate(
    (key) =>
      (
        window as unknown as Record<
          string,
          { serializeSelection: () => string }
        >
      )[key].serializeSelection(),
    API,
  );
}

async function indexOfBlock(page: Page, id: string): Promise<number> {
  return page.evaluate(
    ({ key, blockId }) =>
      (
        window as unknown as Record<
          string,
          { diagnostics: () => { order: string[] } }
        >
      )[key]
        .diagnostics()
        .order.indexOf(blockId),
    { blockId: id, key: API },
  );
}

test("dragging the pointer selects a range across blocks", async ({ page }) => {
  await open(page);
  const blocks = page.locator("[data-engine-block-id]");
  const fromId = (await blocks.nth(1).getAttribute("data-engine-block-id"))!;
  const from = (await blocks.nth(1).boundingBox())!;
  const to = (await blocks.nth(4).boundingBox())!;

  await page.mouse.move(from.x + 12, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 40, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();

  const sel = await focus(page);
  expect(sel).not.toBeNull();
  // Focus advanced into a later block (the range spans down), and the model
  // serialization covers more than the anchor block alone.
  const fromIndex = await indexOfBlock(page, fromId);
  const toIndex = await indexOfBlock(page, sel!.node);
  expect(toIndex).toBeGreaterThan(fromIndex);
  const text = await serialize(page);
  const fromText = await blockText(page, fromId);
  expect(text).toContain(fromText.split("\n")[0]!.slice(0, 12));
  expect(text.length).toBeGreaterThan(fromText.length);
});

test("shift-click extends the selection from the existing anchor", async ({
  page,
}) => {
  await open(page);
  const blocks = page.locator("[data-engine-block-id]");
  const a = (await blocks.nth(1).boundingBox())!;
  const b = (await blocks.nth(3).boundingBox())!;
  await page.mouse.click(a.x + 12, a.y + a.height / 2);
  const start = await focus(page);
  // onMouseDown receives keyboard modifiers; pointerdown does not (Playwright).
  await page.keyboard.down("Shift");
  await page.mouse.click(b.x + 40, b.y + b.height / 2);
  await page.keyboard.up("Shift");

  const end = await focus(page);
  expect(start).not.toBeNull();
  expect(end).not.toBeNull();
  const startIndex = await indexOfBlock(page, start!.node);
  const endIndex = await indexOfBlock(page, end!.node);
  expect(endIndex).toBeGreaterThan(startIndex); // extended downward
  const text = await serialize(page);
  expect(text.length).toBeGreaterThan(0);
});

test("shift+arrow keeps the range when the selection crosses a block boundary", async ({
  page,
}) => {
  await open(page);
  const block = page.locator("[data-engine-block-id]").nth(2);
  const id = (await block.getAttribute("data-engine-block-id"))!;
  const box = (await block.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.2, box.y + 4);

  // Extend down repeatedly until the focus crosses into a later block.
  let crossed = false;
  for (let i = 0; i < 10 && !crossed; i += 1) {
    await page.keyboard.press("Shift+ArrowDown");
    const f = await focus(page);
    if (f && f.node !== id) crossed = true;
  }
  expect(crossed).toBe(true);

  // The selection must still be a non-empty range (anchor stayed put), not a
  // collapsed caret in the new block.
  const sel = await page.evaluate(
    (key) =>
      (
        window as unknown as Record<
          string,
          { diagnostics: () => { selection: unknown } }
        >
      )[key].diagnostics().selection as {
        anchor: { node: string };
        focus: { node: string };
      },
    API,
  );
  expect(sel.anchor.node).toBe(id); // anchor preserved in the start block
  expect(sel.focus.node).not.toBe(id); // focus moved on
  const text = await serialize(page);
  expect(text.length).toBeGreaterThan(0);
});

test("autoscroll during a drag reaches blocks far below the viewport (AC4)", async ({
  page,
}) => {
  await open(page);
  const blocks = page.locator("[data-engine-block-id]");
  const from = (await blocks.nth(1).boundingBox())!;
  const scroller = (await page
    .locator("[data-engine-view-root]")
    .boundingBox())!;
  // The last block mounted at drag start: anything past this was offscreen.
  const visibleEnd = await page.evaluate(
    (key) =>
      (
        window as unknown as Record<
          string,
          { diagnostics: () => { windowEnd: number } }
        >
      )[key].diagnostics().windowEnd,
    API,
  );

  await page.mouse.move(from.x + 12, from.y + 6);
  await page.mouse.down();
  // Hold near the bottom edge so the rAF autoscroll loop runs.
  await page.mouse.move(from.x + 12, scroller.y + scroller.height - 8, {
    steps: 4,
  });
  await page.waitForTimeout(1200);
  await page.mouse.up();

  const sel = await focus(page);
  expect(sel).not.toBeNull();
  const endIndex = await indexOfBlock(page, sel!.node);
  // The selection focus reached a block that was offscreen when the drag began:
  // autoscroll carried the drag past the initial viewport, not just within it.
  expect(endIndex).toBeGreaterThan(visibleEnd);
});
