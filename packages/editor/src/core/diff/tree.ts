/**
 * Block-sequence diff, move detection, and structural recursion (docs/036 §5.4/§5.5, R6-B/R6-D).
 *
 * Why this file exists
 * --------------------
 * The document is a forest addressed by id: `body.order` is the top-level order,
 * and structural nesting is `children` id lists inside a flat `body.blocks` map. A
 * diff of one scope's children is an identity alignment (D1): match by `NodeId`,
 * and a common id whose *order* changed (off the longest-common-subsequence spine)
 * or whose *parent scope* changed is a `moved`, not a delete-plus-insert.
 *
 * The load-bearing invariants, because they are subtle:
 *
 * - **Move detection is LCS-based, never absolute-index-based** (§5.4). Inserting
 *   one block shifts every later index; comparing indices would flag every
 *   following block as moved. Only a common id outside the LCS spine of the two
 *   child-id lists (or one whose parent scope changed) is a move.
 * - **Every node id is emitted exactly once across the whole diff.** A node present
 *   in both snapshots is emitted in its *target* scope (as `moved`/`changed`/
 *   `unchanged`); a base-only node as `removed` in its base scope; a target-only
 *   node as `added` in its target scope. Cross-scope moves are the tricky case: a
 *   node moved from body into a callout is base-only *here* (in body) and
 *   target-only *there* (in the callout). We suppress its `removed` here and emit it
 *   as `moved` there. This holds even when the counterpart scope is inside an
 *   added/removed subtree (`addedSubtree`/`removedSubtree` do the same emit-at-
 *   target-scope walk): a surviving node is *always* a move (D5), never an
 *   add/remove "degrade" — degrading it was what dropped a moved sub-container's
 *   descendants. The added/removed container still *renders* whole (§6.3); that is a
 *   display concern, not a reason to relabel the diff data.
 * - **Merged order** (§5.4): the emitted list is the LCS spine with `removed` and
 *   `added`/`moved` slotted into the gaps between spine anchors. Within one gap a
 *   `removed` and an `added` are paired positionally 1:1 (`replaces`/`replacedBy`)
 *   so the display can show a replacement as one unit; a lone entry is not a pair.
 */
import { attrDiffIsEmpty, diffAttrs } from "./attrs";
import { diffObject } from "./object";
import { diffTextLeaf } from "./text";
import { longestCommonSubsequence } from "./lcs";
import type {
  EditorDocumentSnapshot,
  EditorSnapshotNode,
  NodeId,
  ObjectNode,
  ParentEntry,
  StructuralNode,
  TextLeafNode,
} from "../model";
import type { BlockDiff, ObjectDiffDefinition } from "./types";

/**
 * The sentinel scope id for the top-level body, mirroring the store's `ROOT_NODE_ID`.
 *
 * `buildParentIndex` records top-level nodes under this parent so move detection can
 * treat "the body" as a scope like any container. It is deliberately *not* imported
 * from the store (`core/store`): the diff core stays store-free (D2), so it re-states
 * the same reserved literal. The store excludes this id from every serialized
 * snapshot, so it can never collide with a real body node.
 */
export const BODY_SCOPE_ID: NodeId = "idco_node_root";

/** The base and target snapshots plus their parent indexes and the object-definition resolver, threaded through the recursion. */
export type DiffContext = {
  readonly base: EditorDocumentSnapshot;
  readonly target: EditorDocumentSnapshot;
  readonly baseParents: ReadonlyMap<NodeId, ParentEntry>;
  readonly targetParents: ReadonlyMap<NodeId, ParentEntry>;
  readonly getDefinition?: (type: string) => ObjectDiffDefinition | undefined;
};

/**
 * Walk `order` + `children` once to map every reachable node to its parent scope and index (§5.4).
 *
 * Top-level nodes are recorded under {@link BODY_SCOPE_ID}. A node referenced from
 * a `children` list but absent from `body.blocks` (a dangling ref) is ignored, as
 * is a node present in `blocks` but unreachable from `order`/`children` (an
 * orphan). A duplicate/cyclic reference keeps its first-seen position and is not
 * re-walked, so a malformed snapshot cannot loop.
 */
export function buildParentIndex(
  snapshot: EditorDocumentSnapshot,
): Map<NodeId, ParentEntry> {
  const index = new Map<NodeId, ParentEntry>();
  const visit = (parent: NodeId, children: readonly NodeId[]): void => {
    children.forEach((childId, position) => {
      if (index.has(childId)) return;
      const child = snapshot.body.blocks[childId];
      if (!child) return;
      index.set(childId, { index: position, parent });
      if (child.kind === "structural") visit(childId, child.children);
    });
  };
  visit(BODY_SCOPE_ID, snapshot.body.order);
  return index;
}

