/**
 * Model-owned selection painting and a11y announcement (docs/017 §3.1).
 *
 * The model owns *what* is selected; this module paints it. It computes
 * overlay rects from the mounted leaves' DOM geometry (docs/010 §7.4), renders
 * the caret/selection/preedit bars, feeds IME bounds back to the active
 * EditContext (Phase 7 AC4), and announces selection changes to assistive tech
 * (Phase 7 AC3). It reads the store and geometry by parameter; only the two
 * components hold React state.
 */
import { useRef, useState, type RefObject } from "react";
import {
  orderedTextLeaves,
  type EditorStore,
  type EngineScheduler,
  type NodeId,
  type TextLeafNode,
} from "../core";
import {
  characterClientRects,
  makeRect,
  robustCaretRect,
  textRangeClientRects,
  toDomRect,
} from "./geometry";
import { useSelectionFrameVersion } from "./store-hooks";
import {
  CARET_BLINK_KEYFRAMES,
  ENGINE_SURFACE_SUPPRESS_CSS,
  ENGINE_TYPOGRAPHY_CSS,
  visuallyHiddenStyle,
} from "./styles";
import type { EditContextLike, RenderRegistry, SerializedRect } from "./types";

type OverlayRect = {
  readonly height: number;
  readonly kind: "caret" | "range" | "preedit";
  readonly left: number;
  readonly node: NodeId;
  readonly top: number;
  readonly width: number;
};

export function selectionRects(
  store: EditorStore,
  root: HTMLElement | null,
  blockRefs: ReadonlyMap<NodeId, HTMLElement>,
): readonly OverlayRect[] {
  if (!root || store.selection?.type !== "text") return [];
  const selection = store.selection;
  const rootRect = root.getBoundingClientRect();
  /*
   * Index endpoints through the same document-order text-leaf walk the
   * clipboard serializer uses (docs/011 §8.5/§13.9), not the top-level body
   * order. That keeps nested leaves (a list item's text) paintable and skips
   * object/structural blocks, which carry no text range to paint. Only mounted
   * leaves produce rects, so offscreen middles are never painted (§8.5).
   */
  const leaves = orderedTextLeaves(store);
  const indexOf = new Map(leaves.map((leaf, index) => [leaf.id, index]));
  const anchorIndex = indexOf.get(selection.anchor.node);
  const focusIndex = indexOf.get(selection.focus.node);
  if (anchorIndex === undefined || focusIndex === undefined) return [];
  const forward =
    anchorIndex < focusIndex ||
    (anchorIndex === focusIndex &&
      selection.anchor.offset <= selection.focus.offset);
  const start = forward ? selection.anchor : selection.focus;
  const end = forward ? selection.focus : selection.anchor;
  const startIndex = Math.min(anchorIndex, focusIndex);
  const endIndex = Math.max(anchorIndex, focusIndex);
  const collapsed =
    selection.anchor.node === selection.focus.node &&
    selection.anchor.offset === selection.focus.offset;
  const rects: OverlayRect[] = [];
  if (collapsed) {
    const leaf = leaves[focusIndex]!;
    const element = blockRefs.get(leaf.id);
    if (element) {
      rects.push(
        ...caretRectsFromRange(
          element,
          rootRect,
          leaf.id,
          selection.focus.offset,
          leaf.node.content.text.length,
        ),
      );
    }
  } else {
    for (let index = startIndex; index <= endIndex; index += 1) {
      const leaf = leaves[index]!;
      const element = blockRefs.get(leaf.id);
      if (!element) continue;
      const length = leaf.node.content.text.length;
      const from = leaf.id === start.node ? start.offset : 0;
      const to = leaf.id === end.node ? end.offset : length;
      rects.push(
        ...rangeRectsFromText(element, rootRect, leaf.id, from, to, length),
      );
    }
  }
  // Engine-painted IME preedit underline (docs/010 Phase 7 AC5). A fully owned
  // view gets no browser-drawn composition mark, so paint a thin bar under each
  // line fragment of the composition range on the active (mounted) leaf.
  const composition = store.composition;
  if (composition) {
    const element = blockRefs.get(composition.node);
    if (element) {
      rects.push(
        ...preeditRectsFromText(
          element,
          rootRect,
          composition.node,
          composition.from,
          composition.to,
        ),
      );
    }
  }
  return rects;
}

