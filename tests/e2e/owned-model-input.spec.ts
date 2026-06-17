import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

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
const FIREFOX_TELEX_XIN_CHAO_FIXTURE = JSON.parse(
  readFileSync(
    new URL(
      "../fixtures/owned-model-ime/firefox-telex-xin-chao.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as OwnedImeTrace;

type Diagnostics = {
  text: string;
  anchor: number;
  focus: number;
  inputBackend: "native" | "polyfill";
  composing: boolean;
  focused: boolean;
  lastEvent: string;
  lastClipboardText: string;
  caretLeft: number;
  caretTop: number;
  caretHeight: number;
  rectCount: number;
  usedAddRange: boolean;
};

type OwnedImeTrace = {
  schemaVersion: 1;
  scenario: {
    name: string;
    initialText: string;
    initialSelection: { anchor: number; focus: number };
    expectedFinalText: string;
    expectedFinalSelection: { anchor: number; focus: number };
  };
  events: Array<{
    type: string;
    data?: string | null;
    inputType?: string;
    isComposing?: boolean;
    cancelable?: boolean;
    textarea?: {
      value: string;
      selectionStart: number;
      selectionEnd: number;
    };
  }>;
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

function dispatchClipboard(
  page: Page,
  type: "copy" | "cut" | "paste",
  text = "",
): Promise<string> {
  return page.evaluate(
    ({ diagnosticsKey, eventType, clipboardText }) => {
      const host = document.querySelector("[data-owned-host]");
      if (!host) throw new Error("owned host missing");
      const clipboardData = new DataTransfer();
      if (clipboardText) clipboardData.setData("text/plain", clipboardText);
      const event = new Event(eventType, {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "clipboardData", { value: clipboardData });
      host.dispatchEvent(event);
      const clipboardDiagnostics = (
        window as unknown as Record<string, Diagnostics | undefined>
      )[diagnosticsKey];
      return (
        clipboardData.getData("text/plain") ||
        clipboardDiagnostics?.lastClipboardText ||
        ""
      );
    },
    { clipboardText: text, diagnosticsKey: DIAGNOSTICS_KEY, eventType: type },
  );
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

async function emulateIpadTextareaPlatform(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      get: () => "MacIntel",
    });
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      configurable: true,
      get: () => 5,
    });
  });
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
 * The polyfill must never fold a post-`compositionend` `insertCompositionText`
 * input back into the model; re-applying that trailing event re-inserts the
 * committed word ("xin" → "xinxin", "chào" → "chàochào").
 */
async function replayFirefoxTelexXinChao(page: Page): Promise<void> {
  await replayOwnedImeTrace(page, FIREFOX_TELEX_XIN_CHAO_FIXTURE);
}

async function replayOwnedImeTrace(
  page: Page,
  trace: OwnedImeTrace,
): Promise<void> {
  await polyfillTextarea(page).evaluate((element, replayTrace) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.focus();

    const setValue = (
      value: string,
      selectionStart = value.length,
      selectionEnd = selectionStart,
    ) => {
      textarea.value = value;
      textarea.setSelectionRange(selectionStart, selectionEnd);
    };

    for (const event of replayTrace.events) {
      if (event.type === "compositionstart") {
        textarea.dispatchEvent(new CompositionEvent("compositionstart"));
        continue;
      }
      if (event.type === "compositionupdate") {
        textarea.dispatchEvent(
          new CompositionEvent("compositionupdate", {
            data: event.data ?? "",
          }),
        );
        continue;
      }
      if (event.type === "compositionend") {
        if (event.textarea) {
          setValue(
            event.textarea.value,
            event.textarea.selectionStart,
            event.textarea.selectionEnd,
          );
        }
        textarea.dispatchEvent(
          new CompositionEvent("compositionend", { data: event.data ?? "" }),
        );
        continue;
      }
      if (event.type !== "beforeinput" && event.type !== "input") continue;

      if (event.type === "input" && event.textarea) {
        setValue(
          event.textarea.value,
          event.textarea.selectionStart,
          event.textarea.selectionEnd,
        );
      }
      const inputEvent = new InputEvent(event.type, {
        bubbles: true,
        cancelable:
          event.cancelable ??
          (event.type === "beforeinput" && event.inputType === "insertText"),
        data: event.data ?? null,
        inputType: event.inputType ?? "",
        isComposing: event.isComposing ?? false,
      });
      const notPrevented = textarea.dispatchEvent(inputEvent);
      if (event.type === "beforeinput" && !notPrevented) continue;
      if (event.type === "beforeinput" && event.textarea) {
        setValue(
          event.textarea.value,
          event.textarea.selectionStart,
          event.textarea.selectionEnd,
        );
      }
    }
  }, trace);
}

