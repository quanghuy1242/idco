/**
 * Structured result vocabulary for `diffSnapshots` (docs/036 §5.1).
 *
 * Why this file exists
 * --------------------
 * The diff engine (docs/036 R6-A…E) separates *what changed* from *how it looks*
 * (D3): one pure `diffSnapshots(base, target)` produces one JSON-serializable
 * `SnapshotDiff`, and every consumer — the dedicated diff view, the live inline
 * overlay, the suggested-edits review, a text report, an out-of-process agent
 * (docs/037) — reads that one shape. Keeping the shapes here (types only, no
 * logic) lets the algorithm files and the display layer both depend on the
 * contract without depending on each other, and lets the whole result cross a
 * process boundary unchanged.
 *
 * The load-bearing idea (docs/036 §4.1 D1): a diff between two versions of one
 * document is an **identity** problem, not a text-alignment problem. Blocks match
 * by `NodeId`, characters by `CharacterId`, marks by `mark.id`. So every field
 * below is keyed on identity, and a move is a first-class status rather than the
 * delete-plus-insert noise a text diff produces.
 *
 * @categoryDefault Engine Core — Model
 */
import type {
  CharacterId,
  EditorDocumentSnapshot,
  EditorSnapshotNode,
  JsonObject,
  JsonValue,
  NodeId,
  TextMarkKind,
} from "../model";

/**
 * @categoryDefault Engine Core — Model
 */

/**
 * The status of one block across two snapshots.
 *
 * `"moved"` means a common id whose order among the surviving blocks changed
 * (LCS-based, §5.4), or one whose parent scope changed — *not* any index shift
 * caused by a neighbouring insert or delete. A `"moved"` block may also have
 * changed content, flagged by `BlockDiff.alsoChanged`.
 */
export type BlockStatus =
  | "unchanged"
  | "added"
  | "removed"
  | "moved"
  | "changed";

/**
 * One block's entry in a scope diff: its status, its position on each side, and the sub-diffs for its payload.
 *
 * A `BlockDiff` is emitted exactly once per node id across the whole diff. A node
 * present in both snapshots is emitted in its target scope (as `unchanged`,
 * `changed`, or `moved`); a base-only node is emitted in its base scope as
 * `removed`; a target-only node in its target scope as `added`. `baseIndex`/
 * `baseParent` and `targetIndex`/`targetParent` recover either original order and
 * drive move connectors and gutters. For the top-level body scope the parent is
 * `null`.
 */
export type BlockDiff = {
  readonly id: NodeId;
  readonly status: BlockStatus;
  /** True when a `"moved"` block also changed content (`status` stays `"moved"`). */
  readonly alsoChanged?: boolean;
  /** Index in the base parent's order, or `null` when the block is `added`. */
  readonly baseIndex: number | null;
  /** Index in the target parent's order, or `null` when the block is `removed`. */
  readonly targetIndex: number | null;
  /** The base parent scope id, or `null` for the body / an `added` block. */
  readonly baseParent: NodeId | null;
  /** The target parent scope id, or `null` for the body / a `removed` block. */
  readonly targetParent: NodeId | null;
  /** The target node, or the base node when `status` is `"removed"`. */
  readonly node: EditorSnapshotNode;
  /** Changed/added/removed attr keys on a matched node. */
  readonly attrs?: AttrDiff;
  /** Set for a changed text leaf (§5.2). */
  readonly text?: TextLeafDiff;
  /** Set for a changed object node (§5.6). */
  readonly object?: ObjectDiff;
  /**
   * The recursive child diffs of a structural container. Present on a changed/moved
   * container (only its changed descendants decorated, §5.5) and on an added/removed
   * container (every exclusively-one-side descendant, so `stats` counts the real
   * magnitude and every id is emitted once); a display renders an added/removed
   * container whole (§6.3) and may ignore these. Omitted for an unchanged container
   * (rendered whole) and for non-structural nodes.
   */
  readonly children?: readonly BlockDiff[];
  /** A `"removed"` entry links to the `"added"` one taking its slot in the same gap (§5.4). */
  readonly replacedBy?: NodeId;
  /** The reverse: an `"added"` entry standing in for a removed one in the same gap (§5.4). */
  readonly replaces?: NodeId;
};

/**
 * The character- and mark-level diff of one changed text leaf (§5.2, §5.3).
 *
 * `alignment` is `"id"` on the default identity path (both leaves share
 * character-id lineage) and `"text"` when the leaves shared no ids and the diff
 * fell back to a character-level LCS (D4). `runs` covers the union of both sides
 * in target-then-deleted order.
 */
export type TextLeafDiff = {
  readonly alignment: "id" | "text";
  readonly runs: readonly TextRunDiff[];
  readonly markChanges: readonly MarkChange[];
};

