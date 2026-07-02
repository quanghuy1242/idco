/**
 * `GhostBlock` — the inert render of a REMOVED block during inline review (docs/038 §4–§5, R6-J J0).
 *
 * Why this is a distinct branch, not `QuarantineBlock`
 * ---------------------------------------------------
 * During review the live document is the *proposed / current* side, so a **removed** block is not
 * in the store — the removal exists only on the diff's **base** side. `EngineBlock` resolves its
 * node from the store and returns `null` for an absent id (`block-dispatch.tsx:61`), so it can never
 * render a removal. The ReviewModel (docs/038 §5) instead resolves a removed id to its base-side
 * `EditorNode` and mounts it through this branch. It is deliberately NOT the
 * `QuarantineBlock` seam: that renders a store-*present* node whose schema group is disallowed; a
 * ghost is a store-*absent* node carried by the diff. (The first-draft docs/036 §6.2 claimed the
 * quarantine seam; it cannot host an absent node — corrected here and in docs/038.)
 *
 * The one load-bearing detail
 * ---------------------------
 * It emits `data-engine-block-id={node.id}` and registers through `registerBlock`, exactly as every
 * live block does (`block-dispatch.tsx`). That single attribute is what lets the whole existing
 * `[data-engine-block-id]` stack treat a ghost like any block for free:
 *   - `geometry.ts` resolves its viewport rect (`el.closest("[data-engine-block-id]")`);
 *   - the `ResizeObserver` in `use-virtual-window.ts` measures it and caches its height by id — and
 *     estimator calibration is skipped for it, because `store.getNode(ghostId)` is `null`
 *     (`use-virtual-window.ts` guards `if (node)`), so a ghost never poisons the live estimator;
 *   - the offset model virtualizes it in place at its `baseIndex` slot.
 *
 * Inert by construction (the "ghosts are widgets, not text" rule, docs/038 §3): `contentEditable`
 * is false, pointer + selection are off, and it is `aria-hidden`, so the caret skips it and no
 * per-block EditContext ever binds to it — which is what keeps splicing ghosts around the focused
 * block from tearing that block's EditContext host (the J0 no-tear proof).
 *
 * SCOPE: a removed leaf shows its base text struck through; a removed object/container shows a
 * labelled band (a removed container is ONE ghost — its subtree is not individually ghosted, so it
 * under-measures its old height, docs/038 §5.2). Removed-*child* recursion inside a surviving
 * container is done as of J2 — `block-dispatch` splices this branch into a container's merged child
 * assembly via `ReviewRenderContext`, so a removed row/item/cell renders in place — this component is
 * unchanged by that; it renders one node wherever the dispatch mounts it. Faithful reader-parity
 * ghost content (a removed image showing its figure, a removed code block its source) is the J3
 * refinement; J2's point is that a ghost renders, measures, and virtualizes at any depth in the flow.
 */
import type { CSSProperties } from "react";
import type { EditorNode, NodeId } from "../../core";

const GHOST_BOX: CSSProperties = {
  background:
    "color-mix(in oklab, var(--color-error, #dc2626) 8%, transparent)",
  borderInlineStart: "3px solid var(--color-error, #dc2626)",
  borderRadius: "0.25rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.15rem",
  opacity: 0.75,
  // Vertical spacing lives in PADDING, not margin (docs/038 §5.2, R6-J J2): the ResizeObserver reads
  // `borderBoxSize`, which excludes margin, so a margined ghost would leak ~8px/ghost from the treap's
  // aggregate total (a cosmetic scrollbar drift that compounds with many ghosts). Padding is inside
  // the border box, so the treap measures the ghost's full footprint; the trade is that consecutive
  // ghosts read as one contiguous removed band rather than separate rounded chips, which is if
  // anything clearer for a removed region.
  padding: "0.65rem 0.75rem",
  // Inert: the caret cannot enter and no text selection lands here, so the block
  // reads as an atomic widget (docs/038 §3). Position is relative to match the
  // base block box so geometry reads a stable rect.
  pointerEvents: "none",
  position: "relative",
  userSelect: "none",
};

const GHOST_BADGE: CSSProperties = {
  color: "var(--color-error, #dc2626)",
  fontSize: "0.7rem",
  fontWeight: 600,
  letterSpacing: "0.03em",
  lineHeight: 1.2,
  textTransform: "uppercase",
};

const GHOST_TEXT: CSSProperties = {
  opacity: 0.85,
  textDecoration: "line-through",
};

/** The plain text a removed block shows struck; empty for a node with no own text (object/container). */
function ghostText(node: EditorNode): string {
  return node.kind === "text" ? node.content.text : "";
}

export function GhostBlock(props: {
  readonly node: EditorNode;
  readonly registerBlock: (id: NodeId, element: HTMLElement | null) => void;
}) {
  const { node, registerBlock } = props;
  const text = ghostText(node);
  return (
    <div
      aria-hidden="true"
      contentEditable={false}
      data-engine-block-id={node.id}
      data-engine-ghost={node.type}
      ref={(element) => registerBlock(node.id, element)}
      style={GHOST_BOX}
    >
      <span style={GHOST_BADGE}>removed {node.type}</span>
      {text ? <span style={GHOST_TEXT}>{text}</span> : null}
    </div>
  );
}
