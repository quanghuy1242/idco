import { expect, test, type Page } from "@playwright/test";

/**
 * Regression: the selection-flyout's "Add a comment" / "Add to glossary" child popovers
 * must accept focus + clicks in their input. They were `PopoverTrigger` modals nested in
 * the non-modal flyout, so React Aria's modal infrastructure rendered a body-portaled
 * overlay over the popover that swallowed pointer events — the input was unfocusable
 * (popover.tsx now makes the popover non-modal). Driven as real interaction: Playwright's
 * actionability does a hit-test, so `click()`/`fill()` THROW "intercepts pointer events" if
 * the blocking overlay ever returns — making this a true guard, not a smoke test.
 */
const STORY = "engine--phase-8--full-editor";

async function open(page: Page): Promise<void> {
  await page.goto(`/?story=${STORY}`, { waitUntil: "commit" });
  await page.locator("[data-engine-view-root]").waitFor({ state: "visible" });
}

/** Select a run of text in the subtitle paragraph so the selection flyout appears. */
async function selectSomeText(page: Page): Promise<void> {
  // The 2nd text block is the subtitle ("An owned-model editor with …"). Click near its start
  // (plain text), not its centre: the subtitle ends in a "real link", and a centre click can
  // land on it, which now correctly opens the click-to-edit link form (AC9) and focuses its URL
  // field — capturing the keyboard. We want a plain caret here to drive a keyboard selection.
  const block = page.locator("[data-engine-text-id]").nth(1);
  await block.click({ position: { x: 6, y: 8 } });
  await page.keyboard.press("Home");
  for (let i = 0; i < 8; i += 1) await page.keyboard.press("Shift+ArrowRight");
  // The flyout raises on a *settled* selection (a short debounce), so wait for it.
  await page
    .locator("[data-engine-flyout]")
    .waitFor({ state: "visible", timeout: 5000 });
}

test("the Add-to-glossary popover input takes focus and typed text", async ({
  page,
}) => {
  await open(page);
  await selectSomeText(page);

  await page
    .locator("[data-engine-flyout]")
    .getByRole("button", { name: "Add to glossary" })
    .click();

  const popover = page.locator("[data-engine-glossary-add]");
  await popover.waitFor({ state: "visible" });

  // The first field is the "Search terms" input. It autofocuses on open (non-modal popover
  // focuses explicitly); if a modal overlay were on top, the click would throw "intercepts
  // pointer events" and the fill proves keystrokes land.
  const input = popover.getByRole("textbox").first();
  await expect(input).toBeFocused();
  await input.click();
  await input.fill("widget");
  await expect(input).toHaveValue("widget");
});

test("the Add-a-comment popover input takes focus and typed text", async ({
  page,
}) => {
  await open(page);
  await selectSomeText(page);

  await page
    .locator("[data-engine-flyout]")
    .getByRole("button", { name: "Add a comment" })
    .click();

  const popover = page.locator("[data-engine-comment-add]");
  await popover.waitFor({ state: "visible" });

  // The comment field autofocuses on open (non-modal popover focuses explicitly), then
  // accepts a click + typed text. The reported bug was that a body overlay intercepted the
  // input; Playwright's click throws "intercepts pointer events" if that overlay returns.
  const input = popover.getByRole("textbox", { name: "Comment" });
  await expect(input).toBeFocused();
  await input.click();
  await input.fill("looks good");
  await expect(input).toHaveValue("looks good");
});
