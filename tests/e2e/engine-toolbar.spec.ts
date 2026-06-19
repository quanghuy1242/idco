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

test("the block-type menu converts the block to a heading", async ({
  page,
}) => {
  await open(page);
  await selectFirstBlock(page, 0, 0);
  await page.getByRole("button", { name: "Block type" }).click();
  await page.getByRole("menuitem", { name: "Heading 2" }).click();
  await expect
    .poll(async () => {
      const doc = JSON.parse(await compatJson(page));
      return doc.root.children[0].type;
    })
    .toBe("heading");
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
  await page.getByRole("button", { name: "Block type" }).click();
  await page.getByRole("menuitem", { name: "Heading 2" }).click();
  await expect
    .poll(async () => {
      const doc = JSON.parse(await compatJson(page));
      return doc.root.children[0].type;
    })
    .toBe("heading");
});