/**
 * One coalesced run of characters sharing a single op: `keep`, `insert`, or `delete`.
 *
 * `ids` is present on the identity path (`alignment: "id"`) and carries the
 * character ids of the run — the substrate suggested-edit attribution keys on
 * (docs/036 §7.4). It is absent on the text-alignment fallback.
 */
export type TextRunDiff = {
  readonly op: "keep" | "insert" | "delete";
  readonly text: string;
  readonly ids?: readonly CharacterId[];
};

/**
 * One mark added, removed, or changed on a text leaf, matched by `mark.id` (§5.3).
 *
 * Offsets are in the target leaf's coordinate space, except for a `"removed"`
 * mark, whose offsets are in the base leaf's space (the target has no such mark).
 * A data-bearing mark whose attrs changed (a re-pointed link href, a re-threaded
 * comment) reads as `"changed"`, never remove-plus-add.
 */
export type MarkChange = {
  readonly op: "added" | "removed" | "changed";
  readonly kind: TextMarkKind;
  readonly from: number;
  readonly to: number;
  readonly attrs?: JsonObject;
};

/**
 * The added, removed, and changed keys between two attribute bags (node attrs or settings).
 *
 * `changed` carries both sides per key so a display can show the transition. An
 * all-empty `AttrDiff` means the two bags are structurally equal.
 */
export type AttrDiff = {
  readonly added: Readonly<Record<string, JsonValue>>;
  readonly removed: Readonly<Record<string, JsonValue>>;
  readonly changed: Readonly<
    Record<string, { readonly base: JsonValue; readonly target: JsonValue }>
  >;
};

/**
 * The diff of one object node: whether its lifecycle status changed and its optional field detail.
 *
 * `fields` is present only when the object's `NodeDefinition.diffData` seam
 * supplied field-level detail (D6); without the seam the object is reported
 * `changed` at block granularity with no `fields`. A baked-only difference with
 * equal `data` and `status` is not a change (a re-bake, §5.6).
 */
export type ObjectDiff = {
  readonly statusChanged: boolean;
  readonly fields?: readonly ObjectFieldChange[];
};

/** One field-level change inside an object node's opaque data, from the `diffData` seam. */
export type ObjectFieldChange = {
  readonly path: string;
  readonly base: JsonValue;
  readonly target: JsonValue;
};

/**
 * The diff of one document-owned collection (glossary, bibliography, …), by `item.id` (§5.6).
 *
 * Items are matched by their stable `id`; `changed` names ids present on both
 * sides whose body differs.
 */
export type CollectionDiff = {
  readonly key: string;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
};

/** Aggregate block-level counts across the whole diff, for a header summary ("+12 −3, 2 moved"). */
export type DiffStats = {
  readonly added: number;
  readonly removed: number;
  readonly moved: number;
  readonly changed: number;
};

/**
 * The full structured diff of two document snapshots — the one result every diff consumer reads (§5.1, D3).
 *
 * `base` and `target` are carried so a renderer can resolve a matched id whose
 * kind changed (the base node for the removed-old-over-added-new display, §5.5)
 * and so the result is self-contained across a process boundary. `blocks` is the
 * top-level (body) diff in merged order — the LCS spine with `added`/`removed`
 * interleaved (§5.4).
 */
export type SnapshotDiff = {
  readonly base: EditorDocumentSnapshot;
  readonly target: EditorDocumentSnapshot;
  readonly blocks: readonly BlockDiff[];
  readonly settingsChanged: boolean;
  readonly settingsDetail?: AttrDiff;
  readonly collections: readonly CollectionDiff[];
  readonly stats: DiffStats;
};

/**
 * Options for `diffSnapshots` (§5.6, D6).
 *
 * The core cannot interpret an object node's opaque `data`, exactly as it cannot
 * bake it without the definition. `getNodeDefinition` is the seam a host passes so
 * a registered object type's `diffData` produces field-level detail; without it
 * the diff stays pure and reports object changes at block granularity. Kept as an
 * injected resolver (not a reach into the mutable global registry) so the diff is
 * hermetic and unit-testable.
 */
export type DiffOptions = {
  readonly getNodeDefinition?: (
    type: string,
  ) => ObjectDiffDefinition | undefined;
};

/**
 * The one slice of `NodeDefinition` the diff needs: the optional `diffData` seam (D6).
 *
 * A structural subset of `NodeDefinition` (`../registry`) so the diff core does
 * not depend on the whole object SPI surface; a host passes its real definitions
 * through `DiffOptions.getNodeDefinition` and the shapes line up.
 */
export type ObjectDiffDefinition = {
  readonly type: string;
  readonly diffData?: (
    base: JsonValue,
    target: JsonValue,
  ) => readonly ObjectFieldChange[];
};