function preeditRectsFromText(
  element: HTMLElement,
  rootRect: DOMRect,
  node: NodeId,
  from: number,
  to: number,
): readonly OverlayRect[] {
  // A ~2px underline at the bottom of each line fragment of the preedit range.
  const UNDERLINE = 2;
  return textRangeClientRects(element, from, to).map((rect) => ({
    height: UNDERLINE,
    kind: "preedit" as const,
    left: rect.left - rootRect.left,
    node,
    top: rect.bottom - rootRect.top - UNDERLINE,
    width: rect.width,
  }));
}

function caretRectsFromRange(
  element: HTMLElement,
  rootRect: DOMRect,
  node: NodeId,
  offset: number,
  textLength: number,
): readonly OverlayRect[] {
  // A single-line caret rect, robust at soft-break and end-of-block boundaries
  // (a plain collapsed Range yields nothing there). Never the block box.
  const rect = robustCaretRect(element, offset);
  if (rect && rect.height > 0) {
    // The line box includes leading above/below the glyphs; a caret that tall
    // looks heavy next to a native one. Inset it and center it in the line so
    // it reads like a real insertion bar (mirrors the spike's caret metrics).
    const lineHeight = Math.max(14, rect.height);
    const caretHeight = Math.round(lineHeight * 0.82);
    return [
      {
        height: caretHeight,
        kind: "caret",
        left: rect.left - rootRect.left,
        node,
        top: rect.top - rootRect.top + (lineHeight - caretHeight) / 2,
        width: 1.5,
      },
    ];
  }
  return [fallbackCaretRect(element, rootRect, node, offset, textLength)];
}

function rangeRectsFromText(
  element: HTMLElement,
  rootRect: DOMRect,
  node: NodeId,
  from: number,
  to: number,
  textLength: number,
): readonly OverlayRect[] {
  const rects = textRangeClientRects(element, from, to);
  if (rects.length > 0) {
    return rects.map((rect) => ({
      height: Math.max(1, rect.height),
      kind: "range",
      left: rect.left - rootRect.left,
      node,
      top: rect.top - rootRect.top,
      width: Math.max(1, rect.width),
    }));
  }
  return [fallbackRangeRect(element, rootRect, node, from, to, textLength)];
}

function fallbackCaretRect(
  element: HTMLElement,
  rootRect: DOMRect,
  node: NodeId,
  offset: number,
  textLength: number,
): OverlayRect {
  const rect = element.getBoundingClientRect();
  const usableWidth = Math.max(1, rect.width - 24);
  return {
    height: Math.max(18, rect.height - 10),
    kind: "caret",
    left:
      rect.left -
      rootRect.left +
      12 +
      (usableWidth * offset) / Math.max(1, textLength),
    node,
    top: rect.top - rootRect.top + 5,
    width: 2,
  };
}

function fallbackRangeRect(
  element: HTMLElement,
  rootRect: DOMRect,
  node: NodeId,
  from: number,
  to: number,
  textLength: number,
): OverlayRect {
  const rect = element.getBoundingClientRect();
  const usableWidth = Math.max(1, rect.width - 16);
  const width =
    from === 0 && to === textLength
      ? usableWidth
      : Math.max(
          1,
          (usableWidth * Math.max(1, to - from)) / Math.max(1, textLength),
        );
  return {
    height: Math.max(18, rect.height - 10),
    kind: "range",
    left:
      rect.left -
      rootRect.left +
      8 +
      (usableWidth * from) / Math.max(1, textLength),
    node,
    top: rect.top - rootRect.top + 5,
    width,
  };
}

