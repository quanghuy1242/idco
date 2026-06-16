import { expect, test, type Page } from "@playwright/test";

/**
 * docs/010 Phase 2 — Input + caret + selection spike (the make-or-break,
 * cross-browser foundation gate). Proves the EditContext + caret + selection
 * loop works through one EditContext API contract: Chromium normally uses the
 * native implementation, while WebKit/Firefox and the forced story use the API
 * polyfill before any document model exists.
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
const SWITCHING_STORY = "owned-model--input-spike--switching-harness";
const DIAGNOSTICS_KEY = "__IDCO_OWNED_INPUT__";

type Diagnostics = {
  text: string;
  anchor: number;
  focus: number;
  inputBackend: "native" | "polyfill";
  composing: boolean;
  focused: boolean;
  lastEvent: string;
  caretLeft: number;
  caretTop: number;
  caretHeight: number;
  rectCount: number;
  usedAddRange: boolean;
};

async function openStory(page: Page, story: string) {
  await page.goto(`/?story=${story}`, { waitUntil: "commit" });
  const host = page.locator("[data-owned-host]");
  await host.waitFor({ state: "visible" });
  // Wait for the controller's first paint to publish diagnostics.
  await expect.poll(async () => (await readDiagnostics(page))?.text).toBe("");
  return host;
}

function readDiagnostics(page: Page): Promise<Diagnostics | null> {
  return page.evaluate(
    (key) =>
      (window as unknown as Record<string, Diagnostics | undefined>)[key] ??
      null,
    DIAGNOSTICS_KEY,
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

type FocusSnapshot = {
  activeElementIsHost: boolean;
  focusedElementTag: string;
  matchesFocus: boolean;
  matchesFocusWithin: boolean;
  outlineStyle: string;
  outlineWidth: string;
  outlineColor: string;
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

/**
 * Locate the API polyfill's hidden textarea through Playwright's open-shadow
 * selector piercing. Production code keeps the sink inside a shadow root so
 * browser focus retargets to the visible host; only tests should reach in to
 * synthesize composition events.
 */
function polyfillTextarea(page: Page) {
  return page.locator("[data-owned-host] textarea");
}

/**
 * Capture browser focus styling from the visible host, not the hidden input
 * sink. Native EditContext focuses the host; the API polyfill must therefore
 * retarget focus through its shadow root and paint the missing default outline
 * on the same visible host.
 */
async function focusedHostSnapshot(
  page: Page,
  story: string,
): Promise<FocusSnapshot> {
  const host = await openStory(page, story);
  await host.click();
  return host.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      activeElementIsHost: document.activeElement === element,
      focusedElementTag: document.activeElement?.tagName ?? "",
      matchesFocus: element.matches(":focus"),
      matchesFocusWithin: element.matches(":focus-within"),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
    };
  });
}

/**
 * Replay the exact hidden-textarea event stream real Firefox emits for Windows
 * Vietnamese Telex when typing "xin chào" (captured from the polyfill story).
 * The shape that broke earlier fixes:
 *   - every preedit update fires a `beforeinput`+`input` pair, both with
 *     `inputType: "insertCompositionText"` and the full composing word as `data`
 *     (so the `input` twin is pure redundancy), and
 *   - Firefox fires one more `insertCompositionText` `input` with
 *     `isComposing: false` *after* `compositionend`.
 * The polyfill must drive composition only from `beforeinput` and ignore every
 * `insertCompositionText` `input`; re-applying the trailing post-`compositionend`
 * event re-inserts the committed word ("xin" → "xinxin", "chào" → "chàochào").
 */
