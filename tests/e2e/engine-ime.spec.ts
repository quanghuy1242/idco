import { expect, test, type Page } from "@playwright/test";

/**
 * docs/010 Phase 7 — IME, bounds, caret suppression, and goal-column hardening,
 * driven as real interaction on chromium/webkit/firefox. The owned-model view
 * uses the EditContext polyfill here (the story forces it), which is the backend
 * IDCO owns on every browser without a native EditContext.
 *
 * - AC5 a scripted composition paints an engine-owned preedit underline and feeds
 *   the model on commit.
 * - AC4 IME control/selection bounds track the caret and follow it across scroll.
 * - AC6 the surface suppresses the native caret and ::selection.
 * - AC7 vertical navigation holds a goal column through ragged-width lines.
 */
const EDITING_STORY = "engine--owned-model--phase55-editing";
const RAGGED_STORY = "engine--owned-model--phase7-ragged-lines";
const API = "__IDCO_ENGINE_VIEW_API__";

type Diag = {
  order: string[];
  blockTexts: Record<string, string>;
  selection: {
    type: string;
    focus?: { node: string; offset: number };
    anchor?: { node: string; offset: number };
  } | null;
  composition: { node: string; from: number; to: number } | null;
  imeBounds: {
    control: { left: number; top: number; width: number; height: number };
    selection: { left: number; top: number; width: number; height: number };
    characterCount: number;
    firstCharacter: { left: number; top: number } | null;
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

async function open(page: Page, story: string, query = ""): Promise<void> {
  await page.goto(`/?story=${story}${query}`, { waitUntil: "commit" });
  await page.locator("[data-engine-view-root]").waitFor({ state: "visible" });
  await page
    .locator("[data-engine-text-id]")
    .first()
    .waitFor({ state: "visible" });
}

test("native EditContext: feeding IME bounds uses a real DOMRect, not a plain rect", async ({
  page,
  browserName,
}) => {
  // The native Chromium EditContext rejects a non-DOMRect for updateSelectionBounds
  // and the overlay error-boundary then unmounts the caret. The forced-polyfill
  // stories never exercised the native path, so this opens it explicitly. On
  // WebKit/Firefox there is no native EditContext, so this runs over the polyfill.
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page, EDITING_STORY, "&engineInput=native");
  const block = page.locator("[data-engine-text-id]").nth(1);
  await block.click();
  await page.keyboard.type("ok");
  await page.keyboard.press("ArrowLeft");
  // The caret overlay is still painted (the crash would have unmounted it), and
  // no EditContext bounds TypeError was thrown.
  await expect(page.locator("[data-engine-caret]")).toHaveCount(1);
  expect(
    errors.filter((message) => message.includes("updateSelectionBounds")),
  ).toEqual([]);
  expect(browserName).toBeTruthy();
});

test("AC8 triple-click selects the line, not the whole multi-line block", async ({
  page,
}) => {
  await open(page, RAGGED_STORY);
  const block = page.locator("[data-engine-text-id]").first();
  const id = (await block.getAttribute("data-engine-block-id"))!;
  const text = (await diag(page)).blockTexts[id]!;
  const firstNewline = text.indexOf("\n");
  const box = (await block.boundingBox())!;

  // Triple-click on the first visual line.
  await page.mouse.click(box.x + box.width * 0.3, box.y + 6, { clickCount: 3 });
  const sel = (await diag(page)).selection!;
  expect(sel.type).toBe("text");
  const from = Math.min(sel.anchor!.offset, sel.focus!.offset);
  const to = Math.max(sel.anchor!.offset, sel.focus!.offset);
  // The selection is exactly the first line [0, firstNewline), not the whole
  // block (which would extend past the newline to the end).
  expect(from).toBe(0);
  expect(to).toBe(firstNewline);
  expect(to).toBeLessThan(text.length);
});

test("AC5 a scripted composition paints an engine-owned preedit underline", async ({
  page,
}) => {
  await open(page, EDITING_STORY);
  const block = page.locator("[data-engine-text-id]").nth(1);
  const id = (await block.getAttribute("data-engine-block-id"))!;
  const before = (await diag(page)).blockTexts[id]!;
  // Click to place the caret and activate the leaf (binds the polyfill).
  await block.click();

  await page.evaluate(
    ({ blockId }) => {
      const b = document.querySelector(`[data-engine-block-id="${blockId}"]`);
      const ta = b?.shadowRoot?.querySelector("textarea");
      if (!(ta instanceof HTMLTextAreaElement)) {
        throw new Error("no textarea");
      }
      ta.focus();
      ta.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      // The polyfill routes composition through `beforeinput:insertCompositionText`
      // (input-translator.ts), where it calls EditContext._setComposition.
      ta.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          data: "ni",
          inputType: "insertCompositionText",
          isComposing: true,
        }),
      );
    },
    { blockId: id },
  );

  // The engine recorded a preedit range and painted an underline over it (AC5).
  await expect
    .poll(async () => (await diag(page)).composition !== null, {
      timeout: 5000,
    })
    .toBe(true);
  const comp = (await diag(page)).composition!;
  expect(comp.node).toBe(id);
  expect(comp.to).toBeGreaterThan(comp.from);
  expect(await page.locator("[data-engine-preedit]").count()).toBeGreaterThan(
    0,
  );

  // Commit and assert the composition clears and the text lands in the model.
  await page.evaluate(
    ({ blockId }) => {
      const b = document.querySelector(`[data-engine-block-id="${blockId}"]`);
      const ta = b?.shadowRoot?.querySelector("textarea");
      if (!(ta instanceof HTMLTextAreaElement)) return;
      ta.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "你" }),
      );
    },
    { blockId: id },
  );
  await expect
    .poll(async () => (await diag(page)).composition === null, {
      timeout: 5000,
    })
    .toBe(true);
  expect(await page.locator("[data-engine-preedit]").count()).toBe(0);
  // The commit lands asynchronously (textupdate → dispatch → render), so poll.
  await expect
    .poll(async () => (await diag(page)).blockTexts[id], { timeout: 5000 })
    .not.toBe(before);
});

