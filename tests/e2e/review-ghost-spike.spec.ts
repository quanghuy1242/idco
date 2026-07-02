import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * Woven ghost-render spec (docs/038 §5, R6-J) — the J0 top-level gate PLUS the J2 in-container +
 * per-container-budget claims. Asserts each claim against the real editing surface and captures
 * screenshots for reference. Chromium only (the non-`engine-*` file name keeps it off webkit/firefox).
 *
 * Claims proven against the `Engine / Review Ghost` story:
 *   1. RENDER (J0)       — removed top-level blocks mount in place as inert `[data-engine-ghost]` bands.
 *   2. MEASURE (J0)      — a ghost has real layout height and sits in the offset model.
 *   3. VIRTUALIZE (J0)   — a top-level ghost below the fold is not mounted at rest and mounts on scroll.
 *   4. NO TEAR (J0)      — typing in a live paragraph next to a ghost keeps the caret and the ghost.
 *   5. IN-CONTAINER (J2) — a removed list ITEM renders in place as a ghost INSIDE its surviving list
 *                          (via the ReviewModel's merged child order, not a top-level short-circuit).
 *   6. BUDGET (J2)       — a deletion-heavy list splices at most the budget of ghost items and drops
 *                          the surplus (cost bounded; the dropped count is on `ReviewModel.collapsed`,
 *                          and J3 renders the visible "+N removed" affordance).
 *   7. TABLE GATE (J2)   — a table with a removed row renders its live rows only, NEVER a `<div>` ghost
 *                          inside `<table>`/`<tbody>` (faithful `<tr>`/`<td>` ghosts are J3).
 *
 * SCOPE (honest): J0.4 proves NO-TEAR for DESKTOP + printable typing + a STATIC ghost set only. The
 * hard cases the woven design must eventually survive — mobile EditContext-host flicker, cross-block
 * Backspace/merge, and an edit that splices a ghost *newly adjacent* to the caret — are the named
 * hard-no-tear gate (docs/038 §5.2), not covered here.
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

// The lists sit below the top-level paragraphs, so they start windowed out; scroll the scroller to
// the bottom to mount them before asserting their in-container ghosts.
async function scrollToBottom(page: Page): Promise<void> {
  const scroller = page.locator("[data-engine-view-root]").first();
  await scroller.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await page.waitForTimeout(300);
}

test("J2.5 in-container: a removed list item renders as a ghost inside its surviving list", async ({
  page,
}) => {
  await openStory(page);
  await scrollToBottom(page);
  // A surviving list is a live container; its removed items render in place as ghosts spliced into
  // the list's own child assembly (the ReviewModel's merged childOrder), NOT the top-level flow.
  const listGhosts = page.locator(
    '[data-engine-structural="list"] [data-engine-ghost="listitem"]',
  );
  expect(await listGhosts.count()).toBeGreaterThan(0);
  // The first (numbered) list weaves ghosts BETWEEN live items — it still has surviving items.
  const numberedList = page.locator('[data-engine-structural="list"]').first();
  expect(
    await numberedList
      .locator("[data-engine-block-id]:not([data-engine-ghost])")
      .count(),
  ).toBeGreaterThan(0);
  expect(
    await numberedList.locator('[data-engine-ghost="listitem"]').count(),
  ).toBeGreaterThan(0);
  await page.screenshot({
    fullPage: true,
    path: path.join(OUT, "04-in-container-ghost.png"),
  });
});

test("J2.6 budget: a deletion-heavy list splices at most the budget of ghost items (cost bounded)", async ({
  page,
}) => {
  await openStory(page);
  await scrollToBottom(page);
  // The bullet list (the 2nd list) removed 6 items with a story budget of 4, so the woven flow mounts
  // at most 4 ghost items — the surplus is dropped rather than mounting every ghost row (containers do
  // not internally virtualize, so this cap is the load-bearing bound). The dropped count is recorded
  // on `ReviewModel.collapsed` (unit-tested); the visible "+N removed" affordance is J3.
  const bulletList = page.locator('[data-engine-structural="list"]').nth(1);
  const bulletGhosts = bulletList.locator('[data-engine-ghost="listitem"]');
  const count = await bulletGhosts.count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(4);
});

test("J2.7 table gate: a removed table row renders no invalid ghost inside the table", async ({
  page,
}) => {
  await openStory(page);
  await scrollToBottom(page);
  const table = page.locator('[data-engine-structural="table"]');
  await expect(table).toHaveCount(1); // the table survives as a live block
  // A `GhostBlock` is a `<div>`, invalid inside `<table>`/`<tbody>`/`<tr>` — J2 gates the table out of
  // the in-container splice, so the removed row is NOT woven here (faithful `<tr>` ghosts are J3).
  expect(await table.locator("[data-engine-ghost]").count()).toBe(0);
  // The table still shows its surviving rows (live cells render normally).
  expect(await table.locator("table tr").count()).toBeGreaterThan(0);
});
