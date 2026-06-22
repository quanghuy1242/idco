import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * docs/010 Phase 7 — IME, bounds, caret suppression, and goal-column hardening,
 * driven as real interaction on chromium/webkit/firefox. The owned-model view
 * uses the EditContext polyfill here (the story forces it), which is the backend
 * IDCO owns on every browser without a native EditContext.
 *
 * - AC5 a scripted composition paints an engine-owned preedit underline and feeds
 *   the model on commit.
 * - AC4 IME control/selection bounds track the caret and follow it across scroll.
 * - AC6 the surface suppresses the native caret and ::selection.
 * - AC7 vertical navigation holds a goal column through ragged-width lines.
 */
const EDITING_STORY = "engine--owned-model--phase55-editing";
const RAGGED_STORY = "engine--owned-model--phase7-ragged-lines";
const API = "__IDCO_ENGINE_VIEW_API__";

// Folded in from the removed input spike (note.md Legacy/spike cleanup): the
// real-IME event-stream replays that guard the EditContext polyfill, retargeted
// from the spike host onto the shipped owned-model forced-polyfill block. The
// polyfill is the same vendored code (`src/vendor/editcontext-polyfill`) the owned
// engine binds per leaf, so these regressions belong on the owned surface now.
type EngineImeTrace = {
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
    textarea?: { value: string; selectionStart: number; selectionEnd: number };
  }>;
};

const FIREFOX_TELEX_XIN_CHAO_FIXTURE = JSON.parse(
  readFileSync(
    new URL(
      "../fixtures/owned-model-ime/firefox-telex-xin-chao.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as EngineImeTrace;

type Diag = {
  order: string[];
  blockTexts: Record<string, string>;
  selection: {
    type: string;
    focus?: { node: string; offset: number };
    anchor?: { node: string; offset: number };
  } | null;
  composition: { node: string; from: number; to: number } | null;
  imeBounds: {
    control: { left: number; top: number; width: number; height: number };
    selection: { left: number; top: number; width: number; height: number };
    characterCount: number;
    firstCharacter: { left: number; top: number } | null;
  } | null;
};

async function diag(page: Page): Promise<Diag> {
  return page.evaluate((key) => {
    const api = (
      window as unknown as Record<string, { diagnostics: () => Diag }>
    )[key];
    return api.diagnostics();
  }, API);
}

async function open(page: Page, story: string, query = ""): Promise<void> {
  await page.goto(`/?story=${story}${query}`, { waitUntil: "commit" });
  await page.locator("[data-engine-view-root]").waitFor({ state: "visible" });
  await page
    .locator("[data-engine-text-id]")
    .first()
    .waitFor({ state: "visible" });
}

test("native EditContext: feeding IME bounds uses a real DOMRect, not a plain rect", async ({
  page,
  browserName,
}) => {
  // The native Chromium EditContext rejects a non-DOMRect for updateSelectionBounds
  // and the overlay error-boundary then unmounts the caret. The forced-polyfill
  // stories never exercised the native path, so this opens it explicitly. On
  // WebKit/Firefox there is no native EditContext, so this runs over the polyfill.
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page, EDITING_STORY, "&engineInput=native");
  const block = page.locator("[data-engine-text-id]").nth(1);
  await block.click();
  await page.keyboard.type("ok");
  await page.keyboard.press("ArrowLeft");
  // The caret overlay is still painted (the crash would have unmounted it), and
  // no EditContext bounds TypeError was thrown.
  await expect(page.locator("[data-engine-caret]")).toHaveCount(1);
  expect(
    errors.filter((message) => message.includes("updateSelectionBounds")),
  ).toEqual([]);
  expect(browserName).toBeTruthy();
});

test("AC8 triple-click selects the line, not the whole multi-line block", async ({
  page,
}) => {
  await open(page, RAGGED_STORY);
  const block = page.locator("[data-engine-text-id]").first();
  const id = (await block.getAttribute("data-engine-block-id"))!;
  const text = (await diag(page)).blockTexts[id]!;
  const firstNewline = text.indexOf("\n");
  const box = (await block.boundingBox())!;

  // Triple-click on the first visual line.
  await page.mouse.click(box.x + box.width * 0.3, box.y + 6, { clickCount: 3 });
  const sel = (await diag(page)).selection!;
  expect(sel.type).toBe("text");
  const from = Math.min(sel.anchor!.offset, sel.focus!.offset);
  const to = Math.max(sel.anchor!.offset, sel.focus!.offset);
  // The selection is exactly the first line [0, firstNewline), not the whole
  // block (which would extend past the newline to the end).
  expect(from).toBe(0);
  expect(to).toBe(firstNewline);
  expect(to).toBeLessThan(text.length);
});

test("AC5 a scripted composition paints an engine-owned preedit underline", async ({
  page,
}) => {
  await open(page, EDITING_STORY);
  const block = page.locator("[data-engine-text-id]").nth(1);
  const id = (await block.getAttribute("data-engine-block-id"))!;
  const before = (await diag(page)).blockTexts[id]!;
  // Click to place the caret and activate the leaf (binds the polyfill).
  await block.click();

  await page.evaluate(
    ({ blockId }) => {
      const b = document.querySelector(`[data-engine-block-id="${blockId}"]`);
      const ta = b?.shadowRoot?.querySelector("textarea");
      if (!(ta instanceof HTMLTextAreaElement)) {
        throw new Error("no textarea");
      }
      ta.focus();
      ta.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      // The polyfill routes composition through `beforeinput:insertCompositionText`
      // (input-translator.ts), where it calls EditContext._setComposition.
      ta.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          data: "ni",
          inputType: "insertCompositionText",
          isComposing: true,
        }),
      );
    },
    { blockId: id },
  );

  // The engine recorded a preedit range and painted an underline over it (AC5).
  await expect
    .poll(async () => (await diag(page)).composition !== null, {
      timeout: 5000,
    })
    .toBe(true);
  const comp = (await diag(page)).composition!;
  expect(comp.node).toBe(id);
  expect(comp.to).toBeGreaterThan(comp.from);
  expect(await page.locator("[data-engine-preedit]").count()).toBeGreaterThan(
    0,
  );

  // Commit and assert the composition clears and the text lands in the model.
  await page.evaluate(
    ({ blockId }) => {
      const b = document.querySelector(`[data-engine-block-id="${blockId}"]`);
      const ta = b?.shadowRoot?.querySelector("textarea");
      if (!(ta instanceof HTMLTextAreaElement)) return;
      ta.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "你" }),
      );
    },
    { blockId: id },
  );
  await expect
    .poll(async () => (await diag(page)).composition === null, {
      timeout: 5000,
    })
    .toBe(true);
  expect(await page.locator("[data-engine-preedit]").count()).toBe(0);
  // The commit lands asynchronously (textupdate → dispatch → render), so poll.
  await expect
    .poll(async () => (await diag(page)).blockTexts[id], { timeout: 5000 })
    .not.toBe(before);
});