async function replayFirefoxTelexXinChao(page: Page): Promise<void> {
  await polyfillTextarea(page).evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.focus();

    const setValue = (value: string) => {
      textarea.value = value;
      textarea.setSelectionRange(value.length, value.length);
    };
    const fireInput = (
      type: "beforeinput" | "input",
      inputType: string,
      data: string,
      isComposing: boolean,
    ) =>
      textarea.dispatchEvent(
        new InputEvent(type, {
          bubbles: true,
          cancelable: type === "beforeinput" && inputType === "insertText",
          data,
          inputType,
          isComposing,
        }),
      );

    // Compose one IME word in place after `base`. Firefox reports the OLD value
    // on `beforeinput` and the NEW value on `input`; only the non-composition
    // `input` path reads the textarea value, so faithfulness there is what
    // matters.
    const composeWord = (base: string, steps: readonly string[]) => {
      const final = steps[steps.length - 1] ?? "";
      textarea.dispatchEvent(new CompositionEvent("compositionstart"));
      for (const data of steps) {
        textarea.dispatchEvent(
          new CompositionEvent("compositionupdate", { data }),
        );
        fireInput("beforeinput", "insertCompositionText", data, true);
        setValue(base + data);
        fireInput("input", "insertCompositionText", data, true);
      }
      setValue(base + final);
      textarea.dispatchEvent(
        new CompositionEvent("compositionend", { data: final }),
      );
      // Trailing event Firefox emits after compositionend — the real bug trigger.
      fireInput("input", "insertCompositionText", final, false);
    };

    const insertText = (base: string, data: string) => {
      fireInput("beforeinput", "insertText", data, false);
      setValue(base + data);
      fireInput("input", "insertText", data, false);
    };

    composeWord("", ["x", "xi", "xin", "xin"]);
    insertText("xin", " ");
    composeWord("xin ", ["c", "ch", "cha", "chao", "chào", "chào"]);
  });
}

/**
 * Return a clickable point for a model offset in the plain text node. The
 * multi-click tests need stable coordinates that follow browser font metrics,
 * not guessed pixel offsets.
 */
async function pointForTextOffset(page: Page, offset: number) {
  return page.evaluate((targetOffset) => {
    const textNode = document.querySelector("[data-owned-text]")?.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      throw new Error("owned text node missing");
    }
    const range = document.createRange();
    const start = Math.min(
      Math.max(0, targetOffset),
      textNode.textContent?.length ?? 0,
    );
    range.setStart(textNode, start);
    range.setEnd(
      textNode,
      Math.min(start + 1, textNode.textContent?.length ?? start),
    );
    const rect = range.getBoundingClientRect();
    return {
      x: rect.left + Math.max(1, rect.width / 2),
      y: rect.top + rect.height / 2,
    };
  }, offset);
}

/**
 * Measure the browser's own collapsed-range x-position for a model offset. The
 * custom caret should line up with this for normal text, especially Vietnamese
 * glyphs where a temporary probe can disturb combining-mark shaping.
 */
async function collapsedRangeLeftForTextOffset(page: Page, offset: number) {
  return page.evaluate((targetOffset) => {
    const textElement =
      document.querySelector<HTMLElement>("[data-owned-text]");
    const host = document.querySelector<HTMLElement>("[data-owned-host]");
    if (!textElement || !host) throw new Error("owned input DOM missing");

    const walker = document.createTreeWalker(textElement, NodeFilter.SHOW_TEXT);
    let remaining = Math.max(0, targetOffset);
    let current = walker.nextNode();
    while (current) {
      const text = current as Text;
      const parent = text.parentElement;
      if (!parent?.closest("[data-owned-trailing-line]")) {
        if (remaining <= text.length) {
          const range = document.createRange();
          range.setStart(text, remaining);
          range.collapse(true);
          return (
            range.getBoundingClientRect().left -
            host.getBoundingClientRect().left
          );
        }
        remaining -= text.length;
      }
      current = walker.nextNode();
    }
    throw new Error("offset outside owned text");
  }, offset);
}

