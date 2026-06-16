/**
 * Vendored EditContext API polyfill (docs/010 §5.5 / §6.7). See VENDOR.md for
 * provenance. This module implements the same API shape the browser exposes;
 * editor behavior lives above that boundary and must not fork on backend.
 *
 * Phase 2 (input + caret + selection spike) makes the surface functional for
 * the non-Chromium path: `install()` defines `EditContext` and patches
 * `HTMLElement.prototype.editContext` so `host.editContext = ctx` wires a
 * visually-hidden `<textarea>` input bridge (the docs/010 §5.5 hidden-input
 * approach) that captures keystrokes/IME and re-dispatches them as EditContext
 * `textupdate`/composition events. Selection painting and model commands are
 * the engine's job (docs/010 §7.4), not hidden side effects in the polyfill.
 */

export type EditContextTextUpdateEventInit = {
  readonly updateRangeStart: number;
  readonly updateRangeEnd: number;
  readonly text: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
};

export type PolyfilledTextFormat = {
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly underlineStyle: string;
  readonly underlineThickness: string;
};

/** Minimal `TextUpdateEvent` shape the engine reads on `textupdate`. */
export class PolyfilledTextUpdateEvent extends Event {
  readonly updateRangeStart: number;
  readonly updateRangeEnd: number;
  readonly text: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;

  constructor(type: string, init: EditContextTextUpdateEventInit) {
    super(type);
    this.updateRangeStart = init.updateRangeStart;
    this.updateRangeEnd = init.updateRangeEnd;
    this.text = init.text;
    this.selectionStart = init.selectionStart;
    this.selectionEnd = init.selectionEnd;
  }
}

/**
 * Minimal `TextFormatUpdateEvent` shape for IME preedit styling. Native
 * EditContext fires this so custom editors can draw the platform's composition
 * underline themselves; the polyfill mirrors that contract for its hidden
 * textarea composition range.
 */
export class PolyfilledTextFormatUpdateEvent extends Event {
  readonly #formats: readonly PolyfilledTextFormat[];

  constructor(type: string, formats: readonly PolyfilledTextFormat[]) {
    super(type);
    this.#formats = [...formats];
  }

  getTextFormats(): readonly PolyfilledTextFormat[] {
    return this.#formats;
  }
}

export type EditContextInit = {
  readonly text?: string;
  readonly selectionStart?: number;
  readonly selectionEnd?: number;
};

/**
 * Polyfilled `EditContext`. Owns its own text buffer and selection offsets,
 * decoupled from the DOM (docs/010 §4.2). The bounds setters record the last
 * values fed back so engine code can call the full surface against either
 * implementation; the polyfill does not act on them in this spike.
 */
export class EditContext extends EventTarget {
  /**
   * Brand so callers can tell the polyfill apart from a native `EditContext`
   * even after `install()` has replaced `globalThis.EditContext` (e.g. a Ladle
   * SPA session that visited the forced-polyfill story). Lets the host detect
   * *true* native support rather than "is a function".
   */
  static readonly isIdcoPolyfill = true;

  text: string;
  selectionStart: number;
  selectionEnd: number;
  isComposing = false;
  compositionStart = 0;
  compositionEnd = 0;
  characterBoundsRangeStart = 0;
  /** Last control bounds fed back via {@link updateControlBounds}. */
  controlBounds?: DOMRect;
  /** Last selection bounds fed back via {@link updateSelectionBounds}. */
  selectionBounds?: DOMRect;

  readonly #attached = new Set<Element>();
  #characterBounds: readonly DOMRect[] = [];

  constructor(init: EditContextInit = {}) {
    super();
    this.text = init.text ?? "";
    this.selectionStart = clampOffset(
      init.selectionStart ?? 0,
      this.text.length,
    );
    this.selectionEnd = clampOffset(
      init.selectionEnd ?? this.selectionStart,
      this.text.length,
    );
  }

  updateText(rangeStart: number, rangeEnd: number, text: string): void {
    const start = clampOffset(rangeStart, this.text.length);
    const end = clampOffset(rangeEnd, this.text.length);
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    this.text = `${this.text.slice(0, lo)}${text}${this.text.slice(hi)}`;
  }

  updateSelection(start: number, end: number): void {
    this.selectionStart = clampOffset(start, this.text.length);
    this.selectionEnd = clampOffset(end, this.text.length);
  }

  updateControlBounds(controlBounds: DOMRect): void {
    this.controlBounds = controlBounds;
  }

  updateSelectionBounds(selectionBounds: DOMRect): void {
    this.selectionBounds = selectionBounds;
  }

  updateCharacterBounds(
    rangeStart: number,
    characterBounds: readonly DOMRect[],
  ): void {
    this.characterBoundsRangeStart = Math.max(0, rangeStart);
    this.#characterBounds = [...characterBounds];
  }

  characterBounds(): readonly DOMRect[] {
    return this.#characterBounds;
  }

