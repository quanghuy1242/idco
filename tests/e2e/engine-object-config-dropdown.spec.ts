import { expect, test } from "@playwright/test";

/**
 * Regression for two object-config surface bugs (docs/029 follow-up):
 *
 * - #1 (anchor): the settings popover must drop from the block's gear affordance (top-right),
 *   not cover the whole block from its origin. The overlay anchor resolver reads
 *   `[data-engine-object-gear]`, so the config's left edge sits by the gear, far from the
 *   block's left edge.
 * - #2 (nested dropdown): a real mouse click on an option inside the config's `ResourceSelector`
 *   dropdown must NOT dismiss the config. The dropdown's React Aria listbox used to portal to
 *   `document.body` (outside the surface), so the authority's outside-press dismissal tore the
 *   config down before the option click landed — keyboard worked, the real mouse "collapsed".
 *   The fix routes nested overlays into the overlay layer (`UNSAFE_PortalProvider`) and the
 *   ownership registry recognizes them, so the press is "inside".
 */
test("object config: anchors to the gear and survives a dropdown option click", async ({
  page,
}) => {
  await page.goto("/?story=engine--phase-8--reference-blocks", {
    waitUntil: "commit",
  });
  await page
    .locator("[data-engine-view-root]")
    .waitFor({ state: "visible", timeout: 15000 });

  const block = page.locator("[data-engine-object-type='post-ref']").first();
  await block.scrollIntoViewIfNeeded();
  await block.hover();
  // Hover reveals the chrome gear; under parallel load the reveal can lag, so wait for it.
  const gear = block.locator("[data-engine-object-gear]").first();
  await gear.waitFor({ state: "visible", timeout: 15000 });
  await gear.click();

  const config = page.locator("[data-engine-overlay='block']");
  await config.waitFor({ state: "visible", timeout: 10000 });

  // #1: the config drops from the gear (block's top-right), not the block's left edge.
  const blockBox = (await block.boundingBox())!;
  const configBox = (await config.boundingBox())!;
  expect(configBox.x).toBeGreaterThan(blockBox.x + blockBox.width * 0.3);

  // #2: open the picker dropdown and click an option with a real mouse.
  await config.locator("button[aria-label='Toggle Post']").click();
  const option = page.getByRole("option").first();
  await option.waitFor({ state: "visible", timeout: 6000 });
  // The listbox is routed into the editor's overlay layer (not document.body).
  expect(
    await option.evaluate((el) => !!el.closest("[data-engine-overlay-layer]")),
  ).toBe(true);
  await option.click();
  await page.waitForTimeout(120);

  // The config is still open — the option click was not mistaken for an outside press.
  await expect(config).toBeVisible();
});
