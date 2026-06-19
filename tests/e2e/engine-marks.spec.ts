import { expect, test, type Page } from "@playwright/test";

/**
 * docs/010 Phase 8 AC3 — marks render to the DOM as semantic elements, and the
 * caret/selection geometry stays correct across the resulting many-text-node
 * block. Driven as real interaction so the pixel-level geometry (not just the
 * offset math the unit test covers) is proven on a real browser.
 */
const STORY = "engine--owned-model--phase8-formatted-run";
const API = "__IDCO_ENGINE_VIEW_API__";

type Diag = {
  order: string[];
  selection: {
    type: string;
    focus?: { node: string; offset: number };
  } | null;
  selectionRectCount: number;
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
}

test("marks render as semantic elements within one block", async ({ page }) => {
  await open(page);
  const block = page.locator("[data-engine-text-id]").first();
  // "bold" and "bolditalic" both carry bold; assert at least one of each mark.
  await expect(
    block.locator("strong[data-engine-mark='bold']").first(),
  ).toBeVisible();
  await expect(
    block.locator("em[data-engine-mark='italic']").first(),
  ).toBeVisible();
  const link = block.locator("a[data-engine-mark='link']");
  await expect(link).toHaveText("a link");
  await expect(link).toHaveAttribute(
    "data-engine-mark-href",
    "https://idco.dev",
  );
  // The visible text equals the model text across all the spans.
  await expect(block).toContainText("plain boldbolditalic then a link end");
});

test("selection paints across the formatted run", async ({ page }) => {
  await open(page);
  const id = (await diag(page)).order[0]!;
  // Select [0, 20): plain + bold + bolditalic — three text nodes across spans.
  await page.evaluate(
    ({ key, node }) => {
      const api = (
        window as unknown as Record<
          string,
          { selectText: (a: string, b: number, c: string, d: number) => void }
        >
      )[key];
      api.selectText(node, 0, node, 20);
    },
    { key: API, node: id },
  );
  await expect
    .poll(async () => (await diag(page)).selectionRectCount)
    .toBeGreaterThan(0);
  const selection = (await diag(page)).selection;
  expect(selection?.type).toBe("text");
});

test("clicking inside the link maps to a model offset within the link run", async ({
  page,
}) => {
  await open(page);
  const link = page.locator("a[data-engine-mark='link']");
  await link.click();
  const selection = (await diag(page)).selection;
  expect(selection?.type).toBe("text");
  // The link covers offsets [26, 32) ("a link"); the caret landed inside it,
  // proving point→model-offset mapping walks the descendant text nodes (AC3).
  const offset = selection?.focus?.offset ?? -1;
  expect(offset).toBeGreaterThanOrEqual(26);
  expect(offset).toBeLessThanOrEqual(32);
});
