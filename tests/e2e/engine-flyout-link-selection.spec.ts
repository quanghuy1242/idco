import { expect, test, type Page } from "@playwright/test";

/**
 * Regression (docs/029 issue #1): a real mouse click into the selection-flyout "Add link"
 * drill-in form's URL input must NOT collapse the model selection.
 *
 * The form is portaled to <body> but rendered inside the editor's React subtree, so its
 * `mousedown` bubbles through React's *component* tree back into the view root's
 * `onRootMouseDown` (gap-cursor caret placement, docs/029 §3.2). Before the fix that handler
 * ran `resolveTextPointAt` at the form's screen coords and dispatched a collapsed caret,
 * destroying the very selection the link was about to apply to — the user-reported "clicking
 * the input loses the selected text". The fix bails the root handler for targets outside the
 * editor DOM. We drive it as a real mouse interaction and read the live model selection through
 * the diagnostics handle, so a regression fails here, not silently.
 */
const STORY = "engine--owned-model--phase8-toolbar-editor";
const API = "__IDCO_ENGINE_VIEW_API__";

async function selectionText(page: Page): Promise<string | null> {
  return page.evaluate((key) => {
    const api = (
      window as unknown as Record<
        string,
        { serializeSelection?: () => string } | undefined
      >
    )[key];
    return api?.serializeSelection?.() ?? null;
  }, API);
}

test("flyout Add-link: clicking the URL input keeps the model selection", async ({
  page,
}) => {
  await page.goto(`/?story=${STORY}`, { waitUntil: "commit" });
  await page
    .locator("[data-engine-view-root]")
    .waitFor({ state: "visible", timeout: 15000 });

  // Real-mouse drag-select a run of text in the first text leaf.
  const block = page.locator("[data-engine-text-id]").first();
  await block.waitFor({ state: "visible" });
  const box = (await block.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 4, y);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.min(120, box.width - 4), y, { steps: 10 });
  await page.mouse.up();

  await page
    .locator("[data-engine-flyout]")
    .waitFor({ state: "visible", timeout: 6000 });
  const selected = await selectionText(page);
  expect(selected, "a non-empty range is selected").toBeTruthy();

  // Open the Add-link drill-in from the flyout (real click).
  await page
    .locator("[data-engine-flyout]")
    .getByRole("button", { name: "Link", exact: true })
    .click();
  const form = page.locator("[data-engine-link-editor]");
  await form.waitFor({ state: "visible", timeout: 6000 });

  // REAL mouse click into the URL input — the gesture that used to collapse the selection.
  const input = form.getByRole("textbox").first();
  const ibox = (await input.boundingBox())!;
  await page.mouse.click(ibox.x + ibox.width / 2, ibox.y + ibox.height / 2);
  await page.waitForTimeout(100);

  // The model selection must be exactly what it was — not collapsed to a caret.
  expect(await selectionText(page)).toBe(selected);

  // And the input is usable: typing lands, then Apply sets the link on the kept selection.
  await page.keyboard.type("https://example.com");
  await expect(input).toHaveValue("https://example.com");
  expect(await selectionText(page)).toBe(selected);
});