export function SelectionOverlay(props: {
  readonly store: EditorStore;
  readonly scheduler: EngineScheduler;
  readonly rootRef: RefObject<HTMLElement | null>;
  readonly registry: RenderRegistry;
}) {
  const { store, scheduler, rootRef, registry } = props;
  const version = useSelectionFrameVersion(store, scheduler);
  void version;
  const rects = selectionRects(store, rootRef.current, registry.blockRefs);
  registry.selectionOverlayRenderCount += 1;
  registry.selectionRectCount = rects.filter(
    (rect) => rect.kind !== "preedit",
  ).length;
  // Feed IME bounds for the active leaf each frame (docs/010 §7.4, Phase 7 AC4),
  // so the OS candidate window follows the caret/selection after edits.
  feedImeBounds(rootRef.current, store, registry);
  return (
    <div
      aria-hidden="true"
      data-engine-preedit-count={
        rects.filter((rect) => rect.kind === "preedit").length
      }
      data-engine-selection-overlay=""
      data-engine-selection-rect-count={registry.selectionRectCount}
      style={{
        inset: 0,
        pointerEvents: "none",
        position: "absolute",
      }}
    >
      <style>
        {CARET_BLINK_KEYFRAMES +
          ENGINE_SURFACE_SUPPRESS_CSS +
          ENGINE_TYPOGRAPHY_CSS}
      </style>
      {rects.map((rect, index) => {
        const isCaret = rect.kind === "caret";
        const isPreedit = rect.kind === "preedit";
        return (
          <div
            data-engine-caret={isCaret ? "" : undefined}
            data-engine-preedit={isPreedit ? "" : undefined}
            data-engine-selection-rect={isPreedit ? undefined : ""}
            // Keying a caret by its pixel position recreates the element when it
            // moves, restarting the blink so it shows solid right after a move,
            // the way a native insertion bar does (mirrors the spike).
            key={
              isCaret
                ? `caret-${Math.round(rect.left)}-${Math.round(rect.top)}`
                : `${rect.kind}-${rect.node}-${index}`
            }
            style={{
              animation: isCaret
                ? "idco-caret-blink 1.06s step-end infinite"
                : undefined,
              background: isCaret
                ? "CanvasText"
                : isPreedit
                  ? "CanvasText"
                  : "color-mix(in srgb, Highlight 36%, transparent)",
              borderRadius: isCaret ? 1 : isPreedit ? 0 : 3,
              height: rect.height,
              left: rect.left,
              position: "absolute",
              top: rect.top,
              // The caret must snap, not slide; a global `transition: all` would
              // otherwise animate its position and make it look laggy.
              transition: "none",
              width: rect.width,
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * A polite live region that announces model selection changes to assistive tech
 * (docs/010 Phase 7 AC3, docs/011 §8.7). A non-`contenteditable` surface gets no
 * announcements for free, so the engine owns them. It dedupes on the message and
 * announces caret moves only when the focused block changes, so a run of arrow
 * keys does not flood the screen reader.
 */
export function SelectionAnnouncer(props: {
  readonly store: EditorStore;
  readonly scheduler: EngineScheduler;
}) {
  const { store, scheduler } = props;
  const version = useSelectionFrameVersion(store, scheduler);
  void version;
  const lastNodeRef = useRef<NodeId | null>(null);
  const [message, setMessage] = useState("");
  const next = selectionAnnouncement(store, lastNodeRef);
  if (next !== null && next !== message) setMessage(next);
  return (
    <div
      aria-live="polite"
      data-engine-a11y-announcer=""
      role="status"
      style={visuallyHiddenStyle}
    >
      {message}
    </div>
  );
}

/**
 * Build the announcement for the current selection, or null to leave the live
 * region unchanged (the caret moved within the same block — no announcement, to
 * avoid flooding).
 */
function selectionAnnouncement(
  store: EditorStore,
  lastNodeRef: { current: NodeId | null },
): string | null {
  const selection = store.selection;
  if (!selection) {
    lastNodeRef.current = null;
    return null;
  }
  if (selection.type === "node") {
    lastNodeRef.current = null;
    const node = store.getNode(selection.node);
    return `${node?.type ?? "object"} selected`;
  }
  if (selection.type === "gap") {
    lastNodeRef.current = null;
    return "Caret between blocks";
  }
  const { anchor, focus } = selection;
  const collapsed =
    anchor.node === focus.node && anchor.offset === focus.offset;
  if (!collapsed) {
    lastNodeRef.current = null;
    if (anchor.node === focus.node) {
      const count = Math.abs(focus.offset - anchor.offset);
      return `${count} character${count === 1 ? "" : "s"} selected`;
    }
    return "Selection spanning multiple blocks";
  }
  // Collapsed caret: announce only when it enters a different block.
  if (focus.node === lastNodeRef.current) return null;
  lastNodeRef.current = focus.node;
  const node = store.getNode(focus.node);
  return node && node.kind === "text" ? ariaLabelForLeaf(node) : null;
}

/**
 * Feed `updateControlBounds`/`updateSelectionBounds` (and character bounds while
 * composing) for the active leaf's EditContext (docs/010 §7.4, Phase 7 AC4).
 * Bounds are viewport-space, so the OS candidate window follows the caret across
 * scroll and relayout. The last fed bounds are recorded for diagnostics.
 */
export function feedImeBounds(
  root: HTMLElement | null,
  store: EditorStore,
  registry: RenderRegistry,
): void {
  if (!root) return;
  // While a pointer drag is autoscrolling, feeding bounds would re-home the
  // focused polyfill textarea to the caret and the browser would scroll it back
  // into view, fighting the drag autoscroll. IME bounds are not needed mid-drag.
  if (registry.dragging) return;
  const selection = store.selection;
  const activeId =
    store.activeTextLeafId ??
    (selection?.type === "text" ? selection.focus.node : null);
  if (!activeId) return;
  const host = registry.blockRefs.get(activeId);
  if (!host) return;
  const editContext = (host as { editContext?: EditContextLike | null })
    .editContext;
  if (!editContext) return;
  const hostRect = host.getBoundingClientRect();
  editContext.updateControlBounds?.(toDomRect(hostRect));
  const focusOffset =
    selection?.type === "text" && selection.focus.node === activeId
      ? selection.focus.offset
      : 0;
  const caret = robustCaretRect(host, focusOffset) ?? hostRect;
  // Native `EditContext` requires a real `DOMRect` here (not a plain rect-shaped
  // object), or it throws and the overlay error-boundary unmounts the caret. The
  // polyfill accepts either, which is why this only bit the Chromium native path.
  const selectionRect = toDomRect(
    makeRect(caret.left, caret.top, Math.max(1, caret.width), caret.height),
  );
  editContext.updateSelectionBounds?.(selectionRect);
  const composition = store.composition;
  let characterRects: DOMRect[] = [];
  if (composition && composition.node === activeId) {
    characterRects = characterClientRects(
      host,
      composition.from,
      composition.to,
    );
    editContext.updateCharacterBounds?.(composition.from, characterRects);
  }
  registry.imeBounds = {
    characterCount: characterRects.length,
    control: serializeRect(hostRect),
    firstCharacter: characterRects[0] ? serializeRect(characterRects[0]) : null,
    selection: serializeRect(selectionRect),
  };
}

function serializeRect(rect: DOMRect): SerializedRect {
  return {
    height: rect.height,
    left: rect.left,
    top: rect.top,
    width: rect.width,
  };
}

/** A screen-reader label for a text leaf: its role plus a short text preview. */
export function ariaLabelForLeaf(node: TextLeafNode): string {
  const role =
    node.type === "heading"
      ? "Heading"
      : node.type === "listitem"
        ? "List item"
        : node.type === "quote"
          ? "Quote"
          : node.type === "callout"
            ? "Callout"
            : "Paragraph";
  const preview = node.content.text.trim().slice(0, 40);
  return preview ? `${role}: ${preview}` : `${role}, empty`;
}
