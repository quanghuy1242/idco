import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * Active review surface + cursor spec (docs/038 §7/§16, R6-J J4). Proves the load-bearing J4 claims
 * against the real editing surface + a legibility screenshot. Chromium only (non-`engine-*` name).
 *
 * Claims proven against the `Engine / Review Cursor` story (3 changes: two text edits + one removal):
 *   1. ONE SURFACE — exactly one `[data-engine-review-surface]` renders (one by construction).
 *   2. CURSOR NAV — Next steps "Change i of n" forward and reveals (scrolls to) the change; Prev steps back.
 *   3. FOCUS NOT TORN — a taking-focus surface that reclaims: after a terminal action (Accept) DOM focus
 *      is back inside the editor (the surface's `focusEditor` reclaim), and the model selection survives.
 *   4. ACCEPT / REJECT FUNCTIONAL — Accept resolves a change keeping it (pending count drops, its
 *      "[EDITED]" text stays); Reject reverts the block live (its "[REVISED]" text disappears).
 */
const OUT = path.join(process.cwd(), "test-results", "review-cursor");
const STORY = "/?story=engine--review-cursor--active-review-surface";
const SURFACE = "[data-engine-review-surface]";

async function open(page: Page): Promise<void> {
  await page.goto(STORY, { waitUntil: "commit" });
  await page.locator("[data-engine-view-root]").first().waitFor();
  await page.locator(SURFACE).waitFor({ state: "visible" });
  await page.waitForTimeout(150);
}

/** Whether DOM focus is inside the editor root (the focus-safety signal — no engine API needed). */
async function focusWithinEditor(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.querySelector("[data-engine-view-root]");
    const active = document.activeElement;
    return !!active && !!root && (active === root || root.contains(active));
  });
}

async function docText(page: Page): Promise<string> {
  return (
    (await page.locator("[data-engine-view-root]").first().innerText()) ?? ""
  );
}

test("J4 one surface + cursor nav + focus-safe accept/reject", async ({
  page,
}) => {
  await open(page);
  const surface = page.locator(SURFACE);

  // (1) Exactly one active surface, on the first change.
  expect(await surface.count()).toBe(1);
  await expect(surface).toContainText("Change 1 of 3");
  await page.screenshot({
    fullPage: true,
    path: path.join(OUT, "01-surface.png"),
  });

  // (2) Next reveals (scrolls to) the 2nd change; Prev steps back — always exactly one surface.
  const scroller = page.locator("[data-engine-view-root]").first();
  const before = await scroller.evaluate((el) => el.scrollTop);
  await page.getByRole("button", { name: "Next change" }).click();
  await page.waitForTimeout(220);
  await expect(surface).toContainText("Change 2 of 3");
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
  expect(await surface.count()).toBe(1);

  // (2b) The 3rd change is a REMOVAL — its block is absent from the live document, so the cursor
  // reveals the surviving NEIGHBOR ABOVE the gap (else scroll-to-block would no-op and the surface would
  // vanish; and revealing the block ABOVE keeps the ghost on screen). The surface stays visible on
  // "Change 3 of 3 · Removed", the scroller moved down, AND the removed ghost is actually IN the viewport.
  const atChange2 = await scroller.evaluate((el) => el.scrollTop);
  await page.getByRole("button", { name: "Next change" }).click();
  await page.waitForTimeout(260);
  await expect(surface).toContainText("Change 3 of 3");
  await expect(surface).toContainText("Removed");
  expect(await surface.count()).toBe(1);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(
    atChange2,
  );
  // The removed block's ghost renders in place and is on screen (Finding 1a — not pushed off the top).
  await expect(page.locator("[data-engine-ghost]").first()).toBeInViewport();

  await page.getByRole("button", { name: "Previous change" }).click();
  await page.waitForTimeout(220);
  await page.getByRole("button", { name: "Previous change" }).click();
  await page.waitForTimeout(220);
  await expect(surface).toContainText("Change 1 of 3");

  // (3+4a) Focus reclaim + Accept functional: put a caret in a visible editable block, then Accept.
  // The surface takes focus on press but a terminal action RECLAIMS editor focus, so focus is back in
  // the editor afterwards; the pending count drops to 2 and the accepted edit's "[EDITED]" text stays.
  await page.locator("[data-engine-text-id]").first().click();
  expect(await focusWithinEditor(page)).toBe(true);
  await page.getByRole("button", { name: "Accept this change" }).click();
  await page.waitForTimeout(200);
  expect(await focusWithinEditor(page)).toBe(true); // focus reclaimed to the editor after the action
  await expect(surface).toContainText("of 2");
  expect(await docText(page)).toContain("[EDITED]");

  // (4b) Reject reverts a block live: the cursor now sits on the "[REVISED]" edit; rejecting it removes
  // that proposed text from the live document.
  expect(await docText(page)).toContain("[REVISED]");
  await page.getByRole("button", { name: "Reject this change" }).click();
  await page.waitForTimeout(250);
  expect(await docText(page)).not.toContain("[REVISED]");
  await page.screenshot({
    fullPage: true,
    path: path.join(OUT, "02-after-accept-reject.png"),
  });
});
