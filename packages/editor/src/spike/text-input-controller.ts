// docs/010 §5.2 / §7.4 — the Phase 2 spike controller: one plain-text block on
// an EditContext host. It proves the loop the whole engine turns on —
// input → model → render, model-owned selection, geometry fed to the
// EditContext — before any document model or virtualization exists.
//
// Framework-free (spike reference; not canonical). DOM event plumbing is
// allowed; React/Lexical are not.

import { caretPointFromCoordinates, type CaretPoint } from "./caret-from-point";
import {
  createEditContextHost,
  type EditContextBackend,
  type EditContextLike,
} from "./editcontext-host";
import {
  createSelectionOverlay,
  type OverlayRenderInfo,
  type SelectionOverlay,
} from "./selection-overlay";
import { createTextDomMapper } from "./text-dom-mapping";

export type TextInputState = {
  text: string;
  anchor: number;
  focus: number;
};

export type EngineInputDiagnostics = TextInputState & {
  readonly inputBackend: EditContextBackend;
  readonly composing: boolean;
  readonly focused: boolean;
  readonly lastEvent: string;
  readonly lastClipboardText: string;
  readonly caretLeft: number;
  readonly caretTop: number;
  readonly caretHeight: number;
  readonly rectCount: number;
  readonly usedAddRange: boolean;
};

export type TextInputController = {
  readonly getState: () => TextInputState;
  readonly getDiagnostics: () => EngineInputDiagnostics;
  readonly destroy: () => void;
};

export type CreateTextInputControllerOptions = {
  readonly host: HTMLElement;
  readonly textElement: HTMLElement;
  readonly overlayElement: HTMLElement;
  readonly initialText?: string;
  readonly initialSelection?: {
    readonly anchor: number;
    readonly focus: number;
  };
  readonly forcePolyfill?: boolean;
  /** Publish diagnostics onto `window.__IDCO_ENGINE_INPUT__` for the spike. */
  readonly publishGlobal?: boolean;
  /**
   * Project controller state into another spike shell. This keeps the
   * EditContext/native-polyfill input loop centralized while FlowSpike mirrors
   * the active leaf into its wider model.
   */
  readonly onStateChange?: (diagnostics: EngineInputDiagnostics) => void;
};

const GLOBAL_KEY = "__IDCO_ENGINE_INPUT__";

type DemoBoldMark = {
  readonly start: number;
  readonly end: number;
};

type CompositionFormat = {
  readonly start: number;
  readonly end: number;
  readonly underlineStyle: string;
  readonly underlineThickness: string;
};

type TextFormatLike = {
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly underlineStyle?: string;
  readonly underlineThickness?: string;
};

type TextFormatUpdateEventLike = Event & {
  readonly getTextFormats?: () => readonly TextFormatLike[];
};

/**
 * Return whether focus belongs to this editing host. The API implementation may
 * keep focus on the host itself or on an input sink it owns inside the host; the
 * editor's focus model treats both as the same active EditContext surface.
 */
function hostOwnsFocus(host: HTMLElement): boolean {
  const active = host.ownerDocument.activeElement;
  return active === host || (active instanceof Node && host.contains(active));
}

/**
 * Treat clicks on the synthetic trailing blank line as clicks at the real model
 * end. That line exists only so a terminal newline has layout; it must never
 * become an addressable extra character beyond `state.text.length`.
 */
function isTrailingLinePoint(
  point: CaretPoint | null,
  textElement: HTMLElement,
): boolean {
  if (!point) return false;
  const node =
    point.node.nodeType === Node.ELEMENT_NODE
      ? (point.node as Element)
      : point.node.parentElement;
  return Boolean(node?.closest("[data-engine-trailing-line]")) &&
    textElement.contains(node)
    ? true
    : point.node === textElement && point.offset > 0;
}

