import { expect, test, type Page } from "@playwright/test";

/**
 * docs/010 Phase 5.5 — structural editing through the command layer, driven as
 * real keyboard/pointer interaction (not the diagnostics API). Covers split
 * (Enter), merge (Backspace), content-anchored undo, the edge-click caret fix,
 * and clipboard cut/paste. List indent/outdent is proven headless in
 * tests/editor/engine-commands.test.ts because the view renders top-level text
 * blocks (a structural list shows as a placeholder; nested rendering is later).
 */
const STORY = "engine--owned-model--phase55-editing";
const API = "__IDCO_ENGINE_VIEW_API__";
const SHOTS = "test-results/phase55";

type Diag = {
  order: string[];
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
  await page.goto(`/?story=${STORY}`, { waitUntil: "commit" });
  await page.locator("[data-engine-view-root]").waitFor({ state: "visible" });
  await page
    .locator("[data-engine-block-id]")
    .first()
    .waitFor({ state: "visible" });
}

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

test("Enter splits a paragraph at the caret into two blocks", async ({
  page,
}) => {
  await open(page);
  const block = page.locator("[data-engine-block-id]").nth(2);
  const id = (await block.getAttribute("data-engine-block-id"))!;
  const fullText = (await diag(page)).blockTexts[id]!;
  const box = (await block.boundingBox())!;

  // Click roughly in the middle of the paragraph's first line.
  await page.mouse.click(box.x + box.width * 0.45, box.y + 8);
  const orderBefore = (await diag(page)).order.length;
  await block.screenshot({ path: `${SHOTS}/split-before.png` });

  await page.keyboard.press("Enter");

  const after = await diag(page);
  expect(after.order).toHaveLength(orderBefore + 1);
  // The split index is where block id sat; head + tail rejoin to the original.
  const headIndex = after.order.indexOf(id);
  const tailId = after.order[headIndex + 1]!;
  expect(after.blockTexts[id]! + after.blockTexts[tailId]!).toBe(fullText);
  // The caret is at the start of the new tail block.
  expect(after.selection?.focus).toMatchObject({ node: tailId, offset: 0 });
  await page.locator("[data-engine-view-root]").screenshot({
    path: `${SHOTS}/split-after.png`,
  });
});

test("Backspace at the start of a block merges it into the previous block", async ({
  page,
}) => {
  await open(page);
  const blocks = page.locator("[data-engine-block-id]");
  const firstId = (await blocks.nth(1).getAttribute("data-engine-block-id"))!;
  const secondId = (await blocks.nth(2).getAttribute("data-engine-block-id"))!;
  const before = await diag(page);
  const joined = before.blockTexts[firstId]! + before.blockTexts[secondId]!;

  // Click the far-left edge of the second paragraph: the edge-click fix lands the
  // caret at offset 0, not the block end.
  const box = (await blocks.nth(2).boundingBox())!;
  await page.mouse.click(box.x + 1, box.y + 8);
  expect((await diag(page)).selection?.focus).toMatchObject({
    node: secondId,
    offset: 0,
  });

  await page.keyboard.press("Backspace");

  // The merge folds the previous block into the FOCUSED block, which survives
  // (B′) so the editable element the caret is bound to is never destroyed. The
  // previous block is the one removed; the focused block holds the joined text.
  const after = await diag(page);
  expect(after.order).not.toContain(firstId);
  expect(after.blockTexts[secondId]).toBe(joined);
});

test("clicking the right edge of a block places the caret near the line end, not adrift", async ({
  page,
}) => {
  await open(page);
  const block = page.locator("[data-engine-block-id]").nth(1);
  const id = (await block.getAttribute("data-engine-block-id"))!;
  const text = (await diag(page)).blockTexts[id]!;
  const box = (await block.boundingBox())!;

  // Click well to the right of the glyphs on the first visual line.
  await page.mouse.click(box.x + box.width - 2, box.y + 8);
  const sel = (await diag(page)).selection;
  expect(sel?.focus?.node).toBe(id);
  // It resolved to a real offset on the line (> 0), not collapsed to 0 or lost.
  expect(sel?.focus?.offset).toBeGreaterThan(0);
  expect(sel?.focus?.offset).toBeLessThanOrEqual(text.length);
});

test("typing then a single undo reverts it; caret moves are not undoable", async ({
  page,
}) => {
  await open(page);
  const block = page.locator("[data-engine-block-id]").nth(1);
  const id = (await block.getAttribute("data-engine-block-id"))!;
  const before = (await diag(page)).blockTexts[id]!;
  const box = (await block.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.3, box.y + 8);

  await page.keyboard.type("Z");
  expect((await diag(page)).blockTexts[id]!.length).toBe(before.length + 1);

  // Several caret moves (selection-only, non-historic) must not consume the undo.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");

  await page.keyboard.press("ControlOrMeta+z");
  expect((await diag(page)).blockTexts[id]!).toBe(before);
});