// AC1 + AC2 + AC3: the core input/caret/selection loop on the default story.
// The caret/selection are engine-painted uniformly over the same EditContext
// API contract. Chromium normally uses native EditContext; WebKit/Firefox use
// the API polyfill. The rendering assertions are intentionally backend-agnostic.
test("input, caret, and selection loop", async ({ page }, testInfo) => {
  const host = await openStory(page, NATIVE_STORY);
  const text = page.locator("[data-owned-text]");
  const caret = page.locator("[data-owned-caret]");

  await expect(caret).toBeHidden();
  await host.click();

  // AC1 — typing updates the model and the visible text via textupdate.
  await page.keyboard.type("Hello");
  await expect.poll(async () => (await diagnostics(page)).text).toBe("Hello");
  await expect(text).toHaveText("Hello");

  // AC2 — the engine-painted caret renders and moves with arrow keys.
  await expect(caret).toBeVisible();
  // The hand-painted caret should read like a native insertion bar: thin and
  // glyph-height-ish, not a chunky full-line block.
  const caretBox = (await caret.boundingBox())!;
  const textMetrics = await host.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontSize: Number.parseFloat(style.fontSize),
      lineHeight: Number.parseFloat(style.lineHeight),
    };
  });
  expect(caretBox.width).toBeLessThanOrEqual(1.5);
  expect(caretBox.height).toBeGreaterThanOrEqual(textMetrics.fontSize);
  expect(caretBox.height).toBeLessThan(textMetrics.lineHeight);
  expect((await diagnostics(page)).focused).toBe(true);
  const caretAtEnd = (await diagnostics(page)).caretLeft;
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  const movedDiag = await diagnostics(page);
  expect(movedDiag.focus).toBe(3);
  expect(movedDiag.caretLeft).toBeLessThan(caretAtEnd);

  // AC2 — selection renders for shift+arrow (engine rects + the DOM Selection
  // set via addRange, which tracks the model for every API implementation).
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

  // AC3 — selection is driven through addRange only. Backend identity is
  // diagnostic proof of which API implementation ran, not a behavior branch.
  expect(dragDiag.usedAddRange).toBe(true);
  if (testInfo.project.name === "chromium") {
    expect(dragDiag.inputBackend).toBe("native");
  } else {
    expect(dragDiag.inputBackend).toBe("polyfill");
  }
  await expect(host).not.toHaveAttribute("data-editcontext-active", "");
});

// Multi-line: Enter inserts a newline into the plain-text block on every path
// through the same editor command over the EditContext API, and the caret
// follows to line 2.
test("Enter inserts a newline and the caret follows", async ({ page }) => {
  const host = await openStory(page, NATIVE_STORY);
  const text = page.locator("[data-owned-text]");

  await host.click();
  await page.keyboard.type("first");
  const line1Top = (await diagnostics(page)).caretTop;
  const line1Box = (await text.boundingBox())!;
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await diagnostics(page)).text).toBe("first\n");
  const afterEnterDiag = await diagnostics(page);
  const afterEnterBox = (await text.boundingBox())!;
  const afterEnterCaretBox = (await page
    .locator("[data-owned-caret]")
    .boundingBox())!;
  expect(afterEnterDiag.focus).toBe("first\n".length);
  expect(afterEnterDiag.caretTop).toBeGreaterThan(line1Top);
  expect(afterEnterBox.height).toBeGreaterThan(line1Box.height);
  expect(afterEnterCaretBox.y).toBeGreaterThan(line1Box.y);
  // The painted caret is allowed to kiss the text box edge by a border pixel;
  // browsers disagree by tiny sub-pixel amounts, especially Firefox.
  expect(
    afterEnterCaretBox.y +
      afterEnterCaretBox.height -
      (afterEnterBox.y + afterEnterBox.height),
  ).toBeLessThanOrEqual(2);
  await page.keyboard.type("second");

  await expect
    .poll(async () => (await diagnostics(page)).text)
    .toBe("first\nsecond");
  await expect(text).toHaveText("first\nsecond");
  const afterDiag = await diagnostics(page);
  const afterCharBox = (await text.boundingBox())!;
  expect(afterDiag.focus).toBe("first\nsecond".length);
  expect(
    Math.abs(afterCharBox.height - afterEnterBox.height),
  ).toBeLessThanOrEqual(1);
  // The caret moved down to the second visual line.
  expect(afterDiag.caretTop).toBeGreaterThan(line1Top);
});

test("vertical arrows and basic shortcuts stay inside the input", async ({
  page,
}) => {
  const host = await openStory(page, NATIVE_STORY);
  const text = page.locator("[data-owned-text]");

  await host.click();
  await page.keyboard.type("first");
  await page.keyboard.press("Enter");
  await page.keyboard.type("second");
  await expect
    .poll(async () => (await diagnostics(page)).text)
    .toBe("first\nsecond");

  const line2 = await diagnostics(page);
  await page.keyboard.press("ArrowUp");
  const movedUp = await diagnostics(page);
  expect(movedUp.caretTop).toBeLessThan(line2.caretTop);
  expect(movedUp.focus).toBeLessThanOrEqual("first".length);

  await page.keyboard.press("ArrowDown");
  const movedDown = await diagnostics(page);
  expect(movedDown.caretTop).toBeGreaterThan(movedUp.caretTop);
  expect(movedDown.focus).toBeGreaterThan("first\n".length - 1);

  await page.keyboard.press("Control+A");
  const selectedAll = await diagnostics(page);
  expect(selectedAll.anchor).toBe(0);
  expect(selectedAll.focus).toBe("first\nsecond".length);
  expect((await nativeSelection(page)).text).toBe("first\nsecond");

  await page.keyboard.press("Control+B");
  await expect(text.locator("[data-owned-bold]")).toHaveText("first\nsecond");
  await expect(text).toHaveText("first\nsecond");
});