/**
 * Select a word-like token around a model offset. This is intentionally small:
 * Phase 2 only needs native-text-input parity for the spike, not language-aware
 * segmentation. Whitespace/punctuation falls back to the clicked character so a
 * double-click always produces a deterministic range.
 */
function wordRangeAt(text: string, offset: number): DemoBoldMark {
  const length = text.length;
  const startOffset = Math.min(Math.max(0, offset), length);
  const sampleOffset =
    startOffset > 0 && !isWordCharacter(text[startOffset])
      ? startOffset - 1
      : startOffset;
  const seed = Math.min(Math.max(0, sampleOffset), Math.max(0, length - 1));
  if (length === 0) return { start: 0, end: 0 };
  if (!isWordCharacter(text[seed])) {
    return { start: seed, end: Math.min(seed + 1, length) };
  }

  let start = seed;
  let end = seed + 1;
  while (start > 0 && isWordCharacter(text[start - 1])) start -= 1;
  while (end < length && isWordCharacter(text[end])) end += 1;
  return { start, end };
}

/**
 * Select the current visual/logical line in the Phase 2 single text block.
 * Triple-click in a textarea-like surface selects the line/paragraph, and
 * newline delimiters are the only line model this spike owns.
 */
function lineRangeAt(text: string, offset: number): DemoBoldMark {
  const caret = Math.min(Math.max(0, offset), text.length);
  const lineStart = text.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
  const nextBreak = text.indexOf("\n", caret);
  return {
    start: lineStart,
    end: nextBreak === -1 ? text.length : nextBreak,
  };
}

/**
 * Minimal word-character predicate for the Phase 2 shortcut/click spike.
 * Keeping it local avoids pulling in Intl.Segmenter semantics before the real
 * Phase 3 model has decided how rich-text tokenization should work.
 */
function isWordCharacter(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}_]/u.test(char);
}

type SegmentLike = {
  readonly index: number;
};

type SegmenterLike = {
  readonly segment: (input: string) => Iterable<SegmentLike>;
};

type SegmenterConstructorLike = new (
  locale: string | undefined,
  options: { granularity: "grapheme" },
) => SegmenterLike;

function graphemeBoundaries(text: string): readonly number[] {
  const ctor = (Intl as { Segmenter?: SegmenterConstructorLike }).Segmenter;
  if (typeof ctor === "function") {
    return [
      ...new Set([
        0,
        ...Array.from(
          new ctor(undefined, { granularity: "grapheme" }).segment(text),
          (segment) => segment.index,
        ),
        text.length,
      ]),
    ].sort((a, b) => a - b);
  }

  const boundaries = [0];
  let offset = 0;
  for (const chunk of Array.from(text)) {
    offset += chunk.length;
    boundaries.push(offset);
  }
  return boundaries;
}

function previousGraphemeBoundary(text: string, offset: number): number {
  const target = Math.min(Math.max(0, offset), text.length);
  const boundaries = graphemeBoundaries(text);
  for (let index = boundaries.length - 1; index >= 0; index -= 1) {
    const boundary = boundaries[index] ?? 0;
    if (boundary < target) return boundary;
  }
  return 0;
}

function nextGraphemeBoundary(text: string, offset: number): number {
  const target = Math.min(Math.max(0, offset), text.length);
  for (const boundary of graphemeBoundaries(text)) {
    if (boundary > target) return boundary;
  }
  return text.length;
}

/**
 * Normalize platform IME underline styles to CSS values the DOM renderer can
 * apply. Unknown values fall back to a solid underline because a visible
 * preedit mark is more important than exact platform styling in Phase 2.
 */
function underlineStyle(
  value: string,
): CSSStyleDeclaration["textDecorationStyle"] {
  switch (value) {
    case "dotted":
    case "dashed":
    case "wavy":
    case "double":
    case "solid":
      return value;
    default:
      return "solid";
  }
}

/**
 * Normalize platform IME underline thickness to CSS. Native `TextFormat` and
 * our API polyfill both report semantic values; a visible preedit mark matters
 * more than exact platform styling in this Phase 2 spike.
 */
