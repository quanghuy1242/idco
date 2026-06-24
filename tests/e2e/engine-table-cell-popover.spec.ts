import { expect, test, type Page } from "@playwright/test";

/**
 * Regression: clicking a Fill color (or Vertical align) in the hovered cell's `…` popover
 * must apply the action. The popover is non-modal, so React Aria runs
 * `shouldCloseOnInteractOutside` on focus-out too: pressing a swatch steals focus back to
 * the editor block, and that blur's `relatedTarget` (an editor block) was read as an
 * outside interaction — dismissing the popover on *pointerdown*, before the click applied.
 * A fast synthetic click masked it (the native click fired before React unmounted); a
 * real, slightly slower press did not. The fix keeps the popover open when the
 * interaction/blur target is the editor surface or the popover's own content.
 */
const STORY = "engine--phase-8--full-editor";

async function openCellMenu(page: Page) {
  await page.goto(`/?story=${STORY}`, { waitUntil: "commit" });
  await page.locator("[data-engine-view-root]").waitFor({ state: "visible" });
  const widgets = page.getByText("Widgets", { exact: false }).first();
  await widgets.scrollIntoViewIfNeeded();
  const wb = (await widgets.boundingBox())!;
  await page.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2);
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "Cell actions" }).click();
  const panel = page
    .locator("[data-engine-cell-toolbar]")
    .filter({ hasText: "Fill color" });
  await panel.waitFor({ state: "visible", timeout: 3000 });
  return { panel, widgets };
}

async function cellBg(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const leaf = Array.from(document.querySelectorAll<HTMLElement>("*")).find(
      (e) => e.children.length === 0 && /Widgets/.test(e.textContent || ""),
    );
    let el: HTMLElement | null = leaf ?? null;
    while (el && el.getAttribute("data-engine-structural") !== "tablecell")
      el = el.parentElement;
    return el ? getComputedStyle(el).backgroundColor : "NO-CELL";
  });
}

test("a deliberate (slow) press on a swatch applies the fill", async ({
  page,
}) => {
  const { panel } = await openCellMenu(page);
  const swatch = panel.getByRole("button", { name: /^Fill / }).first();
  const sb = (await swatch.boundingBox())!;
  // Discrete press with a hold — the real-mouse timing that exposed the bug.
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2, {
    steps: 5,
  });
  await page.mouse.down();
  await page.waitForTimeout(120);
  // The popover must survive pointerdown (it used to vanish here).
  await expect(panel).toBeVisible();
  await page.mouse.up();
  await page.waitForTimeout(200);
  // Fill applied: #7f1d1d == rgb(127, 29, 29). And it closes after applying (by design).
  await expect.poll(() => cellBg(page)).toBe("rgb(127, 29, 29)");
});

test("the popover still dismisses (not pinned open) — Escape", async ({
  page,
}) => {
  const { panel } = await openCellMenu(page);
  // Proves the keep-open predicate did not pin the popover: a real dismissal still works.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});

test("clicking outside the popover (in the editor) dismisses it", async ({
  page,
}) => {
  const { panel } = await openCellMenu(page);
  // A click on editor content outside the popover must close it (it must not be
  // pinned open by the keep-open predicate).
  await page.locator("[data-engine-text-id]").first().click();
  await expect(panel).toBeHidden();
});
