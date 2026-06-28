import { expect, test, type Page } from "@playwright/test";

/**
 * R-backlog engine behaviours (note.md §5.8/§5.9) under real layout:
 *  - R2: the empty-document placeholder is visible on an empty doc and clears on
 *    the first character (the painted hint must not survive real typing).
 *  - R3: a chromeless `fillHeight` surface stretches to its container, and a click
 *    in the blank area below the last paragraph lands the caret at the END of the
 *    document — the "click the empty page, type where the text ends" affordance.
 *
 * The static rendering + the `resolveViewStyle` matrix are covered in jsdom
 * (tests/editor/engine-r-backlog.test.tsx); this spec needs real geometry.
 */
const PLACEHOLDER = "engine--owned-model--r2-empty-doc-placeholder";
const FILL = "engine--owned-model--r3-chromeless-fill-height";
const BARE_EMPTY = "engine--owned-model--r3-chromeless-empty-bare-view";
const API = "__IDCO_ENGINE_VIEW_API__";

async function open(page: Page, story: string): Promise<void> {
  await page.goto(`/?story=${story}`, { waitUntil: "commit" });
  await page.locator("[data-engine-view-root]").waitFor({ state: "visible" });
  await page
    .locator("[data-engine-block-id]")
    .first()
    .waitFor({ state: "visible" });
}

test("R2: the placeholder paints on load, before any interaction", async ({
  page,
}) => {
  // The hint is overlay-painted from the block rects, which register after the
  // first render — so the overlay re-renders once post-mount to show it on load
  // rather than only after the first click (note.md §5.8 second follow-up).
  await open(page, BARE_EMPTY);
  await expect(page.locator("[data-engine-placeholder]")).toHaveCount(1);
});

test("R3: the surface shows a text cursor across the whole fill area", async ({
  page,
}) => {
  // The empty area below the text (a fillHeight surface's blank lower half) reads
  // as a click-to-type target — the I-beam, not the default arrow.
  await open(page, BARE_EMPTY);
  const cursor = await page
    .locator("[data-engine-view-root]")
    .evaluate((el) => getComputedStyle(el).cursor);
  expect(cursor).toBe("text");
});

test("R2: placeholder shows on an empty doc and clears on first input", async ({
  page,
}) => {
  await open(page, PLACEHOLDER);

  // The hint is painted in the overlay (not inside the leaf), so the typing fast
  // path cannot wipe or stale it (note.md §5.8 redo).
  const hint = page.locator("[data-engine-placeholder]");
  await expect(hint).toHaveCount(1);
  await expect(hint).toBeVisible();

  // Real input: focus the only block and type. The hint must disappear.
  await page.locator("[data-engine-text-id]").first().click();
  await page.keyboard.type("Hello");
  await page.waitForTimeout(80);

  await expect(page.locator("[data-engine-placeholder]")).toHaveCount(0);
});

test("R2: select-all + Delete clears the text and restores the placeholder (no stale text)", async ({
  page,
}) => {
  await open(page, PLACEHOLDER);
  const block = page.locator("[data-engine-text-id]").first();
  await block.click();
  await page.keyboard.type("ddddddd");
  await page.waitForTimeout(60);
  await expect(page.locator("[data-engine-placeholder]")).toHaveCount(0);

  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await page.waitForTimeout(120);

  // The block DOM is actually cleared (only the zero-width space remains) — the
  // pre-existing fast-path/React-reconciliation staleness that left "ddddddd"
  // behind is fixed (note.md §5.8 redo, the host-text re-sync).
  const domText = await block.evaluate((el) => el.textContent ?? "");
  expect(domText.replace(/​/g, "")).toBe("");
  // ...and the placeholder is back.
  await expect(page.locator("[data-engine-placeholder]")).toHaveCount(1);
});

test("R3: chromeless fillHeight surface stretches and a blank-area click lands the caret at doc end", async ({
  page,
}) => {
  await open(page, FILL);

  const root = page.locator("[data-engine-view-root]");
  const box = (await root.boundingBox())!;
  // The surface fills its 560px flex column (give or take the toolbar above it):
  // it is far taller than its handful of paragraphs, so there is real blank area.
  expect(box.height).toBeGreaterThan(360);

  // Click deep in the blank area below the last paragraph (near the bottom edge).
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 12);
  await page.waitForTimeout(80);

  const result = await page.evaluate((key) => {
    const api = (
      window as unknown as Record<
        string,
        { diagnostics: () => Record<string, unknown> }
      >
    )[key];
    const sel = api.diagnostics().selection as {
      type: string;
      focus?: { node: string; offset: number };
    } | null;
    const textBlocks = Array.from(
      document.querySelectorAll("[data-engine-text-id]"),
    );
    const last = textBlocks[textBlocks.length - 1] as HTMLElement | undefined;
    const lastId = last?.getAttribute("data-engine-text-id") ?? null;
    // The model text length: the rendered text minus the empty-leaf ZWSP.
    const lastLen = (last?.textContent ?? "").replace(/​/g, "").length;
    const rootEl = document.querySelector("[data-engine-view-root]");
    const active = document.activeElement;
    return {
      focusNode: sel?.type === "text" ? (sel.focus?.node ?? null) : null,
      focusOffset: sel?.type === "text" ? (sel.focus?.offset ?? null) : null,
      focusWithin:
        !!active && !!rootEl && (active === rootEl || rootEl.contains(active)),
      lastId,
      lastLen,
      selType: sel?.type ?? null,
    };
  }, API);

  // The caret is a real text caret at the very end of the last text leaf.
  expect(result.selType).toBe("text");
  expect(result.focusNode).toBe(result.lastId);
  expect(result.focusOffset).toBe(result.lastLen);
  expect(result.focusWithin).toBe(true);
  await expect(page.locator("[data-engine-caret]")).not.toHaveCount(0);
});
