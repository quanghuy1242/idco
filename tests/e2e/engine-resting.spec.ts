import { expect, test, type Page } from "@playwright/test";

/**
 * The resting (reader) render is self-sufficient: it carries a zero-specificity
 * baseline typography so headings are sized, lists are bulleted, and spacing
 * holds even when the host has a CSS reset but no `prose`/typography plugin
 * (docs/010 §14 hardening). A real `prose` still overrides the baseline.
 */
const STORY = "engine--phase-8--resting-read";

async function open(page: Page): Promise<void> {
  await page.goto(`/?story=${STORY}`, { waitUntil: "commit" });
  await page.locator("[data-engine-resting-document]").waitFor({
    state: "visible",
  });
}

test("resting render is styled without a host typography plugin", async ({
  page,
}) => {
  await open(page);

  // Heading is visibly larger/bolder than body text (not a flat reset).
  const h1 = page.locator("[data-engine-resting-document] h1").first();
  const p = page.locator("[data-engine-resting-document] p").first();
  const h1Size = await h1.evaluate((el) =>
    parseFloat(getComputedStyle(el).fontSize),
  );
  const pSize = await p.evaluate((el) =>
    parseFloat(getComputedStyle(el).fontSize),
  );
  expect(h1Size).toBeGreaterThan(pSize * 1.4);
  expect(await h1.evaluate((el) => getComputedStyle(el).fontWeight)).toBe(
    "700",
  );

  // The list renders real bullets and a left gutter (not a stripped reset).
  const ul = page.locator("[data-engine-resting-document] ul").first();
  expect(await ul.evaluate((el) => getComputedStyle(el).listStyleType)).toBe(
    "disc",
  );
  expect(
    await ul.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft)),
  ).toBeGreaterThan(0);
});
