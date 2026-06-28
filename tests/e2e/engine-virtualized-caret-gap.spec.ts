import { expect, test, type Page } from "@playwright/test";

/**
 * Virtualized-path caret/gap regressions (note.md §5.3 follow-up — the consumer's
 * "insert then remove a table → caret gone" and "horizontal caret invisible"
 * reports). Three distinct bugs, all specific to `virtualize` (the path the existing
 * gap-cursor / B3 specs did NOT cover — they run `virtualize={false}`):
 *
 *  1. Removing the body's LAST block left `order: []` (inserting a table into an
 *     empty doc replaces the only paragraph; removing the table empties the doc).
 *     An empty body has no caret target, so the selection fell back to a root gap
 *     that paints nothing once focus drops to <body>. Fix: `compileRemoveBlock`
 *     re-seeds an empty paragraph and lands a text caret in it.
 *  2. The gap (horizontal) cursor never painted under virtualization: a gap
 *     selection focuses the OUTER scroller root, but the overlay's focus-within gate
 *     checked the inner content div (the geometry anchor), which does not contain
 *     the scroller root. Fix: the gate checks the scroller root (`focusRootRef`).
 *  3. The virtualized scroller had `padding: 0`, jamming text against the edge,
 *     unlike the non-virtualized path's 16px inset. Fix: same inset on both paths,
 *     with the windowing compensating for the scroller's top padding.
 */
const EMPTY = "engine--owned-model--b3-virtualized-empty-doc";
const SMALL = "engine--owned-model--b3-virtualized-small-doc";
const API = "__IDCO_ENGINE_VIEW_API__";

async function open(page: Page, story: string): Promise<void> {
  await page.goto(`/?story=${story}`, { waitUntil: "commit" });
  await page.locator("[data-engine-view-root]").waitFor({ state: "visible" });
  await page
    .locator("[data-engine-block-id]")
    .first()
    .waitFor({ state: "visible" });
}

async function insertTable(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Insert" }).click();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.getByRole("button", { name: "2 by 2", exact: true }).click();
  await page.waitForTimeout(120);
}

async function caretState(page: Page) {
  return page.evaluate((key) => {
    const api = (
      window as unknown as Record<
        string,
        { diagnostics: () => Record<string, unknown> }
      >
    )[key];
    const diag = api.diagnostics();
    const sel = diag.selection as {
      type: string;
      focus?: { node: string };
    } | null;
    const focusNode = sel?.type === "text" ? (sel.focus?.node ?? null) : null;
    const root = document.querySelector("[data-engine-view-root]");
    const active = document.activeElement;
    return {
      selType: sel?.type ?? null,
      order: diag.order as string[],
      mounted: focusNode
        ? !!document.querySelector(`[data-engine-block-id="${focusNode}"]`)
        : false,
      focusWithinRoot:
        !!active && !!root && (active === root || root.contains(active)),
      caretCount: document.querySelectorAll("[data-engine-caret]").length,
    };
  }, API);
}

test("empty doc: insert a table then remove it via the control keeps a caret", async ({
  page,
}) => {
  await open(page, EMPTY);
  await page.locator("[data-engine-text-id]").first().click();
  await insertTable(page);

  // Remove via the real "Remove table" control (portaled to <body>, the path that
  // orphaned focus and emptied the document).
  await page.locator("table").first().hover();
  await page.waitForTimeout(120);
  await page
    .getByRole("button", { name: /remove table/i })
    .first()
    .click();
  await page.waitForTimeout(350);

  const after = await caretState(page);
  // The doc is re-seeded with one paragraph and a live text caret is painted.
  expect(after.selType).toBe("text");
  expect(after.order.length).toBe(1);
  expect(after.mounted).toBe(true);
  expect(after.focusWithinRoot).toBe(true);
  expect(after.caretCount).toBeGreaterThan(0);
});

test("empty doc: insert a table then a bare remove-block keeps a caret", async ({
  page,
}) => {
  await open(page, EMPTY);
  await page.locator("[data-engine-text-id]").first().click();
  await insertTable(page);

  await page.evaluate((key) => {
    const api = (
      window as unknown as Record<
        string,
        {
          diagnostics: () => { order: string[] };
          getEditorHandle: () => { dispatch: (c: unknown) => void };
        }
      >
    )[key];
    const order = api.diagnostics().order;
    const tableId = order.find((id) => {
      const el = document.querySelector(`[data-engine-block-id="${id}"]`);
      return (
        el?.querySelector("table") !== null ||
        el?.getAttribute("data-engine-structural") === "table"
      );
    });
    api.getEditorHandle().dispatch({ node: tableId, type: "remove-block" });
  }, API);
  await page.waitForTimeout(350);

  const after = await caretState(page);
  expect(after.selType).toBe("text");
  expect(after.order.length).toBe(1);
  expect(after.caretCount).toBeGreaterThan(0);
});

test("the gap (horizontal) cursor paints on the virtualized path", async ({
  page,
}) => {
  await open(page, SMALL);
  await page.locator("[data-engine-text-id]").nth(1).click();

  // A gap selection focuses the scroller root (what `focusRoot` does). Before the
  // fix this filtered the gap cursor out (the gate checked the inner content div).
  await page.evaluate((key) => {
    const api = (
      window as unknown as Record<
        string,
        { getEditorHandle: () => { setSelection: (s: unknown) => void } }
      >
    )[key];
    api
      .getEditorHandle()
      .setSelection({ index: 2, scope: "idco_node_root", type: "gap" });
    (document.querySelector("[data-engine-view-root]") as HTMLElement).focus();
  }, API);
  await page.waitForTimeout(150);

  const gap = page.locator("[data-engine-gap-cursor]");
  await expect(gap).toHaveCount(1);
  const box = (await gap.boundingBox())!;
  expect(box.width).toBeGreaterThan(1);
  expect(box.height).toBeGreaterThan(0);
});

test("the virtualized surface insets its content like the non-virtualized path", async ({
  page,
}) => {
  await open(page, SMALL);
  const inset = await page.evaluate(() => {
    const root = document.querySelector("[data-engine-view-root]")!;
    const block = document.querySelector("[data-engine-block-id]")!;
    const rr = root.getBoundingClientRect();
    const br = block.getBoundingClientRect();
    return {
      virtualized: root.hasAttribute("data-engine-virtualized"),
      left: Math.round(br.left - rr.left),
      top: Math.round(br.top - rr.top),
    };
  });
  expect(inset.virtualized).toBe(true);
  // ~16px scroller padding + 1px border; was ~1px (jammed) before the fix.
  expect(inset.left).toBeGreaterThanOrEqual(15);
  expect(inset.top).toBeGreaterThanOrEqual(15);
});
