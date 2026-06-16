// docs/010 §5.2 / §7.4 — the Phase 2 spike controller: one plain-text block on
// an EditContext host. It proves the loop the whole engine turns on —
// input → model → render, model-owned selection, geometry fed to the
// EditContext — before any document model or virtualization exists.
//
// Framework-free (owned-model/core, enforced by lint). DOM event plumbing is
// allowed; React/Lexical are not.

import {
  caretPointFromCoordinates,
  offsetWithinText,
} from "./caret-from-point";
import {
  createEditContextHost,
  type EditContextLike,
} from "./editcontext-host";
import {
  createSelectionOverlay,
  type SelectionOverlay,
} from "./selection-overlay";

export type TextInputState = {
  text: string;
  anchor: number;
  focus: number;
};

export type OwnedInputDiagnostics = TextInputState & {
  readonly polyfilled: boolean;
  readonly composing: boolean;
  readonly lastEvent: string;
  readonly caretLeft: number;
  readonly caretHeight: number;
  readonly rectCount: number;
  readonly usedAddRange: boolean;
  readonly hasActiveAttr: boolean;
};

export type TextInputController = {
  readonly getState: () => TextInputState;
  readonly getDiagnostics: () => OwnedInputDiagnostics;
  readonly destroy: () => void;
};

export type CreateTextInputControllerOptions = {
  readonly host: HTMLElement;
  readonly textElement: HTMLElement;
  readonly overlayElement: HTMLElement;
  readonly initialText?: string;
  readonly forcePolyfill?: boolean;
  /** Publish diagnostics onto `window.__IDCO_OWNED_INPUT__` for the spike. */
  readonly publishGlobal?: boolean;
};

const GLOBAL_KEY = "__IDCO_OWNED_INPUT__";

