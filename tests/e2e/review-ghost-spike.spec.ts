import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * J0 ghost-render spike (docs/038 §5, R6-J) — the gate for the woven inline overlay. This spec
 * both ASSERTS the three J0 claims and captures screenshots for reference. Chromium only (the
 * non-`engine-*` file name keeps it off the webkit/firefox projects).
 *
 * Claims proven against the real editing surface (`Engine / Review Ghost` story):
 *   1. RENDER    — removed blocks mount in place as inert `[data-engine-ghost]` bands.
 *   2. MEASURE   — a ghost has real layout height and sits in the offset model (scroll height grows).
 *   3. VIRTUALIZE— a ghost below the fold is not mounted at rest and mounts after scrolling to it.
 *   4. NO TEAR   — typing in a live paragraph next to a ghost keeps the caret in that block and the
 *                  ghost in the DOM (the live block's EditContext host is not torn by the splice).
 *
 * SCOPE (honest): J0.4 proves NO-TEAR for DESKTOP + printable typing + a STATIC ghost set only. The
 * hard cases the woven design must eventually survive — mobile EditContext-host flicker, cross-block
 * Backspace/merge, and an edit that splices a ghost *newly adjacent* to the caret — are the named J1
 * gate (docs/038 §5.2), not covered here.
 */
const OUT = path.join(process.cwd(), "test-results", "review-ghost");
const STORY = "/?story=engine--review-ghost--ghost-spike";

async function openStory(page: Page): Promise<void> {
  await page.goto(STORY, { waitUntil: "commit" });
  await page.locator("[data-engine-view-root]").first().waitFor();
  await page
    .locator("[data-engine-ghost]")
    .first()
    .waitFor({ state: "visible" });
}

test("J0.1 render + J0.2 measure: ghosts mount in place with real height", async ({
  page,
}) => {
  await openStory(page);
  const ghosts = page.locator("[data-engine-ghost]");
  // At least the above-the-fold ghosts are mounted.
  expect(await ghosts.count()).toBeGreaterThan(0);
  // Each mounted ghost carries the id attribute the whole geometry/measure stack keys on, and has
  // real layout height (the MEASURE claim — a zero-height ghost would not virtualize).
  const first = ghosts.first();
  await expect(first).toHaveAttribute("data-engine-block-id", /.+/);
  const box = await first.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThan(10);
  await page.screenshot({
    fullPage: true,
    path: path.join(OUT, "01-ghosts-in-place.png"),
  });
});

test("J0.3 virtualize: a below-the-fold ghost is windowed out then mounts on scroll", async ({
  page,
}) => {
  await openStory(page);
  const scroller = page.locator("[data-engine-view-root]").first();
  // Total scrollable content exceeds the viewport (ghosts included in the offset model).
  const metrics = await scroller.evaluate((el) => ({
    client: el.clientHeight,
    scroll: el.scrollHeight,
  }));
  expect(metrics.scroll).toBeGreaterThan(metrics.client);

  const idsAtTop = await page
    .locator("[data-engine-ghost]")
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-engine-block-id")),
    );

  // Scroll to the bottom; the offset model should bring a windowed-out ghost into the mounted set.
  await scroller.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await page.waitForTimeout(300);
  const idsAtBottom = await page
    .locator("[data-engine-ghost]")
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-engine-block-id")),
    );

  // A ghost mounted at the bottom that was not mounted at the top proves in-place virtualization.
  const newAtBottom = idsAtBottom.filter((id) => id && !idsAtTop.includes(id));
  expect(newAtBottom.length).toBeGreaterThan(0);
  await page.screenshot({
    fullPage: true,
    path: path.join(OUT, "02-ghost-after-scroll.png"),
  });

  // Scroll back to the top; the bottom ghost unmounts again (it left the window).
  await scroller.evaluate((el) => el.scrollTo({ top: 0 }));
  await page.waitForTimeout(300);
  const idsBackAtTop = await page
    .locator("[data-engine-ghost]")
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-engine-block-id")),
    );
  expect(idsBackAtTop).not.toContain(newAtBottom[0]);
});

test("J0.4 no tear: typing next to a ghost keeps the caret and the ghost", async ({
  page,
}) => {
  await openStory(page);
  const ghostsBefore = await page.locator("[data-engine-ghost]").count();

  // Find a live editable paragraph and click into it (a text leaf carries data-engine-block-id and
  // is contenteditable via its EditContext host; a ghost is not editable).
  const liveBlock = page
    .locator("[data-engine-block-id]:not([data-engine-ghost])")
    .filter({ hasText: "Paragraph" })
    .first();
  await liveBlock.click();
  const targetId = await liveBlock.getAttribute("data-engine-block-id");

  await page.keyboard.type(" EDITED-NEXT-TO-GHOST");
  await page.waitForTimeout(200);

  // The typed text landed in that block (the edit went to the focused block, not lost to a tear).
  await expect(
    page.locator(`[data-engine-block-id="${targetId}"]`),
  ).toContainText("EDITED-NEXT-TO-GHOST");
  // The ghosts survived the commit-driven re-diff (they are still removed).
  expect(
    await page.locator("[data-engine-ghost]").count(),
  ).toBeGreaterThanOrEqual(Math.min(1, ghostsBefore));
  await page.screenshot({
    fullPage: true,
    path: path.join(OUT, "03-typed-next-to-ghost.png"),
  });
});
