/**
 * `this`-free dispatch helpers for the editor store (docs/020 §7.5).
 *
 * Mark remapping under a text replace, selection remapping across a transaction's
 * steps, the active-leaf notify-skip predicate, subtree collection, and small
 * value utilities. Lifted verbatim from the old single-file `store.ts`. They take
 * the `EditorStore` as a plain argument (type-only import, so no runtime cycle),
 * mirroring how the class called them when they lived in the same file.
 */
import {
  boundaryAtOffset,
  makeObjectNode,
  makeStructuralNode,
  makeTextNode,
  pointAtOffset,
  resolveBoundaryOffset,
  type EditorNode,
  type EditorSelection,
  type JsonObject,
  type JsonValue,
  type NodeId,
  type TextLeafNode,
  type TextMark,
  type TextPoint,
} from "../model";
import { mapTextOffset } from "../model";
import type { Step } from "../model";
import type { EditorStore } from "./editor-store";

export function remapMarksForReplace(
  before: TextLeafNode["content"],
  after: TextLeafNode["content"],
  marks: readonly TextMark[],
  at: number,
  removedLength: number,
  insertedLength: number,
): readonly TextMark[] {
  /*
   * Phase 3 keeps the mark mapping intentionally local: a text replacement can
   * only affect marks on the same leaf. Marks wholly before the edit stay put,
   * marks after the edit shift by delta, and marks crossing the removed region
   * clamp around the inserted text.
   */
  const delta = insertedLength - removedLength;
  return normalizeMarks(
    marks.flatMap((mark) => {
      const from = mapOffset(resolveBoundaryOffset(before, mark.from));
      const to = mapOffset(resolveBoundaryOffset(before, mark.to));
      if (to <= from) return [];
      return [
        {
          ...mark,
          from: boundaryAtOffset(after, from, "before"),
          to: boundaryAtOffset(after, to, "after"),
        },
      ];
    }),
  );

  function mapOffset(offset: number): number {
    if (offset <= at) return offset;
    if (offset >= at + removedLength) return offset + delta;
    return at + insertedLength;
  }
}

export function marksIntersectingRange(
  content: TextLeafNode["content"],
  marks: readonly TextMark[],
  from: number,
  to: number,
): readonly TextMark[] {
  /*
   * A mark is destroyed or clamped only if it truly overlaps the removed span.
   * Marks that merely abut an edge (mark.to === from or mark.from === to) keep
   * their shape under the remap, so they do not need carrying in the inverse.
   */
  return marks.filter((mark) => {
    const markFrom = resolveBoundaryOffset(content, mark.from);
    const markTo = resolveBoundaryOffset(content, mark.to);
    return markFrom < to && markTo > from;
  });
}

export function mergeMarksById(
  base: readonly TextMark[],
  overrides: readonly TextMark[],
): readonly TextMark[] {
  /*
   * Restore by id: an override re-installs the pre-edit mark over its clamped
   * survivor (same id) or re-adds one the deletion dropped entirely.
   */
  const byId = new Map(base.map((mark) => [mark.id, mark]));
  for (const mark of overrides) byId.set(mark.id, mark);
  return normalizeMarks([...byId.values()]);
}

export function normalizeMarks(
  marks: readonly TextMark[],
): readonly TextMark[] {
  /*
   * docs/011 §4.4: a leaf's marks are sorted by `from`. The resolved boundary
   * offset is the sort key, with `to` and then `id` breaking ties so the order
   * is deterministic for round-trip and snapshot equality.
   */
  return [...marks].sort(
    (a, b) =>
      a.from.offset - b.from.offset ||
      a.to.offset - b.to.offset ||
      a.id.localeCompare(b.id),
  );
}

export function withAttrs(
  node: EditorNode,
  attrs: JsonObject | undefined,
): EditorNode {
  if (node.kind === "text") return makeTextNode({ ...node, attrs });
  if (node.kind === "structural") return makeStructuralNode({ ...node, attrs });
  return makeObjectNode({ ...node, attrs });
}

export function collectSubtree(
  nodes: ReadonlyMap<NodeId, EditorNode>,
  id: NodeId,
): EditorNode[] {
  const node = nodes.get(id);
  if (!node) throw new Error(`Unknown node: ${id}`);
  const descendants =
    node.kind === "structural"
      ? node.children.flatMap((childId) => collectSubtree(nodes, childId))
      : [];
  return [node, ...descendants];
}

export function mapSelection(
  store: EditorStore,
  selection: EditorSelection | null,
  steps: readonly Step[],
  forward: boolean,
  removedByStep: ReadonlyMap<Step, ReadonlySet<NodeId>> = new Map(),
): EditorSelection | null {
  /*
   * Selection remap is part of the dispatch chokepoint. The common typing case
   * touches one text leaf and only adjusts offsets in that leaf; structural
   * removal falls back to a nearby valid text/gap selection.
   *
   * Anchor and focus take opposite bias when collapsing into a deleted range so
   * the selection does not invert (§8.8: focus toward the edit, anchor away).
   * That assignment mirrors for a backward selection.
   */
  if (!selection) return null;
  const anchorBias: -1 | 1 = forward ? -1 : 1;
  const focusBias: -1 | 1 = forward ? 1 : -1;
  let current: EditorSelection | null = selection;
  for (const step of steps) {
    if (!current) return null;
    // The full subtree this step removed (empty for non-remove steps), so a deep
    // descendant of a removed container is detected even though the store no
    // longer holds it (docs/021 §8.2).
    const removed = removedByStep.get(step);
    if (current.type === "text") {
      const anchor = mapPoint(store, current.anchor, step, anchorBias, removed);
      const focus = mapPoint(store, current.focus, step, focusBias, removed);
      current =
        anchor && focus
          ? { anchor, focus, type: "text" }
          : fallbackSelection(store, step);
    } else if (
      current.type === "node" &&
      removesNode(step, current.node, removed)
    ) {
      current = fallbackSelection(store, step);
    } else if (
      current.type === "gap" &&
      removesNode(step, current.scope, removed)
    ) {
      current = fallbackSelection(store, step);
    }
  }
  return current;
}

