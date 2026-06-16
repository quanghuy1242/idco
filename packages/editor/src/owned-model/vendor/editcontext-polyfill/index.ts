/**
 * Vendored EditContext polyfill (docs/010 §5.5 / §6.7). See VENDOR.md for
 * provenance and the Phase 2 plan. The engine binds to this API surface only,
 * so native vs polyfilled is invisible to it; this module is framework-free.
 *
 * Phase 1 (groundwork) exposes the surface the engine will bind to — `install`
 * and an `EditContext` class — without yet wiring the upstream hidden-textarea
 * input bridge. The class models the spec's text buffer, selection offsets, and
 * the bounds/format callbacks; later phases (and the upstream vendor) fill in
 * the actual keystroke/IME translation and selection rendering.
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
 * decoupled from the DOM (docs/010 §4.2). The bounds setters are no-ops here
 * until the upstream input/selection bridge is vendored in Phase 2; they exist
 * so engine code can call the full surface against either implementation.
 */
export class EditContext extends EventTarget {
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
  /** Target to define `EditContext` on. Defaults to `globalThis`. */
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
 * (or when `force` is set). Idempotent and side-effect-free unless called.
 */
export function install(options: InstallOptions = {}): InstallResult {
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
  return { installed: true, native };
}

function clampOffset(offset: number, length: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.min(Math.max(0, Math.floor(offset)), length);
}