  attachedElements(): readonly Element[] {
    return [...this.#attached];
  }

  /** Internal: track the host element an `EditContext` is bound to. */
  attach(element: Element): void {
    this.#attached.add(element);
  }

  /** Internal: stop tracking a host element. */
  detach(element: Element): void {
    this.#attached.delete(element);
  }
}

export type InstallOptions = {
  /**
   * Install this API implementation even when native `EditContext` exists.
   * Used by the forced-polyfill story/test variant (docs/010 P2 AC5) to prove
   * the API polyfill on Chromium.
   */
  readonly force?: boolean;
  /**
   * Target to define `EditContext` on. Defaults to `globalThis`. When provided
   * (tests), only `EditContext` is defined — `HTMLElement.prototype` is left
   * untouched so the install stays side-effect-free off the real global.
   */
  readonly target?: Record<string, unknown>;
};

export type InstallResult = {
  /** Whether this call installed the API polyfill `EditContext`. */
  readonly installed: boolean;
  /** Whether a native `EditContext` was present before this call. */
  readonly native: boolean;
};

type MaybePolyfilledEditContextConstructor = Function & {
  readonly isIdcoPolyfill?: boolean;
};

const HOST_BINDINGS = new WeakMap<Element, PolyfillBinding>();
const FOCUS_OUTLINE_STYLE_ID = "idco-editcontext-polyfill-focus-outline";
const DEBUG_LOG_KEY = "__IDCO_EDITCONTEXT_POLYFILL_LOG__";
let forcedInstallCount = 0;
let forcedGlobalTarget: Record<string, unknown> | null = null;
let forcedHadEditContext = false;
let forcedEditContextValue: unknown;
let forcedHadHtmlElementDescriptor = false;
let forcedHtmlElementDescriptor: PropertyDescriptor | undefined;

/**
 * Install the API polyfill `EditContext` onto the target global when it is absent
 * (or when `force` is set). Idempotent and side-effect-free unless called. When
 * installing onto the real global it also patches `HTMLElement.prototype` so
 * `element.editContext = ctx` wires the hidden-textarea input bridge.
 */
export function install(options: InstallOptions = {}): InstallResult {
  const usingGlobalTarget = options.target === undefined;
  const target = (options.target ??
    (globalThis as unknown as Record<string, unknown>)) as Record<
    string,
    unknown
  >;
  const existing = target.EditContext;
  const native =
    typeof existing === "function" &&
    (existing as MaybePolyfilledEditContextConstructor).isIdcoPolyfill !== true;
  if (native && !options.force) {
    return { installed: false, native };
  }
  if (usingGlobalTarget && options.force) {
    rememberForcedInstallOriginals(target);
    forcedInstallCount += 1;
  }
  target.EditContext = EditContext;
  if (usingGlobalTarget) {
    patchHtmlElement(Boolean(options.force));
  }
  return { installed: true, native };
}

/**
 * Save the real browser editing hooks before a forced-polyfill story replaces
 * them. Ladle is a long-lived SPA, so without this the forced story poisons the
 * later default story in the same page.
 */
function rememberForcedInstallOriginals(target: Record<string, unknown>): void {
  if (forcedGlobalTarget) return;
  forcedGlobalTarget = target;
  forcedHadEditContext = Object.prototype.hasOwnProperty.call(
    target,
    "EditContext",
  );
  forcedEditContextValue = target.EditContext;
  if (typeof HTMLElement !== "undefined") {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "editContext",
    );
    forcedHadHtmlElementDescriptor = descriptor !== undefined;
    forcedHtmlElementDescriptor = descriptor;
  }
}

/**
 * Undo a forced-polyfill install once its host is destroyed. Non-Chromium
 * browsers can reinstall the API polyfill on demand; Chromium gets its native
 * constructor and native `HTMLElement.editContext` descriptor back before the
 * next story.
 */
export function releaseForcedInstall(): void {
  if (forcedInstallCount <= 0) return;
  forcedInstallCount -= 1;
  if (forcedInstallCount > 0 || !forcedGlobalTarget) return;

  if (forcedHadEditContext) {
    forcedGlobalTarget.EditContext = forcedEditContextValue;
  } else {
    delete forcedGlobalTarget.EditContext;
  }

  if (typeof HTMLElement !== "undefined") {
    if (forcedHadHtmlElementDescriptor && forcedHtmlElementDescriptor) {
      Object.defineProperty(
        HTMLElement.prototype,
        "editContext",
        forcedHtmlElementDescriptor,
      );
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)
        .editContext;
    }
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[
      "__idcoEditContextPatched"
    ];
  }

  forcedGlobalTarget = null;
  forcedHadEditContext = false;
  forcedEditContextValue = undefined;
  forcedHadHtmlElementDescriptor = false;
  forcedHtmlElementDescriptor = undefined;
}

/**
 * Patch `HTMLElement.prototype.editContext` so assigning an API polyfill
 * `EditContext` attaches/detaches the input bridge, mirroring the native
 * `HTMLElement.editContext` attach point.
 */
