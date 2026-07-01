import { test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * Visual capture for the R6-I review affordances (docs/036 §6.2.1/§6.4) — not an assertion spec.
 * `ChangeDetail` shows the diff view rendering every change class (removed mark, attrs, list
 * flavour, object fields, table-cell fill); `ChangeIndicator` shows the live in-editor left-bar,
 * captured before and after an edit. PNGs land in `test-results/diff-detail/` for human/agent
 * review. Chromium only (the non-`engine-*` file name keeps it off webkit/firefox).
 */
const OUT = path.join(process.cwd(), "test-results", "diff-detail");

async function goto(page: Page, story: string): Promise<void> {
  await page.goto(`/?story=engine--diff-detail--${story}`, {
    waitUntil: "commit",
  });
}

test("capture change detail (every §6.4 class)", async ({ page }) => {
  await goto(page, "change-detail");
  await page.locator(".rt-diff-view").first().waitFor({ state: "visible" });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(OUT, "change-detail.png"),
    fullPage: true,
  });
});

test("capture list changes (flat cards + nested indent)", async ({ page }) => {
  await goto(page, "list-changes");
  await page.locator(".rt-diff-view").first().waitFor({ state: "visible" });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(OUT, "list-changes.png"),
    fullPage: true,
  });
});

test("capture change indicator (clean, then after an edit)", async ({
  page,
}) => {
  await goto(page, "change-indicator");
  await page.getByRole("button", { name: "Edit a paragraph" }).waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(OUT, "indicator-clean.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Edit a paragraph" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({
    path: path.join(OUT, "indicator-after-edit.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Delete a paragraph" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({
    path: path.join(OUT, "indicator-after-delete.png"),
    fullPage: true,
  });
});
