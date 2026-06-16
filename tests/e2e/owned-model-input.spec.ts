import { expect, test, type Page } from "@playwright/test";

/**
 * docs/010 Phase 2 — Input + caret + selection spike (the make-or-break,
 * cross-browser foundation gate). Proves the EditContext + caret + selection
 * loop works on chromium (native EditContext), webkit, and firefox (vendored
 * polyfill) before any document model exists.
 *
 * Browser binaries: `pnpm exec playwright install webkit firefox`. On Linux,
 * the host libraries are required too: `pnpm exec playwright install-deps`
 * (needs sudo). The webkit/firefox projects are declared in playwright.config.ts
 * and scoped to `owned-model-*.spec.ts` so the legacy editor perf specs stay
 * chromium-only.
 *
 * Run: `pnpm exec playwright test tests/e2e/owned-model-input.spec.ts \
 *   --project=chromium --project=webkit --project=firefox`
 */

const NATIVE_STORY = "owned-model--input-spike--native";
const FORCED_POLYFILL_STORY = "owned-model--input-spike--forced-polyfill";

type Diagnostics = {
  text: string;
  anchor: number;
  focus: number;
  polyfilled: boolean;
  composing: boolean;
  lastEvent: string;
  caretLeft: number;
  caretHeight: number;
  rectCount: number;
  usedAddRange: boolean;
  hasActiveAttr: boolean;
};

async function openStory(page: Page, story: string) {
  await page.goto(`/?story=${story}`, { waitUntil: "commit" });
  const host = page.locator("[data-owned-host]");
  await host.waitFor({ state: "visible" });
  // Wait for the controller's first paint to publish diagnostics.
  await expect.poll(() => readDiagnostics(page)).not.toBeNull();
  return host;
}

function readDiagnostics(page: Page): Promise<Diagnostics | null> {
  return page.evaluate(
    () =>
      (window as unknown as { __IDCO_OWNED_INPUT__?: Diagnostics })
        .__IDCO_OWNED_INPUT__ ?? null,
  );
}

async function diagnostics(page: Page): Promise<Diagnostics> {
  const value = await readDiagnostics(page);
  if (!value) throw new Error("owned-model input diagnostics missing");
  return value;
}

type NativeSelection = {
  text: string;
  rangeCount: number;
  anchorOffset: number;
  focusOffset: number;
};

function nativeSelection(page: Page): Promise<NativeSelection> {
  return page.evaluate(() => {
    const selection = window.getSelection();
    return {
      text: selection?.toString() ?? "",
      rangeCount: selection?.rangeCount ?? 0,
      anchorOffset: selection?.anchorOffset ?? -1,
      focusOffset: selection?.focusOffset ?? -1,
    };
  });
}

