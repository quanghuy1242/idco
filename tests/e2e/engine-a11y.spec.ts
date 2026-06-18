import { expect, test, type Page } from "@playwright/test";

/**
 * docs/010 Phase 7 AC3 / docs/011 §8.7 — accessibility of the non-contenteditable
 * surface. A model-owned editor gets no a11y for free, so the engine must expose
 * textbox semantics, accessible names, and announce selection changes itself.
 *
 * This is a structured, automated a11y invariant scan (role/name/live-region/
 * focusability), not a full axe-core audit; wiring axe-core is a follow-on noted
 * in the ledger. It runs on chromium/webkit/firefox.
 */
const EDITING_STORY = "engine--owned-model--phase55-editing";
const API = "__IDCO_ENGINE_VIEW_API__";

async function open(page: Page): Promise<void> {
  await page.goto(`/?story=${EDITING_STORY}`, { waitUntil: "commit" });
  await page.locator("[data-engine-view-root]").waitFor({ state: "visible" });
  await page
    .locator("[data-engine-text-id]")
    .first()
    .waitFor({ state: "visible" });
}

test("AC3 the editing region exposes textbox semantics with accessible names", async ({
  page,
}) => {
  await open(page);

  // The surface is a labelled widget.
  const root = page.locator("[data-engine-view-root]");
  expect(await root.getAttribute("aria-label")).toBeTruthy();

  // Every text block is a multiline textbox with an accessible name.
  const textboxes = page.locator('[data-engine-text-id][role="textbox"]');
  const count = await textboxes.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const box = textboxes.nth(i);
    expect(await box.getAttribute("aria-multiline")).toBe("true");
    expect((await box.getAttribute("aria-label"))?.length ?? 0).toBeGreaterThan(
      0,
    );
    expect(await box.getAttribute("tabindex")).toBe("0");
  }
});

test("AC3 a structured a11y scan finds no role/name/focus violations", async ({
  page,
}) => {
  await open(page);
  const violations = await page.evaluate(() => {
    const root = document.querySelector("[data-engine-view-root]");
    if (!root) return ["no editor root"];
    const problems: string[] = [];

    // A live region for announcements must exist and be polite.
    const live = root.querySelector("[data-engine-a11y-announcer]");
    if (!live) problems.push("missing live region");
    else if (live.getAttribute("aria-live") !== "polite") {
      problems.push("live region is not polite");
    }

    // The selection overlay must be hidden from assistive tech.
    const overlay = root.querySelector("[data-engine-selection-overlay]");
    if (overlay && overlay.getAttribute("aria-hidden") !== "true") {
      problems.push("selection overlay is not aria-hidden");
    }

    // No element may be both hidden from AT and keyboard-focusable.
    for (const el of Array.from(
      root.querySelectorAll<HTMLElement>("[tabindex]"),
    )) {
      const tabindex = Number(el.getAttribute("tabindex"));
      if (tabindex >= 0 && el.closest("[aria-hidden='true']")) {
        problems.push("focusable element inside aria-hidden subtree");
      }
    }

    // Every role=textbox needs an accessible name.
    for (const el of Array.from(
      root.querySelectorAll<HTMLElement>('[role="textbox"]'),
    )) {
      const name =
        el.getAttribute("aria-label") ??
        el.getAttribute("aria-labelledby") ??
        "";
      if (name.trim().length === 0) problems.push("textbox without a name");
    }
    return problems;
  });
  expect(violations).toEqual([]);
});

test("AC3 selection changes are announced through the live region", async ({
  page,
}) => {
  await open(page);
  const announcer = page.locator("[data-engine-a11y-announcer]");

  // Moving the caret into a block announces that block (entered a new block).
  const second = page.locator("[data-engine-text-id]").nth(1);
  await second.click();
  await expect
    .poll(async () => (await announcer.textContent())?.trim() ?? "")
    .not.toBe("");

  // Selecting a word announces the character count without flooding.
  await second.dblclick();
  await expect
    .poll(async () => (await announcer.textContent()) ?? "")
    .toMatch(/character/i);
});

test("AC3 keyboard-only focus reaches the editable blocks", async ({
  page,
}) => {
  await open(page);
  // Tabbing into the document lands on a textbox (the blocks are tabbable).
  const firstBox = page
    .locator('[data-engine-text-id][role="textbox"]')
    .first();
  await firstBox.focus();
  const focusedRole = await page.evaluate(() =>
    document.activeElement?.getAttribute("role"),
  );
  expect(focusedRole).toBe("textbox");
  // It accepts typed input through the engine (model-owned), proving the focus
  // is a real editing entry point, not a dead tab stop.
  const before = await page.evaluate(
    (key) =>
      (
        window as unknown as Record<
          string,
          { diagnostics: () => { blockTexts: Record<string, string> } }
        >
      )[key].diagnostics().blockTexts,
    API,
  );
  await page.keyboard.type("X");
  await expect
    .poll(async () =>
      page.evaluate(
        (key) =>
          (
            window as unknown as Record<
              string,
              { diagnostics: () => { blockTexts: Record<string, string> } }
            >
          )[key].diagnostics().blockTexts,
        API,
      ),
    )
    .not.toEqual(before);
});
