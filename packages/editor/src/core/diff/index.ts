/**
 * Public barrel for the framework-free snapshot diff engine (docs/036 §5, R6-A…E).
 *
 * `diffSnapshots(base, target)` is the headline: one pure function producing one
 * structured `SnapshotDiff` that the diff view, the inline overlay, the
 * suggested-edits review, and out-of-process agents all read. The sub-diff
 * primitives and the alignment/attr helpers are exported for advanced callers and
 * the engine's own tests; the result-shape types carry the whole contract.
 *
 * Keep this surface free of DOM, React, and store code (D2): the diff is a
 * model/format concern, unit-testable without a renderer.
 */
export { diffSnapshots } from "./diff-snapshots";
export { blockDiffIndex } from "./index-blocks";
export {
  BODY_SCOPE_ID,
  buildParentIndex,
  countStats,
  type DiffContext,
  diffScope,
} from "./tree";
export { attrDiffIsEmpty, diffAttrs, jsonEqual } from "./attrs";
export { diffTextLeaf } from "./text";
export { diffMarks } from "./marks";
export { diffObject, type ObjectDiffResult } from "./object";
export {
  diffSequences,
  longestCommonSubsequence,
  type SequenceOp,
} from "./lcs";
export type {
  AttrDiff,
  BlockDiff,
  BlockStatus,
  CollectionDiff,
  DiffOptions,
  DiffStats,
  MarkChange,
  ObjectDiff,
  ObjectDiffDefinition,
  ObjectFieldChange,
  SnapshotDiff,
  TextLeafDiff,
  TextRunDiff,
} from "./types";
