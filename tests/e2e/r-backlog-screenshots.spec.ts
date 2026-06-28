import { test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * Visual capture for the R-backlog (note.md §5.7–5.10) — not an assertion spec.
 * It navigates each R-story and writes a PNG to `test-results/r-backlog/` for
 * human/agent evaluation of the placeholder, chromeless/fill-height surface, the
 * ghost title input, and the PageBody width steps. Runs on chromium only (the
 * non-`engine-*` name keeps it off the webkit/firefox projects).
 */
const OUT = path.join(process.cwd(), "test-results", "r-backlog");

async function shot(
  page: Page,
  story: string,
  file: string,
  ready: string,
): Promise<void> {
  await page.goto(`/?story=${story}`, { waitUntil: "commit" });
  // Wait for a concrete element of the story (the chunk compiles on first
  // navigation, so a flat timeout can catch a blank frame).
  await page.locator(ready).first().waitFor({ state: "visible" });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, file), fullPage: true });
}

async function shotEditor(
  page: Page,
  story: string,
  file: string,
): Promise<void> {
  await page.goto(`/?story=${story}`, { waitUntil: "commit" });
  await page.locator("[data-engine-view-root]").waitFor({ state: "visible" });
  await page
    .locator("[data-engine-block-id]")
    .first()
    .waitFor({ state: "visible" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, file), fullPage: true });
}

test("capture R1 PageBody width steps", async ({ page }) => {
  await shot(
    page,
    "packages-ui--foundations--page-body-widths",
    "r1-pagebody-widths.png",
    "header",
  );
});

test("capture R4 ghost title input", async ({ page }) => {
  await shot(
    page,
    "packages-ui--forms--ghost-title-input",
    "r4-ghost-title.png",
    "input.input",
  );
});

test("capture R2 empty-doc placeholder (before + after typing)", async ({
  page,
}) => {
  await shotEditor(
    page,
    "engine--owned-model--r2-empty-doc-placeholder",
    "r2-placeholder-before.png",
  );
  // After typing the hint must be gone — capture the contrast.
  await page.locator("[data-engine-text-id]").first().click();
  await page.keyboard.type("My first document");
  await page.waitForTimeout(150);
  await page.screenshot({
    path: path.join(OUT, "r2-placeholder-after.png"),
    fullPage: true,
  });
});

test("capture R3 chromeless fill-height (non-virtualized)", async ({
  page,
}) => {
  await shotEditor(
    page,
    "engine--owned-model--r3-chromeless-fill-height",
    "r3-chromeless-fill.png",
  );
});

test("capture R3 fill-height (virtualized)", async ({ page }) => {
  await shotEditor(
    page,
    "engine--owned-model--r3-fill-height-virtualized",
    "r3-fill-virtualized.png",
  );
});

test("capture R3 chromeless empty bare view (placeholder + fill)", async ({
  page,
}) => {
  await shotEditor(
    page,
    "engine--owned-model--r3-chromeless-empty-bare-view",
    "r3-bare-empty.png",
  );
});
