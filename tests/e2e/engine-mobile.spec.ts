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
  order: string[];
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

// Dispatch one synthetic touch event at a client point. The engine's touch
// controller listens on the scroll root and reads `Touch.target` (set to the
// element under the point) for hit-testing, so a real long-press / grip drag is
// reproducible without a high-level gesture API.
async function touch(
  page: Page,
  type: "touchstart" | "touchmove" | "touchend",
  x: number,
  y: number,
): Promise<void> {
  await page.evaluate(
    (arg) => {
      const root = document.querySelector("[data-engine-view-root]")!;
      const target = document.elementFromPoint(arg.x, arg.y) ?? root;
      const t = new Touch({
        clientX: arg.x,
        clientY: arg.y,
        identifier: 1,
        pageX: arg.x,
        pageY: arg.y,
        target,
      });
      const touches = arg.type === "touchend" ? [] : [t];
      root.dispatchEvent(
        new TouchEvent(arg.type, {
          bubbles: true,
          cancelable: true,
          changedTouches: [t],
          composed: true,
          targetTouches: touches,
          touches,
        }),
      );
    },
    { type, x, y },
  );
}

// Long-press inside a block to select the word under the finger (the engine
// long-press = ~450ms held still).
async function longPressWord(page: Page, x: number, y: number): Promise<void> {
  await touch(page, "touchstart", x, y);
  await page.waitForTimeout(550);
  await touch(page, "touchend", x, y);
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

test("AC2 cross-block Backspace keeps the focused block alive so editing never leaves it", async ({
  page,
}) => {
  // A cross-block Backspace folds the previous block into the FOCUSED block,
  // which survives (B′) — the editable element the on-screen keyboard is bound to
  // is never destroyed, so the keyboard has no reason to dismiss-then-reopen and
  // DOM focus never moves. The sub-frame flicker timing is not observable from
  // Playwright; what this guards is the property that makes it impossible: the
  // focused block keeps the model caret and DOM focus across the merge, and
  // typing continues in it with no re-tap, the glyph landing at the merge point.
  await open(page);
  const blocks = page.locator("[data-engine-block-id]");
  const firstId = (await blocks.nth(1).getAttribute("data-engine-block-id"))!;
  const secondId = (await blocks.nth(2).getAttribute("data-engine-block-id"))!;
  const before = await diag(page);
  const firstText = before.blockTexts[firstId]!;
  const secondText = before.blockTexts[secondId]!;

  // Edit the second block (on-screen keyboard up), caret at its very start.
  await page.locator(`[data-engine-block-id="${secondId}"]`).tap();
  await page.evaluate(
    ({ key, node }) => {
      const api = (
        window as unknown as Record<
          string,
          { selectText: (a: string, b: number, c: string, d: number) => void }
        >
      )[key];
      api.selectText(node, 0, node, 0);
    },
    { key: API, node: secondId },
  );

  await page.keyboard.press("Backspace");

  // The previous block is gone; the focused (second) block survived and still
  // holds both the model caret and DOM focus — no hand-off happened at all.
  await expect
    .poll(async () => (await diag(page)).order.includes(firstId))
    .toBe(false);
  await expect
    .poll(async () => (await diag(page)).selection?.focus?.node)
    .toBe(secondId);
  await expect
    .poll(async () =>
      page.evaluate(() =>
        document.activeElement?.getAttribute("data-engine-block-id"),
      ),
    )
    .toBe(secondId);

  // Typing right after the merge — no second tap — proves input focus stayed
  // live in the same block; the glyph sits at the join offset.
  await page.keyboard.type("X");
  await expect
    .poll(async () => (await diag(page)).blockTexts[secondId] ?? "")
    .toBe(firstText + "X" + secondText);
});

test("AC8 long-press selects the word under the finger", async ({
  browserName,
  page,
}) => {
  test.skip(
    browserName === "webkit",
    "WebKit cannot construct synthetic Touch events; AC8 runs on mobile-chromium.",
  );
  await open(page);
  const block = page.locator("[data-engine-text-id]").nth(1);
  const id = (await block.getAttribute("data-engine-block-id"))!;
  const box = (await block.boundingBox())!;
  // Aim well inside the first word on the first line.
  await longPressWord(page, box.x + 24, box.y + 8);

  const sel = (await diag(page)).selection!;
  expect(sel.type).toBe("text");
  expect(sel.focus?.node).toBe(id);
  // A word, not a collapsed caret.
  expect(sel.anchor?.offset).not.toBe(sel.focus?.offset);
});

test("AC8 two grips render for a touch selection and dragging one extends it", async ({
  browserName,
  page,
}) => {
  test.skip(
    browserName === "webkit",
    "WebKit cannot construct synthetic Touch events; AC8 runs on mobile-chromium.",
  );
  await open(page);
  const block = page.locator("[data-engine-text-id]").nth(1);
  const box = (await block.boundingBox())!;
  await longPressWord(page, box.x + 24, box.y + 8);

  // The engine paints exactly two range grips on a touch device.
  await expect(page.locator("[data-engine-sel-handle]")).toHaveCount(2);

  const before = (await diag(page)).selection!;
  const grip = page.locator('[data-engine-sel-handle="end"]');
  const gb = (await grip.boundingBox())!;
  // Drag the end grip far to the right, along the grip's own line, to extend.
  const gx = gb.x + gb.width / 2;
  const gy = gb.y + gb.height / 2;
  await touch(page, "touchstart", gx, gy);
  await touch(page, "touchmove", box.x + box.width * 0.8, gy);
  await touch(page, "touchend", box.x + box.width * 0.8, gy);

  const after = (await diag(page)).selection!;
  expect(after.type).toBe("text");
  expect(after.focus!.offset).toBeGreaterThan(before.focus!.offset);
});

test("AC8 holding the collapsed caret opens the paste popover", async ({
  browserName,
  page,
}) => {
  test.skip(
    browserName === "webkit",
    "WebKit cannot construct synthetic Touch events; AC8 runs on mobile-chromium.",
  );
  await open(page);
  const block = page.locator("[data-engine-text-id]").nth(1);
  await block.tap();
  await expect(page.locator("[data-engine-caret]")).toBeVisible();

  const caretBox = (await page.locator("[data-engine-caret]").boundingBox())!;
  const x = caretBox.x + caretBox.width / 2;
  const y = caretBox.y + caretBox.height / 2;
  await touch(page, "touchstart", x, y);
  await page.waitForTimeout(550);
  await touch(page, "touchend", x, y);

  const popover = page.locator("[data-engine-caret-toolbar]");
  await expect(popover).toBeVisible();
  await expect(popover.getByRole("button", { name: "Paste" })).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Caret actions" }),
  ).toBeVisible();
});