test("caret aligns with Vietnamese collapsed-range geometry", async ({
  page,
}) => {
  const host = await openStory(page, NATIVE_STORY);
  const phrase = "Có 1 con bò kêu vo ve vo ve";
  const targetOffset = phrase.lastIndexOf("ve");

  await host.click();
  await page.keyboard.insertText(phrase);
  await expect.poll(async () => (await diagnostics(page)).text).toBe(phrase);

  for (let index = 0; index < phrase.length - targetOffset; index += 1) {
    await page.keyboard.press("ArrowLeft");
  }

  const diag = await diagnostics(page);
  const expectedLeft = await collapsedRangeLeftForTextOffset(
    page,
    targetOffset,
  );
  expect(diag.focus).toBe(targetOffset);
  expect(Math.abs(diag.caretLeft - expectedLeft)).toBeLessThanOrEqual(1.5);
});

test("double-click selects a word and triple-click selects a line", async ({
  page,
}) => {
  const host = await openStory(page, NATIVE_STORY);

  await host.click();
  await page.keyboard.type("alpha beta");
  await expect
    .poll(async () => (await diagnostics(page)).text)
    .toBe("alpha beta");

  const betaPoint = await pointForTextOffset(page, "alpha b".length);
  await page.mouse.dblclick(betaPoint.x, betaPoint.y);
  const wordSelection = await diagnostics(page);
  expect(wordSelection.anchor).toBe("alpha ".length);
  expect(wordSelection.focus).toBe("alpha beta".length);

  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("gamma");
  await expect
    .poll(async () => (await diagnostics(page)).text)
    .toBe("alpha beta\ngamma");

  const gammaPoint = await pointForTextOffset(page, "alpha beta\ng".length);
  await page.mouse.click(gammaPoint.x, gammaPoint.y, { clickCount: 3 });
  const lineSelection = await diagnostics(page);
  expect(lineSelection.anchor).toBe("alpha beta\n".length);
  expect(lineSelection.focus).toBe("alpha beta\ngamma".length);
});

test("switching forced polyfill back to native keeps newline input stable", async ({
  page,
}, testInfo) => {
  const host = await openStory(page, SWITCHING_STORY);

  await host.click();
  await page.keyboard.type("forced");
  await expect.poll(async () => (await diagnostics(page)).text).toBe("forced");
  expect((await diagnostics(page)).inputBackend).toBe("polyfill");

  await page.locator("[data-owned-switch]").click();
  await expect.poll(async () => (await diagnostics(page)).text).toBe("");

  await host.click();
  await page.keyboard.type("first");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await diagnostics(page)).text).toBe("first\n");
  await page.keyboard.type("second");
  await expect
    .poll(async () => (await diagnostics(page)).text)
    .toBe("first\nsecond");

  const switchedDiag = await diagnostics(page);
  if (testInfo.project.name === "chromium") {
    expect(switchedDiag.inputBackend).toBe("native");
  } else {
    expect(switchedDiag.inputBackend).toBe("polyfill");
  }
});

