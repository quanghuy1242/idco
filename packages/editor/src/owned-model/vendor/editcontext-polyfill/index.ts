/**
 * Vendored EditContext polyfill (docs/010 §5.5 / §6.7). See VENDOR.md for
 * provenance. The engine binds to this API surface only, so native vs
 * polyfilled is invisible to it; this module is framework-free.
 *
 * Phase 2 (input + caret + selection spike) makes the surface functional for
 * the non-Chromium path: `install()` defines `EditContext` and patches
 * `HTMLElement.prototype.editContext` so `host.editContext = ctx` wires a
 * visually-hidden `<textarea>` input bridge (the docs/010 §5.5 hidden-input
 * approach) that captures keystrokes/IME and re-dispatches them as EditContext
 * `textupdate`/composition events. Selection *painting* is the engine's job
 * (docs/010 §7.4), not the polyfill's, in this spike.
 */

export type EditContextTextUpdateEventInit = {
  readonly updateRangeStart: number;
  readonly updateRangeEnd: number;
  readonly text: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
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
   * Install the polyfill even when a native `EditContext` exists. Used by the
   * forced-polyfill story/test variant (docs/010 P2 AC5) to exercise the
   * polyfill path on Chromium.
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
  /** Whether this call installed the polyfilled `EditContext`. */
  readonly installed: boolean;
  /** Whether a native `EditContext` was present before this call. */
  readonly native: boolean;
};

/**
 * Install the polyfilled `EditContext` onto the target global when it is absent
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
  const native = typeof target.EditContext === "function";
  if (native && !options.force) {
    return { installed: false, native };
  }
  target.EditContext = EditContext;
  if (usingGlobalTarget) {
    patchHtmlElement(Boolean(options.force));
    patchSelection();
  }
  return { installed: true, native };
}

const HOST_BINDINGS = new WeakMap<Element, PolyfillBinding>();

/**
 * Patch `HTMLElement.prototype.editContext` so assigning a polyfilled
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

function closestActiveHost(node: Node | null): HTMLElement | null {
  let current: Node | null = node;
  while (current) {
    if (
      current instanceof HTMLElement &&
      current.hasAttribute("data-editcontext-active")
    ) {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

/**
 * Patch `Selection.prototype.addRange`/`removeAllRanges` (docs/010 §7.4). On a
 * `[data-editcontext-active]` host the engine hand-paints its own caret +
 * selection overlay, and mutating the real document Selection there would blur
 * the polyfill's hidden-textarea input sink — so we no-op the real mutation for
 * those hosts and let the original run everywhere else.
 */
function patchSelection(): void {
  if (typeof Selection === "undefined") return;
  const proto = Selection.prototype as unknown as Record<string, unknown>;
  if ("__idcoSelectionPatched" in proto) return;

  const originalAddRange = Selection.prototype.addRange;
  const originalRemoveAll = Selection.prototype.removeAllRanges;

  Selection.prototype.addRange = function patchedAddRange(
    this: Selection,
    range: Range,
  ): void {
    if (range && closestActiveHost(range.startContainer)) return;
    originalAddRange.call(this, range);
  };
  Selection.prototype.removeAllRanges = function patchedRemoveAll(
    this: Selection,
  ): void {
    const active =
      typeof document !== "undefined" ? document.activeElement : null;
    if (closestActiveHost(active)) return;
    originalRemoveAll.call(this);
  };

  Object.defineProperty(proto, "__idcoSelectionPatched", {
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
  #composing = false;

  constructor(host: HTMLElement, ctx: EditContext) {
    this.#host = host;
    this.#ctx = ctx;
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
    host.append(textarea);

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

  readonly #focusSink = (): void => {
    if (document.activeElement !== this.#textarea) {
      this.#textarea.focus({ preventScroll: true });
      this.syncSelection();
    }
  };

  readonly #onInput = (): void => {
    if (this.#composing) return;
    this.#emitTextUpdate();
  };

  readonly #onCompositionStart = (): void => {
    this.#composing = true;
    this.#ctx.dispatchEvent(new Event("compositionstart"));
  };

  readonly #onCompositionEnd = (): void => {
    this.#composing = false;
    this.#emitTextUpdate();
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
}

/** Re-align the polyfill input sink for a host after engine-driven nav. */
export function syncPolyfillSelection(host: Element): void {
  HOST_BINDINGS.get(host)?.syncSelection();
}

function clampOffset(offset: number, length: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.min(Math.max(0, Math.floor(offset)), length);
}
