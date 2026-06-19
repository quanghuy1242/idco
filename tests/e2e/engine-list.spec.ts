import { expect, test, type Page } from "@playwright/test";

/**
 * Regression: toggling a list item back to a paragraph must restore the full
 * paragraph block spacing. The bug was a React inline-style shorthand/longhand
 * conflict — list items set `paddingTop`/`paddingBottom` longhands while the
 * base block used the `padding` shorthand, so flipping listitem→paragraph
 * cleared the top padding to 0 and the line collapsed tight (docs/010 §14).
 */
const STORY = "engine--phase-8--full-editor";

async function open(page: Page): Promise<void> {
  await page.goto(`/?story=${STORY}`, { waitUntil: "commit" });
  await page.locator("[data-engine-view-root]").waitFor({ state: "visible" });
}

function paddingTopOf(page: Page, text: string): Promise<string> {
  return page.evaluate((needle) => {
    const el = Array.from(
      document.querySelectorAll("[data-engine-text-id]"),
    ).find((node) => (node.textContent ?? "").includes(needle));
    return el ? getComputedStyle(el).paddingTop : "missing";
  }, text);
}

test("toggling a list item off restores paragraph spacing (no collapsed padding)", async ({
  page,
}) => {
  await open(page);

  // A genuine paragraph's top padding is the baseline every text block should
  // share when it is not a (tighter) list item.
  const paragraphPad = await paddingTopOf(page, "An owned-model editor");
  expect(paragraphPad).not.toBe("0px");

  // Toggle the first list item ("Marks render to the DOM") back to a paragraph.
  await page.locator('[data-engine-block-type="listitem"]').first().click();
  await page.getByRole("button", { name: "Bulleted list" }).click();

  // It is a paragraph now (no bullet) and must carry the full paragraph padding,
  // not the collapsed 0px the shorthand/longhand bug produced.
  const toggled = page
    .locator('[data-engine-text-id][data-engine-block-type="paragraph"]')
    .filter({ hasText: "Marks render to the DOM" });
  await expect(toggled).toHaveCount(1);
  expect(await paddingTopOf(page, "Marks render to the DOM")).toBe(
    paragraphPad,
  );
});