export function createTextInputController(
  options: CreateTextInputControllerOptions,
): TextInputController {
  const {
    host,
    textElement,
    overlayElement,
    initialText = "",
    forcePolyfill = false,
    publishGlobal = false,
  } = options;

  const editHost = createEditContextHost({ host, initialText, forcePolyfill });
  const editContext: EditContextLike = editHost.editContext;
  const overlay: SelectionOverlay = createSelectionOverlay({
    host,
    textElement,
    overlayElement,
    editContext,
  });

  const state: TextInputState = {
    text: initialText,
    anchor: initialText.length,
    focus: initialText.length,
  };
  let composing = false;
  let lastEvent = "init";
  let dragging = false;

  function clamp(offset: number): number {
    return Math.min(Math.max(0, offset), state.text.length);
  }

  function paint(): void {
    textElement.textContent = state.text;
    const info = overlay.render({ anchor: state.anchor, focus: state.focus });
    if (publishGlobal && typeof window !== "undefined") {
      const diagnostics: OwnedInputDiagnostics = {
        ...state,
        polyfilled: editHost.polyfilled,
        composing,
        lastEvent,
        caretLeft: info.caretLeft,
        caretHeight: info.caretHeight,
        rectCount: info.rectCount,
        usedAddRange: info.usedAddRange,
        hasActiveAttr: host.hasAttribute("data-editcontext-active"),
      };
      (window as unknown as Record<string, unknown>)[GLOBAL_KEY] = diagnostics;
    }
  }

  function setSelection(anchor: number, focus: number): void {
    state.anchor = clamp(anchor);
    state.focus = clamp(focus);
    editContext.updateSelection(
      Math.min(state.anchor, state.focus),
      Math.max(state.anchor, state.focus),
    );
    editHost.syncInputSelection();
  }

  // Mirror the EditContext buffer/selection onto the model on every text update
  // (native and polyfill both maintain `text`/selection before firing).
  function onTextUpdate(): void {
    lastEvent = "textupdate";
    state.text = editContext.text;
    state.anchor = clamp(editContext.selectionStart);
    state.focus = clamp(editContext.selectionEnd);
    paint();
  }

  function onCompositionStart(): void {
    composing = true;
    lastEvent = "compositionstart";
    paint();
  }

  function onCompositionEnd(): void {
    composing = false;
    lastEvent = "compositionend";
    state.text = editContext.text;
    state.anchor = clamp(editContext.selectionStart);
    state.focus = clamp(editContext.selectionEnd);
    paint();
  }

  // Caret/selection navigation is engine-owned for both paths (docs/010 §7.4):
  // arrows never reach the text via input, so we move the model selection and
  // re-sync the input sink.
  function onKeyDown(event: KeyboardEvent): void {
    // While the editing host is focused, plain keystrokes belong to the editor,
    // not to app-level keyboard shortcuts (e.g. Ladle's). On the native path the
    // host is a <div>, so without this those handlers fire and steal focus; the
    // polyfill's focused <textarea> already suppresses them. Keep Ctrl/Cmd/Alt
    // combos, Tab, and Escape bubbling for app shortcuts and a11y.
    if (
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      event.key !== "Tab" &&
      event.key !== "Escape"
    ) {
      event.stopPropagation();
    }

    // Enter inserts a newline into this plain-text block. The polyfill's
    // <textarea> sink already does this; native EditContext instead fires
    // `insertParagraph` (no textupdate), so the engine performs the edit.
    if (event.key === "Enter" && !editHost.polyfilled) {
      event.preventDefault();
      const lo = Math.min(state.anchor, state.focus);
      const hi = Math.max(state.anchor, state.focus);
      editContext.updateText(lo, hi, "\n");
      state.text = editContext.text;
      lastEvent = "key:Enter";
      setSelection(lo + 1, lo + 1);
      paint();
      return;
    }

    const extend = event.shiftKey;
    let focus = state.focus;
    let handled = true;
    switch (event.key) {
      case "ArrowLeft":
        focus = state.focus - 1;
        break;
      case "ArrowRight":
        focus = state.focus + 1;
        break;
      case "Home":
        focus = 0;
        break;
      case "End":
        focus = state.text.length;
        break;
      default:
        handled = false;
    }
    if (!handled) return;
    event.preventDefault();
    lastEvent = `key:${event.key}`;
    setSelection(extend ? state.anchor : focus, focus);
    paint();
  }

  function offsetFromPointer(event: PointerEvent): number {
    const node = textElement.firstChild;
    const text = node && node.nodeType === Node.TEXT_NODE ? (node as Text) : null;
    if (!text) return 0;
    const point = caretPointFromCoordinates(
      event.clientX,
      event.clientY,
      host.ownerDocument,
    );
    const offset = offsetWithinText(text, point);
    return offset ?? state.focus;
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    if (!editHost.polyfilled) host.focus({ preventScroll: true });
    dragging = true;
    host.setPointerCapture?.(event.pointerId);
    const offset = offsetFromPointer(event);
    lastEvent = "pointerdown";
    setSelection(offset, offset);
    paint();
  }

  function onPointerMove(event: PointerEvent): void {
    if (!dragging) return;
    const offset = offsetFromPointer(event);
    lastEvent = "pointermove";
    setSelection(state.anchor, offset);
    paint();
  }

  function onPointerUp(event: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    host.releasePointerCapture?.(event.pointerId);
    lastEvent = "pointerup";
  }

  editContext.addEventListener("textupdate", onTextUpdate);
  editContext.addEventListener("compositionstart", onCompositionStart);
  editContext.addEventListener("compositionend", onCompositionEnd);
  host.addEventListener("keydown", onKeyDown, { capture: true });
  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerup", onPointerUp);

  paint();

  function getState(): TextInputState {
    return { ...state };
  }

  function getDiagnostics(): OwnedInputDiagnostics {
    const info = overlay.render({ anchor: state.anchor, focus: state.focus });
    return {
      ...state,
      polyfilled: editHost.polyfilled,
      composing,
      lastEvent,
      caretLeft: info.caretLeft,
      caretHeight: info.caretHeight,
      rectCount: info.rectCount,
      usedAddRange: info.usedAddRange,
      hasActiveAttr: host.hasAttribute("data-editcontext-active"),
    };
  }

  function destroy(): void {
    editContext.removeEventListener("textupdate", onTextUpdate);
    editContext.removeEventListener("compositionstart", onCompositionStart);
    editContext.removeEventListener("compositionend", onCompositionEnd);
    host.removeEventListener("keydown", onKeyDown, { capture: true });
    host.removeEventListener("pointerdown", onPointerDown);
    host.removeEventListener("pointermove", onPointerMove);
    host.removeEventListener("pointerup", onPointerUp);
    overlay.destroy();
    editHost.destroy();
  }

  return { getState, getDiagnostics, destroy };
}