/**
 * Diff one scope's children into an ordered `BlockDiff[]` in merged order (§5.4).
 *
 * Called on `body.order` for the top-level scope and recursively on each matched
 * container's `children`. Each id's parent scope and index come from the global
 * parent maps in `ctx` (so cross-scope moves resolve correctly), so the scope
 * itself need not be passed. Classifies each id as added/removed/moved/unchanged/
 * changed, recurses into matched structural containers (§5.5), and interleaves
 * `removed` with `added`/`moved` between the LCS spine anchors.
 */
export function diffScope(
  ctx: DiffContext,
  baseChildren: readonly NodeId[],
  targetChildren: readonly NodeId[],
): BlockDiff[] {
  // Classify by *reachability* (presence in the parent index), not mere presence
  // in the `blocks` map. `buildParentIndex` only records nodes reachable from
  // `order`/`children`, so a dangling ref or an orphan (a block no path reaches) is
  // absent from it. Keying on it drops dangling refs here AND keeps an orphan from
  // being mistaken for a matched node later — a matched node dereferences *both*
  // parent entries in `diffMatched`, so an orphan with no entry would crash the
  // otherwise-total function (its docstring promises no error for any input).
  const baseKids = baseChildren.filter((id) => ctx.baseParents.has(id));
  const targetKids = targetChildren.filter((id) => ctx.targetParents.has(id));
  const baseKidSet = new Set(baseKids);
  const targetKidSet = new Set(targetKids);
  const spineList = longestCommonSubsequence(baseKids, targetKids, (id) => id);

  const result: BlockDiff[] = [];

  const emitGap = (
    baseGap: readonly NodeId[],
    targetGap: readonly NodeId[],
  ) => {
    // Emission rule (the invariant this whole file rests on): a node present in
    // both snapshots is emitted exactly once, at its *target* scope; a base-only
    // node is emitted as `removed` at its base scope. So here:
    //
    // - a base-side id that survived anywhere in the target is skipped — it is
    //   emitted at whichever scope now holds it (this scope's target walk if it
    //   only reordered, or another scope's walk if it moved away). Only an id gone
    //   from the target entirely is a genuine `removed`.
    // - a target-side id that exists anywhere in the base is `moved` (D5: a node in
    //   both at a different (parent,index) is a move, never remove-plus-add — this
    //   holds even when the counterpart scope is inside an added/removed subtree,
    //   which is exactly the case a "degrade to add/remove" rule got wrong and
    //   dropped the moved node's descendants). Only an id absent from the base is
    //   genuinely `added`.
    const removedIds: NodeId[] = [];
    for (const id of baseGap) {
      if (targetKidSet.has(id)) continue; // reordered within this scope → target walk
      if (ctx.targetParents.has(id)) continue; // survived elsewhere → emitted at its target scope
      removedIds.push(id);
    }
    const targetItems: Array<{ id: NodeId; status: "added" | "moved" }> = [];
    for (const id of targetGap) {
      if (baseKidSet.has(id) || ctx.baseParents.has(id)) {
        targetItems.push({ id, status: "moved" });
      } else {
        targetItems.push({ id, status: "added" });
      }
    }
    // Pair removed↔added positionally 1:1 within the gap (§5.4). Moves never pair.
    const addedIds = targetItems
      .filter((item) => item.status === "added")
      .map((item) => item.id);
    const pairs = Math.min(removedIds.length, addedIds.length);
    const replacedByOf = new Map<NodeId, NodeId>();
    const replacesOf = new Map<NodeId, NodeId>();
    for (let p = 0; p < pairs; p += 1) {
      replacedByOf.set(removedIds[p]!, addedIds[p]!);
      replacesOf.set(addedIds[p]!, removedIds[p]!);
    }
    for (const id of removedIds) {
      result.push(buildRemoved(ctx, id, replacedByOf.get(id)));
    }
    for (const item of targetItems) {
      if (item.status === "added") {
        result.push(buildAdded(ctx, item.id, replacesOf.get(item.id)));
      } else {
        result.push(diffMatched(ctx, item.id, true));
      }
    }
  };

  let bi = 0;
  let ti = 0;
  for (let s = 0; s <= spineList.length; s += 1) {
    const anchor = s < spineList.length ? spineList[s]! : null;
    const baseGap: NodeId[] = [];
    while (bi < baseKids.length && baseKids[bi] !== anchor) {
      baseGap.push(baseKids[bi]!);
      bi += 1;
    }
    const targetGap: NodeId[] = [];
    while (ti < targetKids.length && targetKids[ti] !== anchor) {
      targetGap.push(targetKids[ti]!);
      ti += 1;
    }
    emitGap(baseGap, targetGap);
    if (anchor) {
      // An in-order common id (on the spine): a matched, non-moved node.
      result.push(diffMatched(ctx, anchor, false));
      bi += 1;
      ti += 1;
    }
  }
  return result;
}

