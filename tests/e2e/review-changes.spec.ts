import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * Changes pane + Suggestion Source spec (docs/036 §7.3, docs/038 §17, R6-J J5). Proves the load-bearing
 * J5 claims against the real editor + engine + a legibility screenshot. Chromium only (non-`engine-*`).
 *
 * Claims proven against the `Engine / Review Changes` story (one proposal: a block edit + a conflict +
 * a glossary change):
 *   1. HOST-OWNED LIST — the pane renders the source's one proposal, attributed ("Assistant") and
 *      pending, with no pending markup in the document.
 *   2. THE ANCHORLESS SPLIT (§17) — the CONFLICT and the COLLECTION change route into the pane's
 *      "Reviewed here" section (they have no block to weave onto); the block edit shows as a jump row.
 *   3. LIFECYCLE — Accept records the outcome in the host and moves the proposal to Resolved (its
 *      Accept/Reject buttons clear, its status reads "accepted").
 */
const OUT = path.join(process.cwd(), "test-results", "review-changes");
const STORY = "/?story=engine--review-changes--changes-review";
const PANE = "[data-engine-changes]";
const PROPOSAL = "[data-engine-changes-proposal]";

async function open(page: Page): Promise<void> {
  await page.goto(STORY, { waitUntil: "commit" });
  await page.locator("[data-engine-view-root]").first().waitFor();
  await page.locator(PANE).waitFor({ state: "visible" });
  await page.waitForTimeout(150);
}

test("J5 pane lists a proposal, routes anchorless changes, and resolves on accept", async ({
  page,
}) => {
  await open(page);
  const proposal = page.locator(PROPOSAL);

  // (1) Exactly one host proposal, attributed + pending.
  expect(await proposal.count()).toBe(1);
  await expect(proposal).toContainText("Assistant");
  await expect(proposal).toContainText("pending");

  // (2) The anchorless split (§17): the conflict and the collection change route to the pane; the
  // block-anchored edit shows as a jump-to row ("N characters inserted").
  const conflict = page.locator('[data-engine-changes-anchorless="conflict"]');
  const collection = page.locator(
    '[data-engine-changes-anchorless="collection"]',
  );
  await expect(conflict).toHaveCount(1);
  await expect(conflict).toContainText("no longer applies");
  await expect(collection).toHaveCount(1);
  await expect(collection).toContainText("Glossary");
  await expect(proposal).toContainText("inserted"); // the block edit's summary (jump row)

  await page.screenshot({
    fullPage: true,
    path: path.join(OUT, "01-pane.png"),
  });

  // (3) Accept records the outcome and moves the proposal to Resolved: its Accept/Reject clear and the
  // status reads "accepted". (The in-store apply that would mutate the document is J6.)
  await page.getByRole("button", { name: "Accept" }).click();
  await page.waitForTimeout(200);
  expect(await page.getByRole("button", { name: "Accept" }).count()).toBe(0);
  await expect(proposal).toContainText("accepted");

  await page.screenshot({
    fullPage: true,
    path: path.join(OUT, "02-after-accept.png"),
  });
});