function patchHtmlElement(force: boolean): void {
  if (typeof HTMLElement === "undefined") return;
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const alreadyPatched = "__idcoEditContextPatched" in proto;
  const hasNative =
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, "editContext") !==
    undefined;
  if (alreadyPatched || (hasNative && !force)) return;

  const store = new WeakMap<HTMLElement, EditContext | null>();
  Object.defineProperty(HTMLElement.prototype, "editContext", {
    configurable: true,
    get(this: HTMLElement) {
      return store.get(this) ?? null;
    },
    set(this: HTMLElement, value: EditContext | null) {
      const previous = HOST_BINDINGS.get(this);
      if (previous) {
        previous.destroy();
        HOST_BINDINGS.delete(this);
      }
      store.set(this, value ?? null);
      if (value) {
        value.attach(this);
        HOST_BINDINGS.set(this, new PolyfillBinding(this, value));
      }
    },
  });
  Object.defineProperty(proto, "__idcoEditContextPatched", {
    configurable: true,
    enumerable: false,
    value: true,
  });
}

/**
 * The hidden-textarea bridge for one host. Captures keystrokes/IME on a
 * visually-hidden `<textarea>` and mirrors them onto the bound `EditContext`,
 * dispatching `textupdate`/composition events the engine listens for.
 */
class PolyfillBinding {
  readonly #host: HTMLElement;
  readonly #ctx: EditContext;
  readonly #textarea: HTMLTextAreaElement;
  readonly #shadowRoot: ShadowRoot;
  readonly #usesMirroredTextarea: boolean;
  #composing = false;
  #compositionStart = 0;
  #compositionEnd = 0;
  #compositionUsedScratchInput = false;
  #compositionNeedsPostCommitSuppress = false;
  #suppressNextPostCompositionInsertText = false;
  #clearPostCompositionSuppressTimer: number | null = null;
  #lastOwnedPlainInsert: { start: number; end: number; text: string } | null =
    null;

