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
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  childrenOf,
  pointAtOffset,
  type EditorStore,
  type EngineScheduler,
  type GapSelection,
  type NodeId,
  type TextLeafNode,
} from "../../core";
import { blockTypeRole } from "../spi";
import { gapMarkerRect } from "./gap-cursor";
import { getNodeView } from "../spi";
import { getStructuralView } from "../spi";
import {
  characterClientRects,
  makeRect,
  robustCaretRect,
  textRangeClientRects,
  toDomRect,
} from "./geometry";
import { requestFrame } from "../raf";
import { useSelectionFrameVersion } from "../store-hooks";
import {
  CARET_BLINK_KEYFRAMES,
  ENGINE_OBJECT_CHROME_CSS,
  ENGINE_SURFACE_SUPPRESS_CSS,
  ENGINE_TYPOGRAPHY_CSS,
  RICH_TEXT_TYPOGRAPHY_CSS,
  visuallyHiddenStyle,
} from "../styles";
import type { EditContextLike, RenderRegistry, SerializedRect } from "../types";

/**
 * The empty-document placeholder hint and the single block allowed to host it
 * (R2, note.md §5.8). The view computes it from `order` (the slot is the sole text
 * block of an empty doc); the overlay decides visibility per frame from the live
 * model, so it is immune to the typing fast path that patches the leaf DOM out of
 * band (the reason the hint is painted here, in the overlay, and NOT as a child of
 * the EditContext host where `patchHostText` would wipe it — note.md §5.8 redo).
 */
export type EditorPlaceholder = {
  readonly text: string;
  readonly targetId: NodeId | null;
};

type OverlayRect = {
  readonly height: number;
  readonly kind: "caret" | "range" | "preedit" | "gap";
  readonly left: number;
  readonly node: NodeId;
  readonly top: number;
  readonly width: number;
  /** Ink for a caret/gap when it sits in a colored cell — the painted caret is
   *  not a native one, so CSS `caret-color` cannot reach it; we color it here to
   *  match the cell's auto-contrast text (docs/022 §7). Undefined → `CanvasText`. */
  readonly color?: string;
};

