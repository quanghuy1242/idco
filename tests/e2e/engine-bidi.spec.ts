import { expect, test, type Page } from "@playwright/test";

/**
 * docs/018 §2.9 — RTL / bidi caret as a real cross-browser target.
 *
 * The selection model carries the affinity bit, but the bidi caret at RTL
 * boundaries was only acknowledged, never a dedicated test. This is that test:
 * arrow navigation through a mixed-direction line moves in *logical* order (the
 * engine moves by grapheme boundary, not visual position), the caret reaches both
 * ends, and a whole-line selection serializes in logical order — none of which
 * may silently regress when the affinity handling changes. It runs on every
 * browser project (chromium/webkit/firefox) so the bidi behaviour is proven, not
 * assumed.
 */
const STORY = "engine--owned-model--bidi-caret";
const API = "__IDCO_ENGINE_VIEW_API__";

type Diag = {
  order: string[];
  blockTexts: Record<string, string>;
  selection: { type: string; focus?: { node: string; offset: number } } | null;
};

function diag(page: Page): Promise<Diag> {
  return page.evaluate((key) => {
    const api = (
      window as unknown as Record<string, { diagnostics: () => Diag }>
    )[key];
    return api.diagnostics();
  }, API);
}

async function open(page: Page): Promise<{ id: string; text: string }> {
  await page.goto(`/?story=${STORY}`, { waitUntil: "commit" });
  await page.locator("[data-engine-view-root]").waitFor({ state: "visible" });
  await page
    .locator("[data-engine-block-id]")
    .first()
    .waitFor({ state: "visible" });
  const d = await diag(page);
  const id = d.order[0]!;
  return { id, text: d.blockTexts[id] ?? "" };
}

test("arrow keys walk a bidi line in logical order to both ends", async ({
  page,
}) => {
  const { id, text } = await open(page);
  const length = text.length;
  expect(length).toBeGreaterThan(8);

  // Focus the block and collapse the caret to the logical start.
  await page.locator(`[data-engine-block-id="${id}"]`).click();
  for (let i = 0; i < length + 2; i++) await page.keyboard.press("ArrowLeft");
  let focus = (await diag(page)).selection?.focus;
  expect(focus?.node).toBe(id);
  expect(focus?.offset).toBe(0);

  // ArrowRight advances the logical offset by one grapheme each press, all the
  // way through the Latin→RTL→Latin run, regardless of visual direction.
  for (let i = 1; i <= length; i++) {
    await page.keyboard.press("ArrowRight");
    focus = (await diag(page)).selection?.focus;
    expect(focus?.offset).toBe(i);
  }
  expect(focus?.offset).toBe(length);
});

test("a whole-line selection over a bidi run serializes in logical order", async ({
  page,
}) => {
  const { id, text } = await open(page);
  const serialized = await page.evaluate(
    ({ key, blockId, end }) => {
      const api = (
        window as unknown as Record<
          string,
          {
            selectText: (a: string, b: number, c: string, d: number) => void;
            serializeSelection: () => string;
          }
        >
      )[key];
      api.selectText(blockId, 0, blockId, end);
      return api.serializeSelection();
    },
    { blockId: id, end: text.length, key: API },
  );
  // The model stores and serializes logical order; bidi only affects rendering.
  expect(serialized).toBe(text);
});