  constructor(host: HTMLElement, ctx: EditContext) {
    this.#host = host;
    this.#ctx = ctx;
    this.#usesMirroredTextarea = shouldUseMirroredTextarea(host);
    this.#shadowRoot =
      host.shadowRoot ??
      host.attachShadow({ mode: "open", delegatesFocus: true });
    this.#textarea = document.createElement("textarea");
    const textarea = this.#textarea;
    textarea.setAttribute("aria-label", "Text input");
    textarea.tabIndex = 0;
    textarea.autocapitalize = "off";
    textarea.autocomplete = "off";
    textarea.spellcheck = false;
    // The hidden sink must be a *real, non-degenerate* editing target, not a
    // 1px/opacity:0 box. Windows IMEs (Vietnamese Telex especially) refuse to
    // compose into a degenerate textarea and drop into reconversion — committing
    // the previous word and replacing it instead of composing the next one
    // ("xin " → typing "o" reconverts "xin"). Give it a genuine footprint over
    // the host and hide it with transparent ink rather than `opacity`/zero size.
    // It must also be the actual pointer target: Microsoft IMEs may not initialize
    // their text service on first focus if the textarea is only focused
    // programmatically through a pointer-transparent host.
    Object.assign(textarea.style, {
      position: "absolute",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      margin: "0",
      padding: "0",
      border: "0",
      outline: "none",
      resize: "none",
      overflow: "hidden",
      font: "inherit",
      color: "transparent",
      background: "transparent",
      caretColor: "transparent",
      pointerEvents: "auto",
      whiteSpace: "pre-wrap",
      userSelect: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    // Desktop polyfill mode keeps the textarea as a transient composition
    // scratchpad; iOS/iPadOS needs the real surrounding text so the software
    // keyboard can perform word deletion and Vietnamese composition correctly.
    textarea.value = this.#usesMirroredTextarea ? ctx.text : "";
    this.#ensureFocusOutlineStyle();
    this.#ensureSlot();
    this.#shadowRoot.append(textarea);

    host.addEventListener("pointerdown", this.#focusSink);
    host.addEventListener("focus", this.#focusSink);
    host.addEventListener("focusout", this.#enablePointerSink);
    textarea.addEventListener("beforeinput", this.#onBeforeInput);
    textarea.addEventListener("input", this.#onInput);
    textarea.addEventListener("compositionstart", this.#onCompositionStart);
    textarea.addEventListener("compositionend", this.#onCompositionEnd);
    textarea.addEventListener("blur", this.#enablePointerSink);
  }

  /**
   * Reset the hidden textarea to an empty scratchpad. The textarea is NOT a
   * mirror of the document — it only ever holds the active composing word while
   * an IME is composing. Keeping it empty when idle is what stops Windows Telex
   * from reconverting a previously-committed word: there is simply no prior text
   * in the field for the IME to select and replace (the "xin " → reconvert "xin"
   * → "o  "/"xin o" bug). The model owns the document; every non-composition
   * edit is applied to the model in `#onBeforeInput`, not read back from here.
   */
  syncSelection(): void {
    // Never disturb the field mid-composition; the IME owns it then.
    if (this.#composing || this.#ctx.isComposing) return;
    if (this.#usesMirroredTextarea) {
      if (this.#textarea.value !== this.#ctx.text) {
        this.#textarea.value = this.#ctx.text;
      }
      this.#textarea.setSelectionRange(
        this.#ctx.selectionStart,
        this.#ctx.selectionEnd,
      );
      return;
    }
    if (this.#textarea.value !== "") this.#textarea.value = "";
    this.#textarea.setSelectionRange(0, 0);
  }

  destroy(): void {
    this.#host.removeEventListener("pointerdown", this.#focusSink);
    this.#host.removeEventListener("focus", this.#focusSink);
    this.#host.removeEventListener("focusout", this.#enablePointerSink);
    this.#textarea.removeEventListener("beforeinput", this.#onBeforeInput);
    this.#textarea.removeEventListener("input", this.#onInput);
    this.#textarea.removeEventListener(
      "compositionstart",
      this.#onCompositionStart,
    );
    this.#textarea.removeEventListener(
      "compositionend",
      this.#onCompositionEnd,
    );
    this.#textarea.removeEventListener("blur", this.#enablePointerSink);
    this.#clearPostCompositionSuppress();
    this.#textarea.remove();
  }

  /**
   * Provide the UA focus ring native EditContext gives its focused host. Chrome
   * paints that outline from low-level browser focus styling, while a hidden
   * textarea in delegated-focus shadow DOM only retargets focus to the host;
   * these shadow host rules fill that API gap without adding visible wrapper
   * DOM.
   */
  #ensureFocusOutlineStyle(): void {
    if (this.#shadowRoot.querySelector(`#${FOCUS_OUTLINE_STYLE_ID}`)) return;
    const style = document.createElement("style");
    style.id = FOCUS_OUTLINE_STYLE_ID;
    style.textContent = `
:host(:focus),
:host(:focus-within) {
  outline: auto;
  outline: -webkit-focus-ring-color auto 1px;
}
`;
    this.#shadowRoot.prepend(style);
  }

  /**
   * Render host light-DOM children through the shadow root. The hidden textarea
   * must live inside a delegated-focus shadow tree so browser focus retargets
   * to the visible EditContext host, matching native EditContext focus/outline
   * semantics while keeping the textarea an implementation detail.
   */
  #ensureSlot(): void {
    if (this.#shadowRoot.querySelector("slot")) return;
    this.#shadowRoot.append(document.createElement("slot"));
  }

  readonly #focusSink = (): void => {
    if (this.#shadowRoot.activeElement !== this.#textarea) {
      this.#textarea.focus({ preventScroll: true });
    }
    this.#textarea.style.pointerEvents = "none";
    this.syncSelection();
  };

  readonly #enablePointerSink = (): void => {
    this.#textarea.style.pointerEvents = "auto";
  };

  /**
   * Apply IME composition from `beforeinput`, replacing the tracked composition
   * range with the event's reported `data`. `insertCompositionText` reports the
   * whole composing word each update (e.g. "c" → "ch" → "chào"), and the IME
   * fires a matching `beforeinput` before every composition `input`, so this is
   * the single authoritative entry point for composition — the `input` twin is
   * ignored (see `#onInput`). Driving the model from the composition range plus
   * `data` keeps the surrounding document text stable regardless of how the
   * browser mutates the hidden textarea.
   */
  readonly #onBeforeInput = (event: Event): void => {
    if (!(event instanceof InputEvent)) return;
    this.#recordDebugEvent("beforeinput:before", event);
    const type = event.inputType;
    if (this.#usesMirroredTextarea) {
      // iOS software keyboards need the native textarea edit to happen against
      // the mirrored buffer. The following `input` event mirrors the result back
      // into EditContext/model state.
      event.stopPropagation();
      this.#recordDebugEvent("beforeinput:mirrored", event);
      return;
    }
    if (type === "insertText" && this.#suppressNextPostCompositionInsertText) {
      if (event.cancelable) event.preventDefault();
      this.#suppressNextPostCompositionInsertText = false;
      this.#lastOwnedPlainInsert = null;
      this.syncSelection();
      this.#recordDebugEvent("beforeinput:suppressed", event);
      return;
    }
    if (type === "insertCompositionText") {
      event.stopPropagation();
      this.#lastOwnedPlainInsert = null;
      this.#beginComposition();
      this.#replaceCompositionText(event.data ?? "");
      this.#emitCompositionFormat();
      this.#recordDebugEvent("beforeinput:composition", event);
      return;
    }
    if (this.#composing) {
      this.#recordDebugEvent("beforeinput:ignored-composing", event);
      return;
    }

    // Every non-composition edit is owned: applied to the MODEL at the model
    // selection, never read back from the scratch textarea. The textarea selection
    // cannot be trusted (Windows Telex desyncs it onto the previous word), and the
    // scratch field is empty anyway, so reading its value is meaningless. We only
    // act on cancelable `beforeinput` so we can suppress the textarea's own edit;
    // the matching `input` is then ignored (`#onInput`).
    const start = Math.min(this.#ctx.selectionStart, this.#ctx.selectionEnd);
    const end = Math.max(this.#ctx.selectionStart, this.#ctx.selectionEnd);
    const edit = this.#modelEditFor(type, event.data, start, end);
    if (!edit || !event.cancelable) {
      this.#recordDebugEvent("beforeinput:ignored", event);
      return;
    }
    event.preventDefault();
    this.#applyModelEdit(edit.start, edit.end, edit.text);
    this.#lastOwnedPlainInsert =
      type === "insertText" || type === "insertReplacementText" ? edit : null;
    this.#recordDebugEvent("beforeinput:owned", event);
  };

  /**
   * Map a non-composition `inputType` to the model range + replacement text it
   * should produce. Returns null for input types this spike does not own.
   */
  #modelEditFor(
    type: string,
    data: string | null,
    start: number,
    end: number,
  ): { start: number; end: number; text: string } | null {
    switch (type) {
      case "insertText":
      case "insertReplacementText":
        if (typeof data !== "string") return null;
        return {
          start:
            start === end
              ? (vietnameseRewriteStart(this.#ctx.text, start, data) ?? start)
              : start,
          end,
          text: data,
        };
      case "insertLineBreak":
      case "insertParagraph":
        return { start, end, text: "\n" };
      case "deleteContentBackward":
        return start === end
          ? { start: prevOffset(this.#ctx.text, start), end, text: "" }
          : { start, end, text: "" };
      case "deleteContentForward":
        return start === end
          ? { start, end: nextOffset(this.#ctx.text, end), text: "" }
          : { start, end, text: "" };
      case "deleteWordBackward":
        return start === end
          ? { start: prevWordBoundary(this.#ctx.text, start), end, text: "" }
          : { start, end, text: "" };
      case "deleteWordForward":
        return start === end
          ? { start, end: nextWordBoundary(this.#ctx.text, end), text: "" }
          : { start, end, text: "" };
      default:
        return null;
    }
  }

  /**
   * Splice the model, collapse the caret after the edit, emit `textupdate`, and
   * reset the scratch textarea. This is the single mutation path for all
   * non-composition input.
   */
  #applyModelEdit(start: number, end: number, text: string): void {
    const lo = Math.max(0, Math.min(start, end));
    const hi = Math.min(this.#ctx.text.length, Math.max(start, end));
    this.#ctx.text = `${this.#ctx.text.slice(0, lo)}${text}${this.#ctx.text.slice(hi)}`;
    const caret = lo + text.length;
    this.#ctx.selectionStart = caret;
    this.#ctx.selectionEnd = caret;
    this.#ctx.dispatchEvent(
      new PolyfilledTextUpdateEvent("textupdate", {
        text,
        selectionStart: caret,
        selectionEnd: caret,
        updateRangeStart: lo,
        updateRangeEnd: hi,
      }),
    );
    this.syncSelection();
  }

  readonly #onInput = (event: Event): void => {
    if (!(event instanceof InputEvent)) return;
    this.#recordDebugEvent("input:before", event);
    if (this.#usesMirroredTextarea) {
      event.stopPropagation();
      this.#mirrorTextareaToContext();
      if (this.#composing || this.#ctx.isComposing || event.isComposing) {
        this.#emitCompositionFormat();
      }
      this.#recordDebugEvent("input:mirrored", event);
      return;
    }
    const inComposition =
      this.#composing || this.#ctx.isComposing || event.isComposing;
    if (!inComposition) {
      this.#correctPlainVietnameseInputEcho(event);
      this.#recordDebugEvent("input:idle", event);
      return;
    }

    // Some IMEs, including Microsoft Vietnamese Telex in Firefox, mutate the
    // scratch textarea through composing `input` events where `event.data` is a
    // key delta, empty, or otherwise not the full preedit string. That is safe to
    // read only while composing: the textarea is empty when idle and only holds
    // the active composing word during this session.
    if (inComposition) {
      this.#beginComposition();
      this.#lastOwnedPlainInsert = null;
      this.#compositionUsedScratchInput = true;
      const eventText = event.data ?? "";
      if (
        event.inputType !== "insertCompositionText" ||
        this.#textarea.value !== eventText
      ) {
        this.#compositionNeedsPostCommitSuppress = true;
      }
      this.#replaceCompositionText(this.#textarea.value);
      this.#emitCompositionFormat();
      this.#recordDebugEvent("input:composition", event);
    }
  };

  readonly #onCompositionStart = (): void => {
    this.#recordDebugEvent("compositionstart:before");
    this.#lastOwnedPlainInsert = null;
    this.#beginComposition();
    this.#recordDebugEvent("compositionstart:after");
  };

  readonly #onCompositionEnd = (event: CompositionEvent): void => {
    this.#recordDebugEvent("compositionend:before", event);
    if (!this.#composing) return;
    if (this.#usesMirroredTextarea) {
      this.#mirrorTextareaToContext();
      this.#composing = false;
      this.#ctx.isComposing = false;
      this.#ctx.compositionStart = this.#ctx.selectionStart;
      this.#ctx.compositionEnd = this.#ctx.selectionEnd;
      this.#compositionStart = this.#ctx.selectionStart;
      this.#compositionEnd = this.#ctx.selectionEnd;
      this.syncSelection();
      this.#ctx.dispatchEvent(
        new PolyfilledTextFormatUpdateEvent("textformatupdate", []),
      );
      this.#ctx.dispatchEvent(new Event("compositionend"));
      this.#recordDebugEvent("compositionend:mirrored", event);
      return;
    }
    const finalText = event.data ?? "";
    const activeText = this.#ctx.text.slice(
      this.#compositionStart,
      this.#compositionEnd,
    );
    const finalLooksLikeKeyDelta =
      this.#compositionNeedsPostCommitSuppress &&
      activeText.length > 1 &&
      finalText.length < activeText.length;
    if (
      finalText !== "" &&
      finalText !== activeText &&
      !finalLooksLikeKeyDelta
    ) {
      this.#replaceCompositionText(finalText);
    }
    const committedText = this.#ctx.text.slice(
      this.#compositionStart,
      this.#compositionEnd,
    );
    if (
      this.#compositionUsedScratchInput &&
      this.#compositionNeedsPostCommitSuppress &&
      committedText !== ""
    ) {
      this.#suppressPostCompositionInsertTextOnce();
    }
    this.#composing = false;
    this.#ctx.isComposing = false;
    this.#ctx.compositionStart = this.#ctx.selectionStart;
    this.#ctx.compositionEnd = this.#ctx.selectionEnd;
    this.#compositionStart = this.#ctx.selectionStart;
    this.#compositionEnd = this.#ctx.selectionEnd;
    this.syncSelection();
    this.#ctx.dispatchEvent(
      new PolyfilledTextFormatUpdateEvent("textformatupdate", []),
    );
    this.#ctx.dispatchEvent(new Event("compositionend"));
    this.#recordDebugEvent("compositionend:after", event);
  };

  /**
   * Some WebKit + UniKey desktop paths send the raw Telex key through
   * cancelable `beforeinput`, then still fire a plain `input` with the
   * transformed Vietnamese text in `event.data` or the scratch textarea. The
   * normal desktop rule is to ignore idle `input` events because Firefox Telex
   * can desync the textarea selection onto previous words. This correction keeps
   * that rule narrow: it only runs when the idle `input` contains Vietnamese
   * transformed text and there was a just-owned plain insert to repair.
   */
  #correctPlainVietnameseInputEcho(event: InputEvent): void {
    if (
      event.inputType !== "insertText" &&
      event.inputType !== "insertReplacementText" &&
      event.inputType !== "insertCompositionText"
    ) {
      this.#lastOwnedPlainInsert = null;
      return;
    }

    const candidate = vietnameseInputCandidate(
      event.data,
      this.#textarea.value,
    );
    if (!candidate || !this.#lastOwnedPlainInsert) return;

    const start =
      vietnameseRewriteStart(
        this.#ctx.text,
        this.#lastOwnedPlainInsert.start,
        candidate,
      ) ??
      vietnameseRewriteStart(
        this.#ctx.text,
        this.#ctx.selectionStart,
        candidate,
      );
    if (start === null) return;

    const end = Math.max(start, this.#ctx.selectionStart);
    this.#lastOwnedPlainInsert = null;
    this.#applyModelEdit(start, end, candidate);
  }

  #recordDebugEvent(label: string, event?: Event): void {
    const view = this.#host.ownerDocument.defaultView;
    if (!view) return;
    const target = view as unknown as Record<string, unknown>;
    const log = Array.isArray(target[DEBUG_LOG_KEY])
      ? (target[DEBUG_LOG_KEY] as unknown[])
      : [];
    target[DEBUG_LOG_KEY] = log;
    const input = event instanceof InputEvent ? event : null;
    const composition = event instanceof CompositionEvent ? event : null;
    const entry = {
      label,
      type: event?.type ?? label,
      inputType: input?.inputType ?? "",
      data: input?.data ?? composition?.data ?? "",
      isComposing: input?.isComposing ?? false,
      cancelable: event?.cancelable ?? false,
      defaultPrevented: event?.defaultPrevented ?? false,
      modelText: this.#ctx.text,
      modelSelection: `${this.#ctx.selectionStart}-${this.#ctx.selectionEnd}`,
      modelComposition: `${this.#ctx.compositionStart}-${this.#ctx.compositionEnd}`,
      composing: this.#composing || this.#ctx.isComposing,
      textareaValue: this.#textarea.value,
      textareaSelection: `${this.#textarea.selectionStart}-${this.#textarea.selectionEnd}`,
      lastOwnedPlainInsert: this.#lastOwnedPlainInsert
        ? `${this.#lastOwnedPlainInsert.start}-${this.#lastOwnedPlainInsert.end}:${this.#lastOwnedPlainInsert.text}`
        : "",
    };
    log.push(entry);
    if (log.length > 200) log.splice(0, log.length - 200);
    view.console.debug("[idco editcontext polyfill]", entry);
  }

  /**
   * Start a composition from the current logical selection (idempotent within a
   * session). Tracking the composition range in model coordinates — rather than
   * reading the textarea DOM range per event — keeps the surrounding document
   * text stable as the IME rewrites the active word in place.
   */
  #beginComposition(): void {
    if (this.#composing) return;
    this.#clearPostCompositionSuppress();
    this.#composing = true;
    this.#compositionUsedScratchInput = false;
    this.#compositionNeedsPostCommitSuppress = false;
    if (this.#usesMirroredTextarea) {
      this.#ctx.selectionStart = clampOffset(
        this.#textarea.selectionStart,
        this.#ctx.text.length,
      );
      this.#ctx.selectionEnd = clampOffset(
        this.#textarea.selectionEnd,
        this.#ctx.text.length,
      );
    }
    this.#compositionStart = Math.min(
      this.#ctx.selectionStart,
      this.#ctx.selectionEnd,
    );
    this.#compositionEnd = Math.max(
      this.#ctx.selectionStart,
      this.#ctx.selectionEnd,
    );
    this.#ctx.isComposing = true;
    this.#ctx.compositionStart = this.#compositionStart;
    this.#ctx.compositionEnd = this.#compositionEnd;
    this.#ctx.dispatchEvent(new Event("compositionstart"));
  }

  /**
   * Replace the current preedit span with the IME's latest full composition
   * string. `insertCompositionText` reports the whole composing text each time,
   * so this rewrites the tracked composition range instead of appending deltas.
   */
  #replaceCompositionText(text: string): void {
    this.#retargetCompositionRangeForCommittedBase(text);
    const rangeStart = this.#compositionStart;
    const rangeEnd = this.#compositionEnd;
    const next = `${this.#ctx.text.slice(0, rangeStart)}${text}${this.#ctx.text.slice(rangeEnd)}`;
    const selection = rangeStart + text.length;
    this.#ctx.text = next;
    this.#ctx.selectionStart = selection;
    this.#ctx.selectionEnd = selection;
    this.#ctx.compositionStart = rangeStart;
    this.#compositionEnd = selection;
    this.#ctx.compositionEnd = selection;
    this.#ctx.dispatchEvent(
      new PolyfilledTextUpdateEvent("textupdate", {
        text,
        selectionStart: selection,
        selectionEnd: selection,
        updateRangeStart: rangeStart,
        updateRangeEnd: rangeEnd,
      }),
    );
  }

  /**
   * WebKit + desktop UniKey can first commit the romanized syllable through
   * normal `insertText` ("chao"), then start composition at the caret and report
   * only the transformed Vietnamese suffix ("ào"). A scratchpad composition
   * range that stays collapsed at the caret appends that suffix ("chaoào").
   * When the first transformed update matches the word before the range, move
   * the model range backward so the IME rewrite replaces the romanized base.
   */
  #retargetCompositionRangeForCommittedBase(text: string): void {
    if (this.#usesMirroredTextarea) return;
    const nextStart = vietnameseRewriteStart(
      this.#ctx.text,
      this.#compositionStart,
      text,
    );
    if (nextStart === null) return;
    this.#compositionStart = nextStart;
    this.#ctx.compositionStart = this.#compositionStart;
  }

  /**
   * Emit the same `textformatupdate` signal native EditContext uses for IME
   * preedit styling. Native can report richer platform underline values; this
   * hidden-textarea bridge only knows the active composition range, so it sends
   * a simple thin underline for the shared renderer to paint.
   */
  #emitCompositionFormat(): void {
    const end = Math.max(this.#compositionStart, this.#compositionEnd);
    const formats =
      end > this.#compositionStart
        ? [
            {
              rangeStart: this.#compositionStart,
              rangeEnd: end,
              underlineStyle: "solid",
              underlineThickness: "thin",
            },
          ]
        : [];
    this.#ctx.dispatchEvent(
      new PolyfilledTextFormatUpdateEvent("textformatupdate", formats),
    );
  }

  /**
   * Firefox can send a trailing plain `insertText` commit immediately after a
   * composition already updated the scratch textarea. Suppress only that
   * same-turn echo; a real next keystroke arrives after this zero-delay timer
   * clears the guard.
   */
  #suppressPostCompositionInsertTextOnce(): void {
    this.#suppressNextPostCompositionInsertText = true;
    if (this.#clearPostCompositionSuppressTimer !== null) {
      this.#host.ownerDocument.defaultView?.clearTimeout(
        this.#clearPostCompositionSuppressTimer,
      );
    }
    this.#clearPostCompositionSuppressTimer =
      this.#host.ownerDocument.defaultView?.setTimeout(() => {
        this.#clearPostCompositionSuppress();
      }, 0) ?? null;
  }

  #clearPostCompositionSuppress(): void {
    this.#suppressNextPostCompositionInsertText = false;
    if (this.#clearPostCompositionSuppressTimer === null) return;
    this.#host.ownerDocument.defaultView?.clearTimeout(
      this.#clearPostCompositionSuppressTimer,
    );
    this.#clearPostCompositionSuppressTimer = null;
  }

  /**
   * Mobile Safari's software keyboard needs a real textarea buffer for context:
   * word deletion, suggestions, and Vietnamese composition all inspect the
   * surrounding text. In mirrored mode the browser mutates the textarea first;
   * this method mirrors that result back into the EditContext contract.
   */
  #mirrorTextareaToContext(): void {
    const previous = this.#ctx.text;
    const next = this.#textarea.value;
    const selectionStart = clampOffset(
      this.#textarea.selectionStart,
      next.length,
    );
    const selectionEnd = clampOffset(this.#textarea.selectionEnd, next.length);
    const diff = textDiff(previous, next);

    this.#ctx.text = next;
    this.#ctx.selectionStart = selectionStart;
    this.#ctx.selectionEnd = selectionEnd;
    if (this.#composing || this.#ctx.isComposing) {
      this.#ctx.isComposing = true;
      this.#ctx.compositionStart = this.#compositionStart;
      this.#compositionEnd = Math.max(
        this.#compositionStart,
        selectionStart,
        selectionEnd,
      );
      this.#ctx.compositionEnd = this.#compositionEnd;
    }

    this.#ctx.dispatchEvent(
      new PolyfilledTextUpdateEvent("textupdate", {
        text: diff.text,
        selectionStart,
        selectionEnd,
        updateRangeStart: diff.start,
        updateRangeEnd: diff.end,
      }),
    );
  }
}

