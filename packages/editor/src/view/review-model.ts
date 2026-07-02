/**
 * `ReviewModel` — the merged top-level order + ghost node map the woven inline overlay renders
 * (docs/038 §5, R6-J J0).
 *
 * The load-bearing idea (docs/038 §5): the merged order is *not* a new computation — it is a
 * projection of the already-computed `SnapshotDiff`. `diffSnapshots` emits `diff.blocks` in merged
 * spine order (the LCS spine with added/removed interleaved, docs/036 §5.4), each entry carrying
 * its node and status. So the top-level review order is just `diff.blocks.map(b => b.id)`, and a
 * `"removed"` entry's `node` is the base-side node a `GhostBlock` renders. That order is handed to
 * the virtualizer as `order`, and the render loop mounts a `GhostBlock` for a ghost id and the
 * normal `EngineBlock` for a live id — no second diff, no parallel geometry system.
 *
 * SCOPE (J0): the top-level body scope only. Removed *children* inside a surviving container live
 * in `BlockDiff.children`, not in `diff.blocks`; splicing those into a container's own child
 * assembly is the J2 review-aware recursion (docs/038 §5). J0 proves the mechanism at the top level.
 *
 * @categoryDefault Inline Review
 */
import { useMemo } from "react";
import { diffSnapshots } from "../core";
import type {
  EditorDocumentSnapshot,
  EditorNode,
  EditorStore,
  NodeId,
  SnapshotDiff,
} from "../core";
import { useReviewSnapshot } from "./store-hooks";

/**
 * The woven inline overlay's ReviewModel exports (docs/038 §5). This standalone block is the
 * api-map module header (the file header above precedes elided value imports and is dropped from the
 * emitted `.d.ts`), so it also stops the first real symbol's own doc from being consumed as the
 * header (the `store-hooks.ts` / `diff/types.ts` convention).
 *
 * @categoryDefault Inline Review
 */

/**
 * A merged review order plus the base-side nodes to render as ghosts.
 *
 * `order` is the top-level display order including removed ids at their spine slot; `ghosts` maps a
 * removed id to the base-side `EditorSnapshotNode` a `GhostBlock` renders. Pass both to the editor
 * view (`reviewOrder` / `reviewGhosts`): an id in `ghosts` renders as an inert ghost, every other id
 * renders as its normal live block.
 */
export type ReviewGhostPlan = {
  readonly order: readonly NodeId[];
  readonly ghosts: ReadonlyMap<NodeId, EditorNode>;
};

/**
 * Project a `SnapshotDiff` into the top-level merged order + ghost map — pure, so it is unit-testable
 * without a live editor (docs/038 §5).
 *
 * Walks `diff.blocks` (already in merged spine order) once: every id joins `order`; a `"removed"`
 * entry additionally records its base node in `ghosts`. Live ids (unchanged/changed/moved/added)
 * stay out of `ghosts` and render as normal blocks.
 */
export function buildReviewOrder(diff: SnapshotDiff): ReviewGhostPlan {
  const order: NodeId[] = [];
  const ghosts = new Map<NodeId, EditorNode>();
  for (const block of diff.blocks) {
    order.push(block.id);
    if (block.status === "removed") ghosts.set(block.id, block.node);
  }
  return { order, ghosts };
}

/**
 * Derive the live review plan from a captured `baseline` snapshot — opt-in, so the shipped editor pays nothing.
 *
 * A consumer captures a `baseline` once (load / last save) and calls this to diff it against the live
 * document (`diffSnapshots(baseline, useReviewSnapshot(store))`), memoized so it recomputes only when
 * a commit invalidates the live snapshot. Returns `null` when no baseline is set — the editor then
 * uses its ordinary body order. The `useReviewSnapshot` subscription (a `toSnapshot()` per commit)
 * lives here, in the opt-in caller, so an editor that never reviews carries no review cost.
 *
 * J0 CAVEAT (spike cadence, not the shipped cadence): this runs a FULL `diffSnapshots` (O(nodes +
 * chars)) on every commit while reviewing. The converged design (docs/038 §15, docs/036 §8) calls
 * for an incremental, idle-coalesced re-diff off the keystroke path — that is J1 work; do not mistake
 * this per-commit full diff for the intended review cadence.
 */
export function useReviewGhostPlan(
  store: EditorStore,
  baseline: EditorDocumentSnapshot | null,
): ReviewGhostPlan | null {
  const current = useReviewSnapshot(store);
  return useMemo(() => {
    if (!baseline) return null;
    return buildReviewOrder(diffSnapshots(baseline, current));
  }, [baseline, current]);
}
