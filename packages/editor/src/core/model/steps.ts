/**
 * Closed mutation algebra for the owned-model editor.
 *
 * Why this file exists
 * --------------------
 * The store is allowed to mutate internally for performance, but edits must
 * still be invertible, auditable, and selection-remappable. Every document
 * change therefore travels as one of these step objects. Commands create
 * `TransactionDraft`s from steps; `EditorStore.dispatch` applies them, derives
 * inverse steps from live pre-state, and records a `CommittedTransaction`.
 *
 * Design rules encoded here:
 *
 * - Step types are closed for Phase 3. Custom object behavior goes through
 *   object data steps, not custom store mutations.
 * - Destructive steps carry enough old data for undo without retaining full
 *   document snapshots.
 * - `from`/`to` fields are not decorative; dispatch checks them against live
 *   state so stale commands fail instead of corrupting history.
 * - `origin` is always `"local"` now, but it is present from day one so future
 *   collaboration does not require a history-layer rewrite.
 */
import type {
  CollectionItem,
  DocumentSettings,
  EditorNode,
  EditorSelection,
  JsonObject,
  JsonValue,
  NodeId,
  ObjectNodeStatus,
  TextLeafType,
  TextMark,
  TextSlice,
} from "./model";

/**
 * @categoryDefault Engine Core — Model
 */

/**
 * Replace text inside one leaf.
 *
 * `removed` is checked against live content during dispatch and then replaced
 * by a fully id-bearing inserted slice. The inverse captures the removed slice
 * with its original character ids.
 *
 * `removedMarks` carries the marks a deletion destroys or clamps, in the
 * leaf's pre-edit coordinates. A user command never sets it; dispatch attaches
 * it to the inverse so undo can re-expand a clamped mark and restore a dropped
 * one exactly, rather than reconstructing marks by guessing (docs/011 §4.5).
 */
export type ReplaceTextStep = {
  readonly type: "replace-text";
  readonly node: NodeId;
  readonly at: number;
  readonly removed: TextSlice;
  readonly inserted: TextSlice;
  readonly removedMarks?: readonly TextMark[];
};

/** Add one range mark to a text leaf. */
export type AddMarkStep = {
  readonly type: "add-mark";
  readonly node: NodeId;
  readonly mark: TextMark;
};

/** Remove one range mark from a text leaf. */
export type RemoveMarkStep = {
  readonly type: "remove-mark";
  readonly node: NodeId;
  readonly mark: TextMark;
};

export type SetNodeTypeStep = {
  readonly type: "set-node-type";
  readonly node: NodeId;
  readonly from: TextLeafType;
  readonly to: TextLeafType;
};

/** Set one JSON-safe node attribute while carrying both sides for inversion. */
export type SetNodeAttrStep = {
  readonly type: "set-node-attr";
  readonly node: NodeId;
  readonly key: string;
  readonly from: JsonValue | undefined;
  readonly to: JsonValue | undefined;
};

/** Insert a node plus its optional already-allocated subtree. */
export type InsertNodeStep = {
  readonly type: "insert-node";
  readonly parent: NodeId;
  readonly index: number;
  readonly node: EditorNode;
  readonly descendants?: readonly EditorNode[];
};

/** Remove a node plus its captured subtree, so undo does not need a snapshot. */
export type RemoveNodeStep = {
  readonly type: "remove-node";
  readonly parent: NodeId;
  readonly index: number;
  readonly node: EditorNode;
  readonly descendants?: readonly EditorNode[];
};

/** Move one existing node by id; descendants move with their parent. */
export type MoveNodeStep = {
  readonly type: "move-node";
  readonly node: NodeId;
  readonly from: {
    readonly parent: NodeId;
    readonly index: number;
  };
  readonly to: {
    readonly parent: NodeId;
    readonly index: number;
  };
};

/** Swap opaque object data and baked/status metadata atomically. */
export type SetObjectDataStep = {
  readonly type: "set-object-data";
  readonly node: NodeId;
  readonly from: JsonValue;
  readonly to: JsonValue;
  readonly bakedFrom?: JsonValue;
  readonly bakedTo?: JsonValue;
  readonly statusFrom: ObjectNodeStatus;
  readonly statusTo: ObjectNodeStatus;
};

/** Document-level settings never travel through the body stream. */
export type SetSettingsStep = {
  readonly type: "set-settings";
  readonly from: DocumentSettings;
  readonly to: DocumentSettings;
};

/**
 * Replace one document-owned collection's whole item array (docs/027 §5.3). A
 * document-level step, the sibling of `set-settings`: it carries both sides for
 * inversion and never touches the body stream, so it does not affect position
 * mapping. Routing glossary/bibliography edits through this step (not a side store)
 * is what makes them undoable in the same stack as text — and lets a type-first
 * glossary creation mark a range *and* add a term in one atomic transaction whose
 * undo reverses both halves together (§5.3, §12 "undo across a collection edit").
 */
export type SetCollectionStep = {
  readonly type: "set-collection";
  readonly collection: string;
  readonly from: readonly CollectionItem[];
  readonly to: readonly CollectionItem[];
};

/** Closed Phase 3 mutation algebra for the owned model. */
export type Step =
  | ReplaceTextStep
  | AddMarkStep
  | RemoveMarkStep
  | SetNodeTypeStep
  | SetNodeAttrStep
  | InsertNodeStep
  | RemoveNodeStep
  | MoveNodeStep
  | SetObjectDataStep
  | SetSettingsStep
  | SetCollectionStep;

/** A command-produced transaction before dispatch captures inverses. */
export type TransactionDraft = {
  readonly steps: readonly Step[];
  readonly selectionAfter?: EditorSelection;
  readonly origin: "local";
};

/** A transaction after dispatch, with inverse steps and dirty metadata. */
export type CommittedTransaction = {
  readonly steps: readonly Step[];
  readonly inverse: readonly Step[];
  readonly selectionBefore: EditorSelection | null;
  readonly selectionAfter: EditorSelection | null;
  readonly touched: ReadonlySet<NodeId>;
  readonly settingsChanged: boolean;
  readonly structureChanged: boolean;
  readonly origin: "local";
};

/** Per-subscriber dirty summary; no full-document invalidation on text edits. */
export type StoreDirty = {
  readonly nodes: ReadonlySet<NodeId>;
  readonly selection: boolean;
  readonly settings: boolean;
  readonly structure: boolean;
};

export function cloneAttrsWithValue(
  attrs: JsonObject | undefined,
  key: string,
  value: JsonValue | undefined,
): JsonObject | undefined {
  const next = { ...attrs } as Record<string, JsonValue>;
  if (value === undefined) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return Object.keys(next).length === 0 ? undefined : next;
}