test("cut deletes the selection and paste re-inserts it through commands", async ({
  page,
  browserName,
}) => {
  // Known cross-browser limitation (docs/010 Phase 7 §11): Firefox returns a
  // null `clipboardData` for a *synthetic* ClipboardEvent (the constructor's
  // clipboardData is ignored), so this test — which dispatches a synthetic cut —
  // cannot read what the engine wrote. Real Ctrl+X/Ctrl+V works on Firefox; the
  // engine's model delete/insert is proven on chromium/webkit here.
  test.fixme(
    browserName === "firefox",
    "Firefox synthetic ClipboardEvent.clipboardData is null",
  );
  await open(page);
  const block = page.locator("[data-engine-block-id]").nth(1);
  const id = (await block.getAttribute("data-engine-block-id"))!;
  const before = (await diag(page)).blockTexts[id]!;

  // Select the first word via the engine API, then fire a real cut event.
  await page.evaluate(
    ({ key, node }) => {
      (
        window as unknown as Record<
          string,
          {
            selectText: (a: string, ao: number, f: string, fo: number) => void;
          }
        >
      )[key].selectText(node, 0, node, 5);
    },
    { key: API, node: id },
  );

  const cut = await page.evaluate(() => {
    const root = document.querySelector("[data-engine-view-root]")!;
    const data = new DataTransfer();
    root.dispatchEvent(
      new ClipboardEvent("cut", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
    return data.getData("text/plain");
  });
  expect(cut).toBe(before.slice(0, 5));
  expect((await diag(page)).blockTexts[id]!).toBe(before.slice(5));

  // Paste it back at the (now collapsed) caret.
  await page.evaluate((text) => {
    const root = document.querySelector("[data-engine-view-root]")!;
    const data = new DataTransfer();
    data.setData("text/plain", text);
    root.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
  }, cut);
  expect((await diag(page)).blockTexts[id]!).toBe(before);
});

test("Shift+Enter inserts a soft line break without splitting the block", async ({
  page,
}) => {
  await open(page);
  const block = page.locator("[data-engine-block-id]").nth(1);
  const id = (await block.getAttribute("data-engine-block-id"))!;
  const before = (await diag(page)).blockTexts[id]!;
  const box = (await block.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.4, box.y + 8);
  const orderBefore = (await diag(page)).order.length;

  await page.keyboard.press("Shift+Enter");

  const after = await diag(page);
  expect(after.order).toHaveLength(orderBefore); // no new block
  expect(after.blockTexts[id]).toContain("\n");
  expect(after.blockTexts[id]!.replace("\n", "")).toBe(before);
});

test("Shift+Enter at block end moves the caret to the trailing soft-break line", async ({
  page,
}) => {
  await open(page);
  const block = page.locator("[data-engine-block-id]").nth(1);
  const id = (await block.getAttribute("data-engine-block-id"))!;
  const before = (await diag(page)).blockTexts[id]!;
  await page.evaluate(
    ({ key, node, offset }) => {
      const api = (
        window as unknown as Record<
          string,
          {
            focusBlock: (id: string) => void;
            selectText: (
              anchorNode: string,
              anchorOffset: number,
              focusNode: string,
              focusOffset: number,
            ) => void;
          }
        >
      )[key];
      api.selectText(node, offset, node, offset);
      api.focusBlock(node);
    },
    { key: API, node: id, offset: before.length },
  );
  const beforeCaret = (await page
    .locator("[data-engine-caret]")
    .boundingBox())!;

  await page.keyboard.press("Shift+Enter");

  const after = await diag(page);
  const afterCaret = (await page.locator("[data-engine-caret]").boundingBox())!;
  expect(after.blockTexts[id]).toBe(`${before}\n`);
  expect(after.selection?.focus).toMatchObject({
    node: id,
    offset: before.length + 1,
  });
  expect(afterCaret.y).toBeGreaterThan(beforeCaret.y);
});

test("double-click selects a word; triple-click selects the whole block", async ({
  page,
}) => {
  await open(page);
  const block = page.locator("[data-engine-block-id]").nth(1);
  const id = (await block.getAttribute("data-engine-block-id"))!;
  const full = (await diag(page)).blockTexts[id]!;
  const box = (await block.boundingBox())!;

  // Double-click over the first word ("The") near the block's left edge.
  await page.mouse.dblclick(box.x + 10, box.y + 8);
  const word = await serialize(page);
  expect(word.length).toBeGreaterThan(1);
  expect(word.trim()).toBe(word); // no surrounding whitespace: a clean word
  expect(full.startsWith(word)).toBe(true);
  await page
    .locator("[data-engine-view-root]")
    .screenshot({ path: `${SHOTS}/double-click-word.png` });

  await page.mouse.click(box.x + 10, box.y + 8, { clickCount: 3 });
  expect(await serialize(page)).toBe(full);
});

test("clicking the empty area below the text drops the caret in the last block", async ({
  page,
}) => {
  await open(page);
  const blocks = page.locator("[data-engine-block-id]");
  const count = await blocks.count();
  // Last text block is `tail`; the structural list renders as a placeholder.
  const tailId = (await blocks
    .nth(count - 1)
    .getAttribute("data-engine-block-id"))!;
  const tailText = (await diag(page)).blockTexts[tailId]!;
  const root = (await page.locator("[data-engine-view-root]").boundingBox())!;

  // Click low in the scroller, well below the last paragraph.
  await page.mouse.click(root.x + root.width * 0.5, root.y + root.height - 6);

  const sel = (await diag(page)).selection;
  expect(sel?.focus?.node).toBe(tailId);
  expect(sel?.focus?.offset).toBe(tailText.length); // caret at the end
});

async function caretHeight(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector("[data-engine-caret]");
    return el instanceof HTMLElement ? el.getBoundingClientRect().height : -1;
  });
}

