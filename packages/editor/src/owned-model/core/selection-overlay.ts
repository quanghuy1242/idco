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

export type SelectionModel = {
  readonly anchor: number;
  readonly focus: number;
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
  readonly editContext: EditContextLike;
};

const SUPPRESS_STYLE_ID = "idco-owned-model-native-selection-suppress";

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
  const { host, textElement, overlayElement, editContext } = options;
  const doc = host.ownerDocument;

  ensureNativeSuppressStyle(doc);

  const caret = doc.createElement("div");
  caret.dataset.ownedCaret = "";
  Object.assign(caret.style, {
    position: "absolute",
    width: "2px",
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

  function textNode(): Text | null {
    const node = textElement.firstChild;
    return node && node.nodeType === Node.TEXT_NODE ? (node as Text) : null;
  }

  function rangeFor(start: number, end: number): Range {
    const node = textNode();
    const range = doc.createRange();
    if (!node) {
      range.selectNodeContents(textElement);
      range.collapse(true);
      return range;
    }
    const max = node.length;
    range.setStart(node, Math.min(Math.max(0, start), max));
    range.setEnd(node, Math.min(Math.max(0, end), max));
    return range;
  }

  function fallbackHeight(): number {
    const computed = doc.defaultView?.getComputedStyle(textElement);
    const lineHeight = Number.parseFloat(computed?.lineHeight ?? "");
    if (Number.isFinite(lineHeight) && lineHeight > 0) return lineHeight;
    const fontSize = Number.parseFloat(computed?.fontSize ?? "");
    return Number.isFinite(fontSize) && fontSize > 0 ? fontSize * 1.2 : 18;
  }

  function caretGeometry(
    offset: number,
    hostRect: DOMRect,
  ): { left: number; top: number; height: number } {
    const rect = rangeFor(offset, offset).getBoundingClientRect();
    const degenerate =
      rect.left === 0 && rect.top === 0 && rect.width === 0 && rect.height === 0;
    if (!degenerate) {
      return {
        left: rect.left - hostRect.left,
        top: rect.top - hostRect.top,
        height: rect.height > 0 ? rect.height : fallbackHeight(),
      };
    }
    // Empty block / no glyph geometry: place the caret at the text element's
    // content origin instead of the bogus (0,0) a collapsed empty range yields.
    const textRect = textElement.getBoundingClientRect();
    return {
      left: Math.max(0, (textRect.left || hostRect.left) - hostRect.left),
      top: Math.max(0, (textRect.top || hostRect.top) - hostRect.top),
      height: fallbackHeight(),
    };
  }

  function render(model: SelectionModel): OverlayRenderInfo {
    const lo = Math.min(model.anchor, model.focus);
    const hi = Math.max(model.anchor, model.focus);
    const hostRect = host.getBoundingClientRect();

    // Selection highlight rects from live geometry.
    rectLayer.replaceChildren();
    let rectCount = 0;
    if (hi > lo) {
      const range = rangeFor(lo, hi);
      for (const rect of Array.from(range.getClientRects())) {
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
      editContext.updateSelectionBounds(range.getBoundingClientRect());
    }

    // Caret at the focus offset, with an empty-block fallback so it never lands
    // at the viewport origin.
    const geometry = caretGeometry(model.focus, hostRect);
    Object.assign(caret.style, {
      left: `${geometry.left}px`,
      top: `${geometry.top}px`,
      height: `${geometry.height}px`,
    } satisfies Partial<CSSStyleDeclaration>);
    // Restart the blink so the caret reads solid immediately after it moves.
    if (blink) blink.currentTime = 0;

    // Feed control bounds for IME placement (docs/010 §7.4).
    editContext.updateControlBounds(hostRect);

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
    if (selection && hi > lo) {
      const active = doc.activeElement;
      selection.removeAllRanges();
      selection.addRange(rangeFor(lo, hi));
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
    } else if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
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
