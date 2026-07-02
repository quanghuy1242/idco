import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * Passive marker layer spec (docs/038 §7–§9, R6-J J3) — the any-depth generalization of the R6-I
 * change indicator. Asserts each claim against the real editing surface and captures a legibility
 * screenshot. Chromium only (the non-`engine-*` file name keeps it off webkit/firefox).
 *
 * Claims proven against the `Engine / Review Decoration` story:
 *   1. GUTTER BAR (top level) — a top-level block that differs carries `data-engine-review-changed`.
 *   2. ELEMENT RING (nested) — two re-colored table cells AND a nested code-block object whose
 *      language changed each carry `data-engine-review-ring`, and the CSS actually paints a ring.
 *   3. THE ROUTER (docs/038 §8) — the changed CELLS + the nested OBJECT ring; the TABLE and CALLOUT
 *      that contain them take the top-level bar (a breadcrumb), NOT a ring; the rows get nothing.
 *   4. OBJECT-CHROME SURVIVAL — the object's ring paints an `outline` (not only a box-shadow), so it
 *      survives the object's hover/live `box-shadow` chrome that would otherwise replace it.
 *   5. COMPOSITION — a removed paragraph still leaves a deletion tick, alongside the new rings.
 */
const OUT = path.join(process.cwd(), "test-results", "review-decoration");
const STORY = "/?story=engine--review-decoration--passive-markers";

async function openStory(page: Page): Promise<void> {
  await page.goto(STORY, { waitUntil: "commit" });
  await page.locator("[data-engine-view-root]").first().waitFor();
  await page
    .locator('[data-engine-structural="table"]')
    .first()
    .waitFor({ state: "visible" });
  // The decoration is applied in an effect after the first commit; give it a frame to land.
  await page.waitForTimeout(120);
}

test("J3 bar + ring: top-level block bars, nested changed cells ring", async ({
  page,
}) => {
  await openStory(page);

  // (1) At least one top-level gutter bar (the edited paragraph and the table both bar).
  const bars = page.locator("[data-engine-review-changed]");
  expect(await bars.count()).toBeGreaterThan(0);

  // (2) Three rings: two re-colored table cells + the nested code-block object.
  const rings = page.locator("[data-engine-review-ring]");
  expect(await rings.count()).toBe(3);
  const table = page.locator('[data-engine-structural="table"]');
  expect(await table.locator("[data-engine-review-ring]").count()).toBe(2);
  // The nested object's ring is on the object element itself (it also carries object chrome).
  const objectRing = page.locator(
    "[data-engine-object-type][data-engine-review-ring]",
  );
  expect(await objectRing.count()).toBe(1);

  // The ring is actually painted — and specifically paints an OUTLINE, the channel that survives the
  // object's box-shadow chrome. (A box-shadow-only ring would be replaced by the chrome on hover.)
  const paint = await rings.first().evaluate((el) => ({
    outlineStyle: getComputedStyle(el).outlineStyle,
    outlineWidth: getComputedStyle(el).outlineWidth,
    boxShadow: getComputedStyle(el).boxShadow,
  }));
  expect(paint.outlineStyle).not.toBe("none");
  expect(parseFloat(paint.outlineWidth)).toBeGreaterThan(0);
  expect(paint.boxShadow).not.toBe("none");

  // (3) The table + callout carry the bar (a breadcrumb), NOT a ring.
  await expect(table).toHaveAttribute("data-engine-review-changed", /.+/);
  expect(await table.getAttribute("data-engine-review-ring")).toBeNull();
  const callout = page.locator('[data-engine-structural="callout"]');
  expect(await callout.getAttribute("data-engine-review-ring")).toBeNull();

  // (5) The removed paragraph still leaves a deletion tick somewhere (composition with the rings).
  const ticks = page.locator(
    "[data-engine-review-removed-before],[data-engine-review-removed-after]",
  );
  expect(await ticks.count()).toBeGreaterThan(0);

  await page.screenshot({
    fullPage: true,
    path: path.join(OUT, "01-bar-and-rings.png"),
  });

  // (4) OBJECT-CHROME SURVIVAL: hover the nested object so its hover box-shadow chrome fires; the
  // ring's OUTLINE must persist (the box-shadow channel may be replaced by the chrome, the outline is
  // not). This is the second-pass fix — a box-shadow-only ring vanished exactly on hover.
  await objectRing.hover();
  await page.waitForTimeout(120);
  const hovered = await objectRing.evaluate((el) => ({
    outlineStyle: getComputedStyle(el).outlineStyle,
    outlineWidth: getComputedStyle(el).outlineWidth,
  }));
  expect(hovered.outlineStyle).not.toBe("none");
  expect(parseFloat(hovered.outlineWidth)).toBeGreaterThan(0);
  await page.screenshot({
    fullPage: true,
    path: path.join(OUT, "02-object-ring-hovered.png"),
  });
});
