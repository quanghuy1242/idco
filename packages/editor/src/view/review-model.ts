/**
 * `ReviewModel` — the woven inline overlay's render plan, a pure projection of a `SnapshotDiff`
 * (docs/038 §5, R6-J J0 top-level + J2 in-container).
 *
 * The load-bearing idea (docs/038 §5): the merged order is *not* a new computation — it is a
 * projection of the already-computed `SnapshotDiff`. `diffSnapshots` emits `diff.blocks` in merged
 * spine order (the LCS spine with added/removed interleaved, docs/036 §5.4), recursively (each
 * `BlockDiff` carries `children` — the container's full child list in merged order, tree.ts:249), each
 * entry carrying its node and status. So the review plan is a walk of that tree:
 *
 * - **order** — the top-level merged order (`diff.blocks.map(b => b.id)`), fed to the virtualizer so
 *   removed top-level blocks appear at their old slot. The treap windows this, so top-level ghosts
 *   are virtualized like any block — there is no cost cap at the top level (a grounded correction to
 *   docs/038 §5.1: the top-level region threshold is a UX affordance for a huge rewrite, not a cost
 *   necessity, and rides the review affordance in J4).
 * - **ghosts** — every `"removed"` id (at any depth) → its base-side node, which a `GhostBlock`
 *   renders inert. A removed *container* is one ghost (its base node); its subtree is not individually
 *   ghosted (J2 caveat: the ghost shows a badge, so it under-measures — docs/038 §5.2).
 * - **childOrder** — for a surviving container that has removed children, the merged child order
 *   (`b.children.map(c => c.id)`, live children in target order + removed ghosts spliced at their base
 *   slots). `block-dispatch` maps this instead of `store` children so a removed row/item renders in
 *   place. Set only when there is a ghost to splice; otherwise the live `node.children` already carries
 *   added/moved children in target order.
 * - **collapsed** — the per-container ghost BUDGET (docs/038 §5.1, the one load-bearing escape hatch):
 *   structural containers do NOT internally virtualize (block-dispatch mounts every child), so a
 *   deletion-heavy container would mount every ghost row. Beyond `containerGhostBudget` ghost children,
 *   the surplus is dropped from `childOrder` and the dropped count recorded here (surfaced, not silent —
 *   a consumer/J3 renders the "+N removed" affordance and drill-in). The top level needs no such cap
 *   because it virtualizes.
 *
 * No second diff, no parallel geometry system: the diff is the plan.
 *
 * @categoryDefault Inline Review
 */