export function selectionRects(
  store: EditorStore,
  root: HTMLElement | null,
  blockRefs: ReadonlyMap<NodeId, HTMLElement>,
): readonly OverlayRect[] {
  if (!root) return [];
  // A gap cursor paints a horizontal insertion marker between block-level
  // children of its scope (docs/019 §4.9/§5.8) — never a vertical I-beam.
  if (store.selection?.type === "gap") {
    const rect = gapOverlayRect(store, store.selection, root, blockRefs);
    if (!rect) return [];
    const color = caretInkFor(store, store.selection.scope);
    return [color ? { ...rect, color } : rect];
  }
  if (store.selection?.type !== "text") return [];
  const selection = store.selection;
  const rootRect = root.getBoundingClientRect();
  const { anchor, focus } = selection;
  const collapsed =
    anchor.node === focus.node && anchor.offset === focus.offset;
  const rects: OverlayRect[] = [];
  if (collapsed) {
    /*
     * A collapsed caret needs only its own leaf — never a document walk. The old
     * path built a `Map` of *every* text leaf in the document to find one index,
     * so every keystroke/arrow paid O(total leaves). The focus leaf is mounted
     * iff it has a blockRef; an offscreen caret paints nothing (§8.5).
     */
    const leaf = store.getNode(focus.node);
    const element = blockRefs.get(focus.node);
    if (leaf?.kind === "text" && element) {
      const color = caretInkFor(store, focus.node);
      rects.push(
        ...caretRectsFromRange(
          element,
          rootRect,
          focus.node,
          focus.offset,
          leaf.content.text.length,
        ).map((rect) => (color ? { ...rect, color } : rect)),
      );
    }
  } else {
    /*
     * Range: order the two endpoints with the model's O(depth) comparator, then
     * paint only the *mounted* text leaves that fall inside [start, end]. We walk
     * the mounted `blockRefs` (bounded by the viewport window + overscan), never
     * the whole document — so a selection across a virtualized gap stays cheap to
     * repaint per drag frame and the offscreen middle is held by the model, not
     * painted (docs/011 §8.5). This is what kept drag selection from lagging on a
     * book-scale document, where the old per-frame full walk blew the frame budget.
     */
    let forward = true;
    try {
      forward = store.comparePoints(anchor, focus) <= 0;
    } catch {
      forward = true;
    }
    const start = forward ? anchor : focus;
    const end = forward ? focus : anchor;
    for (const [id, element] of blockRefs) {
      const leaf = store.getNode(id);
      if (!leaf || leaf.kind !== "text") continue;
      const length = leaf.content.text.length;
      // Endpoint leaves are always in range; an interior leaf is kept only if it
      // sorts at/after `start` and at/before `end` in model order.
      if (id !== start.node && id !== end.node) {
        const at = pointAtOffset(id, leaf.content, 0);
        let inRange = false;
        try {
          inRange =
            store.comparePoints(at, start) >= 0 &&
            store.comparePoints(at, end) <= 0;
        } catch {
          inRange = false;
        }
        if (!inRange) continue;
      }
      const from = id === start.node ? start.offset : 0;
      const to = id === end.node ? end.offset : length;
      rects.push(
        ...rangeRectsFromText(element, rootRect, id, from, to, length),
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

/**
 * The caret/gap ink for a position, or undefined → the theme's `CanvasText`. The
 * engine paints its own caret, so CSS `caret-color` never reaches it; instead the
 * overlay walks from `nodeId` up its ancestors and asks each node's registered
 * view for a `caretInk` contribution (the object `NodeView` or the
 * `StructuralNodeView`), taking the first that returns one. This keeps the
 * overlay free of any per-type knowledge — a table cell maps its `backgroundColor`
 * to a readable ink in its own view, and any custom node can do the same without
 * touching this file (docs/021 §10, docs/022 §7).
 */
function caretInkFor(store: EditorStore, nodeId: NodeId): string | undefined {
  let id: NodeId | undefined = nodeId;
  const seen = new Set<NodeId>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const node = store.getNode(id);
    if (node?.kind === "structural") {
      const ink = getStructuralView(node.type)?.caretInk?.(node);
      if (ink) return ink;
    } else if (node?.kind === "object") {
      const ink = getNodeView(node.type)?.caretInk?.(node);
      if (ink) return ink;
    }
    id = store.parentEntry(id)?.parent;
  }
  return undefined;
}

/**
 * The horizontal gap-cursor marker for a `{scope, index}` gap (docs/019 §4.9).
 * It is anchored to the mounted rects of the children flanking the slot and
 * spans their block width, inset to the scope's content box; at a doc/scope edge
 * it pins to the scope top/bottom. Returns null when neither flanking child is
 * mounted (an offscreen gap paints nothing, like an offscreen caret §8.5).
 */
function gapOverlayRect(
  store: EditorStore,
  selection: GapSelection,
  root: HTMLElement,
  blockRefs: ReadonlyMap<NodeId, HTMLElement>,
): OverlayRect | null {
  const children = childrenOf(store, selection.scope);
  const prevId =
    selection.index > 0 ? children[selection.index - 1] : undefined;
  const nextId =
    selection.index < children.length ? children[selection.index] : undefined;
  const prevEl = prevId ? blockRefs.get(prevId) : undefined;
  const nextEl = nextId ? blockRefs.get(nextId) : undefined;
  // A non-empty scope whose flanking blocks are both offscreen: nothing to pin
  // to. An empty scope (no children) still paints, pinned to the scope box.
  if (children.length > 0 && !prevEl && !nextEl) return null;
  const scopeEl =
    selection.scope === store.bodyId
      ? root
      : (blockRefs.get(selection.scope) ?? root);
  const rootRect = root.getBoundingClientRect();
  const scopeRect = scopeEl.getBoundingClientRect();
  const prevRect = prevEl?.getBoundingClientRect() ?? null;
  const nextRect = nextEl?.getBoundingClientRect() ?? null;
  const anchorRect = prevRect ?? nextRect;
  const style = scopeEl.ownerDocument.defaultView?.getComputedStyle(scopeEl);
  const padLeft = style ? parseFloat(style.paddingLeft) || 0 : 0;
  const padRight = style ? parseFloat(style.paddingRight) || 0 : 0;
  const padTop = style ? parseFloat(style.paddingTop) || 0 : 0;
  const padBottom = style ? parseFloat(style.paddingBottom) || 0 : 0;
  // Span the flanking block's width when known (so the marker lines up with the
  // prose column), else the scope's padded content box.
  const left = anchorRect ? anchorRect.left : scopeRect.left + padLeft;
  const right = anchorRect ? anchorRect.right : scopeRect.right - padRight;
  const marker = gapMarkerRect({
    height: 2,
    nextTop: nextRect?.top ?? null,
    prevBottom: prevRect?.bottom ?? null,
    scopeBottom: scopeRect.bottom - padBottom,
    scopeLeft: left,
    scopeRight: right,
    scopeTop: scopeRect.top + padTop,
  });
  return {
    height: marker.height,
    kind: "gap",
    left: marker.left - rootRect.left,
    node: nextId ?? prevId ?? selection.scope,
    top: marker.top - rootRect.top,
    width: marker.width,
  };
}

/**
 * Where to paint the empty-document placeholder, or null (R2, note.md §5.8 redo).
 * Shows only while the slot block is mounted AND its LIVE model text is empty — so
 * it disappears the instant a character lands in the model (the typing fast path
 * patches the DOM and skip-notifies the leaf, but it always updates the model, so
 * reading the model here is correct where reading the leaf DOM would be stale). The
 * position is the block's text origin (its own left/top padding), in `root`-
 * relative coordinates so it lines up with where the caret paints. Returns the
 * block's content width as `maxWidth` so a long hint wraps inside the column.
 */
function placeholderHintRect(
  store: EditorStore,
  placeholder: EditorPlaceholder | null,
  root: HTMLElement | null,
  blockRefs: ReadonlyMap<NodeId, HTMLElement>,
): { left: number; top: number; maxWidth: number; text: string } | null {
  if (!placeholder?.text || !placeholder.targetId || !root) return null;
  const node = store.getNode(placeholder.targetId);
  if (!node || node.kind !== "text" || node.content.text.length > 0)
    return null;
  const el = blockRefs.get(placeholder.targetId);
  if (!el) return null;
  const rootRect = root.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  const padLeft = style ? parseFloat(style.paddingLeft) || 0 : 0;
  const padRight = style ? parseFloat(style.paddingRight) || 0 : 0;
  const padTop = style ? parseFloat(style.paddingTop) || 0 : 0;
  return {
    left: elRect.left - rootRect.left + padLeft,
    maxWidth: Math.max(0, elRect.width - padLeft - padRight),
    text: placeholder.text,
    top: elRect.top - rootRect.top + padTop,
  };
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

/**
 * Whether DOM focus is currently within the editor surface (a text leaf, or the
 * root when a gap is selected) AND the window itself has focus. Tracks focusin/
 * focusout on the document and window focus/blur so the caret hides on a tab/app
 * switch too. The polyfill patches `document.activeElement` to the host element,
 * so `root.contains(activeElement)` holds on both the native and polyfill paths.
 */
function useEditorFocusWithin(rootRef: RefObject<HTMLElement | null>): boolean {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const doc = root.ownerDocument;
    const win = doc.defaultView ?? window;
    const compute = () => {
      const active = doc.activeElement;
      const within = !!active && (active === root || root.contains(active));
      setFocused(within && doc.hasFocus());
    };
    // focusout fires before focus settles on the next target; read on the next
    // frame so `activeElement` reflects where focus actually went (or `body`).
    const onFocusOut = () => requestFrame(compute);
    compute();
    doc.addEventListener("focusin", compute, true);
    doc.addEventListener("focusout", onFocusOut, true);
    win.addEventListener("focus", compute);
    win.addEventListener("blur", compute);
    return () => {
      doc.removeEventListener("focusin", compute, true);
      doc.removeEventListener("focusout", onFocusOut, true);
      win.removeEventListener("focus", compute);
      win.removeEventListener("blur", compute);
    };
  }, [rootRef]);
  return focused;
}

export function SelectionOverlay(props: {
  readonly store: EditorStore;
  readonly scheduler: EngineScheduler;
  readonly rootRef: RefObject<HTMLElement | null>;
  /**
   * The focusable surface container, for the focus-within gate. It differs from
   * `rootRef` on the virtualized path: there the overlay is anchored to the inner
   * *content* div (`rootRef`) for correct geometry, but focus lives on the OUTER
   * scroller root — and a gap selection focuses that scroller root
   * (`focusRoot`), which is the content div's PARENT, not a descendant. Checking
   * `rootRef` (the content div) would then report "not focused" and filter the gap
   * cursor out (the "horizontal caret invisible under virtualization" bug, note.md
   * §5.3 follow-up). Defaults to `rootRef` for the non-virtualized path, where the
   * scroller root and the geometry anchor are the same element.
   */
  readonly focusRootRef?: RefObject<HTMLElement | null>;
  /** Empty-document placeholder hint, painted here (not in the leaf) so the typing
   *  fast path cannot wipe it; visibility is decided per frame from the model. */
  readonly placeholder?: EditorPlaceholder | null;
  readonly registry: RenderRegistry;
}) {
  const { store, scheduler, rootRef, focusRootRef, placeholder, registry } =
    props;
  const version = useSelectionFrameVersion(store, scheduler);
  void version;
  // The block refs register during commit — AFTER this overlay's first render read
  // an empty registry — so the empty-document placeholder (which needs the slot
  // block's mounted rect) cannot compute on the first paint, and nothing else
  // re-renders the overlay until the first interaction. Bump once post-mount to
  // re-render with the registry populated, so the hint shows on load rather than
  // only after a click (note.md §5.8 second follow-up). The selection frame version
  // covers every change after that; pre-paint (layout effect) so the hint does not
  // flash in.
  const [, setMountTick] = useState(0);
  useLayoutEffect(() => setMountTick(1), []);
  // The caret/gap is an *insertion* affordance: it must only show while the
  // editor actually holds focus. Painting it on a blurred surface (the previous
  // behavior) is misleading — it implies typing lands there when it does not,
  // and it hid focus-loss bugs. We hide the caret/gap (not the range highlight)
  // whenever focus leaves the editor subtree or the window itself (docs/019).
  // The gate checks the OUTER scroller root (`focusRootRef`), which contains both a
  // focused text leaf AND the scroller root a gap selection focuses — so a gap
  // cursor paints under virtualization where checking the content div would not.
  const focused = useEditorFocusWithin(focusRootRef ?? rootRef);
  const allRects = selectionRects(store, rootRef.current, registry.blockRefs);
  const rects = focused
    ? allRects
    : allRects.filter((rect) => rect.kind !== "caret" && rect.kind !== "gap");
  registry.selectionOverlayRenderCount += 1;
  registry.selectionRectCount = rects.filter(
    (rect) => rect.kind !== "preedit",
  ).length;
  // The empty-document placeholder, decided per frame from the live model (R2,
  // note.md §5.8 redo): show only while the slot block exists and is empty. Reading
  // the model — not the leaf DOM — is what makes it immune to the typing fast path
  // (which patches the host out of band and skip-notifies the leaf).
  const placeholderHint = placeholderHintRect(
    store,
    placeholder ?? null,
    rootRef.current,
    registry.blockRefs,
  );
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
          // The reader's `.rt-*` typography contract (docs/015 §4.3): the single source of
          // prose appearance, so the live editable host and the reader render identically.
          RICH_TEXT_TYPOGRAPHY_CSS +
          ENGINE_TYPOGRAPHY_CSS +
          ENGINE_OBJECT_CHROME_CSS}
      </style>
      {placeholderHint ? (
        // Painted in the overlay, at the slot block's text origin, in a NEUTRAL
        // muted style — it deliberately does NOT wear the block's typography class,
        // so an empty heading block shows a normal-weight hint rather than a huge
        // bold one (note.md §5.8 redo, the author's "placeholder picks up the h1
        // style" report). Non-interactive, so clicks fall through to the surface.
        <div
          data-engine-placeholder=""
          style={{
            color: "var(--color-base-content, CanvasText)",
            left: placeholderHint.left,
            maxWidth: placeholderHint.maxWidth,
            opacity: 0.4,
            position: "absolute",
            top: placeholderHint.top,
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
        >
          {placeholderHint.text}
        </div>
      ) : null}
      {rects.map((rect, index) => {
        const isCaret = rect.kind === "caret";
        const isPreedit = rect.kind === "preedit";
        const isGap = rect.kind === "gap";
        // The gap marker blinks like a caret (a transient, materialize-on-keystroke
        // affordance) and is the horizontal insertion bar §5.8 — same ink as the
        // caret (`CanvasText`) so it reads as one cursor system, just laid flat.
        const blink = isCaret || isGap;
        return (
          <div
            data-engine-caret={isCaret ? "" : undefined}
            data-engine-gap-cursor={isGap ? "" : undefined}
            data-engine-preedit={isPreedit ? "" : undefined}
            data-engine-selection-rect={isPreedit ? undefined : ""}
            // Keying a caret/gap by its pixel position recreates the element when
            // it moves, restarting the blink so it shows solid right after a move,
            // the way a native insertion bar does (mirrors the spike).
            key={
              blink
                ? `${rect.kind}-${Math.round(rect.left)}-${Math.round(rect.top)}`
                : `${rect.kind}-${rect.node}-${index}`
            }
            style={{
              animation: blink
                ? "idco-caret-blink 1.06s step-end infinite"
                : undefined,
              background:
                isCaret || isGap
                  ? (rect.color ?? "CanvasText")
                  : isPreedit
                    ? "CanvasText"
                    : "color-mix(in srgb, Highlight 36%, transparent)",
              borderRadius: isCaret ? 1 : isGap ? 2 : isPreedit ? 0 : 3,
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
  const role = blockTypeRole(node.type);
  const preview = node.content.text.trim().slice(0, 40);
  return preview ? `${role}: ${preview}` : `${role}, empty`;
}