/** Re-align the polyfill input sink for a host after engine-driven nav. */
export function syncPolyfillSelection(host: Element): void {
  HOST_BINDINGS.get(host)?.syncSelection();
}

function clampOffset(offset: number, length: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.min(Math.max(0, Math.floor(offset)), length);
}

/**
 * iOS/iPadOS software keyboards need the hidden textarea to contain the real
 * text. Desktop keeps the empty scratchpad because Windows Vietnamese Telex can
 * otherwise reconvert previously committed words through stale textarea state.
 */
function shouldUseMirroredTextarea(host: HTMLElement): boolean {
  const view = host.ownerDocument.defaultView;
  const navigator = view?.navigator;
  if (!navigator) return false;
  const platform = navigator.platform;
  return (
    /iP(?:ad|hone|od)/.test(navigator.userAgent) ||
    (platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function textDiff(
  previous: string,
  next: string,
): { start: number; end: number; text: string } {
  let start = 0;
  while (
    start < previous.length &&
    start < next.length &&
    previous[start] === next[start]
  ) {
    start += 1;
  }

  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previous[previousEnd - 1] === next[nextEnd - 1]
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  return {
    start,
    end: previousEnd,
    text: next.slice(start, nextEnd),
  };
}

function hasVietnameseTransform(value: string): boolean {
  return value !== "" && foldVietnameseInput(value) !== value.toLowerCase();
}

function vietnameseInputCandidate(
  eventData: string | null,
  textareaValue: string,
): string | null {
  if (eventData && hasVietnameseTransform(eventData)) return eventData;
  if (hasVietnameseTransform(textareaValue)) return textareaValue;
  return null;
}

function foldVietnameseInput(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

function currentWordStart(text: string, offset: number): number {
  let start = clampOffset(offset, text.length);
  while (start > 0 && !/\s/.test(text[start - 1] ?? "")) {
    start -= 1;
  }
  return start;
}

function vietnameseRewriteStart(
  text: string,
  offset: number,
  replacement: string,
): number | null {
  if (!hasVietnameseTransform(replacement)) return null;

  const rangeStart = clampOffset(offset, text.length);
  const wordStart = currentWordStart(text, rangeStart);
  if (wordStart === rangeStart) return null;

  const word = text.slice(wordStart, rangeStart);
  const foldedWord = foldVietnameseInput(word);
  const foldedText = foldVietnameseInput(replacement);
  if (!foldedWord || !foldedText) return null;

  if (
    foldedWord === foldedText ||
    foldedText.startsWith(foldedWord) ||
    (foldedWord.startsWith("dd") && foldedText.startsWith("d"))
  ) {
    return wordStart;
  }
  if (foldedWord.endsWith(foldedText)) {
    return rangeStart - Math.min(foldedText.length, word.length);
  }
  if (foldedWord.endsWith("e") && foldedText.startsWith("eu")) {
    return rangeStart - 1;
  }
  return null;
}

/** Previous offset, stepping over a surrogate pair so we never split a char. */
function prevOffset(text: string, offset: number): number {
  if (offset <= 0) return 0;
  const before = text.charCodeAt(offset - 2);
  const lead = text.charCodeAt(offset - 1);
  const isLowSurrogate = lead >= 0xdc00 && lead <= 0xdfff;
  const isHighSurrogate = before >= 0xd800 && before <= 0xdbff;
  return offset - (isLowSurrogate && isHighSurrogate ? 2 : 1);
}

/** Next offset, stepping over a surrogate pair so we never split a char. */
function nextOffset(text: string, offset: number): number {
  if (offset >= text.length) return text.length;
  const code = text.charCodeAt(offset);
  const isHighSurrogate = code >= 0xd800 && code <= 0xdbff;
  return offset + (isHighSurrogate && offset + 1 < text.length ? 2 : 1);
}

/** Word-delete boundary backward: skip trailing spaces, then a run of non-spaces. */
function prevWordBoundary(text: string, offset: number): number {
  let i = offset;
  while (i > 0 && /\s/.test(text[i - 1] ?? "")) i -= 1;
  while (i > 0 && !/\s/.test(text[i - 1] ?? "")) i -= 1;
  return i;
}

/** Word-delete boundary forward: skip leading spaces, then a run of non-spaces. */
function nextWordBoundary(text: string, offset: number): number {
  let i = offset;
  while (i < text.length && /\s/.test(text[i] ?? "")) i += 1;
  while (i < text.length && !/\s/.test(text[i] ?? "")) i += 1;
  return i;
}
