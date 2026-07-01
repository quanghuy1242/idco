/**
 * The diff-view's reader-local mirror of the engine's `SnapshotDiff` result (docs/036 §5.1).
 *
 * Why a mirror and not an import. The diff engine (`diffSnapshots`) lives in
 * `packages/editor/src/core/diff`, and the **editor depends on the reader, not the reverse**
 * (`../reader/model.ts` explains the same constraint for the resolution kernel) — the reader
 * sits below the editor in the package graph, so importing the editor's `SnapshotDiff` would
 * be a circular package dependency. So, exactly as `../reader/types.ts` mirrors
 * `EditorDocumentSnapshot` with wide payloads, the shapes below mirror the engine's diff
 * result: `NodeId`/`ClientId` widen to `string`, `JsonValue` to `unknown`, `TextMarkKind` to
 * `string`. Because they are structural *supertypes* of the engine's readonly types, the
 * output of `diffSnapshots(base, target)` is assignable to `ReaderSnapshotDiff` with **no
 * cast** — a host computes the diff with the editor and passes it straight into `<DiffView>`.
 *
 * These are types only, no logic, so they add nothing to the server-safe graph.
 *
 * @categoryDefault Diff View
 */
import type { ReaderAttrs, ReaderBlockNode, ReaderSnapshot } from "../reader";

/**
 * @categoryDefault Diff View
 */

/**
 * The status of one block across the two compared snapshots (mirror of the engine's `BlockStatus`).
 *
 * `"moved"` is an identity signal — a common id whose order among the surviving blocks
 * changed, or whose parent scope changed — not any index shift from a neighbouring insert or
 * delete; a `"moved"` block may also have changed content (`ReaderBlockDiff.alsoChanged`).
 */
export type ReaderDiffBlockStatus =
  | "unchanged"
  | "added"
  | "removed"
  | "moved"
  | "changed";

/**
 * One coalesced run of characters inside a changed text leaf, sharing a single op (§5.2).
 *
 * `keep` renders plain, `insert` an additive tint, `delete` a subtractive tint plus
 * strikethrough (§6.3 Tier 1). `ids` (the run's character ids) is present on the identity
 * path and drives suggested-edit attribution later; the diff view does not read it.
 */
export type ReaderTextRunDiff = {
  readonly op: "keep" | "insert" | "delete";
  readonly text: string;
  readonly ids?: readonly {
    readonly client: string;
    readonly clock: number;
  }[];
};

/**
 * One mark added, removed, or changed on a text leaf, matched by `mark.id` (§5.3).
 *
 * Offsets are in the target leaf's coordinate space, except a `"removed"` mark, whose offsets
 * are in the base leaf's space. The diff view overlays a dotted underline on the covered runs
 * so a mark-only change is visible even when every run is `keep`.
 */
export type ReaderMarkChange = {
  readonly op: "added" | "removed" | "changed";
  readonly kind: string;
  readonly from: number;
  readonly to: number;
  readonly attrs?: ReaderAttrs;
};

/**
 * The character- and mark-level diff of one changed text leaf (§5.2, §5.3).
 *
 * `alignment` is `"id"` on the identity path and `"text"` when the leaves shared no character
 * ids and the diff fell back to a heuristic character LCS (§5.2) — the view badges the fallback.
 * `runs` covers the union of both sides in target-then-deleted order.
 */
export type ReaderTextLeafDiff = {
  readonly alignment: "id" | "text";
  readonly runs: readonly ReaderTextRunDiff[];
  readonly markChanges: readonly ReaderMarkChange[];
};

/** The added, removed, and changed keys between two attribute bags (node attrs or settings). */
export type ReaderAttrDiff = {
  readonly added: ReaderAttrs;
  readonly removed: ReaderAttrs;
  readonly changed: Readonly<
    Record<string, { readonly base: unknown; readonly target: unknown }>
  >;
};

/** One field-level change inside an object node's opaque data, from the `diffData` seam (§5.6). */
export type ReaderObjectFieldChange = {
  readonly path: string;
  readonly base: unknown;
  readonly target: unknown;
};

/** The diff of one object node: whether its lifecycle status changed, plus optional field detail. */
export type ReaderObjectDiff = {
  readonly statusChanged: boolean;
  readonly fields?: readonly ReaderObjectFieldChange[];
};

/** The diff of one document-owned collection (glossary, bibliography, …), by `item.id` (§5.6). */
export type ReaderCollectionDiff = {
  readonly key: string;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
};

/** Aggregate block-level counts across the whole diff, for the header summary ("+12 −3, 2 moved"). */
export type ReaderDiffStats = {
  readonly added: number;
  readonly removed: number;
  readonly moved: number;
  readonly changed: number;
};

/**
 * One block's entry in a scope diff: its status, its position on each side, and its payload sub-diffs (§5.1).
 *
 * Emitted exactly once per node id across the whole diff (a matched node in its target scope,
 * a base-only node as `removed`, a target-only node as `added`). `baseIndex`/`baseParent` and
 * `targetIndex`/`targetParent` recover either original order and drive the side-by-side rows
 * and the "moved from ¶N" note. `children` is the recursive diff of a structural container; a
 * changed container decorates only its changed descendants (§5.5).
 */
export type ReaderBlockDiff = {
  readonly id: string;
  readonly status: ReaderDiffBlockStatus;
  readonly alsoChanged?: boolean;
  readonly baseIndex: number | null;
  readonly targetIndex: number | null;
  readonly baseParent: string | null;
  readonly targetParent: string | null;
  readonly node: ReaderBlockNode;
  readonly attrs?: ReaderAttrDiff;
  readonly text?: ReaderTextLeafDiff;
  readonly object?: ReaderObjectDiff;
  readonly children?: readonly ReaderBlockDiff[];
  readonly replacedBy?: string;
  readonly replaces?: string;
};

/**
 * The full structured diff of two document snapshots — the one result `<DiffView>` renders (§5.1, D3).
 *
 * A structural supertype of the engine's `SnapshotDiff`, so `diffSnapshots(base, target)`
 * passes straight in. `base`/`target` are carried so the view can resolve a matched id whose
 * kind changed and render either side; `blocks` is the top-level (body) diff in merged order.
 */
export type ReaderSnapshotDiff = {
  readonly base: ReaderSnapshot;
  readonly target: ReaderSnapshot;
  readonly blocks: readonly ReaderBlockDiff[];
  readonly settingsChanged: boolean;
  readonly settingsDetail?: ReaderAttrDiff;
  readonly collections: readonly ReaderCollectionDiff[];
  readonly stats: ReaderDiffStats;
};

/** The two diff-view layouts (§6.1): `"unified"` (one column, the default) or `"side-by-side"`. */
export type DiffViewMode = "unified" | "side-by-side";