import { useMemo } from "react";
import { diffSnapshots } from "../core";
import type {
  BlockDiff,
  EditorDocumentSnapshot,
  EditorNode,
  EditorStore,
  NodeId,
  SnapshotDiff,
  TextLeafDiff,
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
 * Default per-container ghost budget (docs/038 §5.1): the number of removed children a single
 * structural container splices in place before the surplus collapses. Containers do not internally
 * virtualize, so this bounds their mount cost; ~a viewport of rows, matching the D16 region size.
 */
export const DEFAULT_CONTAINER_GHOST_BUDGET = 24;

/** Tuning for {@link buildReviewModel}. */
export type ReviewModelOptions = {
  /** Removed children a container splices before collapsing the surplus (default {@link DEFAULT_CONTAINER_GHOST_BUDGET}). */
  readonly containerGhostBudget?: number;
};

/**
 * The woven overlay's render plan: the merged top-level order, the ghost nodes, the per-container
 * merged child orders, and the collapsed-ghost counts.
 *
 * Pass it to the editor view's `review` prop. An id in `ghosts` renders as an inert `GhostBlock`; a
 * container in `childOrder` maps that merged order instead of its `store` children; every other id
 * renders as its normal live block. `collapsed` maps a container to how many of its removed children
 * were dropped past the budget (for a "+N removed" affordance).
 */
export type ReviewModel = {
  readonly order: readonly NodeId[];
  readonly ghosts: ReadonlyMap<NodeId, EditorNode>;
  readonly childOrder: ReadonlyMap<NodeId, readonly NodeId[]>;
  readonly collapsed: ReadonlyMap<NodeId, number>;
  /**
   * A removed ghost id → the added id that replaces it in the same gap (docs/038 §5.4 `replacedBy`,
   * docs/039 P5). The merged spine already places the ghost directly above its replacement, so the
   * view reads this pairing to render the two as ONE unit — a struck base above its green replacement,
   * grouped, one bar — instead of two unrelated add/remove cards. Empty when nothing was replaced.
   */
  readonly replacements: ReadonlyMap<NodeId, NodeId>;
  /**
   * A live (non-removed) changed text leaf id → its `TextLeafDiff` (docs/039 R-T1, P4c). The woven
   * text decorator (`renderReviewLeafMarks`) reads this to render the leaf as live track-changes:
   * inserted runs washed + underlined (editable store text), deleted runs as inert struck ghosts. A
   * removed leaf is NOT here (it renders whole as a `GhostBlock`); only a surviving edited leaf.
   */
  readonly textDiffs: ReadonlyMap<NodeId, TextLeafDiff>;
};

/**
 * Project a `SnapshotDiff` into the woven render plan — pure, so it is unit-testable without a live
 * editor (docs/038 §5).
 *
 * Walks the diff's merged spine recursively. The top-level scope is virtualized (no ghost cap); a
 * container scope is not, so past `containerGhostBudget` removed children the surplus collapses and
 * the dropped count is recorded in `collapsed` (never silently — see {@link ReviewModel}). A removed
 * subtree is one ghost and is not recursed into (docs/038 §5.2).
 */
export function buildReviewModel(
  diff: SnapshotDiff,
  options?: ReviewModelOptions,
): ReviewModel {
  const budget = Math.max(
    0,
    options?.containerGhostBudget ?? DEFAULT_CONTAINER_GHOST_BUDGET,
  );
  const ghosts = new Map<NodeId, EditorNode>();
  const childOrder = new Map<NodeId, readonly NodeId[]>();
  const collapsed = new Map<NodeId, number>();
  const replacements = new Map<NodeId, NodeId>();
  const textDiffs = new Map<NodeId, TextLeafDiff>();

  // Visit one scope's blocks and return its merged (post-budget) id order plus how many ghosts the
  // budget dropped. `virtualized` is true only for the top-level body scope (the treap windows it, so
  // no cap); a container scope is not internally virtualized, so its ghost children are budget-capped.
  const visitScope = (
    blocks: readonly BlockDiff[],
    virtualized: boolean,
  ): { readonly order: NodeId[]; readonly dropped: number } => {
    const removed = blocks.filter((b) => b.status === "removed");
    // Keep the first `budget` removed children (in merged position); drop the surplus. A removed
    // subtree renders as ONE ghost regardless of its own size, so the budget counts entries, not nodes.
    const keep =
      !virtualized && removed.length > budget
        ? new Set(removed.slice(0, budget).map((b) => b.id))
        : null;
    let dropped = 0;
    const order: NodeId[] = [];
    for (const b of blocks) {
      if (b.status === "removed") {
        if (keep && !keep.has(b.id)) {
          dropped += 1;
          continue;
        }
        ghosts.set(b.id, b.node);
        order.push(b.id);
        // A removed block that was replaced in its gap (docs/038 §5.4) pairs with its replacement so
        // the view renders the struck base + green replacement as one unit (docs/039 P5). The spine
        // already stacks them; this records the pairing the renderer groups on.
        if (b.replacedBy) replacements.set(b.id, b.replacedBy);
        // A removed subtree is one ghost (its base node) — do not recurse into it.
        continue;
      }
      order.push(b.id);
      // A surviving changed text leaf carries its `TextLeafDiff` for the woven track-changes decorator
      // (docs/039 R-T1). A removed leaf is handled above (a whole ghost), so it never lands here.
      if (b.text) textDiffs.set(b.id, b.text);
      if (b.children && b.children.length > 0) {
        if (isTableFamily(b.node.type)) {
          // J2 does NOT weave ghosts inside a table. A `GhostBlock` is a `<div>`, which is invalid
          // content for `<table>`/`<tbody>`/`<tr>` (the browser hoists it out of the grid), and a
          // faithful `<tr>`/`<td>` ghost with table-aware styling is J3. So render the table's live
          // children only (no `childOrder` override) and record the count of removed descendants — a
          // deleted row, or a deleted column's cells across surviving rows — in `collapsed`, surfaced
          // for J3's affordance rather than silently lost or spliced as invalid markup. The table
          // still survives as a live block; only its removed *contents* are deferred.
          const deferred = countRemovedDeep(b.children);
          if (deferred > 0) collapsed.set(b.id, deferred);
        } else {
          const inner = visitScope(b.children, false);
          // Override the container's child assembly only when it has a ghost to splice; otherwise the
          // live `node.children` already carries added/moved children in target order.
          if (b.children.some((c) => c.status === "removed")) {
            childOrder.set(b.id, inner.order);
          }
          if (inner.dropped > 0) collapsed.set(b.id, inner.dropped);
        }
      }
    }
    return { dropped, order };
  };

  const top = visitScope(diff.blocks, true);
  return {
    childOrder,
    collapsed,
    ghosts,
    order: top.order,
    replacements,
    textDiffs,
  };
}

/**
 * Table-family container types (docs/021 §8.1): their editing render emits real `<table>`/`<tr>`/
 * `<td>`, so a `<div>` ghost child is invalid there. J2 gates these out of the in-container splice;
 * faithful `<tr>`/`<td>` ghosts are J3.
 */
const TABLE_FAMILY: ReadonlySet<string> = new Set([
  "table",
  "tablerow",
  "tablecell",
]);
function isTableFamily(type: string): boolean {
  return TABLE_FAMILY.has(type);
}

/**
 * Count removed nodes anywhere under `blocks`, treating a removed subtree as ONE (it is not recursed
 * into — it is a single ghost). Used to surface how much a table defers to J3 (a deleted row counts
 * once; a deleted column counts each removed cell across the surviving rows).
 */
function countRemovedDeep(blocks: readonly BlockDiff[]): number {
  let n = 0;
  for (const b of blocks) {
    if (b.status === "removed") {
      n += 1;
      continue;
    }
    if (b.children) n += countRemovedDeep(b.children);
  }
  return n;
}

/**
 * Derive the live review model from a captured `baseline` snapshot — opt-in, so the shipped editor pays nothing.
 *
 * A consumer captures a `baseline` once (load / last save, or a proposal's pre-apply state) and calls
 * this to diff it against the live document (`diffSnapshots(baseline, useReviewSnapshot(store))`),
 * memoized so it recomputes only when a commit invalidates the live snapshot. Returns `null` when no
 * baseline is set — the editor then uses its ordinary body order. The `useReviewSnapshot` subscription
 * (a `toSnapshot()` per commit) lives here, in the opt-in caller, so an editor that never reviews
 * carries no review cost.
 *
 * CADENCE CAVEAT (not the shipped cadence): this runs a FULL `diffSnapshots` (O(nodes + chars)) on
 * every commit while reviewing. That is fine for the read-only woven surface (the reviewer is not
 * editing into the proposal yet); the incremental, idle-coalesced re-diff off the keystroke path
 * (docs/036 §8) is coupled to editing-DURING-review and lands with the optimistic-apply plumbing in
 * J6 — do not mistake this per-commit full diff for the final review cadence.
 */
export function useReviewModel(
  store: EditorStore,
  baseline: EditorDocumentSnapshot | null,
  options?: ReviewModelOptions,
): ReviewModel | null {
  const current = useReviewSnapshot(store);
  const budget = options?.containerGhostBudget;
  return useMemo(() => {
    if (!baseline) return null;
    return buildReviewModel(
      diffSnapshots(baseline, current),
      budget === undefined ? undefined : { containerGhostBudget: budget },
    );
  }, [baseline, current, budget]);
}
