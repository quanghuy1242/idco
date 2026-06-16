// docs/010 §7.4 — the model owns *what* is selected; this paints it. We drive
// the DOM `Selection` via `removeAllRanges()` + `addRange()` only (the
// base/extent setter is deliberately avoided — it is not patched by the
// polyfill and would silently no-op there), feed the range geometry back to the
// EditContext so the OS IME candidate window lands correctly, and hand-paint the
// caret + selection rects. Geometry comes from the browser
// (`Range.getClientRects()`), so wrap and bidi line-fragment geometry come back
// for free.
//
// Phase 2 finding: binding an EditContext to a host *does* yield a native,
// browser-painted caret/selection for a DOM `addRange` (the §7.4 hypothesis is
// confirmed). But the native caret position/visibility is inconsistent across
// the empty-block and just-focused cases, so — per §7.4's sanctioned fallback —
// the engine hand-paints the caret + selection *uniformly* on every path and
// suppresses the native caret/`::selection` on the host. This is "no
// architectural change, only more painting" and gives one consistent caret
// across native, polyfill, and (later) virtualized gaps.

import type { EditContextLike } from "./editcontext-host";
import type { TextDomMapper } from "./text-dom-mapping";

export type SelectionModel = {
  readonly anchor: number;
  readonly focus: number;
  /** Whether the editing host or its polyfill input sink currently owns focus. */
  readonly focused: boolean;
};

export type OverlayRenderInfo = {
  readonly caretLeft: number;
  readonly caretTop: number;
  readonly caretHeight: number;
  readonly rectCount: number;
  readonly usedAddRange: boolean;
};

export type SelectionOverlay = {
  readonly render: (model: SelectionModel) => OverlayRenderInfo;
  readonly destroy: () => void;
};

export type CreateSelectionOverlayOptions = {
  readonly host: HTMLElement;
  readonly textElement: HTMLElement;
  readonly overlayElement: HTMLElement;
  readonly textMapper: TextDomMapper;
  readonly editContext: EditContextLike;
};

const SUPPRESS_STYLE_ID = "idco-owned-model-native-selection-suppress";
const CARET_WIDTH_PX = 1;
const CARET_HEIGHT_FONT_SCALE = 1.12;
const MIN_CARET_HEIGHT_PX = 12;

/**
 * Decide whether browser geometry is usable for caret/selection painting. A
 * collapsed range at a newline often reports the all-zero viewport rect, which
 * looks numeric but is not a real text position.
 */
function isUsableRect(rect: DOMRect): boolean {
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    (rect.width > 0 || rect.height > 0)
  );
}

/**
 * Measure the text line box separately from the painted caret box. CSS
 * `line-height` includes leading above/below the glyphs; using that full value
 * for a custom caret makes it look tall and heavy compared with the browser's
 * native insertion bar. The caret is therefore based on font-size and centered
 * inside the browser-provided line geometry.
 */
function textLineMetrics(element: HTMLElement): {
  readonly lineHeight: number;
  readonly caretHeight: number;
} {
  const computed = element.ownerDocument.defaultView?.getComputedStyle(element);
  const fontSize = Number.parseFloat(computed?.fontSize ?? "");
  const lineHeight = Number.parseFloat(computed?.lineHeight ?? "");
  const usableFontSize =
    Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 16;
  const usableLineHeight =
    Number.isFinite(lineHeight) && lineHeight > 0
      ? lineHeight
      : usableFontSize * 1.2;
  return {
    lineHeight: usableLineHeight,
    caretHeight: Math.min(
      usableLineHeight,
      Math.max(MIN_CARET_HEIGHT_PX, usableFontSize * CARET_HEIGHT_FONT_SCALE),
    ),
  };
}

/**
 * Convert a browser line-position rect into the smaller visual caret box. This
 * keeps layout/hit-testing tied to real DOM geometry while avoiding the thick
 * full-line custom caret that looked unlike a native text input.
 */
function visualCaretGeometry(
  lineGeometry: {
    readonly left: number;
    readonly top: number;
    readonly height: number;
  },
  textElement: HTMLElement,
): { left: number; top: number; height: number } {
  const metrics = textLineMetrics(textElement);
  const lineHeight =
    lineGeometry.height > 0 ? lineGeometry.height : metrics.lineHeight;
  const caretHeight = Math.min(lineHeight, metrics.caretHeight);
  return {
    left: lineGeometry.left,
    top: lineGeometry.top + Math.max(0, (lineHeight - caretHeight) / 2),
    height: caretHeight,
  };
}