test("AC8 the selection toolbar cuts the selected word", async ({
  browserName,
  page,
}) => {
  test.skip(
    browserName === "webkit",
    "WebKit cannot construct synthetic Touch events; AC8 runs on mobile-chromium.",
  );
  await open(page);
  const block = page.locator("[data-engine-text-id]").nth(1);
  const id = (await block.getAttribute("data-engine-block-id"))!;
  const box = (await block.boundingBox())!;
  const before = (await diag(page)).blockTexts[id]!;
  await longPressWord(page, box.x + 24, box.y + 8);

  // Fire the button's action directly: the floating bar repaints on the
  // selection frame lane (like the caret overlay), so Playwright's tap-stability
  // wait never settles; `dispatchEvent` exercises the same onClick wiring.
  await page
    .locator("[data-engine-sel-toolbar]")
    .getByRole("button", { name: "Cut" })
    .dispatchEvent("click");

  // The selected word is gone (clipboard write may be blocked in CI, but the
  // model delete runs regardless).
  await expect
    .poll(async () => ((await diag(page)).blockTexts[id] ?? "").length)
    .toBeLessThan(before.length);
});

test("AC8 the selection toolbar bolds the selected word", async ({
  browserName,
  page,
}) => {
  test.skip(
    browserName === "webkit",
    "WebKit cannot construct synthetic Touch events; AC8 runs on mobile-chromium.",
  );
  await open(page);
  const block = page.locator("[data-engine-text-id]").nth(1);
  const box = (await block.boundingBox())!;
  await longPressWord(page, box.x + 24, box.y + 8);

  await page
    .locator("[data-engine-sel-toolbar]")
    .getByRole("button", { name: "Bold" })
    .dispatchEvent("click");

  // A bolded leaf re-renders with a semantic <strong> over the marked run.
  await expect(block.locator("strong")).toHaveCount(1);
});
