import { test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * Visual capture for the diff view (docs/036 §6.1/§6.3, R6-F) — not an assertion spec. It
 * navigates each `Engine / Diff View` story and writes a PNG to `test-results/diff-view/` for
 * human/agent evaluation of the §6.3 design system (change cards, one status tag, inline
 * track-changes, two-ended moves, foldable context, row-aligned side-by-side). Chromium only (the
 * non-`engine-*` file name keeps it off the webkit/firefox projects).
 */
const OUT = path.join(process.cwd(), "test-results", "diff-view");

async function shot(page: Page, story: string, file: string): Promise<void> {
  await page.goto(`/?story=engine--diff-view--${story}`, {
    waitUntil: "commit",
  });
  await page.locator(".rt-diff-view").first().waitFor({ state: "visible" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, file), fullPage: true });
}

test("capture Overview (unified + side-by-side)", async ({ page }) => {
  await shot(page, "overview", "overview-unified.png");
  await page.getByRole("button", { name: "side-by-side" }).click();
  await page.waitForTimeout(200);
  await page.screenshot({
    path: path.join(OUT, "overview-side-by-side.png"),
    fullPage: true,
  });
});

test("capture text leaves and marks", async ({ page }) => {
  await shot(page, "text-leaves-and-marks", "text-and-marks.png");
});

test("capture add / remove / move", async ({ page }) => {
  await shot(page, "add-remove-move", "add-remove-move.png");
});

test("capture structural containers", async ({ page }) => {
  await shot(page, "structural-containers", "structural-containers.png");
});

test("capture inner structural table", async ({ page }) => {
  await shot(page, "inner-structural-table", "inner-structural-table.png");
});

test("capture object blocks", async ({ page }) => {
  await shot(page, "object-blocks", "object-blocks.png");
});

test("capture side-by-side", async ({ page }) => {
  await shot(page, "side-by-side", "side-by-side.png");
});

test("capture edge cases", async ({ page }) => {
  await shot(page, "edge-cases", "edge-cases.png");
});

test("capture focused context", async ({ page }) => {
  await shot(page, "focused-context", "focused-context.png");
});
