/**
 * The review render context (docs/038 §4–§5, R6-J J2) — how `EngineBlock` learns it is rendering
 * inside a review.
 *
 * J0 short-circuited ghosts in the react-view TOP-LEVEL render loop, which cannot reach a removed
 * *child* inside a surviving container (that is not in the top-level order). J2 moves the decision
 * into `EngineBlock` via this context, so the SAME ghost-aware dispatch runs at the top level and
 * inside every container's child assembly (`block-dispatch.tsx`), with no second render path:
 *
 * - `ghosts` — a removed id (any depth) → its base node; `EngineBlock` renders it as an inert
 *   `GhostBlock` instead of resolving it from the store (which would return null for an absent id).
 * - `childOrder` — a reviewed container id → its merged child order (live children + removed ghosts
 *   spliced at their base slots, already capped to the per-container budget so the render mounts at
 *   most `budget` ghosts); `block-dispatch` maps this instead of `node.children`.
 *
 * The budget's *dropped count* lives on {@link ReviewModel}.`collapsed` (unit-tested) but is not in
 * this render context: J2 only needs to BOUND the cost (which the capped `childOrder` already does);
 * surfacing the "+N removed" affordance in the DOM is J3's passive layer (the generalized R6-I
 * `data-*`-by-id mechanism, uniform across registry and default containers). `null` (the shipped
 * default) means "not reviewing" — every lookup is skipped and the render is the ordinary editor.
 *
 * @categoryDefault Inline Review
 */
import { createContext, useContext } from "react";
import type { EditorNode, NodeId, TextLeafDiff } from "../../core";

/** The per-block review lookups `EngineBlock`/`block-dispatch` consult while a review is active. */
export type ReviewRender = {
  readonly ghosts: ReadonlyMap<NodeId, EditorNode>;
  readonly childOrder: ReadonlyMap<NodeId, readonly NodeId[]>;
  /**
   * A live changed text leaf id → its `TextLeafDiff` (docs/039 R-T1): `block-dispatch` passes it to the
   * leaf so it renders live track-changes (inserted runs decorated, deleted runs as inert ghosts)
   * instead of plain text. Absent for an unchanged leaf, which renders normally.
   */
  readonly textDiffs: ReadonlyMap<NodeId, TextLeafDiff>;
};

/** Null outside a review (the shipped path); set by the view while a `ReviewModel` is active. */
export const ReviewRenderContext = createContext<ReviewRender | null>(null);

/** Read the active review render lookups, or `null` when not reviewing. */
export function useReviewRender(): ReviewRender | null {
  return useContext(ReviewRenderContext);
}
