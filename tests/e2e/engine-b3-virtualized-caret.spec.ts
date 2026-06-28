import { expect, test, type Page } from "@playwright/test";

/**
 * B3 (note.md §5.3) — the caret must survive a structural edit under virtualization.
 *
 * content-api saw the painted caret vanish on the virtualized path: inserting a
 * table then deleting it lost the caret until a re-click. Isolated to the engine
 * here: a structural edit that removes the DOM host holding focus (the table the
 * caret sat in) drops browser focus to <body>; the model remaps the caret onto a
 * surviving block, but nothing re-homed DOM focus, so the focus-within gate filtered
 * the painted caret and typing was dead until a re-click. The fix is a commit-driven
 * focus reclaim in the view (react-view.tsx). The decisive signal is the gap between
 * the MODEL (a collapsed text selection — the engine thinks there is a caret) and
 * the DOM (focus inside the surface + `[data-engine-caret]` painted).
 *
 * The delete here is a bare `store.command({type:"remove-block"})` with NO follow-up
 * `focus()` call — the path a host button or programmatic edit takes, and the one
 * that exposed the bug (the toolbar's own `focusEditor` masked it).
 */
const SMALL = "engine--owned-model--b3-virtualized-small-doc";
const EMPTY = "engine--owned-model--b3-virtualized-empty-doc";
const API = "__IDCO_ENGINE_VIEW_API__";

type Diag = {
  selectionType: string | null;
  focusNode: string | null;
  virtualized: boolean;
  mounted: boolean;
  focusWithinRoot: boolean;
};

async function diag(page: Page): Promise<Diag> {
  return page.evaluate((key) => {
    const api = (
      window as unknown as Record<
        string,
        { diagnostics: () => Record<string, unknown> }
      >
    )[key];
    const d = api.diagnostics();
    const sel = d.selection as {
      type: string;
      focus?: { node: string };
    } | null;
    const focusNode = sel?.type === "text" && sel.focus ? sel.focus.node : null;
    const root = document.querySelector("[data-engine-view-root]");
    const active = document.activeElement as HTMLElement | null;
    return {
      focusNode,
      focusWithinRoot:
        !!active && !!root && (active === root || root.contains(active)),
      mounted: focusNode
        ? !!document.querySelector(`[data-engine-block-id="${focusNode}"]`)
        : false,
      selectionType: sel?.type ?? null,
      virtualized: d.virtualized as boolean,
    };
  }, API);
}

async function caretCount(page: Page): Promise<number> {
  return page.locator("[data-engine-caret]").count();
}

async function open(page: Page, story: string): Promise<void> {
  await page.goto(`/?story=${story}`, { waitUntil: "commit" });
  await page.locator("[data-engine-view-root]").waitFor({ state: "visible" });
  await page
    .locator("[data-engine-block-id]")
    .first()
    .waitFor({ state: "visible" });
}

test("caret survives a real toolbar table insert then a bare remove-block", async ({
  page,
}) => {
  await open(page, SMALL);
  expect((await diag(page)).virtualized).toBe(true);

  // A real caret in a text block (index 0 is the heading).
  await page.locator("[data-engine-text-id]").nth(1).click();
  expect(await caretCount(page)).toBeGreaterThan(0);

  // Real toolbar: Insert tab -> Table -> a 2x2 table. The caret lands INSIDE a
  // table cell (a nested sub-engine host).
  await page.getByRole("tab", { name: "Insert" }).click();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.getByRole("button", { name: "2 by 2", exact: true }).click();
  await page.waitForTimeout(80);

  // Delete the whole table with a bare command and NO focus() follow-up — the path
  // that orphaned focus. The selection must remap out of the destroyed subtree.
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
    const handle = api.getEditorHandle();
    const tableId = api.diagnostics().order[2];
    if (tableId) handle.dispatch({ node: tableId, type: "remove-block" });
  }, API);

  // Settle past the structural re-render and the commit-driven focus reclaim.
  await page.waitForTimeout(250);
  const after = await diag(page);

  // The model holds a text caret on a mounted, surviving block...
  expect(after.selectionType).toBe("text");
  expect(after.mounted).toBe(true);
  // ...and the engine re-homed DOM focus onto it, so the caret is painted again.
  expect(after.focusWithinRoot).toBe(true);
  expect(await caretCount(page)).toBeGreaterThan(0);
});

test("an empty virtualized document shows a caret when focused", async ({
  page,
}) => {
  await open(page, EMPTY);
  expect((await diag(page)).virtualized).toBe(true);

  const block = page.locator("[data-engine-block-id]").first();
  const box = (await block.boundingBox())!;
  await page.mouse.click(
    box.x + Math.min(20, box.width / 2),
    box.y + box.height / 2,
  );
  await page.waitForTimeout(60);
  const d = await diag(page);

  expect(d.selectionType).toBe("text");
  expect(d.focusWithinRoot).toBe(true);
  expect(await caretCount(page)).toBeGreaterThan(0);
});