/** Diff a matched node (present in both snapshots) into a `BlockDiff`, recursing structural children (§5.5). */
function diffMatched(ctx: DiffContext, id: NodeId, moved: boolean): BlockDiff {
  const baseNode = ctx.base.body.blocks[id]!;
  const targetNode = ctx.target.body.blocks[id]!;
  const baseEntry = ctx.baseParents.get(id)!;
  const targetEntry = ctx.targetParents.get(id)!;

  const attrDiff = diffAttrs(baseNode.attrs, targetNode.attrs);
  const attrsChanged = !attrDiffIsEmpty(attrDiff);

  let changed = attrsChanged;
  let text: BlockDiff["text"];
  let object: BlockDiff["object"];
  let children: BlockDiff["children"];

  if (baseNode.kind !== targetNode.kind) {
    // Kind change (a text leaf became an object, etc.): a whole-node change. The
    // renderer fetches the base node by id from `SnapshotDiff.base` to show
    // removed-old over added-new (§5.5); no sub-diff is meaningful across kinds.
    changed = true;
  } else if (targetNode.kind === "text") {
    const baseText = baseNode as TextLeafNode;
    const targetText = targetNode as TextLeafNode;
    const leafDiff = diffTextLeaf(baseText, targetText);
    const contentChanged =
      leafDiff.runs.some((run) => run.op !== "keep") ||
      leafDiff.markChanges.length > 0 ||
      baseText.type !== targetText.type;
    if (contentChanged) changed = true;
    // Attach runs whenever the leaf is `changed` (even if only attrs/type changed)
    // so the display always has a run pass for a changed text leaf (§6.3).
    if (changed) text = leafDiff;
  } else if (targetNode.kind === "object") {
    const objectDiff = diffObject(
      baseNode as ObjectNode,
      targetNode as ObjectNode,
      ctx.getDefinition?.(targetNode.type),
    );
    if (objectDiff.changed) changed = true;
    if (changed) object = objectDiff.object;
  } else {
    const baseStruct = baseNode as StructuralNode;
    const targetStruct = targetNode as StructuralNode;
    const childDiffs = diffScope(
      ctx,
      baseStruct.children,
      targetStruct.children,
    );
    // A container is changed if its child membership/order changed (this also
    // catches a child moved *out*, which the childDiffs alone miss because the
    // moved-out child is emitted in its target scope, not here) or any surviving
    // child changed.
    const membershipChanged = !idListsEqual(
      baseStruct.children.filter((child) => ctx.baseParents.has(child)),
      targetStruct.children.filter((child) => ctx.targetParents.has(child)),
    );
    const descendantChanged = childDiffs.some((d) => d.status !== "unchanged");
    if (membershipChanged || descendantChanged) changed = true;
    // Attach child diffs only when the container itself is changed/moved-and-changed,
    // so an unchanged container renders whole (§6.3) and stays lean.
    if (changed) children = childDiffs;
  }

  const status = moved ? "moved" : changed ? "changed" : "unchanged";
  const alsoChanged = moved && changed;

  return {
    baseIndex: baseEntry.index,
    baseParent: scopeField(baseEntry.parent),
    id,
    node: targetNode,
    status,
    targetIndex: targetEntry.index,
    targetParent: scopeField(targetEntry.parent),
    ...(alsoChanged ? { alsoChanged: true } : {}),
    ...(attrsChanged ? { attrs: attrDiff } : {}),
    ...(text ? { text } : {}),
    ...(object ? { object } : {}),
    ...(children ? { children } : {}),
  };
}

function buildAdded(
  ctx: DiffContext,
  id: NodeId,
  replaces: NodeId | undefined,
): BlockDiff {
  const block = buildAddedNested(ctx, id, new Set([id]));
  return replaces ? { ...block, replaces } : block;
}

function buildAddedNested(
  ctx: DiffContext,
  id: NodeId,
  seen: Set<NodeId>,
): BlockDiff {
  const targetNode = ctx.target.body.blocks[id]!;
  const entry = ctx.targetParents.get(id)!;
  const children = addedSubtree(ctx, targetNode, seen);
  return {
    baseIndex: null,
    baseParent: null,
    id,
    node: targetNode,
    status: "added",
    targetIndex: entry.index,
    targetParent: scopeField(entry.parent),
    ...(children ? { children } : {}),
  };
}