function underlineThickness(value: string): string {
  return value === "thick" ? "2px" : "1px";
}

/**
 * Check whether a normalized range fully covers a render segment. Segment
 * boundaries are generated from every range start/end, so containment is
 * enough; no partial-overlap splitting is needed inside this helper.
 */
function rangeCoversSegment(
  range: DemoBoldMark,
  start: number,
  end: number,
): boolean {
  return range.start <= start && range.end >= end;
}

/**
 * Pick the IME format that covers a render segment. Platform IMEs may return
 * several adjacent format ranges; the Phase 2 view only needs the one that
 * contains this already-split segment.
 */
function compositionForSegment(
  formats: readonly CompositionFormat[],
  start: number,
  end: number,
): CompositionFormat | null {
  return (
    formats.find((format) => rangeCoversSegment(format, start, end)) ?? null
  );
}

/**
 * Build a compact equality key for IME format ranges. It avoids repainting the
 * text DOM when repeated native `textformatupdate` events carry the same
 * underline state.
 */
function compositionFormatKey(formats: readonly CompositionFormat[]): string {
  return formats
    .map(
      (format) =>
        `${format.start}:${format.end}:${format.underlineStyle}:${format.underlineThickness}`,
    )
    .join("|");
}

export function createTextInputController(
  options: CreateTextInputControllerOptions,
): TextInputController {
  const {
    host,
    textElement,
    overlayElement,
    initialText = "",
    initialSelection,
    forcePolyfill = false,
    publishGlobal = false,
    onStateChange,
  } = options;

  const editHost = createEditContextHost({ host, initialText, forcePolyfill });
  const editContext: EditContextLike = editHost.editContext;
  const textMapper = createTextDomMapper(textElement);
  const overlay: SelectionOverlay = createSelectionOverlay({
    host,
    textElement,
    overlayElement,
    textMapper,
    editContext,
  });

  const state: TextInputState = {
    text: initialText,
    anchor: Math.min(
      Math.max(0, initialSelection?.anchor ?? initialText.length),
      initialText.length,
    ),
    focus: Math.min(
      Math.max(0, initialSelection?.focus ?? initialText.length),
      initialText.length,
    ),
  };
  let boldMarks: DemoBoldMark[] = [];
  let compositionFormats: CompositionFormat[] = [];
  let textSurfaceDirty = true;
  let cachedLineStepHeight: number | null = null;
  let composing = false;
  let focused = hostOwnsFocus(host);
  let lastEvent = "init";
  let lastClipboardText = "";
  let dragging = false;
  let lastPointerOffset = state.focus;
  let lastOverlayInfo: OverlayRenderInfo = {
    caretLeft: 0,
    caretTop: 0,
    caretHeight: 18,
    rectCount: 0,
    usedAddRange: false,
  };

  editContext.updateSelection(
    Math.min(state.anchor, state.focus),
    Math.max(state.anchor, state.focus),
  );
  editHost.syncInputSelection();

  /**
   * Return sorted, clamped bold ranges for the temporary Ctrl+B demo. This is
   * deliberately not a rich-text model; Phase 3 will replace it with real marks
   * and transactions. For Phase 2 it proves that keyboard shortcuts can route
   * through the owned input loop and affect a selected range.
   */
  function normalizedBoldMarks(): readonly DemoBoldMark[] {
    return boldMarks
      .map((mark) => ({
        start: clamp(mark.start),
        end: clamp(mark.end),
      }))
      .filter((mark) => mark.end > mark.start)
      .sort((a, b) => a.start - b.start || a.end - b.end);
  }

  /**
   * Return sorted, clamped IME composition ranges. Every EditContext
   * implementation reports these through `textformatupdate`. The ranges are
   * view-only decorations and never mutate the model string.
   */
  function normalizedCompositionFormats(): readonly CompositionFormat[] {
    return compositionFormats
      .map((format) => ({
        start: clamp(format.start),
        end: clamp(format.end),
        underlineStyle: format.underlineStyle,
        underlineThickness: format.underlineThickness,
      }))
      .filter((format) => format.end > format.start)
      .sort((a, b) => a.start - b.start || a.end - b.end);
  }

  /**
   * Mark the rendered text DOM stale. Selection moves should not call this:
   * they only need overlay geometry. Text, temporary bold marks, and IME
   * underlines do call it because they change the text node topology.
   */
  function invalidateTextSurface(): void {
    textSurfaceDirty = true;
    cachedLineStepHeight = null;
  }

  /**
   * Append a text segment, wrapping it only when a visual decoration is active.
   * Bold is a removable Phase 2 shortcut demo; composition underline is real
   * IME preedit feedback that custom EditContext renderers must draw.
   */
  function appendTextSegment(
    children: Node[],
    text: string,
    segmentOptions: {
      readonly bold: boolean;
      readonly composition: CompositionFormat | null;
    },
  ): void {
    const node = host.ownerDocument.createTextNode(text);
    if (!segmentOptions.bold && !segmentOptions.composition) {
      children.push(node);
      return;
    }

    const wrapper = host.ownerDocument.createElement(
      segmentOptions.bold ? "strong" : "span",
    );
    if (segmentOptions.bold) wrapper.dataset.engineBold = "";
    if (segmentOptions.composition) {
      wrapper.dataset.engineComposition = "";
      Object.assign(wrapper.style, {
        textDecorationLine: "underline",
        textDecorationStyle: underlineStyle(
          segmentOptions.composition.underlineStyle,
        ),
        textDecorationThickness: underlineThickness(
          segmentOptions.composition.underlineThickness,
        ),
        textUnderlineOffset: "0.16em",
      } satisfies Partial<CSSStyleDeclaration>);
    }
    wrapper.append(node);
    children.push(wrapper);
  }

  /**
   * Render the model text plus a layout-only final-line marker when the model
   * ends in `\n`. A terminal newline is a real model offset, but browsers do
   * not allocate a blank final line until another glyph appears; the marker
   * makes the visible text area, caret geometry, and model agree immediately.
   */
  function renderTextSurface(): void {
    if (!textSurfaceDirty) return;

    const children: Node[] = [];
    const bold = normalizedBoldMarks();
    const compositions = normalizedCompositionFormats();
    const boundaries = new Set<number>([0, state.text.length]);
    for (const range of bold) {
      boundaries.add(range.start);
      boundaries.add(range.end);
    }
    for (const format of compositions) {
      boundaries.add(format.start);
      boundaries.add(format.end);
    }

    const points = [...boundaries].sort((a, b) => a - b);
    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index] ?? 0;
      const end = points[index + 1] ?? start;
      if (end <= start) continue;
      appendTextSegment(children, state.text.slice(start, end), {
        bold: bold.some((mark) => rangeCoversSegment(mark, start, end)),
        composition: compositionForSegment(compositions, start, end),
      });
    }

    if (state.text.endsWith("\n")) {
      // Browsers preserve the newline in the text node, but they do not reserve
      // a visible blank final line for layout until another glyph appears. The
      // owned caret can already move to the model offset after `\n`; this hidden
      // zero-width marker gives the host an actual final line box at that same
      // model end without adding anything to `state.text`, clipboard text, or
      // the first text node that offset mapping uses.
      const trailingLine = host.ownerDocument.createElement("span");
      trailingLine.dataset.engineTrailingLine = "";
      trailingLine.setAttribute("aria-hidden", "true");
      trailingLine.textContent = "\u200b";
      Object.assign(trailingLine.style, {
        pointerEvents: "none",
      } satisfies Partial<CSSStyleDeclaration>);
      children.push(trailingLine);
    }

    textElement.replaceChildren(...children);
    textMapper.markDirty();
    textSurfaceDirty = false;
  }

  function clamp(offset: number): number {
    return Math.min(Math.max(0, offset), state.text.length);
  }

  function paint(): void {
    renderTextSurface();
    const info = overlay.render({
      anchor: state.anchor,
      focus: state.focus,
      focused,
    });
    lastOverlayInfo = info;
    const diagnostics: EngineInputDiagnostics = {
      ...state,
      inputBackend: editHost.backend,
      composing,
      focused,
      lastEvent,
      lastClipboardText,
      caretLeft: info.caretLeft,
      caretTop: info.caretTop,
      caretHeight: info.caretHeight,
      rectCount: info.rectCount,
      usedAddRange: info.usedAddRange,
    };
    onStateChange?.(diagnostics);
    if (publishGlobal && typeof window !== "undefined") {
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

  function replaceModelText(
    rangeStart: number,
    rangeEnd: number,
    text: string,
  ): void {
    const result = editHost.replaceText(rangeStart, rangeEnd, text);
    state.text = result.text;
    state.anchor = result.selectionStart;
    state.focus = result.selectionEnd;
    boldMarks = [];
    compositionFormats = [];
    invalidateTextSurface();
  }

  function selectionRange(): DemoBoldMark {
    return {
      start: Math.min(state.anchor, state.focus),
      end: Math.max(state.anchor, state.focus),
    };
  }

  function selectedText(): string {
    const range = selectionRange();
    return state.text.slice(range.start, range.end);
  }

  function writeClipboardData(event: ClipboardEvent, text: string): void {
    event.clipboardData?.setData("text/plain", text);
    lastClipboardText = text;
    event.preventDefault();
    event.stopPropagation();
  }

  /**
   * Keep a visible preedit underline even if an implementation sends composing
   * text before it sends a richer `textformatupdate` payload. The contract is
   * the same either way: compositionStart/compositionEnd identify the preedit
   * range in EditContext offsets.
   */
  function syncFallbackCompositionFormat(): boolean {
    const start = clamp(editContext.compositionStart ?? state.anchor);
    const end = clamp(editContext.compositionEnd ?? state.focus);
    const next =
      end > start
        ? [
            {
              start,
              end,
              underlineStyle: "solid",
              underlineThickness: "thin",
            },
          ]
        : [];
    if (
      compositionFormatKey(compositionFormats) === compositionFormatKey(next)
    ) {
      return false;
    }
    compositionFormats = next;
    return true;
  }

  /**
   * Read `textformatupdate` payloads and turn them into rendered IME underlines.
   * MDN's EditContext guide is explicit that custom renderers must apply these
   * composition formats themselves; that is editor work, not backend work.
   */
  function onTextFormatUpdate(event: Event): void {
    const formats =
      (event as TextFormatUpdateEventLike).getTextFormats?.().map((format) => ({
        start: format.rangeStart,
        end: format.rangeEnd,
        underlineStyle: format.underlineStyle ?? "solid",
        underlineThickness: format.underlineThickness ?? "thin",
      })) ?? [];
    if (
      compositionFormatKey(compositionFormats) === compositionFormatKey(formats)
    ) {
      return;
    }
    compositionFormats = formats;
    lastEvent = "textformatupdate";
    invalidateTextSurface();
    paint();
  }

  // Mirror the EditContext buffer/selection onto the model on every text update
  // (native and polyfill both maintain `text`/selection before firing).
  function onTextUpdate(): void {
    lastEvent = "textupdate";
    const textChanged = state.text !== editContext.text;
    if (textChanged) {
      // The Phase 2 bold mark is only a shortcut-routing demo over one mutable
      // string. Real mark remapping belongs to Phase 3 transactions, so clear
      // demo marks after text mutations instead of pretending we have a mark
      // transform pipeline here.
      boldMarks = [];
      invalidateTextSurface();
    }
    state.text = editContext.text;
    state.anchor = clamp(editContext.selectionStart);
    state.focus = clamp(editContext.selectionEnd);
    if (composing && syncFallbackCompositionFormat()) {
      invalidateTextSurface();
    }
    paint();
  }

  /**
   * Select all model text inside the spike host. This keeps Ctrl/Cmd+A scoped to
   * the owned input instead of letting the browser select the Ladle page.
   */
  function selectAll(): void {
    lastEvent = "shortcut:selectAll";
    setSelection(0, state.text.length);
    paint();
  }

  /**
   * Toggle the temporary bold demo mark for the selected range. This is an
   * intentionally removable Phase 2 example: it proves shortcut plumbing and
   * selected-range rendering, while Phase 3 will own real rich-text marks.
   */
  function toggleBoldSelection(): void {
    const start = Math.min(state.anchor, state.focus);
    const end = Math.max(state.anchor, state.focus);
    lastEvent = "shortcut:bold";
    if (end <= start) {
      paint();
      return;
    }

    const exactIndex = boldMarks.findIndex(
      (mark) => mark.start === start && mark.end === end,
    );
    boldMarks =
      exactIndex >= 0
        ? boldMarks.filter((_, index) => index !== exactIndex)
        : [...boldMarks, { start, end }];
    invalidateTextSurface();
    paint();
  }

  /**
   * Handle editor-owned shortcuts before the browser/page sees them. The spike
   * only claims shortcuts it can model honestly today: select-all and the
   * temporary selected-text bold example.
   */
  function handleShortcut(event: KeyboardEvent): boolean {
    if (!event.ctrlKey && !event.metaKey) return false;
    const key = event.key.toLowerCase();
    if (key === "a") {
      event.preventDefault();
      event.stopPropagation();
      selectAll();
      return true;
    }
    if (key === "b") {
      event.preventDefault();
      event.stopPropagation();
      toggleBoldSelection();
      return true;
    }
    return false;
  }

  /**
   * Return the vertical movement step from CSS line-height, not from the painted
   * caret height. The caret is intentionally shorter for visual polish, while
   * ArrowUp/ArrowDown still need to jump by the real browser line box.
   */
  function lineStepHeight(): number {
    if (cachedLineStepHeight !== null) return cachedLineStepHeight;
    const computed =
      host.ownerDocument.defaultView?.getComputedStyle(textElement);
    const lineHeight = Number.parseFloat(computed?.lineHeight ?? "");
    cachedLineStepHeight =
      Number.isFinite(lineHeight) && lineHeight > 0
        ? lineHeight
        : Math.max(1, lastOverlayInfo.caretHeight);
    return cachedLineStepHeight;
  }

  /**
   * Move vertically by asking the browser to hit-test the same visual column on
   * the line above/below. This is intentionally browser-layout-driven: Phase 2
   * proves we can reuse native line wrapping instead of building a text layout
   * engine.
   */
  function offsetFromVerticalMove(direction: -1 | 1): number {
    const hostRect = host.getBoundingClientRect();
    const lineHeight = lineStepHeight();
    const x = hostRect.left + lastOverlayInfo.caretLeft + 1;
    const y =
      hostRect.top +
      lastOverlayInfo.caretTop +
      lastOverlayInfo.caretHeight / 2 +
      direction * lineHeight;
    const point = caretPointFromCoordinates(x, y, host.ownerDocument);
    if (isTrailingLinePoint(point, textElement)) return state.text.length;
    return textMapper.modelOffsetFromCaretPoint(point) ?? state.focus;
  }

  function onCompositionStart(): void {
    composing = true;
    compositionFormats = [];
    invalidateTextSurface();
    lastEvent = "compositionstart";
    paint();
  }

  function onCompositionEnd(): void {
    composing = false;
    compositionFormats = [];
    invalidateTextSurface();
    lastEvent = "compositionend";
    state.text = editContext.text;
    state.anchor = clamp(editContext.selectionStart);
    state.focus = clamp(editContext.selectionEnd);
    paint();
  }

  /** Repaint the caret when focus enters/leaves the native host or polyfill sink. */
  function onFocusIn(): void {
    focused = true;
    lastEvent = "focus";
    paint();
  }

  /** Hide the collapsed caret when focus leaves the whole editing host. */
  function onFocusOut(event: FocusEvent): void {
    if (
      event.relatedTarget instanceof Node &&
      host.contains(event.relatedTarget)
    ) {
      return;
    }
    focused = false;
    lastEvent = "blur";
    paint();
  }

  // Caret/selection navigation is engine-owned for both paths (docs/010 §7.4):
  // arrows never reach the text via input, so we move the model selection and
  // re-sync the input sink.
  function onKeyDown(event: KeyboardEvent): void {
    if (handleShortcut(event)) return;

    // While the editing host is focused, plain keystrokes belong to the editor,
    // not to app-level keyboard shortcuts (e.g. Ladle's). Keep Ctrl/Cmd/Alt
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

    if (composing) return;

    // Enter is an editor text command, not a backend workaround. Route it
    // through the same EditContext replacement helper for native and polyfill
    // implementations so the visible model never depends on textarea defaults.
    if (event.key === "Enter") {
      event.preventDefault();
      const lo = Math.min(state.anchor, state.focus);
      const hi = Math.max(state.anchor, state.focus);
      replaceModelText(lo, hi, "\n");
      lastEvent = "key:Enter";
      paint();
      return;
    }

    const extend = event.shiftKey;
    let focus = state.focus;
    let handled = true;
    switch (event.key) {
      case "ArrowLeft":
        focus = previousGraphemeBoundary(state.text, state.focus);
        break;
      case "ArrowRight":
        focus = nextGraphemeBoundary(state.text, state.focus);
        break;
      case "Backspace": {
        const range = selectionRange();
        const start =
          range.start === range.end
            ? previousGraphemeBoundary(state.text, state.focus)
            : range.start;
        const end = range.start === range.end ? state.focus : range.end;
        replaceModelText(start, end, "");
        break;
      }
      case "Delete": {
        const range = selectionRange();
        const start = range.start === range.end ? state.focus : range.start;
        const end =
          range.start === range.end
            ? nextGraphemeBoundary(state.text, state.focus)
            : range.end;
        replaceModelText(start, end, "");
        break;
      }
      case "ArrowUp":
        focus = offsetFromVerticalMove(-1);
        break;
      case "ArrowDown":
        focus = offsetFromVerticalMove(1);
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
    if (event.key !== "Backspace" && event.key !== "Delete") {
      setSelection(extend ? state.anchor : focus, focus);
    }
    paint();
  }

  function onCopy(event: ClipboardEvent): void {
    lastEvent = "clipboard:copy";
    writeClipboardData(event, selectedText());
    paint();
  }

  function onCut(event: ClipboardEvent): void {
    const range = selectionRange();
    lastEvent = "clipboard:cut";
    writeClipboardData(event, state.text.slice(range.start, range.end));
    if (range.end > range.start) {
      replaceModelText(range.start, range.end, "");
    }
    paint();
  }

  function onPaste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData("text/plain") ?? "";
    const range = selectionRange();
    lastClipboardText = text;
    lastEvent = "clipboard:paste";
    event.preventDefault();
    event.stopPropagation();
    if (text.length > 0 || range.end > range.start) {
      replaceModelText(range.start, range.end, text);
    }
    paint();
  }

  function offsetFromPointer(event: PointerEvent): number {
    const point = caretPointFromCoordinates(
      event.clientX,
      event.clientY,
      host.ownerDocument,
    );
    if (isTrailingLinePoint(point, textElement)) return state.text.length;
    const offset = textMapper.modelOffsetFromCaretPoint(point);
    return offset ?? state.focus;
  }

  /**
   * Handle native-text-input multi-click selection. Browser defaults cannot be
   * trusted here because the visible selection is engine-painted and the input
   * sink may be either a native EditContext host or the polyfill textarea.
   */
  function selectFromClickCount(clickCount: number, offset: number): boolean {
    if (clickCount >= 3) {
      const range = lineRangeAt(state.text, offset);
      lastEvent = "pointer:triple";
      setSelection(range.start, range.end);
      paint();
      return true;
    }
    if (clickCount === 2) {
      const range = wordRangeAt(state.text, offset);
      lastEvent = "pointer:double";
      setSelection(range.start, range.end);
      paint();
      return true;
    }
    return false;
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    editHost.focus();
    const offset = offsetFromPointer(event);
    lastPointerOffset = offset;
    // WebKit reports multi-click count on pointerdown; Chromium/Firefox report
    // it reliably on click. Handle it here when present, then let onClick cover
    // the browsers that only know the final count later in the event sequence.
    if (selectFromClickCount(event.detail, offset)) {
      event.preventDefault();
      dragging = false;
      return;
    }
    dragging = true;
    host.setPointerCapture?.(event.pointerId);
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

  /**
   * Apply double/triple-click selection after the browser has resolved the full
   * click count. Chromium/Firefox do not reliably expose that count on
   * `pointerdown`, while `MouseEvent.detail` on `click` is stable across the
   * Phase 2 browser matrix.
   */
  function onClick(event: MouseEvent): void {
    if (event.button !== 0) return;
    if (selectFromClickCount(event.detail, lastPointerOffset)) {
      event.preventDefault();
    }
  }

  editContext.addEventListener("textupdate", onTextUpdate);
  editContext.addEventListener("textformatupdate", onTextFormatUpdate);
  editContext.addEventListener("compositionstart", onCompositionStart);
  editContext.addEventListener("compositionend", onCompositionEnd);
  host.addEventListener("focusin", onFocusIn);
  host.addEventListener("focusout", onFocusOut);
  host.addEventListener("keydown", onKeyDown, { capture: true });
  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerup", onPointerUp);
  host.addEventListener("click", onClick);
  host.addEventListener("copy", onCopy);
  host.addEventListener("cut", onCut);
  host.addEventListener("paste", onPaste);

  paint();

  function getState(): TextInputState {
    return { ...state };
  }

  function getDiagnostics(): EngineInputDiagnostics {
    return {
      ...state,
      inputBackend: editHost.backend,
      composing,
      focused,
      lastEvent,
      lastClipboardText,
      caretLeft: lastOverlayInfo.caretLeft,
      caretTop: lastOverlayInfo.caretTop,
      caretHeight: lastOverlayInfo.caretHeight,
      rectCount: lastOverlayInfo.rectCount,
      usedAddRange: lastOverlayInfo.usedAddRange,
    };
  }

  function destroy(): void {
    editContext.removeEventListener("textupdate", onTextUpdate);
    editContext.removeEventListener("textformatupdate", onTextFormatUpdate);
    editContext.removeEventListener("compositionstart", onCompositionStart);
    editContext.removeEventListener("compositionend", onCompositionEnd);
    host.removeEventListener("focusin", onFocusIn);
    host.removeEventListener("focusout", onFocusOut);
    host.removeEventListener("keydown", onKeyDown, { capture: true });
    host.removeEventListener("pointerdown", onPointerDown);
    host.removeEventListener("pointermove", onPointerMove);
    host.removeEventListener("pointerup", onPointerUp);
    host.removeEventListener("click", onClick);
    host.removeEventListener("copy", onCopy);
    host.removeEventListener("cut", onCut);
    host.removeEventListener("paste", onPaste);
    overlay.destroy();
    editHost.destroy();
    if (publishGlobal && typeof window !== "undefined") {
      delete (window as unknown as Record<string, unknown>)[GLOBAL_KEY];
    }
  }

  return { getState, getDiagnostics, destroy };
}