test("AC4 IME bounds track the caret and follow it across scroll", async ({
  page,
}) => {
  await open(page, "engine--owned-model--phase55000-blocks");
  const first = page.locator("[data-engine-text-id]").first();
  const id = (await first.getAttribute("data-engine-block-id"))!;
  await first.click();

  // The fed selection bounds sit at the painted caret.
  await expect
    .poll(async () => (await diag(page)).imeBounds !== null)
    .toBe(true);
  const caret = await page.locator("[data-engine-caret]").first().boundingBox();
  const beforeBounds = (await diag(page)).imeBounds!;
  expect(caret).not.toBeNull();
  expect(Math.abs(beforeBounds.selection.top - caret!.y)).toBeLessThan(8);

  // Scroll the surface; the bounds must re-feed at the caret's new viewport
  // position so the OS candidate window follows it (AC4).
  await page.locator("[data-engine-view-root]").evaluate((el) => {
    el.scrollTop = 40;
    el.dispatchEvent(new Event("scroll"));
  });
  await expect
    .poll(async () => {
      const b = await diag(page);
      return b.imeBounds ? b.imeBounds.selection.top : Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(beforeBounds.selection.top - 20);
  void id;
});

test("AC6 the surface suppresses the native caret and ::selection", async ({
  page,
}) => {
  await open(page, EDITING_STORY);
  // The native caret is suppressed on the engine's own editing blocks (where it
  // paints its own caret). Assert on a text block, not the role=application root
  // — WebKit resolves caret-color oddly on a non-editable container, and the
  // block is the meaningful, reliably-transparent target. (The live object
  // editor keeps its caret; that is guarded in engine-objects.spec.ts.)
  const caretColor = await page
    .locator("[data-engine-text-id]")
    .first()
    .evaluate((el) => getComputedStyle(el).caretColor);
  // Transparent renders as rgba(0, 0, 0, 0) in computed styles.
  expect(caretColor.replace(/\s/g, "")).toBe("rgba(0,0,0,0)");

  // A ::selection rule that zeroes the highlight exists in the engine stylesheet.
  const hasSelectionRule = await page.evaluate(() => {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(rules)) {
        const text = rule.cssText;
        if (text.includes("::selection") && text.includes("transparent")) {
          return true;
        }
      }
    }
    return false;
  });
  expect(hasSelectionRule).toBe(true);
});

