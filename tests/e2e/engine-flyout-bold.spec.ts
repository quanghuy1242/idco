import { expect, test, type Page } from "@playwright/test";

/**
 * Regression: the selection flyout is *sticky* — applying an inline format must not
 * dismiss it, so an author can chain Bold then Italic over the same selection (docs/024
 * §7.2). It regressed for *mouse-drag* selections only: after the drag, clicking a
 * plain flyout button (e.g. Bold) runs `focusEditor()` to restore editor focus, and
 * React Aria's non-modal `useOverlay` runs `shouldCloseOnInteractOutside` on that
 * focus-out (`onBlurWithin`). The blur's `relatedTarget` is an editor block, which the
 * flyout's predicate treated as "outside", so the sticky flyout tore itself down. The
 * keyboard path hid the bug because `focusEditor()` was a no-op there (focus already in
 * the editor, so no blur fired). The fix treats the editing surface as "inside".
 */
const STORY = "engine--phase-8--full-editor";

async function open(page: Page): Promise<void> {
  await page.goto(`/?story=${STORY}`, { waitUntil: "commit" });
  await page.locator("[data-engine-view-root]").waitFor({ state: "visible" });
}

test("keyboard-select then click Bold keeps the flyout open", async ({
  page,
}) => {
  await open(page);
  const block = page.locator("[data-engine-text-id]").nth(1);
  await block.click();
  await page.keyboard.press("Home");
  for (let i = 0; i < 8; i += 1) await page.keyboard.press("Shift+ArrowRight");
  const flyout = page.locator("[data-engine-flyout]");
  await flyout.waitFor({ state: "visible", timeout: 5000 });

  await flyout.getByRole("button", { name: "Bold" }).click();
  await expect(flyout).toBeVisible();
});

test("mouse-drag select then click Bold keeps the flyout open", async ({
  page,
}) => {
  await open(page);
  const block = page.locator("[data-engine-text-id]").nth(1);
  const box = (await block.boundingBox())!;
  // Drag-select a run of text inside the subtitle paragraph.
  await page.mouse.move(box.x + 5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  const flyout = page.locator("[data-engine-flyout]");
  await flyout.waitFor({ state: "visible", timeout: 5000 });

  // Apply Bold — the flyout must survive the focus restore (the regressed case).
  await flyout.getByRole("button", { name: "Bold" }).click();
  await expect(flyout).toBeVisible();

  // Chain a second format on the same selection — still sticky.
  await flyout.getByRole("button", { name: "Italic" }).click();
  await expect(flyout).toBeVisible();
});

test("clicking elsewhere in the document still dismisses the flyout", async ({
  page,
}) => {
  await open(page);
  const block = page.locator("[data-engine-text-id]").nth(1);
  const box = (await block.boundingBox())!;
  await page.mouse.move(box.x + 5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  const flyout = page.locator("[data-engine-flyout]");
  await flyout.waitFor({ state: "visible", timeout: 5000 });

  // A click that collapses the selection must let the flyout go (the coordinator
  // closes it on the selection change), proving the fix did not pin it open.
  await page.locator("[data-engine-text-id]").nth(3).click();
  await expect(flyout).toBeHidden();
});