function mapPoint(
  store: EditorStore,
  point: TextPoint,
  step: Step,
  bias: -1 | 1,
  removed: ReadonlySet<NodeId> | undefined,
): TextPoint | null {
  if (step.type === "replace-text" && step.node === point.node) {
    const node = store.requireTextNode(point.node);
    const offset = mapTextOffset(
      point.offset,
      step.at,
      step.removed.text.length,
      step.inserted.text.length,
      bias,
    );
    return pointAtOffset(point.node, node.content, offset, point.assoc ?? bias);
  }
  if (removesNode(step, point.node, removed)) return null;
  return point;
}

/**
 * Whether `step` removed `node`. Prefers the dispatch-supplied set of every id
 * the step removed (the full subtree, so a deep descendant counts); falls back to
 * the step's own `node`/`descendants` for callers that pass no set (docs/021 §8.2).
 */
function removesNode(
  step: Step,
  node: NodeId,
  removed: ReadonlySet<NodeId> | undefined,
): boolean {
  if (step.type !== "remove-node") return false;
  if (removed) return removed.has(node);
  if (step.node.id === node) return true;
  return (step.descendants ?? []).some((descendant) => descendant.id === node);
}

export function canSkipActiveTextNotify(
  steps: readonly Step[],
  active: NodeId,
): boolean {
  /*
   * Text replacement on the active leaf is the one mutation React should not see
   * immediately: the input controller patches the rendered text node in the same
   * event. Other active-leaf mutations, such as mark toggles or node-type changes,
   * change structure/formatting and must refresh the React snapshot.
   */
  return (
    steps.some((step) => stepTouchesNode(step, active)) &&
    steps.every(
      (step) =>
        !stepTouchesNode(step, active) ||
        (step.type === "replace-text" && step.node === active),
    )
  );
}

function stepTouchesNode(step: Step, node: NodeId): boolean {
  switch (step.type) {
    case "replace-text":
    case "add-mark":
    case "remove-mark":
    case "set-node-type":
    case "set-node-attr":
    case "set-object-data":
      return step.node === node;
    case "insert-node":
      return (
        step.node.id === node ||
        step.parent === node ||
        (step.descendants ?? []).some((descendant) => descendant.id === node)
      );
    case "remove-node":
      return (
        step.node.id === node ||
        step.parent === node ||
        (step.descendants ?? []).some((descendant) => descendant.id === node)
      );
    case "move-node":
      return (
        step.node === node ||
        step.from.parent === node ||
        step.to.parent === node
      );
    case "set-settings":
      return false;
  }
}

function fallbackSelection(
  store: EditorStore,
  step: Step,
): EditorSelection | null {
  if (step.type !== "remove-node") return store.selection;
  const parent = store.requireNode(step.parent);
  const siblings = parent.kind === "structural" ? parent.children : [];
  const previous = siblings[step.index - 1];
  if (previous) return selectionAtNodeEdge(store, previous, "after");
  const next = siblings[step.index];
  if (next) return selectionAtNodeEdge(store, next, "before");
  // The scope is now empty: a gap at its only slot (docs/019 §4.3, §9).
  return { index: 0, scope: step.parent, type: "gap" };
}

function selectionAtNodeEdge(
  store: EditorStore,
  nodeId: NodeId,
  side: "before" | "after",
): EditorSelection {
  const node = store.requireNode(nodeId);
  if (node.kind === "text") {
    const offset = side === "before" ? 0 : node.content.text.length;
    const point = pointAtOffset(node.id, node.content, offset);
    return { anchor: point, focus: point, type: "text" };
  }
  // A gap beside an object, named scope-relative (docs/019 §5.1): the slot after
  // a node is its index + 1, the slot before it is its index.
  const entry = store.parentEntry(nodeId);
  return {
    index: entry ? (side === "after" ? entry.index + 1 : entry.index) : 0,
    scope: entry ? entry.parent : store.bodyId,
    type: "gap",
  };
}

export function bakedSnapshot(value: JsonValue | undefined) {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "kind" in value &&
    typeof value.kind === "string"
  ) {
    return {
      kind: value.kind,
      payload: "payload" in value ? value.payload : null,
    };
  }
  return undefined;
}

export function compareNumberArrays(
  a: readonly number[],
  b: readonly number[],
): -1 | 0 | 1 {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = a[index]! - b[index]!;
    if (difference !== 0) return sign(difference);
  }
  return sign(a.length - b.length);
}

export function sign(value: number): -1 | 0 | 1 {
  if (value < 0) return -1;
  if (value > 0) return 1;
  return 0;
}