test("AC7 vertical navigation holds a goal column through ragged lines", async ({
  page,
}) => {
  await open(page, RAGGED_STORY);
  const block = page.locator("[data-engine-text-id]").first();
  const id = (await block.getAttribute("data-engine-block-id"))!;
  const text = (await diag(page)).blockTexts[id]!;
  const firstNewline = text.indexOf("\n");
  const secondNewline = text.indexOf("\n", firstNewline + 1);

  // Place the caret deep into the long first line (a high column), past where
  // the short middle line ends.
  const box = (await block.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.6, box.y + 6);
  const startOffset = (await diag(page)).selection!.focus!.offset;
  expect(startOffset).toBeGreaterThan(8);
  expect(startOffset).toBeLessThan(firstNewline);

  // ArrowDown onto the short line: the caret clamps to its end (shorter column).
  await page.keyboard.press("ArrowDown");
  const onShort = (await diag(page)).selection!.focus!.offset;
  expect(onShort).toBeGreaterThan(firstNewline);
  expect(onShort).toBeLessThanOrEqual(secondNewline);

  // ArrowDown onto the long third line: the goal column is restored, so the
  // caret lands near the original column, not at the short line's short end.
  await page.keyboard.press("ArrowDown");
  const onLong = (await diag(page)).selection!.focus!.offset;
  const columnOnThird = onLong - secondNewline - 1;
  const shortLineLength = secondNewline - firstNewline - 1;
  expect(onLong).toBeGreaterThan(secondNewline);
  // Without a goal column the caret would stick near the short line's column;
  // with it, the third-line column is close to the original (within a few chars).
  expect(columnOnThird).toBeGreaterThan(shortLineLength + 2);
});

// ============================================================================
// Polyfill IME regressions — folded from the removed input spike (note.md).
//
// These replay the exact hidden-textarea event streams real IMEs emit and assert
// the owned model converges on the right text. They guard the vendored EditContext
// polyfill the owned engine binds per leaf. Each opens the forced-polyfill editing
// story, clears a block to empty (through the model, so exact assertions hold),
// then drives that block's shadow-root textarea. Verify with
// `pnpm test:e2e:correctness`.
// ============================================================================

// Open the forced-polyfill editing story, focus a block, and clear it to empty
// through the model so a replay builds its text from a known-empty leaf.
async function openEmptyPolyfillBlock(page: Page): Promise<string> {
  await open(page, EDITING_STORY);
  const block = page.locator("[data-engine-text-id]").nth(1);
  const id = (await block.getAttribute("data-engine-block-id"))!;
  await block.click();
  // Clear the leaf through the polyfill input path, not a hardware Backspace: a
  // touch profile (the iPad test) does not bind keydown deletion, so select the
  // whole leaf in the sink textarea and fire deleteContentBackward — the same
  // delete path the Gboard replay below exercises, so it works on every platform.
  await driveBlockTextarea(page, id, null, (textarea) => {
    if (textarea.value.length === 0) return;
    textarea.setSelectionRange(0, textarea.value.length);
    const notPrevented = textarea.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        data: null,
        inputType: "deleteContentBackward",
        isComposing: false,
      }),
    );
    if (notPrevented) {
      textarea.value = "";
      textarea.setSelectionRange(0, 0);
      textarea.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: null,
          inputType: "deleteContentBackward",
          isComposing: false,
        }),
      );
    }
  });
  await expect
    .poll(async () => (await diag(page)).blockTexts[id] ?? "")
    .toBe("");
  return id;
}

// Drive `fn` against the block's polyfill textarea. Playwright's CSS locator
// pierces the leaf's open shadow root (the same way the spike reached its host
// textarea), and `locator.evaluate` runs `fn` directly in the page — no eval. A
// first evaluate focuses the sink so the replay `fn` runs against a focused leaf.
async function driveBlockTextarea<A>(
  page: Page,
  blockId: string,
  arg: A,
  fn: (textarea: HTMLTextAreaElement, arg: A) => void,
): Promise<void> {
  const textarea = page.locator(`[data-engine-block-id="${blockId}"] textarea`);
  await textarea.evaluate((element) =>
    (element as HTMLTextAreaElement).focus(),
  );
  // Playwright's `Unboxed<A>` arg typing fights a generic wrapper; the runtime
  // contract (pure fn + serializable arg) holds, so cast through `never`.
  await textarea.evaluate(fn as never, arg as never);
}

