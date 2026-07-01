/**
 * `diffSnapshots` — the one pure entry point that assembles the full structured diff (docs/036 §5, D2/D3, R6-E).
 *
 * Why this file exists
 * --------------------
 * This is the public face of the diff engine: a framework-free
 * `diffSnapshots(base, target, options?)` that returns one JSON-serializable
 * `SnapshotDiff` every consumer reads — the diff view, the inline overlay, the
 * suggested-edits review, a text report, an out-of-process agent (docs/037). It
 * depends only on `core/model` and the sibling diff modules; no DOM, no React, no
 * store, so it runs in the editor, the reader, a worker, or a headless script (D2).
 *
 * It composes the pieces: the body block-sequence diff (`tree.ts`, which recurses
 * into containers, text leaves, and objects), the document-settings attr diff, and
 * the per-key collection diff, then tallies the block stats for a header summary.
 */
import type {
  CollectionItem,
  EditorDocumentSnapshot,
  JsonValue,
} from "../model";
import { attrDiffIsEmpty, diffAttrs, jsonEqual } from "./attrs";
import {
  buildParentIndex,
  countStats,
  type DiffContext,
  diffScope,
} from "./tree";
import type { CollectionDiff, DiffOptions, SnapshotDiff } from "./types";

/**
 * @categoryDefault Engine Core — Model
 */

/**
 * Compute the structured diff between two document snapshots (§5.1, D3).
 *
 * Matches blocks by `NodeId`, characters by `CharacterId`, and marks by `mark.id`,
 * so a move reads as a move and a re-flowed sentence as a minimal edit rather than
 * the delete-plus-insert noise a text diff produces (D1). Pass
 * `options.getNodeDefinition` to enable object field-level detail through the
 * `diffData` seam (§5.6); without it object changes report at block granularity.
 * Pure and total for any two snapshots — unrelated documents degrade to the
 * per-leaf text-alignment fallback (§5.2), never an error.
 *
 * Precondition: a snapshot must not contain a block whose id is the reserved body
 * sentinel `idco_node_root` (the store's `ROOT_NODE_ID`). Store-produced snapshots
 * never do — `toSnapshot()` excludes the root — so this only constrains hand-built
 * input; such a block would be conflated with the body scope by the parent index.
 *
 * @example
 * const diff = diffSnapshots(baseSnapshot, targetSnapshot);
 * console.log(diff.stats); // { added, removed, moved, changed }
 */
export function diffSnapshots(
  base: EditorDocumentSnapshot,
  target: EditorDocumentSnapshot,
  options?: DiffOptions,
): SnapshotDiff {
  const ctx: DiffContext = {
    base,
    baseParents: buildParentIndex(base),
    getDefinition: options?.getNodeDefinition,
    target,
    targetParents: buildParentIndex(target),
  };
  const blocks = diffScope(ctx, base.body.order, target.body.order);
  const settingsDetail = diffAttrs(base.settings, target.settings);
  const settingsChanged = !attrDiffIsEmpty(settingsDetail);
  const collections = diffCollections(base.collections, target.collections);
  const stats = countStats(blocks);
  return {
    base,
    blocks,
    collections,
    settingsChanged,
    stats,
    target,
    ...(settingsChanged ? { settingsDetail } : {}),
  };
}

/**
 * Diff every document-owned collection by `item.id` (§5.6).
 *
 * Only keys with at least one change appear in the result — a diff is a change
 * list, so an unchanged collection is omitted rather than reported as an empty
 * diff. `changed` names ids present on both sides whose item body differs.
 */
function diffCollections(
  base: EditorDocumentSnapshot["collections"],
  target: EditorDocumentSnapshot["collections"],
): CollectionDiff[] {
  const baseC = base ?? {};
  const targetC = target ?? {};
  const keys = new Set([...Object.keys(baseC), ...Object.keys(targetC)]);
  const result: CollectionDiff[] = [];
  for (const key of [...keys].sort()) {
    const baseItems = baseC[key] ?? [];
    const targetItems = targetC[key] ?? [];
    const baseById = new Map<string, CollectionItem>(
      baseItems.map((item) => [item.id, item]),
    );
    const targetIds = new Set(targetItems.map((item) => item.id));
    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];
    for (const item of targetItems) {
      const before = baseById.get(item.id);
      if (!before) {
        added.push(item.id);
      } else if (!jsonEqual(item as JsonValue, before as JsonValue)) {
        changed.push(item.id);
      }
    }
    for (const item of baseItems) {
      if (!targetIds.has(item.id)) removed.push(item.id);
    }
    if (added.length > 0 || removed.length > 0 || changed.length > 0) {
      result.push({ added, changed, key, removed });
    }
  }
  return result;
}