test("AC4 IME bounds track the caret and follow it across scroll", async ({
  page,
}) => {
  await open(page, "engine--owned-model--phase55000-blocks");
  const first = page.locator("[data-engine-text-id]").first();
  const id = (await first.getAttribute("data-engine-block-id"))!;
  await first.click();

  // The fed selection bounds sit at the painted caret.
  await expect
    .poll(async () => (await diag(page)).imeBounds !== null)
    .toBe(true);
  const caret = await page.locator("[data-engine-caret]").first().boundingBox();
  const beforeBounds = (await diag(page)).imeBounds!;
  expect(caret).not.toBeNull();
  expect(Math.abs(beforeBounds.selection.top - caret!.y)).toBeLessThan(8);

  // Scroll the surface; the bounds must re-feed at the caret's new viewport
  // position so the OS candidate window follows it (AC4).
  await page.locator("[data-engine-view-root]").evaluate((el) => {
    el.scrollTop = 40;
    el.dispatchEvent(new Event("scroll"));
  });
  await expect
    .poll(async () => {
      const b = await diag(page);
      return b.imeBounds ? b.imeBounds.selection.top : Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(beforeBounds.selection.top - 20);
  void id;
});

test("AC6 the surface suppresses the native caret and ::selection", async ({
  page,
}) => {
  await open(page, EDITING_STORY);
  // The native caret is suppressed on the engine's own editing blocks (where it
  // paints its own caret). Assert on a text block, not the role=application root
  // — WebKit resolves caret-color oddly on a non-editable container, and the
  // block is the meaningful, reliably-transparent target. (The live object
  // editor keeps its caret; that is guarded in engine-objects.spec.ts.)
  const caretColor = await page
    .locator("[data-engine-text-id]")
    .first()
    .evaluate((el) => getComputedStyle(el).caretColor);
  // Transparent renders as rgba(0, 0, 0, 0) in computed styles.
  expect(caretColor.replace(/\s/g, "")).toBe("rgba(0,0,0,0)");

  // A ::selection rule that zeroes the highlight exists in the engine stylesheet.
  const hasSelectionRule = await page.evaluate(() => {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(rules)) {
        const text = rule.cssText;
        if (text.includes("::selection") && text.includes("transparent")) {
          return true;
        }
      }
    }
    return false;
  });
  expect(hasSelectionRule).toBe(true);
});

test("AC7 vertical navigation holds a goal column through ragged lines", async ({
  page,
}) => {
  await open(page, RAGGED_STORY);
  const block = page.locator("[data-engine-text-id]").first();
  const id = (await block.getAttribute("data-engine-block-id"))!;
  const text = (await diag(page)).blockTexts[id]!;
  const firstNewline = text.indexOf("\n");
  const secondNewline = text.indexOf("\n", firstNewline + 1);

  // Place the caret deep into the long first line (a high column), past where
  // the short middle line ends.
  const box = (await block.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.6, box.y + 6);
  const startOffset = (await diag(page)).selection!.focus!.offset;
  expect(startOffset).toBeGreaterThan(8);
  expect(startOffset).toBeLessThan(firstNewline);

  // ArrowDown onto the short line: the caret clamps to its end (shorter column).
  await page.keyboard.press("ArrowDown");
  const onShort = (await diag(page)).selection!.focus!.offset;
  expect(onShort).toBeGreaterThan(firstNewline);
  expect(onShort).toBeLessThanOrEqual(secondNewline);

  // ArrowDown onto the long third line: the goal column is restored, so the
  // caret lands near the original column, not at the short line's short end.
  await page.keyboard.press("ArrowDown");
  const onLong = (await diag(page)).selection!.focus!.offset;
  const columnOnThird = onLong - secondNewline - 1;
  const shortLineLength = secondNewline - firstNewline - 1;
  expect(onLong).toBeGreaterThan(secondNewline);
  // Without a goal column the caret would stick near the short line's column;
  // with it, the third-line column is close to the original (within a few chars).
  expect(columnOnThird).toBeGreaterThan(shortLineLength + 2);
});