test("polyfill composes Vietnamese Telex 'xin chào' from the real Firefox event stream", async ({
  page,
}) => {
  const id = await openEmptyPolyfillBlock(page);

  // Every preedit update fires a beforeinput+input pair (both insertCompositionText
  // with the full word), and Firefox fires one more insertCompositionText input
  // with isComposing:false AFTER compositionend. Re-applying that trailing event
  // re-inserts the committed word ("xin"→"xinxin"); the polyfill must not fold it.
  await driveBlockTextarea(
    page,
    id,
    FIREFOX_TELEX_XIN_CHAO_FIXTURE,
    (textarea, trace) => {
      const setValue = (
        value: string,
        selectionStart = value.length,
        selectionEnd = selectionStart,
      ) => {
        textarea.value = value;
        textarea.setSelectionRange(selectionStart, selectionEnd);
      };
      for (const event of trace.events) {
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
    },
  );

  await expect
    .poll(async () => (await diag(page)).blockTexts[id])
    .toBe("xin chào");
});

test("polyfill ignores a desynced textarea selection and edits at the model caret", async ({
  page,
}) => {
  const id = await openEmptyPolyfillBlock(page);

  // After committing "xin " the IME leaves the textarea selection on "xin" (0-3)
  // while the model caret is at 4, then fires a plain insertText "o" that would
  // replace "xin". Trusting the textarea collapses the doc to "o  "; the fix
  // applies the insert at the MODEL caret → "xin o".
  await driveBlockTextarea(page, id, null, (textarea) => {
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
    composeWord("", ["x", "xi", "xin"]);
    insertTextAt(" ", 3, 3);
    insertTextAt("o", 0, 3);
  });

  await expect
    .poll(async () => (await diag(page)).blockTexts[id])
    .toBe("xin o");
});

test("iPadOS polyfill mirrors textarea context for Vietnamese composition and word delete", async ({
  page,
}) => {
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
  const id = await openEmptyPolyfillBlock(page);

  // The desktop Telex scratchpad fix must not starve iOS of surrounding text:
  // compose "cái gì đấy" then deleteWordBackward → "cái gì ".
  await driveBlockTextarea(page, id, null, (textarea) => {
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

  await expect
    .poll(async () => (await diag(page)).blockTexts[id])
    .toBe("cái gì ");
});

for (const redundantDeleteInput of [false, true] as const) {
  test(`polyfill deletes the IME-selected range for Android Gboard diacritics (redundant twin: ${redundantDeleteInput})`, async ({
    page,
  }) => {
    const id = await openEmptyPolyfillBlock(page);

    // Gboard accents a vowel by SELECTING the cluster, firing deleteContentBackward,
    // then insertText of the accented cluster. The model must delete the IME-SELECTED
    // range (else "chào"→"chaào"), and Android Chrome's redundant uncancelable delete
    // input twin must not delete twice (else "nhé"→"né"). Both yield "xin chào bạn nhé".
    await driveBlockTextarea(
      page,
      id,
      { redundantDeleteInput },
      (textarea, opts) => {
        const insertText = (data: string) => {
          const caret = textarea.selectionEnd;
          textarea.setSelectionRange(caret, caret);
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
              textarea.value.slice(0, caret) +
              data +
              textarea.value.slice(caret);
            const next = caret + data.length;
            textarea.setSelectionRange(next, next);
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
        const recompose = (start: number, end: number, cluster: string) => {
          textarea.setSelectionRange(start, end);
          const deleteNotPrevented = textarea.dispatchEvent(
            new InputEvent("beforeinput", {
              bubbles: true,
              cancelable: true,
              data: null,
              inputType: "deleteContentBackward",
              isComposing: false,
            }),
          );
          if (deleteNotPrevented) {
            textarea.value =
              textarea.value.slice(0, start) + textarea.value.slice(end);
            textarea.setSelectionRange(start, start);
          }
          if (opts.redundantDeleteInput) {
            textarea.dispatchEvent(
              new InputEvent("input", {
                bubbles: true,
                data: null,
                inputType: "deleteContentBackward",
                isComposing: false,
              }),
            );
          }
          insertText(cluster);
        };
        for (const ch of "xin chao") insertText(ch);
        recompose(6, 8, "ào");
        for (const ch of " ban") insertText(ch);
        recompose(10, 12, "ạn");
        for (const ch of " nhe") insertText(ch);
        recompose(15, 16, "é");
      },
    );

    await expect
      .poll(async () => (await diag(page)).blockTexts[id])
      .toBe("xin chào bạn nhé");
  });
}