/**
 * Reproduce the real Firefox+Telex selection-desync captured from the spike:
 * after committing "xin " the IME leaves the hidden textarea SELECTION pointing
 * at the previous word ("0-3") while the model caret is at "4-4", then fires a
 * plain `insertText "o"` that would replace "xin" with "o" in the textarea. A
 * polyfill that mirrors `textarea.value` collapses the document to "o  "; the
 * fix must apply the insert at the MODEL selection instead, yielding "xin o".
 *
 * The helper dispatches the realistic `beforeinput`+`input` pair and only
 * performs the textarea's replacement when the edit was NOT prevented — so the
 * same script reproduces the corruption on the old code and passes on the fix.
 */
async function replayFirefoxTelexSelectionDesync(page: Page): Promise<void> {
  await polyfillTextarea(page).evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.focus();

    const composeWord = (base: string, steps: readonly string[]) => {
      const final = steps[steps.length - 1] ?? "";
      textarea.dispatchEvent(new CompositionEvent("compositionstart"));
      for (const data of steps) {
        textarea.dispatchEvent(
          new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: false,
            data,
            inputType: "insertCompositionText",
            isComposing: true,
          }),
        );
        textarea.value = base + data;
        textarea.setSelectionRange((base + data).length, (base + data).length);
        textarea.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            data,
            inputType: "insertCompositionText",
            isComposing: true,
          }),
        );
      }
      textarea.value = base + final;
      textarea.setSelectionRange((base + final).length, (base + final).length);
      textarea.dispatchEvent(
        new CompositionEvent("compositionend", { data: final }),
      );
      textarea.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: final,
          inputType: "insertCompositionText",
          isComposing: false,
        }),
      );
    };

    // Plain insertText with the textarea selection at [selStart, selEnd]. The
    // browser only performs the edit (and fires `input`) when `beforeinput` was
    // not prevented — exactly what the polyfill controls.
    const insertTextAt = (data: string, selStart: number, selEnd: number) => {
      textarea.setSelectionRange(selStart, selEnd);
      const notPrevented = textarea.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          data,
          inputType: "insertText",
          isComposing: false,
        }),
      );
      if (notPrevented) {
        textarea.value =
          textarea.value.slice(0, selStart) +
          data +
          textarea.value.slice(selEnd);
        const caret = selStart + data.length;
        textarea.setSelectionRange(caret, caret);
        textarea.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            data,
            inputType: "insertText",
            isComposing: false,
          }),
        );
      }
    };

    composeWord("", ["x", "xi", "xin"]); // model + textarea = "xin", caret 3
    insertTextAt(" ", 3, 3); // in-sync space → "xin ", caret 4
    insertTextAt("o", 0, 3); // DESYNC: textarea selection on "xin", model caret 4
  });
}

/**
 * Emulate the iOS/iPadOS polyfill path where the software keyboard mutates a
 * real mirrored textarea. This catches the regression caused by the desktop
 * Telex scratchpad fix: an empty textarea gives iOS no surrounding text for
 * Vietnamese composition or word-delete semantics.
 */
