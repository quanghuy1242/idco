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
  #composing = false;
  #compositionStart = 0;

  constructor(host: HTMLElement, ctx: EditContext) {
    this.#host = host;
    this.#ctx = ctx;
    this.#shadowRoot =
      host.shadowRoot ??
      host.attachShadow({ mode: "open", delegatesFocus: true });
    this.#textarea = document.createElement("textarea");
    const textarea = this.#textarea;
    textarea.setAttribute("aria-hidden", "true");
    textarea.tabIndex = -1;
    textarea.autocapitalize = "off";
    textarea.spellcheck = false;
    Object.assign(textarea.style, {
      position: "absolute",
      width: "1px",
      height: "1px",
      padding: "0",
      margin: "0",
      border: "0",
      left: "0",
      top: "0",
      opacity: "0",
      overflow: "hidden",
      resize: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    textarea.value = ctx.text;
    this.#ensureFocusOutlineStyle();
    this.#ensureSlot();
    this.#shadowRoot.append(textarea);

    host.addEventListener("pointerdown", this.#focusSink);
    host.addEventListener("focus", this.#focusSink);
    textarea.addEventListener("input", this.#onInput);
    textarea.addEventListener("compositionstart", this.#onCompositionStart);
    textarea.addEventListener("compositionend", this.#onCompositionEnd);
  }

  /** Keep the textarea selection aligned with the model (engine-driven nav). */
  syncSelection(): void {
    this.#textarea.value = this.#ctx.text;
    this.#textarea.setSelectionRange(
      this.#ctx.selectionStart,
      this.#ctx.selectionEnd,
    );
  }

  destroy(): void {
    this.#host.removeEventListener("pointerdown", this.#focusSink);
    this.#host.removeEventListener("focus", this.#focusSink);
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
    this.syncSelection();
  };

  readonly #onInput = (): void => {
    this.#emitTextUpdate();
    if (this.#composing) this.#emitCompositionFormat();
  };

  readonly #onCompositionStart = (): void => {
    this.#composing = true;
    this.#compositionStart =
      this.#textarea.selectionStart ?? this.#ctx.selectionStart;
    this.#ctx.isComposing = true;
    this.#ctx.compositionStart = this.#compositionStart;
    this.#ctx.compositionEnd = this.#compositionStart;
    this.#ctx.dispatchEvent(new Event("compositionstart"));
  };

  readonly #onCompositionEnd = (): void => {
    this.#composing = false;
    this.#emitTextUpdate();
    this.#ctx.isComposing = false;
    this.#ctx.compositionStart = this.#ctx.selectionStart;
    this.#ctx.compositionEnd = this.#ctx.selectionEnd;
    this.#ctx.dispatchEvent(
      new PolyfilledTextFormatUpdateEvent("textformatupdate", []),
    );
    this.#ctx.dispatchEvent(new Event("compositionend"));
  };

  #emitTextUpdate(): void {
    const previousLength = this.#ctx.text.length;
    const next = this.#textarea.value;
    const selectionStart = this.#textarea.selectionStart ?? next.length;
    const selectionEnd = this.#textarea.selectionEnd ?? selectionStart;
    this.#ctx.text = next;
    this.#ctx.selectionStart = selectionStart;
    this.#ctx.selectionEnd = selectionEnd;
    if (this.#composing) {
      this.#ctx.compositionStart = this.#compositionStart;
      this.#ctx.compositionEnd = Math.max(this.#compositionStart, selectionEnd);
    }
    this.#ctx.dispatchEvent(
      new PolyfilledTextUpdateEvent("textupdate", {
        text: next,
        selectionStart,
        selectionEnd,
        updateRangeStart: 0,
        updateRangeEnd: previousLength,
      }),
    );
  }

  /**
   * Emit the same `textformatupdate` signal native EditContext uses for IME
   * preedit styling. Native can report richer platform underline values; this
   * hidden-textarea bridge only knows the active composition range, so it sends
   * a simple thin underline for the shared renderer to paint.
   */
  #emitCompositionFormat(): void {
    const end = Math.max(this.#compositionStart, this.#ctx.selectionEnd);
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
}

/** Re-align the polyfill input sink for a host after engine-driven nav. */
export function syncPolyfillSelection(host: Element): void {
  HOST_BINDINGS.get(host)?.syncSelection();
}

function clampOffset(offset: number, length: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.min(Math.max(0, Math.floor(offset)), length);
}
