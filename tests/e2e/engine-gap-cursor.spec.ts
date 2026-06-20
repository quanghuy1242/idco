import { expect, test, type Page } from "@playwright/test";

/**
 * docs/019 Phase 2/3 — positional editing, driven as real interaction.
 *
 * The document is `[divider, paragraph, divider]`: the configuration where the
 * caret could not previously rest above the first object, between two stacked
 * objects, or below the last one (problems §3.3.4/5). This proves the gap cursor
 * is reachable by arrow, painted, and materializes a paragraph in the right
 * place (Phase 2), and that a mid-paragraph object insert splits the leaf
 * (Phase 3).
 */
const STORY = "engine--owned-model--phase019-gap-cursor";
const API = "__IDCO_ENGINE_VIEW_API__";
const STORE = "__IDCO_GAP_STORE__";
const SHOTS = "test-results/phase019";

type Selection =
  | { type: "text"; focus: { node: string; offset: number } }
  | { type: "node"; node: string }
  | { type: "gap"; scope: string; index: number };

type Diag = {
  order: string[];
  blockTexts: Record<string, string>;
  selection: Selection | null;
};

function storyUrl(): string {
  return `/?mode=preview&story=${STORY}`;
}

async function ready(page: Page): Promise<void> {
  await page.goto(storyUrl());
  await page.waitForFunction((key) => {
    const api = (
      window as unknown as Record<string, { diagnostics?: unknown }>
    )[key as string];
    return Boolean(api && typeof api.diagnostics === "function");
  }, API);
}

async function diag(page: Page): Promise<Diag> {
  return page.evaluate((key) => {
    const api = (
      window as unknown as Record<string, { diagnostics: () => Diag }>
    )[key as string];
    return api.diagnostics();
  }, API);
}