async function replayIpadVietnameseAndWordDelete(page: Page): Promise<void> {
  await polyfillTextarea(page).evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.focus();

    const fireInput = (
      type: "beforeinput" | "input",
      inputType: string,
      data: string | null,
      isComposing: boolean,
    ) =>
      textarea.dispatchEvent(
        new InputEvent(type, {
          bubbles: true,
          cancelable: type === "beforeinput",
          data,
          inputType,
          isComposing,
        }),
      );

    const replaceSelection = (text: string) => {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.value =
        textarea.value.slice(0, start) + text + textarea.value.slice(end);
      const caret = start + text.length;
      textarea.setSelectionRange(caret, caret);
    };

    const insertText = (text: string) => {
      const notPrevented = fireInput("beforeinput", "insertText", text, false);
      if (!notPrevented) return;
      replaceSelection(text);
      fireInput("input", "insertText", text, false);
    };

    const composeWord = (values: readonly string[]) => {
      textarea.dispatchEvent(new CompositionEvent("compositionstart"));
      const prefix = textarea.value.slice(0, textarea.selectionStart);
      for (const value of values) {
        fireInput(
          "beforeinput",
          "insertCompositionText",
          value.at(-1) ?? value,
          true,
        );
        textarea.value = `${prefix}${value}`;
        textarea.setSelectionRange(
          textarea.value.length,
          textarea.value.length,
        );
        fireInput(
          "input",
          "insertCompositionText",
          value.at(-1) ?? value,
          true,
        );
      }
      textarea.dispatchEvent(
        new CompositionEvent("compositionend", {
          data: values[values.length - 1] ?? "",
        }),
      );
    };

    insertText("cái gì ");
    composeWord(["d", "dd", "đ", "đâ", "đây", "đấy"]);
    const beforeDelete = fireInput(
      "beforeinput",
      "deleteWordBackward",
      null,
      false,
    );
    if (!beforeDelete) return;
    textarea.value = "cái gì ";
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    fireInput("input", "deleteWordBackward", null, false);
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

async function expectCaretPixelAligned(page: Page): Promise<void> {
  const caretBox = await page.locator("[data-owned-caret]").boundingBox();
  if (!caretBox) throw new Error("owned caret missing");
  const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
  const deviceX = caretBox.x * devicePixelRatio;
  expect(Math.abs(deviceX - Math.round(deviceX))).toBeLessThanOrEqual(0.01);
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
    await expect(host).not.toHaveAttribute("data-editcontext-active", "");
  } else {
    expect(dragDiag.inputBackend).toBe("polyfill");
    await expect(host).toHaveAttribute("data-editcontext-active", "");
  }
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

test("grapheme navigation and deletion never split composed text", async ({
  page,
}) => {
  const host = await openStory(page, NATIVE_STORY);
  const text = page.locator("[data-owned-text]");

  await host.click();
  await page.keyboard.insertText("A👩‍💻B");
  await expect.poll(async () => (await diagnostics(page)).text).toBe("A👩‍💻B");

  await page.keyboard.press("ArrowLeft");
  expect((await diagnostics(page)).focus).toBe("A👩‍💻".length);
  await page.keyboard.press("Backspace");
  await expect.poll(async () => (await diagnostics(page)).text).toBe("AB");
  expect((await diagnostics(page)).focus).toBe("A".length);

  await page.keyboard.insertText("e\u0301🙂");
  await expect
    .poll(async () => (await diagnostics(page)).text)
    .toBe("Ae\u0301🙂B");
  await page.keyboard.press("Backspace");
  await expect
    .poll(async () => (await diagnostics(page)).text)
    .toBe("Ae\u0301B");
  await page.keyboard.press("Backspace");
  await expect.poll(async () => (await diagnostics(page)).text).toBe("AB");
  await expect(text).toHaveText("AB");
});

test("single-block copy and paste use the owned model text", async ({
  page,
}) => {
  const host = await openStory(page, NATIVE_STORY);
  const text = page.locator("[data-owned-text]");

  await host.click();
  await page.keyboard.type("copy paste");
  await expect
    .poll(async () => (await diagnostics(page)).text)
    .toBe("copy paste");

  await page.keyboard.press("Control+A");
  const copied = await dispatchClipboard(page, "copy");
  expect(copied).toBe("copy paste");
  expect((await diagnostics(page)).lastClipboardText).toBe("copy paste");

  await dispatchClipboard(page, "paste", "model text");
  await expect
    .poll(async () => (await diagnostics(page)).text)
    .toBe("model text");
  await expect(text).toHaveText("model text");
  expect((await diagnostics(page)).lastClipboardText).toBe("model text");
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
  await expectCaretPixelAligned(page);
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
      textarea.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          data: value,
          inputType: "insertCompositionText",
          isComposing: true,
        }),
      );
      textarea.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: value,
          inputType: "insertCompositionText",
          isComposing: true,
        }),
      );
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
    // Real IMEs drive composition through `beforeinput`/`insertCompositionText`
    // (the `input` twin is redundant); the polyfill owns it from there.
    textarea.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: false,
        data: "bo",
        inputType: "insertCompositionText",
        isComposing: true,
      }),
    );
    textarea.value = "bo";
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    textarea.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: "bo",
        inputType: "insertCompositionText",
        isComposing: true,
      }),
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

test("polyfill ignores a desynced textarea selection and edits at the model caret", async ({
  page,
}) => {
  const host = await openStory(page, FORCED_POLYFILL_STORY);
  await host.click();

  await replayFirefoxTelexSelectionDesync(page);

  // The IME left the textarea selection on the committed "xin" (taSel 0-3) and
  // tried to replace it; trusting the textarea collapsed the doc to "o  ". The
  // fix applies the insert at the model caret (4) → "xin o", and the rendered
  // surface must match the model.
  await expect.poll(async () => (await diagnostics(page)).text).toBe("xin o");
  await expect
    .poll(() =>
      page.evaluate(
        () => document.querySelector("[data-owned-text]")?.textContent ?? null,
      ),
    )
    .toBe("xin o");
});

test("iPadOS polyfill mirrors textarea context for Vietnamese composition and word delete", async ({
  page,
}) => {
  await emulateIpadTextareaPlatform(page);
  const host = await openStory(page, FORCED_POLYFILL_STORY);
  await host.click();

  await replayIpadVietnameseAndWordDelete(page);

  await expect.poll(async () => (await diagnostics(page)).text).toBe("cái gì ");
  await expect
    .poll(() =>
      page.evaluate(
        () => document.querySelector("[data-owned-text]")?.textContent ?? null,
      ),
    )
    .toBe("cái gì ");
  await expect
    .poll(() =>
      polyfillTextarea(page).evaluate(
        (element) => (element as HTMLTextAreaElement).value,
      ),
    )
    .toBe("cái gì ");
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
  await expect(host).toHaveAttribute("data-editcontext-active", "");
  await expect(caret).toBeVisible();

  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  const selectionDiag = await diagnostics(page);
  expect(selectionDiag.anchor).not.toBe(selectionDiag.focus);
  expect(selectionDiag.rectCount).toBeGreaterThan(0);
});