// AC4: an IME/composition sequence produces the correct final text + selection.
test("IME composition produces the correct final text", async ({ page }) => {
  const host = await openStory(page, NATIVE_STORY);
  await host.click();
  await page.keyboard.type("a");

  const composed = "ねこ";
  const inputBackend = (await diagnostics(page)).inputBackend;

  if (inputBackend === "polyfill") {
    // Test driver detail: the API polyfill exposes a hidden textarea input sink,
    // so synthetic composition events are dispatched there. The editor still
    // observes only EditContext-shaped events.
    await polyfillTextarea(page).evaluate((element, value) => {
      const textarea = element as HTMLTextAreaElement;
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
    // Test driver detail: Chromium exposes CDP IME controls for the native
    // implementation, so this branch drives the OS IME into the focused host.
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

test("shared renderer paints IME preedit formats from the API", async ({
  page,
}) => {
  const host = await openStory(page, FORCED_POLYFILL_STORY);
  const composition = page.locator("[data-owned-composition]");

  // CI can deterministically synthesize composition on the polyfill textarea.
  // The underline renderer being asserted below is still the shared
  // EditContext path: native and polyfill both feed it through
  // `textformatupdate`.
  await host.click();
  await polyfillTextarea(page).evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.focus();
    textarea.dispatchEvent(new CompositionEvent("compositionstart"));
    textarea.value = "bo";
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    textarea.dispatchEvent(
      new InputEvent("input", { data: "bo", isComposing: true }),
    );
  });

  await expect.poll(async () => (await diagnostics(page)).text).toBe("bo");
  expect((await diagnostics(page)).composing).toBe(true);
  await expect(composition).toHaveText("bo");
  await expect(composition).toHaveCSS("text-decoration-line", "underline");

  await polyfillTextarea(page).evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.dispatchEvent(
      new CompositionEvent("compositionend", { data: "bo" }),
    );
  });

  await expect(composition).toHaveCount(0);
  expect((await diagnostics(page)).composing).toBe(false);
});

// This bug is in the polyfill, not any one engine: with the previous fix this
// replay fails identically on both firefox AND webkit (Received "xinchàochào").
// We run it on every polyfill engine. The event stream was captured from real
// Firefox; we have no real Safari/WebKit capture (Playwright can't drive a
// platform IME, and Windows has no WebKit browser), so the webkit run is a
// synthetic proxy. Real Safari coverage rides on upstream-parity: the polyfill
// uses the same beforeinput-only composition strategy as @neftaly's polyfill,
// which is fuzz-tested against Safari 15.4+.
test("polyfill composes Vietnamese Telex 'xin chào' from the real Firefox event stream", async ({
  page,
}) => {
  const host = await openStory(page, FORCED_POLYFILL_STORY);
  await host.click();

  await replayFirefoxTelexXinChao(page);

  // Earlier fixes left "xinxin chàochào" here (the dup), which then desynced the
  // model from the textarea and let the real IME corrupt it further into "o  ".
  // The dup is the reproducible root cause; "o  " was its downstream symptom.
  await expect
    .poll(async () => (await diagnostics(page)).text)
    .toBe("xin chào");
  expect((await diagnostics(page)).composing).toBe(false);

  // Assert the *rendered* text too, not just the model: the controller mirrors
  // `EditContext.text` into the rendered surface wholesale, so a model/display
  // divergence would show up here.
  await expect
    .poll(() =>
      page.evaluate(
        () => document.querySelector("[data-owned-text]")?.textContent ?? null,
      ),
    )
    .toBe("xin chào");
});

test("native and API polyfill expose the same focused host outline", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Native EditContext comparison is Chromium-only.",
  );

  const nativeFocus = await focusedHostSnapshot(page, NATIVE_STORY);
  const polyfillFocus = await focusedHostSnapshot(page, FORCED_POLYFILL_STORY);

  expect(nativeFocus.activeElementIsHost).toBe(true);
  expect(polyfillFocus.activeElementIsHost).toBe(true);
  expect(nativeFocus.matchesFocus).toBe(true);
  expect(polyfillFocus.matchesFocus).toBe(true);
  expect(nativeFocus.matchesFocusWithin).toBe(true);
  expect(polyfillFocus.matchesFocusWithin).toBe(true);
  expect(nativeFocus.outlineStyle).not.toBe("none");
  expect(nativeFocus.outlineWidth).not.toBe("0px");
  expect(polyfillFocus).toEqual(nativeFocus);
});

// AC5: the forced-polyfill variant renders a working caret + selection on every
// browser (including chromium), proving our API polyfill independent of native
// EditContext support.
test("forced polyfill renders caret and selection", async ({ page }) => {
  const host = await openStory(page, FORCED_POLYFILL_STORY);
  const caret = page.locator("[data-owned-caret]");

  await host.click();
  await page.keyboard.type("World");
  await expect.poll(async () => (await diagnostics(page)).text).toBe("World");

  const diag = await diagnostics(page);
  expect(diag.inputBackend).toBe("polyfill");
  await expect(host).not.toHaveAttribute("data-editcontext-active", "");
  await expect(caret).toBeVisible();

  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  const selectionDiag = await diagnostics(page);
  expect(selectionDiag.anchor).not.toBe(selectionDiag.focus);
  expect(selectionDiag.rectCount).toBeGreaterThan(0);
});