test("the caret stays a thin single-line bar after repeated Shift+Enter", async ({
  page,
}) => {
  await open(page);
  const block = page.locator("[data-engine-block-id]").nth(1);
  const box = (await block.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.4, box.y + 8);
  const inlineHeight = await caretHeight(page);
  expect(inlineHeight).toBeGreaterThan(0);

  for (let i = 0; i < 4; i += 1) await page.keyboard.press("Shift+Enter");
  await page
    .locator("[data-engine-view-root]")
    .screenshot({ path: `${SHOTS}/caret-after-shift-enter.png` });

  const newlineHeight = await caretHeight(page);
  expect(newlineHeight).toBeGreaterThan(0);
  // The caret on the new empty line is about one line tall, like the inline
  // caret — not the (much taller) multi-line block box it used to fall back to.
  expect(newlineHeight).toBeLessThan(inlineHeight * 1.6);
  expect(newlineHeight).toBeLessThan(40);
});

test("a drag keeps selecting after the pointer leaves the editor and returns", async ({
  page,
}) => {
  await open(page);
  const blocks = page.locator("[data-engine-block-id]");
  const anchorId = (await blocks.nth(1).getAttribute("data-engine-block-id"))!;
  const from = (await blocks.nth(1).boundingBox())!;
  const root = (await page.locator("[data-engine-view-root]").boundingBox())!;

  await page.mouse.move(from.x + 12, from.y + from.height / 2);
  await page.mouse.down();
  // Leave the editor entirely (to the left of it), then come back lower down.
  await page.mouse.move(root.x - 60, from.y + 60, { steps: 6 });
  await page.mouse.move(from.x + 60, from.y + from.height * 2.5, { steps: 6 });
  await page.mouse.up();

  const sel = (await diag(page)).selection;
  expect(sel).not.toBeNull();
  // The selection survived the round trip: it is a real range, not collapsed
  // back to the press point (which is what the old pointerleave reset produced).
  const text = await serialize(page);
  expect(text.length).toBeGreaterThan(0);
  const sameSpot =
    sel!.focus!.node === anchorId &&
    sel!.anchor!.node === anchorId &&
    sel!.focus!.offset === sel!.anchor!.offset;
  expect(sameSpot).toBe(false);
});

test("arrow and shift-arrow cross the list placeholder instead of hitting a wall", async ({
  page,
}) => {
  await open(page);
  const blocks = page.locator("[data-engine-block-id]");
  // order: [heading, first, second, list(placeholder), tail]
  const secondId = (await blocks.nth(2).getAttribute("data-engine-block-id"))!;
  const tailId = (await blocks.nth(4).getAttribute("data-engine-block-id"))!;
  const box = (await blocks.nth(2).boundingBox())!;
  await page.mouse.click(box.x + 4, box.y + 8);
  expect((await diag(page)).selection?.focus?.node).toBe(secondId);

  // Plain ArrowDown steps over the [list] block to the next text block.
  await page.keyboard.press("ArrowDown");
  expect((await diag(page)).selection?.focus?.node).toBe(tailId);

  // Shift+ArrowUp extends the range back across the list (not collapsed/stuck).
  await page.keyboard.press("Shift+ArrowUp");
  const sel = (await diag(page)).selection;
  expect(sel?.anchor?.node).toBe(tailId);
  expect(sel?.focus?.node).toBe(secondId);
  expect((await serialize(page)).length).toBeGreaterThan(0);
});
