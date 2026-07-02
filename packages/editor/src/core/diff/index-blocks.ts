/**
 * `blockDiffIndex` — an id → `BlockDiff` index over the recursive diff tree (docs/039 §11, P5).
 *
 * `SnapshotDiff.blocks` is a recursive spine (each `BlockDiff` carries `children`), so finding the
 * diff for a NESTED element — a re-colored table cell, an object whose field changed — means walking
 * the tree. The woven overlay does that on every ring click and every band open (docs/039 §7.6, §7.7),
 * so it wants O(1). This builds a flat `Map<NodeId, BlockDiff>` once per diff; the woven layer then
 * resolves `blockDiffIndex(diff).get(id)` to render the per-element chip or to project the one-block
 * `scopedDiff` the inline band feeds to `<DiffView>`. Pure and framework-free — no store, no DOM.
 *
 * Every id is emitted once by the engine (`docs/036 §5.1`), so the map has no collisions; a removed
 * container is one entry (its subtree is not recursed by the engine on the removed side beyond what it
 * already emitted, and this index simply walks whatever `children` the diff carries).
 *
 * @categoryDefault Engine Core — Model
 */
import type { NodeId } from "../model";
import type { BlockDiff, SnapshotDiff } from "./types";

/**
 * @categoryDefault Engine Core — Model
 */

/**
 * Build a flat `NodeId → BlockDiff` index over a diff's recursive `blocks` tree (docs/039 §11).
 *
 * Walks every `BlockDiff` and its `children`, so a nested change (a cell, a list item, an object)
 * resolves in O(1). Used by the woven overlay's ring affordance and its inline-expand band to find
 * the sub-diff for the element under the cursor without re-walking the tree each time.
 */
export function blockDiffIndex(
  diff: Pick<SnapshotDiff, "blocks">,
): Map<NodeId, BlockDiff> {
  const index = new Map<NodeId, BlockDiff>();
  const walk = (blocks: readonly BlockDiff[]) => {
    for (const block of blocks) {
      index.set(block.id, block);
      if (block.children && block.children.length > 0) walk(block.children);
    }
  };
  walk(diff.blocks);
  return index;
}