/**
 * Suppress the native caret + `::selection` highlight on the engine surface so
 * the engine's hand-painted caret/selection are the only ones visible. Injected
 * once per document; idempotent.
 */
function ensureNativeSuppressStyle(doc: Document): void {
  if (doc.getElementById(SUPPRESS_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = SUPPRESS_STYLE_ID;
  style.textContent = [
    "[data-owned-host]{caret-color:transparent;}",
    "[data-owned-host]::selection,[data-owned-host] ::selection{background:transparent;}",
  ].join("");
  doc.head.append(style);
}

export function createSelectionOverlay(
  options: CreateSelectionOverlayOptions,
): SelectionOverlay {
  const { host, textElement, overlayElement, textMapper, editContext } =
    options;
  const doc = host.ownerDocument;

  ensureNativeSuppressStyle(doc);

  const caret = doc.createElement("div");
  caret.dataset.ownedCaret = "";
  Object.assign(caret.style, {
    position: "absolute",
    width: `${CARET_WIDTH_PX}px`,
    background: "currentColor",
    pointerEvents: "none",
    willChange: "left, top",
  } satisfies Partial<CSSStyleDeclaration>);

  // A hard blink so the engine-painted caret reads like a native one. Restarted
  // on every move so the caret shows solid right after it changes.
  const blink =
    typeof caret.animate === "function"
      ? caret.animate(
          [
            { opacity: 1, offset: 0 },
            { opacity: 1, offset: 0.5 },
            { opacity: 0, offset: 0.5 },
            { opacity: 0, offset: 1 },
          ],
          { duration: 1060, iterations: Number.POSITIVE_INFINITY },
        )
      : null;

  const rectLayer = doc.createElement("div");
  rectLayer.dataset.ownedSelection = "";
  Object.assign(rectLayer.style, {
    position: "absolute",
    inset: "0",
    pointerEvents: "none",
  } satisfies Partial<CSSStyleDeclaration>);

  overlayElement.append(rectLayer, caret);

  function rangeFor(start: number, end: number): Range {
    const startPosition = textMapper.textPositionFromModelOffset(start);
    const endPosition = textMapper.textPositionFromModelOffset(end);
    const range = doc.createRange();
    if (!startPosition || !endPosition) {
      range.selectNodeContents(textElement);
      range.collapse(true);
      return range;
    }
    range.setStart(startPosition.node, startPosition.offset);
    range.setEnd(endPosition.node, endPosition.offset);
    return range;
  }

  function fallbackHeight(): number {
    return textLineMetrics(textElement).lineHeight;
  }

  /**
   * Measure a collapsed model offset by inserting a temporary zero-width glyph.
   * Browser range geometry is unreliable at empty/newline offsets, so this
   * gives layout a real inline box while still letting the browser own wrapping,
   * bidi, font metrics, and line-height.
   */
  function markerCaretGeometry(
    offset: number,
    hostRect: DOMRect,
  ): { left: number; top: number; height: number } | null {
    const markerHeight = textLineMetrics(textElement).lineHeight;
    const marker = doc.createElement("span");
    marker.dataset.ownedCaretProbe = "";
    marker.textContent = "\u200b";
    Object.assign(marker.style, {
      display: "inline-block",
      width: "0",
      height: `${markerHeight}px`,
      overflow: "hidden",
      lineHeight: "inherit",
      verticalAlign: "baseline",
      pointerEvents: "none",
    } satisfies Partial<CSSStyleDeclaration>);

    const position = textMapper.textPositionFromModelOffset(offset);
    const range = doc.createRange();
    if (position) {
      range.setStart(position.node, position.offset);
      range.collapse(true);
    } else {
      range.selectNodeContents(textElement);
      range.collapse(true);
    }

    range.insertNode(marker);
    const rect = marker.getBoundingClientRect();
    marker.remove();
    textElement.normalize();
    textMapper.markDirty();
    if (!isUsableRect(rect)) return null;
    return visualCaretGeometry(
      {
        left: rect.left - hostRect.left,
        top: rect.top - hostRect.top,
        height: rect.height > 0 ? rect.height : fallbackHeight(),
      },
      textElement,
    );
  }

  function caretGeometry(
    offset: number,
    hostRect: DOMRect,
  ): { left: number; top: number; height: number } {
    const needsProbeFirst =
      textMapper.textLength() === 0 ||
      textMapper.characterBeforeOffset(offset) === "\n";
    if (needsProbeFirst) {
      const markerGeometry = markerCaretGeometry(offset, hostRect);
      if (markerGeometry) return markerGeometry;
    }

    // Ordinary caret offsets are most accurate when measured as a collapsed DOM
    // range. The temporary probe is reserved for empty/final-newline offsets:
    // inserted zero-width glyphs can perturb font shaping around Vietnamese
    // combining marks and make the caret look one glyph off.
    const rect = rangeFor(offset, offset).getBoundingClientRect();
    if (isUsableRect(rect)) {
      return visualCaretGeometry(
        {
          left: rect.left - hostRect.left,
          top: rect.top - hostRect.top,
          height: rect.height > 0 ? rect.height : fallbackHeight(),
        },
        textElement,
      );
    }

    const markerGeometry = markerCaretGeometry(offset, hostRect);
    if (markerGeometry) return markerGeometry;

    // Empty block / no glyph geometry: place the caret at the text element's
    // content origin instead of the bogus (0,0) a collapsed empty range yields.
    const textRect = textElement.getBoundingClientRect();
    return visualCaretGeometry(
      {
        left: Math.max(0, (textRect.left || hostRect.left) - hostRect.left),
        top: Math.max(0, (textRect.top || hostRect.top) - hostRect.top),
        height: fallbackHeight(),
      },
      textElement,
    );
  }

  function render(model: SelectionModel): OverlayRenderInfo {
    const lo = Math.min(model.anchor, model.focus);
    const hi = Math.max(model.anchor, model.focus);
    const hostRect = host.getBoundingClientRect();

    // Selection highlight rects from live geometry.
    rectLayer.replaceChildren();
    let rectCount = 0;
    let selectionRange: Range | null = null;
    if (hi > lo) {
      selectionRange = rangeFor(lo, hi);
      for (const rect of Array.from(selectionRange.getClientRects())) {
        const box = doc.createElement("div");
        box.dataset.ownedSelrect = "";
        Object.assign(box.style, {
          position: "absolute",
          left: `${rect.left - hostRect.left}px`,
          top: `${rect.top - hostRect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          background: "Highlight",
          opacity: "0.3",
        } satisfies Partial<CSSStyleDeclaration>);
        rectLayer.append(box);
        rectCount += 1;
      }
      editContext.updateSelectionBounds(selectionRange.getBoundingClientRect());
    }

    // Caret at the focus offset, with an empty-block fallback so it never lands
    // at the viewport origin.
    const geometry = caretGeometry(model.focus, hostRect);
    Object.assign(caret.style, {
      left: `${geometry.left}px`,
      top: `${geometry.top}px`,
      height: `${geometry.height}px`,
      visibility: model.focused ? "visible" : "hidden",
    } satisfies Partial<CSSStyleDeclaration>);
    // Restart the blink only while focused. A pre-painted blinking caret on an
    // unfocused editor reads like a ghost insertion point and confused the
    // Phase 2 story switch/debug flow.
    if (blink && model.focused) blink.currentTime = 0;

    // Feed control bounds for IME placement (docs/010 §7.4).
    editContext.updateControlBounds(hostRect);
    if (hi === lo) {
      editContext.updateSelectionBounds(
        new DOMRect(
          hostRect.left + geometry.left,
          hostRect.top + geometry.top,
          1,
          geometry.height,
        ),
      );
    }

    // Drive the DOM Selection via addRange only (docs/010 §7.4). `addRange` is
    // always forward, so use lo→hi; the model keeps true anchor/focus.
    //
    // Only touch the real Selection when there is an actual (non-collapsed)
    // selection. The caret itself is engine-painted, so a collapsed caret needs
    // no DOM selection — and mutating the Selection on every keystroke blurs the
    // focused editing host (native) / input sink (polyfill), which would drop
    // input. We clear a stale selection on collapse, but only when one exists.
    let usedAddRange = false;
    const selection = doc.defaultView?.getSelection?.() ?? null;
    if (selection && selectionRange) {
      const active = doc.activeElement;
      selection.removeAllRanges();
      selection.addRange(selectionRange);
      usedAddRange = true;
      // Restore focus if setting the selection blurred the editing host/sink —
      // only when it had focus, so we never steal focus on mount.
      if (
        active instanceof HTMLElement &&
        active !== doc.activeElement &&
        host.contains(active)
      ) {
        active.focus({ preventScroll: true });
      }
    } else if (
      selection &&
      selection.rangeCount > 0 &&
      !selection.isCollapsed
    ) {
      selection.removeAllRanges();
    }

    return {
      caretLeft: geometry.left,
      caretTop: geometry.top,
      caretHeight: geometry.height,
      rectCount,
      usedAddRange,
    };
  }

  function destroy(): void {
    blink?.cancel();
    caret.remove();
    rectLayer.remove();
  }

  return { render, destroy };
}
