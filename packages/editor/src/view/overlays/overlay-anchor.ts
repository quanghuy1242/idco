/**
 * Overlay anchor resolver (docs/029 §7.4/§8.2, R1-C) — the DOM half of the positioning
 * solve. It turns an {@link AnchorRef} (a model-space anchor: a selection, a caret, a cell,
 * a block, a mark, a point) into a viewport rect, which `overlay-positioning.ts` then lays
 * out. This is the single place overlay anchors are derived, replacing each surface
 * re-scavenging its own rect with `caretClientRect`/`getBoundingClientRect`/`elementFromPoint`
 * (docs/029 §3.2). It belongs in `overlays/` because it is DOM geometry, beside the existing
 * `geometry.ts` primitives it reuses.
 *
 * Virtualized re-anchor (docs/025): when the anchored block is mounted, its real DOM rect is
 * used; when it has scrolled off the virtual window (unmounted), the rect is *estimated*
 * from the shared `OffsetModel` prefix — the same offset-model fallback `revealBlock`/
 * `scrollToBlock` use — so an overlay anchored to an off-window block still resolves to a
 * sane position instead of vanishing. The estimate is split into the pure
 * {@link estimateBlockRect} so it is unit-testable without a layout engine (jsdom returns
 * zero rects for everything).
 */
import type { EditorStore, NodeId } from "../../core";
import type { OffsetModel } from "../../core/offset-model";
import type { AnchorRef } from "../spi/anchor-target";
import type { RectLike } from "../spi/overlay-positioning";
import { caretClientRect } from "./geometry";

/**
 * The scroller geometry the off-window estimate needs, captured as a plain bag so the
 * estimate is pure and testable: the scroller's viewport-space top/left and its current
 * `scrollTop` (content scrolled past the top). A block's estimated viewport top is
 * `scroller.top + (model.prefix(index) - scroller.scrollTop)`.
 */
export type ScrollerGeometry = {
  readonly top: number;
  readonly left: number;
  readonly scrollTop: number;
};

/** Options for {@link resolveAnchorRect}; all optional so a bare call uses the live DOM. */
export type AnchorResolveOptions = {
  /** The document to query (defaults to the global `document`). */
  readonly doc?: Document;
  /** The shared offset model, for estimating an off-window block/cell anchor. */
  readonly offsetModel?: OffsetModel | null;
  /** The scroller geometry paired with `offsetModel` for the estimate. */
  readonly scroller?: ScrollerGeometry | null;
};

/** A plain `RectLike` from a DOMRect (drops the DOMRect identity so the result is serializable). */
function toRectLike(rect: DOMRect): RectLike {
  return {
    height: rect.height,
    left: rect.left,
    top: rect.top,
    width: rect.width,
  };
}

/** Whether a rect carries no measurable geometry (jsdom, unmounted, or pre-paint). */
function isDegenerate(rect: RectLike | null): boolean {
  return !rect || (rect.width <= 0 && rect.height <= 0);
}

/**
 * Estimate a block's viewport rect from the offset model when it is not mounted (docs/025).
 * Pure: depends only on the model, the document order, and the scroller bag — no DOM — so
 * the virtualized re-anchor path is deterministically unit-tested. Returns null when the
 * block is not in the order.
 */
export function estimateBlockRect(
  model: OffsetModel,
  order: readonly NodeId[],
  scroller: ScrollerGeometry,
  blockId: NodeId,
): RectLike | null {
  const index = order.indexOf(blockId);
  if (index < 0) return null;
  const topInContent = model.prefix(index);
  const height = Math.max(1, model.prefix(index + 1) - topInContent);
  return {
    height,
    left: scroller.left,
    top: scroller.top + (topInContent - scroller.scrollTop),
    width: 0,
  };
}

/** The viewport rect of the selection's start caret (start-biased, docs/024 §9), or null. */
function selectionStartRect(
  store: EditorStore,
  doc: Document,
): RectLike | null {
  const sel = store.selection;
  if (sel?.type !== "text") return null;
  let start = sel.anchor;
  try {
    if (store.comparePoints(sel.anchor, sel.focus) > 0) start = sel.focus;
  } catch {
    start = sel.anchor;
  }
  const el = doc.querySelector<HTMLElement>(
    `[data-engine-block-id="${start.node}"]`,
  );
  const rect = el ? caretClientRect(el, start.offset) : null;
  return rect ? toRectLike(rect) : null;
}

/** The viewport rect of the collapsed caret, or null. */
function caretRect(store: EditorStore, doc: Document): RectLike | null {
  const sel = store.selection;
  if (sel?.type !== "text") return null;
  const el = doc.querySelector<HTMLElement>(
    `[data-engine-block-id="${sel.focus.node}"]`,
  );
  const rect = el ? caretClientRect(el, sel.focus.offset) : null;
  return rect ? toRectLike(rect) : null;
}

/** The viewport rect of a mounted element by block id, with offset-model fallback. */
function blockRect(
  store: EditorStore,
  doc: Document,
  blockId: NodeId,
  opts: AnchorResolveOptions,
): RectLike | null {
  const el = doc.querySelector<HTMLElement>(
    `[data-engine-block-id="${blockId}"]`,
  );
  const rect = el ? toRectLike(el.getBoundingClientRect()) : null;
  if (!isDegenerate(rect)) return rect;
  // Off the virtual window (or no layout): estimate from the offset model (docs/025).
  if (opts.offsetModel && opts.scroller) {
    return estimateBlockRect(
      opts.offsetModel,
      store.order,
      opts.scroller,
      blockId,
    );
  }
  return rect;
}

/** The viewport rect of a mark element by its mark id, or null. */
function markRect(doc: Document, markId: string): RectLike | null {
  const el = doc.querySelector<HTMLElement>(
    `[data-engine-mark-id="${markId}"]`,
  );
  return el ? toRectLike(el.getBoundingClientRect()) : null;
}

/**
 * Resolve an {@link AnchorRef} to a viewport rect (docs/029 §7.4). Returns null when the
 * anchor cannot be resolved (no selection of the right shape, an unmounted block with no
 * offset model, a missing element) so the authority can drop the envelope for the frame
 * rather than position it at the origin.
 */
export function resolveAnchorRect(
  store: EditorStore,
  anchor: AnchorRef,
  opts: AnchorResolveOptions = {},
): RectLike | null {
  const doc =
    opts.doc ?? (typeof document !== "undefined" ? document : undefined);
  if (!doc) return null;
  switch (anchor.kind) {
    case "selection":
      return selectionStartRect(store, doc);
    case "caret":
      return caretRect(store, doc);
    case "cell":
      // A cell action popover anchors to its trigger affordance — the hovered `…` button at the
      // cell's top-right — not the cell's origin, so it drops from where the user pressed. The
      // opener passes the button's live screen point as `at`; absent it, fall back to the cell's
      // model rect (which, start-biased, would otherwise place the panel at the cell's far edge).
      return anchor.at
        ? { height: 0, left: anchor.at.x, top: anchor.at.y, width: 0 }
        : blockRect(store, doc, anchor.cellId, opts);
    case "block":
      return blockRect(store, doc, anchor.blockId, opts);
    case "mark":
      return markRect(doc, anchor.markId);
    case "point":
      return { height: 0, left: anchor.x, top: anchor.y, width: 0 };
  }
}