function buildRemoved(
  ctx: DiffContext,
  id: NodeId,
  replacedBy: NodeId | undefined,
): BlockDiff {
  const block = buildRemovedNested(ctx, id, new Set([id]));
  return replacedBy ? { ...block, replacedBy } : block;
}

function buildRemovedNested(
  ctx: DiffContext,
  id: NodeId,
  seen: Set<NodeId>,
): BlockDiff {
  const baseNode = ctx.base.body.blocks[id]!;
  const entry = ctx.baseParents.get(id)!;
  const children = removedSubtree(ctx, baseNode, seen);
  return {
    baseIndex: entry.index,
    baseParent: scopeField(entry.parent),
    id,
    node: baseNode,
    status: "removed",
    targetIndex: null,
    targetParent: null,
    ...(children ? { children } : {}),
  };
}

// An added/removed container's display renders its whole subtree as one unit
// (§6.3 renderBlock — a removed table is one dimmed block, not a struck grid), but
// the *result* must still emit every descendant once, so `stats` counts the real
// magnitude and no id is dropped from `blocks`. The rule mirrors `diffScope`:
//
// - a descendant genuinely new here (absent from the base) is `added` and recurses.
// - a descendant that also exists in the base *moved into* this added container
//   (D5) — e.g. wrapping an existing block in a new callout. It is emitted here (its
//   target scope) as a normal matched `moved`, which recurses its own subtree with
//   the full diff, so a moved container carries its interior instead of dropping it.
//   Its base-side occurrence is skipped by whichever scope holds it in the base.
//
// removedSubtree is the mirror: a base child gone from the target is `removed` and
// recurses; a base child that survived moved away and is emitted at its target scope,
// so it is skipped here. There is no add/remove "degrade" — a surviving node is always
// a move (D5), which is what stops a moved sub-container from losing its descendants.
//
// `seen` carries the ancestor path so a malformed cyclic container (a subtree that
// references an ancestor) cannot spin the recursion — the same defensiveness
// `buildParentIndex` has, honored here because this walk follows raw `children`.
function addedSubtree(
  ctx: DiffContext,
  node: EditorSnapshotNode,
  seen: Set<NodeId>,
): readonly BlockDiff[] | undefined {
  if (node.kind !== "structural") return undefined;
  const kids: BlockDiff[] = [];
  for (const childId of node.children) {
    if (seen.has(childId)) continue; // cycle guard
    if (!ctx.targetParents.has(childId)) continue; // dangling ref / orphan
    seen.add(childId);
    if (ctx.baseParents.has(childId)) {
      // Moved into this added container — a full matched move, subtree and all.
      kids.push(diffMatched(ctx, childId, true));
    } else {
      kids.push(buildAddedNested(ctx, childId, seen));
    }
  }
  return kids.length > 0 ? kids : undefined;
}

function removedSubtree(
  ctx: DiffContext,
  node: EditorSnapshotNode,
  seen: Set<NodeId>,
): readonly BlockDiff[] | undefined {
  if (node.kind !== "structural") return undefined;
  const kids: BlockDiff[] = [];
  for (const childId of node.children) {
    if (seen.has(childId)) continue; // cycle guard
    if (!ctx.baseParents.has(childId)) continue; // dangling ref / orphan
    if (ctx.targetParents.has(childId)) continue; // moved out — emitted at its target scope
    seen.add(childId);
    kids.push(buildRemovedNested(ctx, childId, seen));
  }
  return kids.length > 0 ? kids : undefined;
}

function scopeField(scope: NodeId): NodeId | null {
  return scope === BODY_SCOPE_ID ? null : scope;
}

function idListsEqual(a: readonly NodeId[], b: readonly NodeId[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Recursively tally block statuses across the whole diff tree, for the header summary. */
export function countStats(blocks: readonly BlockDiff[]): {
  added: number;
  removed: number;
  moved: number;
  changed: number;
} {
  let added = 0;
  let removed = 0;
  let moved = 0;
  let changed = 0;
  const walk = (list: readonly BlockDiff[]): void => {
    for (const block of list) {
      // Count each block once by its primary status; a `moved` that also changed
      // counts as moved (its `alsoChanged` flag carries the secondary signal).
      if (block.status === "added") added += 1;
      else if (block.status === "removed") removed += 1;
      else if (block.status === "moved") moved += 1;
      else if (block.status === "changed") changed += 1;
      if (block.children) walk(block.children);
    }
  };
  walk(blocks);
  return { added, changed, moved, removed };
}