test.describe("docs/019 gap cursor + positional insert", () => {
  test("the caret reaches the gap above a first-block object and materializes a paragraph there", async ({
    page,
  }) => {
    await ready(page);
    const before = await diag(page);
    expect(before.order).toHaveLength(3);
    const middleId = before.order[1]!;

    // Click into the paragraph, go to its very start, then arrow up through the
    // gaps: first to the gap after the top divider, then across the atom to the
    // gap above it — the position that was structurally unreachable before.
    await page.locator(`[data-engine-block-id="${middleId}"]`).click();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");

    const atGap = await diag(page);
    expect(atGap.selection?.type).toBe("gap");
    expect(atGap.selection?.type === "gap" && atGap.selection.index).toBe(0);
    await expect(page.locator("[data-engine-gap-cursor]")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/gap-above-first-object.png` });

    // Enter materializes a real paragraph at body index 0; the divider that was
    // first is now the second block.
    await page.keyboard.press("Enter");
    const after = await diag(page);
    expect(after.order).toHaveLength(4);
    expect(after.order[1]).toBe(before.order[0]); // divider pushed down to slot 1
    // The new first block is a text leaf (it appears in blockTexts, objects do not).
    expect(Object.keys(after.blockTexts)).toContain(after.order[0]);
    await page.screenshot({ path: `${SHOTS}/after-materialize.png` });

    // Backspace on that empty first paragraph removes it (it had no previous
    // block to merge into) and rests a gap at the top — the "delete this empty
    // line" gesture that previously no-op'd at the document top.
    await page.keyboard.press("Backspace");
    const removed = await diag(page);
    expect(removed.order).toHaveLength(3);
    expect(removed.order).toEqual(before.order);
    expect(removed.selection?.type).toBe("gap");
    expect(removed.selection?.type === "gap" && removed.selection.index).toBe(
      0,
    );
  });

  test("Backspace from the gap beside an empty paragraph removes that paragraph", async ({
    page,
  }) => {
    await ready(page);
    const before = await diag(page);
    const middleId = before.order[1]!;

    // Materialize an empty paragraph at the top (gap above the first object).
    await page.locator(`[data-engine-block-id="${middleId}"]`).click();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    const materialized = await diag(page);
    expect(materialized.order).toHaveLength(4);
    const emptyId = materialized.order[0]!;

    // Step right to the gap AFTER the empty paragraph (before the divider) — the
    // reachable gap beside it — then Backspace removes the empty block from there.
    await page.keyboard.press("ArrowRight");
    const atGap = await diag(page);
    expect(atGap.selection?.type).toBe("gap");
    await page.keyboard.press("Backspace");
    const after = await diag(page);
    expect(after.order).not.toContain(emptyId);
    expect(after.order).toEqual(before.order);
  });

  test("the caret hides when the editor loses focus and returns when refocused", async ({
    page,
  }) => {
    await ready(page);
    const order = (await diag(page)).order;
    await page.locator(`[data-engine-block-id="${order[1]}"]`).click();
    await page.keyboard.press("End");
    await expect(page.locator("[data-engine-caret]")).toHaveCount(1);
    // Blur the surface: the caret must not linger (it would imply typing lands
    // there when it does not).
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      document.body.focus();
    });
    await expect(page.locator("[data-engine-caret]")).toHaveCount(0);
    // Refocus by clicking back in: the caret returns.
    await page.locator(`[data-engine-block-id="${order[1]}"]`).click();
    await expect(page.locator("[data-engine-caret]")).toHaveCount(1);
  });

  test("focus stays in the editor while arrowing through gaps", async ({
    page,
  }) => {
    await ready(page);
    const order = (await diag(page)).order;
    await page.locator(`[data-engine-block-id="${order[1]}"]`).click();
    await page.keyboard.press("End");
    const focusWithin = () =>
      page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        const root = document.querySelector("[data-engine-view-root]");
        return (
          !!a &&
          a !== document.body &&
          !!root &&
          (a === root || root.contains(a))
        );
      });
    // Cross the divider into the gap, across it, and back — focus must remain
    // inside the editor the whole time (root for a gap, the leaf for text).
    for (const key of ["ArrowRight", "ArrowRight", "ArrowLeft", "ArrowLeft"]) {
      await page.keyboard.press(key);
      expect(await focusWithin()).toBe(true);
    }
  });

  test("a mid-paragraph object insert splits the leaf into head / object / tail (Phase 3)", async ({
    page,
  }) => {
    await ready(page);
    await page.waitForFunction(
      (key) =>
        Boolean((window as unknown as Record<string, unknown>)[key as string]),
      STORE,
    );
    const before = await diag(page);
    const middleId = before.order[1]!;
    const text = before.blockTexts[middleId]!;
    const splitAt = text.indexOf("helloworld") + "hello".length;
    expect(splitAt).toBeGreaterThan(0);

    // Place a collapsed caret mid-paragraph, then run the same insert-object
    // command the Insert (+) menu dispatches.
    await page.evaluate(
      ({ apiKey, node, offset }) => {
        const api = (
          window as unknown as Record<
            string,
            {
              selectText: (
                a: string,
                ao: number,
                f: string,
                fo: number,
              ) => void;
            }
          >
        )[apiKey];
        api.selectText(node, offset, node, offset);
      },
      { apiKey: API, node: middleId, offset: splitAt },
    );
    await page.evaluate((storeKey) => {
      const store = (
        window as unknown as Record<
          string,
          { command: (c: unknown) => unknown }
        >
      )[storeKey];
      store.command({ data: {}, objectType: "divider", type: "insert-object" });
    }, STORE);

    const after = await diag(page);
    // [divider, head(middle), newDivider, tail, divider] — the leaf broke at the
    // caret and the object landed in the seam.
    expect(after.order).toHaveLength(5);
    expect(after.order[1]).toBe(middleId);
    expect(after.blockTexts[middleId]).toBe(text.slice(0, splitAt));
    expect(after.blockTexts[after.order[3]!]).toBe(text.slice(splitAt));
    // The seam holds the object (not in blockTexts).
    expect(Object.keys(after.blockTexts)).not.toContain(after.order[2]);
    await page.screenshot({ path: `${SHOTS}/mid-split.png` });
  });
});
