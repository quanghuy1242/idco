// Translates textarea input events into EditContext internal method calls.
// Composition uses preventDefault + explicit range tracking via EditContext's
// _setComposition/_commitText. Non-composition handled types (insertText,
// delete*) call _insertText/_deleteBackward/etc. directly.

import type { EditContextPolyfill } from "./edit-context.js";

// inputType values that EditContext handles — these produce textupdate events.
const HANDLED_INPUT_TYPES: ReadonlySet<string> = new Set([
  "insertText",
  "insertTranspose",
  "deleteWordBackward",
  "deleteWordForward",
  "deleteContent",
  "deleteContentBackward",
  "deleteContentForward",
]);

// inputType values where Chrome does NOT fire beforeinput on the element.
const SUPPRESSED_INPUT_TYPES: ReadonlySet<string> = new Set([
  "deleteByCut",
  "deleteByDrag",
]);

export interface InputTranslator {
  destroy: () => void;
  syncFromEditContext: () => void;
}

const DELETE_DISPATCH: Readonly<
  Record<string, (ec: EditContextPolyfill) => void>
> = {
  deleteContentBackward: (ec) => ec._deleteBackward(),
  deleteContentForward: (ec) => ec._deleteForward(),
  deleteWordBackward: (ec) => ec._deleteWordBackward(),
  deleteWordForward: (ec) => ec._deleteWordForward(),
  deleteContent: (ec) => ec._deleteBackward(),
};

const KEYBOARD_EVENT_PROPS = [
  "key",
  "code",
  "location",
  "ctrlKey",
  "shiftKey",
  "altKey",
  "metaKey",
  "repeat",
  "isComposing",
] as const;

// Pure modifier keys that can't change text or selection.
const MODIFIER_ONLY_KEYS: ReadonlySet<string> = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "CapsLock",
]);

// Keys whose default textarea behavior moves the cursor/selection.
// Chrome native EditContext does NOT update selection for these.
const NAVIGATION_KEYS: ReadonlySet<string> = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

function createForwardedKeyboardEvent(event: KeyboardEvent): KeyboardEvent {
  const init: KeyboardEventInit = {};
  for (const prop of KEYBOARD_EVENT_PROPS) {
    (init as Record<string, unknown>)[prop] = event[prop];
  }
  init.bubbles = true;
  init.cancelable = true;
  init.composed = true;
  return new KeyboardEvent(event.type, init);
}

// Normalize Firefox's insertLineBreak to Chrome's insertParagraph for plain Enter.
// Also remap Ctrl+Backspace/Delete with a selection: the textarea fires
// deleteContentBackward/Forward (selection deletion), but Chrome's native
// EditContext always fires deleteWord* to reflect the keypress intent.
function normalizeInputType(
  inputType: string,
  shiftHeld: boolean,
  ctrlHeld: boolean,
): string {
  if (inputType === "insertLineBreak" && !shiftHeld) return "insertParagraph";
  if (ctrlHeld) {
    if (inputType === "deleteContentBackward") return "deleteWordBackward";
    if (inputType === "deleteContentForward") return "deleteWordForward";
  }
  return inputType;
}

// inputTypes where Chrome native EditContext sets beforeinput.data to null
// (paste/drop data is available via event.dataTransfer, not event.data).
const DATA_NULL_INPUT_TYPES: ReadonlySet<string> = new Set([
  "insertFromPaste",
  "insertFromDrop",
]);

function createSyntheticBeforeInput(
  inputType: string,
  event: InputEvent,
): InputEvent {
  const init: InputEventInit = {
    inputType,
    data: DATA_NULL_INPUT_TYPES.has(inputType) ? null : event.data,
    cancelable: true,
    bubbles: true,
    composed: true,
  };
  if (event.dataTransfer) init.dataTransfer = event.dataTransfer;
  return new InputEvent("beforeinput", init);
}