// AC1 + AC2 + AC3: the core input/caret/selection loop on the default story.
// Native EditContext on chromium; vendored polyfill on webkit/firefox. The
// caret/selection are engine-painted uniformly on every path (docs/010 §7.4
// fallback), with the native caret/`::selection` suppressed — so the rendering
// assertions are the same across browsers, and the DOM Selection (set via
// addRange) still tracks the model on the native path.
test("input, caret, and selection loop", async ({ page }, testInfo) => {
  const host = await openStory(page, NATIVE_STORY);
  const text = page.locator("[data-owned-text]");
  const caret = page.locator("[data-owned-caret]");

  await host.click();

  // AC1 — typing updates the model and the visible text via textupdate.
  await page.keyboard.type("Hello");
  await expect.poll(async () => (await diagnostics(page)).text).toBe("Hello");
  await expect(text).toHaveText("Hello");

  // AC2 — the engine-painted caret renders and moves with arrow keys.
  await expect(caret).toBeVisible();
  const caretAtEnd = (await diagnostics(page)).caretLeft;
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  const movedDiag = await diagnostics(page);
  expect(movedDiag.focus).toBe(3);
  expect(movedDiag.caretLeft).toBeLessThan(caretAtEnd);

  // AC2 — selection renders for shift+arrow (engine rects + the DOM Selection
  // set via addRange, which tracks the model on the native path).
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  const shiftDiag = await diagnostics(page);
  expect(shiftDiag.focus).toBe(1);
  expect(shiftDiag.anchor).toBe(3);
  expect(shiftDiag.rectCount).toBeGreaterThan(0);
  await expect(page.locator("[data-owned-selrect]").first()).toBeVisible();
  expect((await nativeSelection(page)).text).toBe("el");

  // AC2 — selection renders for drag.
  const box = (await text.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
  const dragDiag = await diagnostics(page);
  expect(dragDiag.anchor).not.toBe(dragDiag.focus);
  expect(dragDiag.rectCount).toBeGreaterThan(0);

  // AC3 — selection is driven through addRange only; the polyfill-only marker
  // is present on the polyfill path and absent on native chromium (§7.4).
  expect(dragDiag.usedAddRange).toBe(true);
  if (testInfo.project.name === "chromium") {
    expect(dragDiag.polyfilled).toBe(false);
    expect(dragDiag.hasActiveAttr).toBe(false);
    await expect(host).not.toHaveAttribute("data-editcontext-active", "");
  } else {
    expect(dragDiag.polyfilled).toBe(true);
    expect(dragDiag.hasActiveAttr).toBe(true);
    await expect(host).toHaveAttribute("data-editcontext-active", "");
  }
});

// Multi-line: Enter inserts a newline into the plain-text block on every path
// (native EditContext fires insertParagraph, which the engine handles; the
// polyfill's textarea inserts it directly), and the caret follows to line 2.
test("Enter inserts a newline and the caret follows", async ({ page }) => {
  const host = await openStory(page, NATIVE_STORY);
  const text = page.locator("[data-owned-text]");

  await host.click();
  await page.keyboard.type("first");
  const line1Top = (await diagnostics(page)).caretTop;
  await page.keyboard.press("Enter");
  await page.keyboard.type("second");

  await expect
    .poll(async () => (await diagnostics(page)).text)
    .toBe("first\nsecond");
  await expect(text).toHaveText("first\nsecond");
  const afterDiag = await diagnostics(page);
  expect(afterDiag.focus).toBe("first\nsecond".length);
  // The caret moved down to the second visual line.
  expect(afterDiag.caretTop).toBeGreaterThan(line1Top);
});

// AC4: an IME/composition sequence produces the correct final text + selection.
test("IME composition produces the correct final text", async ({
  page,
}) => {
  const host = await openStory(page, NATIVE_STORY);
  await host.click();
  await page.keyboard.type("a");

  const composed = "ねこ";
  const polyfilled = (await diagnostics(page)).polyfilled;

  if (polyfilled) {
    // Polyfill path: drive composition on the hidden-textarea input sink.
    await page.evaluate((value) => {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        "[data-owned-host] textarea",
      );
      if (!textarea) throw new Error("polyfill textarea missing");
      textarea.focus();
      textarea.dispatchEvent(new CompositionEvent("compositionstart"));
      textarea.value = `a${value}`;
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      textarea.dispatchEvent(new InputEvent("input", { isComposing: true }));
      textarea.dispatchEvent(
        new CompositionEvent("compositionend", { data: value }),
      );
    }, composed);
  } else {
    // Native path (chromium): drive the OS IME via CDP into the focused host.
    const session = await page.context().newCDPSession(page);
    await session.send("Input.imeSetComposition", {
      text: composed,
      selectionStart: composed.length,
      selectionEnd: composed.length,
    });
    await session.send("Input.insertText", { text: composed });
    await session.detach();
  }

  await expect
    .poll(async () => (await diagnostics(page)).text)
    .toBe(`a${composed}`);
  const finalDiag = await diagnostics(page);
  expect(finalDiag.composing).toBe(false);
  expect(finalDiag.focus).toBe(`a${composed}`.length);
});

// AC5: the forced-polyfill variant renders a working caret + selection on every
// browser (including chromium), proving the polyfill path independent of native
// EditContext support.
test("forced polyfill renders caret and selection", async ({ page }) => {
  const host = await openStory(page, FORCED_POLYFILL_STORY);
  const caret = page.locator("[data-owned-caret]");

  await host.click();
  await page.keyboard.type("World");
  await expect.poll(async () => (await diagnostics(page)).text).toBe("World");

  const diag = await diagnostics(page);
  expect(diag.polyfilled).toBe(true);
  expect(diag.hasActiveAttr).toBe(true);
  await expect(host).toHaveAttribute("data-editcontext-active", "");
  await expect(caret).toBeVisible();

  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  const selectionDiag = await diagnostics(page);
  expect(selectionDiag.anchor).not.toBe(selectionDiag.focus);
  expect(selectionDiag.rectCount).toBeGreaterThan(0);
});
