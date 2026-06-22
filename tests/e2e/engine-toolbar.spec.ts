import { expect, test, type Page } from "@playwright/test";

/**
 * docs/010 Phase 8 AC2 — the @idco/ui toolbar drives the model selection, as
 * real browser interaction against the full OwnedModelEditor. Proves the bold
 * toggle, the block-type menu, and the link popover actually mutate the model
 * (not just in jsdom).
 */
const STORY = "engine--owned-model--phase8-toolbar-editor";
const API = "__IDCO_ENGINE_VIEW_API__";

async function open(page: Page): Promise<void> {
  await page.goto(`/?story=${STORY}`, { waitUntil: "commit" });
  await page.locator("[data-engine-view-root]").waitFor({ state: "visible" });
}

/** The first text block id, and a helper to select a range in it. */
async function selectFirstBlock(
  page: Page,
  from: number,
  to: number,
): Promise<string> {
  return page.evaluate(
    ({ key, from: a, to: b }) => {
      const api = (
        window as unknown as Record<
          string,
          {
            diagnostics: () => { order: string[] };
            selectText: (n: string, x: number, m: string, y: number) => void;
          }
        >
      )[key];
      const id = api.diagnostics().order[0]!;
      api.selectText(id, a, id, b);
      return id;
    },
    { from, key: API, to },
  );
}

async function compatJson(page: Page): Promise<string> {
  return page.evaluate((key) => {
    const api = (
      window as unknown as Record<
        string,
        { getEditorHandle: () => { getDocument: () => unknown } }
      >
    )[key];
    return JSON.stringify(api.getEditorHandle().getDocument());
  }, API);
}

test("the bold toolbar button toggles a bold mark on the model selection", async ({
  page,
}) => {
  await open(page);
  await selectFirstBlock(page, 0, 5);
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  // The model now carries a bold run: the compat projection has format bit 1.
  await expect
    .poll(async () => {
      const doc = JSON.parse(await compatJson(page));
      const para = doc.root.children[0];
      return (para.children as { format?: number }[]).some(
        (c) => ((c.format ?? 0) & 1) === 1,
      );
    })
    .toBe(true);
});

test("right-clicking a text selection opens a context menu that toggles bold", async ({
  page,
}) => {
  await open(page);
  await selectFirstBlock(page, 0, 5);
  // Right-click the first block; the engine context menu opens at the cursor.
  await page
    .locator("[data-engine-text-id]")
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Bold" }).click();
  await expect
    .poll(async () => {
      const doc = JSON.parse(await compatJson(page));
      const para = doc.root.children[0];
      return (para.children as { format?: number }[]).some(
        (c) => ((c.format ?? 0) & 1) === 1,
      );
    })
    .toBe(true);
});

test("the block-type menu converts the block to a heading", async ({
  page,
}) => {
  await open(page);
  await selectFirstBlock(page, 0, 0);
  await page.getByRole("button", { name: "Text style" }).click();
  await page.getByRole("menuitem", { name: "Heading 2" }).click();
  await expect
    .poll(async () => {
      const doc = JSON.parse(await compatJson(page));
      return doc.root.children[0].type;
    })
    .toBe("heading");
});

test("the find popover opens, searches the model, and stays open while navigating", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Find in document" }).click();
  const input = page.getByRole("textbox", { name: "Find" });
  await input.waitFor({ state: "visible" });
  await input.fill("bold");
  // The search selected a match on the model (find reads the model, not the DOM).
  await expect
    .poll(async () =>
      page.evaluate((key) => {
        const api = (
          window as unknown as Record<
            string,
            { diagnostics: () => { selection: { type: string } | null } }
          >
        )[key];
        return api.diagnostics().selection?.type ?? null;
      }, API),
    )
    .toBe("text");
  // Navigating via the in-popover button keeps the popover open (non-modal).
  await page.getByRole("button", { name: "Next match" }).click();
  await expect(input).toBeVisible();
});

test("the link popover sets a link on the selection", async ({ page }) => {
  await open(page);
  await selectFirstBlock(page, 0, 5);
  await page.getByRole("button", { name: "Link", exact: true }).click();
  const url = page.getByRole("textbox", { name: "Link URL" });
  await url.waitFor({ state: "visible" });
  await url.fill("https://idco.dev");
  await page.getByRole("button", { name: "Apply link" }).click();
  await expect
    .poll(async () => await compatJson(page))
    .toContain("https://idco.dev");
});

test("a real mouse caret then the block-type menu converts to a heading", async ({
  page,
}) => {
  await open(page);
  // Click into the block with the mouse (the real user flow), not the API, so
  // the model selection comes from a pointer caret and the toolbar still applies.
  await page.locator("[data-engine-text-id]").first().click();
  await page.getByRole("button", { name: "Text style" }).click();
  await page.getByRole("menuitem", { name: "Heading 2" }).click();
  await expect
    .poll(async () => {
      const doc = JSON.parse(await compatJson(page));
      return doc.root.children[0].type;
    })
    .toBe("heading");
});

test("the toolbar tabs switch the visible command row (docs/023)", async ({
  page,
}) => {
  await open(page);
  // Home is the default tab: its format marks (Bold) show, Insert's Table does not.
  await expect(
    page.getByRole("button", { name: "Bold", exact: true }),
  ).toBeVisible();
  // Switch to Insert: the Table tool appears, the Home-only Bold button is gone.
  await page.getByRole("tab", { name: "Insert" }).click();
  await expect(
    page.getByRole("button", { name: "Table", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Bold", exact: true }),
  ).toHaveCount(0);
  // Switch back to Home: Bold returns (the active tab preserves its command row).
  await page.getByRole("tab", { name: "Home" }).click();
  await expect(
    page.getByRole("button", { name: "Bold", exact: true }),
  ).toBeVisible();
});

test("the Insert table dimension picker inserts a sized table (docs/023 §7.2)", async ({
  page,
}) => {
  await open(page);
  // Leave a caret in the first block, then open Insert → Table and pick 2 × 3.
  await page.locator("[data-engine-text-id]").first().click();
  await page.getByRole("tab", { name: "Insert" }).click();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  // The grid cells are labelled "<cols> by <rows>"; picking "2 by 3" inserts a
  // 3-row, 2-column table. That the insert lands at all proves the model selection
  // survived the popover taking focus (the toolbar was not blur-disabled).
  await page.getByRole("button", { name: "2 by 3", exact: true }).click();
  await expect
    .poll(async () => {
      const doc = JSON.parse(await compatJson(page));
      const table = (doc.root.children as { type: string }[]).find(
        (c) => c.type === "table",
      ) as { children?: unknown[] } | undefined;
      return table?.children?.length ?? 0;
    })
    .toBe(3);
});