export function createInputTranslator(
  textarea: HTMLTextAreaElement,
  getEditContext: () => EditContextPolyfill | null,
  getAttachedElement: () => HTMLElement | null,
): InputTranslator {
  // Track modifier state from keydown for input type normalization
  let shiftHeld = false;
  let ctrlHeld = false;
  // Track whether we're mid-composition (from the textarea's perspective)
  let textareaComposing = false;

  function syncFromEditContext(): void {
    const editContext = getEditContext();
    if (!editContext) return;

    // Don't sync textarea during composition — setting value or selection
    // programmatically disrupts the browser's native IME tracking,
    // causing composition to end prematurely or subsequent
    // imeSetComposition calls to be swallowed.
    if (editContext.isComposing) return;

    textarea.value = editContext.text;
    const start = Math.min(
      editContext.selectionStart,
      editContext.selectionEnd,
    );
    const end = Math.max(editContext.selectionStart, editContext.selectionEnd);
    textarea.setSelectionRange(
      start,
      end,
      editContext.selectionStart > editContext.selectionEnd
        ? "backward"
        : "forward",
    );
  }

  // Whether the textarea is inside a shadow root. When true, keyboard,
  // clipboard, and composition events naturally bubble to the host element
  // via shadow DOM retargeting, so we must NOT dispatch synthetic copies.
  const inShadow = textarea.getRootNode() instanceof ShadowRoot;

  function forwardKeyboardEvent(event: KeyboardEvent): void {
    if (event.type === "keydown") {
      shiftHeld = event.shiftKey;
      ctrlHeld = event.ctrlKey || event.metaKey;
      // Ensure textarea is in sync before processing key events. Chrome may
      // asynchronously reset the textarea's selection after addRange() on
      // light DOM conflicts with shadow-hosted textarea focus.
      // Skip for modifier-only keys — they can't change text or selection.
      if (!MODIFIER_ONLY_KEYS.has(event.key)) {
        syncFromEditContext();
      }
    }

    const attachedElement = getAttachedElement();
    if (!attachedElement) return;

    // Check if this key needs preventDefault to stop textarea default behavior.
    // Navigation keys move the textarea cursor; Ctrl+A/Z/Y mutate state outside
    // the EditContext flow.
    const needsPreventDefault =
      event.type === "keydown" &&
      (NAVIGATION_KEYS.has(event.key) ||
        ((event.ctrlKey || event.metaKey) &&
          !event.altKey &&
          (event.key.toLowerCase() === "a" ||
            event.key.toLowerCase() === "z" ||
            event.key.toLowerCase() === "y")));

    if (!inShadow) {
      if (!attachedElement.dispatchEvent(createForwardedKeyboardEvent(event))) {
        event.preventDefault();
        return;
      }
    } else if (needsPreventDefault) {
      // Firefox doesn't retarget keyboard events through the shadow boundary
      // when preventDefault() is called on the original event. Dispatch a
      // synthetic copy on the host and stop the original from also bubbling
      // through (which would cause duplicates on Chrome).
      event.stopPropagation();
      if (!attachedElement.dispatchEvent(createForwardedKeyboardEvent(event))) {
        event.preventDefault();
        return;
      }
    }

    if (needsPreventDefault) {
      event.preventDefault();
    }
  }

  function handleBeforeInput(event: Event): void {
    if (!(event instanceof InputEvent)) return;
    const editContext = getEditContext();
    const attachedElement = getAttachedElement();
    if (!editContext || !attachedElement) return;

    const inputType = normalizeInputType(event.inputType, shiftHeld, ctrlHeld);
    const isComposition = inputType === "insertCompositionText";
    const isHandled = HANDLED_INPUT_TYPES.has(inputType);
    const isSuppressed = SUPPRESSED_INPUT_TYPES.has(inputType);

    // If a non-composition input arrives while the EditContext is composing,
    // Chrome's native EditContext keeps the composition range intact but
    // "suspends" it — no compositionend event fires, updateSelection won't
    // cancel it, and a subsequent imeSetComposition resumes it (no extra
    // compositionstart). On blur/detach, compositionend data reflects the
    // CURRENT text at the composition range.
    if (!isComposition && editContext.isComposing) {
      editContext._suspendComposition();
      syncFromEditContext();
    }

    // Chrome doesn't fire beforeinput for composition or suppressed types on the element.
    if (isSuppressed) {
      if (inShadow) event.stopPropagation();
      event.preventDefault();
      return;
    }

    if (!isComposition) {
      // Stop the natural event from also reaching the host via shadow DOM
      if (inShadow) event.stopPropagation();

      const syntheticBeforeInput = createSyntheticBeforeInput(inputType, event);

      if (!attachedElement.dispatchEvent(syntheticBeforeInput)) {
        event.preventDefault();
        return;
      }
    }

    // Composition: suppress and route through EditContext's _setComposition.
    // Chrome native EditContext never fires beforeinput:insertCompositionText
    // on the element, so stop the textarea's event from bubbling through shadow DOM.
    if (isComposition) {
      if (inShadow) event.stopPropagation();
      event.preventDefault();
      const data = event.data ?? "";
      editContext._setComposition(data, data.length, data.length);
      syncFromEditContext();
      return;
    }

    if (isHandled) {
      event.preventDefault();

      if (inputType === "insertText" || inputType === "insertTranspose") {
        editContext._insertText(event.data ?? "");
      } else {
        // Honor an explicit textarea range-selection as the deletion span before
        // deleting. Vietnamese IMEs (e.g. Gboard on Android) select the vowel
        // cluster to recompose it, then fire deleteContentBackward; the model
        // caret alone deletes the wrong span ("chào" → "chaào"). A *collapsed*
        // textarea selection is left to the model, preserving the desktop
        // Telex behavior where the committed-word textarea caret is stale.
        if (textarea.selectionStart !== textarea.selectionEnd) {
          editContext.updateSelection(
            textarea.selectionStart,
            textarea.selectionEnd,
          );
        }
        DELETE_DISPATCH[inputType]?.(editContext);
      }

      syncFromEditContext();
      return;
    }

    // Non-handled types (insertParagraph, insertFromPaste, etc.): prevent
    // textarea mutation — the app handles these itself, matching Chrome.
    event.preventDefault();
  }

  function handleCompositionStart(): void {
    textareaComposing = true;
    // Don't fire compositionstart on EditContext yet — that happens in
    // _setComposition when the first non-empty text arrives.
  }

  function handleCompositionEnd(event: CompositionEvent): void {
    if (!textareaComposing) return;
    textareaComposing = false;

    const editContext = getEditContext();
    if (!editContext) return;

    // Finish any active or suspended composition. Pass the browser's
    // compositionend data directly — the composition range in state can
    // be stale when updateText shrunk the text without adjusting selection.
    editContext._finishComposingText(true, event.data);

    syncFromEditContext();
  }

  // Reconcile the EditContext model to the textarea's actual post-edit value by
  // diffing out the common prefix/suffix and replacing the changed span. The
  // textarea is the real input sink, so its value is authoritative on `input`
  // (which fires after the mutation). Returns whether the model changed.
  //
  // This is the ONE diff in the input pipeline that cannot be eliminated. On the
  // `beforeinput` path (desktop/Firefox) the browser hands us the inserted data
  // and we apply it directly with no diff; the engine then reuses the span we
  // publish on the resulting `textupdate` event (it never re-diffs). But on the
  // `input`-reconciliation path (Android Chrome's redundant twin, WebKit boundary
  // cases) the browser already mutated the textarea and told us *nothing* about
  // the span — for IME / autocorrect / swipe-typing `inputType` carries no usable
  // (start, end, inserted). So here we MUST discover the change by comparing
  // strings; there is no precomputed answer to reuse. We are the layer that
  // originates the span, which is why this scan stays and the engine-side one was
  // deleted.
  //
  // Cost: O(n) per input event (n = EditContext buffer length). The two scans
  // start at the string ENDS and walk inward to the change, so the price is the
  // two UNCHANGED halves around the edit, not the edit itself — a 1-char insert in
  // the middle still compares ~n chars. The buffer mirrors one text leaf (a single
  // paragraph/heading/list-item — code blocks are heavy objects, not this path),
  // so n is normally a few hundred chars and the scan is ~1µs: negligible against
  // a 6ms frame, and the `oldText === newText` line above bails the common
  // "beforeinput already applied it" case in ~4ns before any scan.
  //
  // PROPER SOLUTION (deliberately not implemented — see "why not" below). We
  // already know WHERE the edit is: `textarea.selectionStart` is the caret right
  // after it landed, and an `input` event is always a contiguous splice at that
  // caret. So instead of scanning from the ends inward, anchor at the caret and
  // scan OUTWARD, capped at a window W (e.g. 512):
  //
  //   const caret = Math.min(textarea.selectionStart, newLen);
  //   const delta = newLen - oldLen;        // caret-delta is the same boundary
  //                                          // in OLD coordinates
  //   // walk the left/right splice edges out from the caret, <= W steps each,
  //   // then build replaceStart/replaceEnd/inserted from the caret ± those walks
  //
  // That makes a keystroke in a huge leaf O(W) instead of O(n). The catch is that
  // you CANNOT cheaply verify the regions outside the window are unchanged —
  // comparing the two long prefixes for equality is itself O(n) and defeats the
  // point — so a windowed diff *assumes* locality (valid: input events are local
  // edits) and needs (1) an O(1) arithmetic check (oldLen - removed +
  // inserted.length === newLen) and (2) a fallback to this full scan when the
  // window does not reconcile (a big paste). It also has real boundary cases the
  // dumb full scan handles for free: surrogate pairs / grapheme clusters
  // straddling the window edge, an IME *replacing* a span (delete+insert at once,
  // so the caret is not simply start + inserted.length), and backward selections.
  //
  // WHY NOT NOW: it only helps the pathological corner of a 50KB+ SINGLE leaf
  // (one wall-of-text paragraph, no breaks) edited mid-buffer, AND only on the
  // Android/WebKit input path, AND the `===` bail already covers the common case.
  // Nobody authors a 50KB paragraph and edits its middle. So the windowing is
  // insurance against an input that effectively never occurs, at the cost of ~20
  // intricate lines plus surrogate/IME-replace edge handling and fuzz tests — a
  // poor trade. If EditContext is ever bound to a whole large document (not one
  // leaf), revisit and implement the windowed path above.
  function reconcileModelToTextarea(editContext: EditContextPolyfill): boolean {
    const oldText = editContext.text;
    const newText = textarea.value;
    if (oldText === newText) return false;

    const oldLen = oldText.length;
    const newLen = newText.length;
    let prefix = 0;
    const maxPrefix = Math.min(oldLen, newLen);
    while (
      prefix < maxPrefix &&
      oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)
    ) {
      prefix += 1;
    }
    let suffix = 0;
    const maxSuffix = Math.min(oldLen - prefix, newLen - prefix);
    while (
      suffix < maxSuffix &&
      oldText.charCodeAt(oldLen - 1 - suffix) ===
        newText.charCodeAt(newLen - 1 - suffix)
    ) {
      suffix += 1;
    }

    const replaceStart = prefix;
    const replaceEnd = oldLen - suffix;
    const inserted = newText.slice(prefix, newLen - suffix);
    // Drive the change through the model's selection so it emits one textupdate
    // with the inserted text and the post-edit caret, identical to a native edit.
    editContext.updateSelection(replaceStart, replaceEnd);
    editContext._insertText(inserted);
    return true;
  }

  // `input` fires after the textarea has mutated. Rather than replay the
  // operation (which double-applies when both beforeinput and input fire, as on
  // Android Chrome), reconcile the model to the textarea by diff. When
  // beforeinput already applied + synced this edit (desktop/Firefox) the diff is
  // empty, so the redundant input is a no-op; when beforeinput never fired
  // (WebKit boundary cases) the diff carries the real mutation. The edit lands
  // exactly once, over the span the IME actually changed.
  function handleInput(event: Event): void {
    // Chrome's native EditContext never fires input events on the element.
    // Stop any leaking through shadow DOM retargeting.
    if (inShadow) event.stopPropagation();

    if (!(event instanceof InputEvent)) return;
    const editContext = getEditContext();
    if (!editContext) return;

    const inputType = normalizeInputType(event.inputType, shiftHeld, ctrlHeld);

    // Composition inputs are handled by the composition flow.
    if (inputType === "insertCompositionText") return;

    // Suspend composition if a non-composition input slipped through.
    if (editContext.isComposing) {
      editContext._suspendComposition();
    }

    const changed = reconcileModelToTextarea(editContext);

    // Forward synthetic beforeinput to the attached element only when this input
    // actually carried a mutation, so the redundant Android twin stays silent.
    const attachedElement = getAttachedElement();
    if (changed && attachedElement && !SUPPRESSED_INPUT_TYPES.has(inputType)) {
      const syntheticEvent = createSyntheticBeforeInput(inputType, event);
      attachedElement.dispatchEvent(syntheticEvent);
    }

    if (changed) syncFromEditContext();
  }

  function forwardClipboardEvent(event: ClipboardEvent): void {
    if (inShadow) return; // Shadow DOM retargets clipboard events naturally
    const attachedElement = getAttachedElement();
    if (!attachedElement) return;

    const forwarded = new ClipboardEvent(event.type, {
      bubbles: true,
      cancelable: event.cancelable,
      composed: true,
      clipboardData: event.clipboardData,
    });

    if (!attachedElement.dispatchEvent(forwarded)) {
      event.preventDefault();
    }
  }

  textarea.addEventListener("beforeinput", handleBeforeInput);
  textarea.addEventListener("input", handleInput);
  textarea.addEventListener("compositionstart", handleCompositionStart);
  textarea.addEventListener("compositionend", handleCompositionEnd);
  textarea.addEventListener("keydown", forwardKeyboardEvent);
  textarea.addEventListener("keyup", forwardKeyboardEvent);
  textarea.addEventListener("copy", forwardClipboardEvent);
  textarea.addEventListener("cut", forwardClipboardEvent);
  textarea.addEventListener("paste", forwardClipboardEvent);

  function destroy(): void {
    textarea.removeEventListener("beforeinput", handleBeforeInput);
    textarea.removeEventListener("input", handleInput);
    textarea.removeEventListener("compositionstart", handleCompositionStart);
    textarea.removeEventListener("compositionend", handleCompositionEnd);
    textarea.removeEventListener("keydown", forwardKeyboardEvent);
    textarea.removeEventListener("keyup", forwardKeyboardEvent);
    textarea.removeEventListener("copy", forwardClipboardEvent);
    textarea.removeEventListener("cut", forwardClipboardEvent);
    textarea.removeEventListener("paste", forwardClipboardEvent);
  }

  return { destroy, syncFromEditContext };
}
