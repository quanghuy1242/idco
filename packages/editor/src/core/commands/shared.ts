/** Shared command helpers: scope/insertion resolution, leaf/mark/grapheme utilities, and read-side queries (docs/020 §7.5). */
import {
  boundaryAtOffset,
  makeTextNode,
  replaceTextContent,
  resolveBoundaryOffset,
  sliceTextContent,
  type EditorNode,
  type EditorSelection,
  type JsonObject,
  type JsonValue,
  type NodeId,
  type StructuralNode,
  type TextContent,
  type TextLeafNode,
  type TextLeafType,
  type TextMark,
  type TextMarkKind,
  type TextPoint,
  type TextSlice,
} from "../model";
import type { Step } from "../model";
import type { EditorStore, PendingFormat, TransactionBuilder } from "../store";

/**
 * @categoryDefault Engine Core — Commands
 */

export const EMPTY_SLICE: TextSlice = { runs: [], text: "" };

/** A high-level editing intent. Never a raw `Step` (docs/011 §12.2). */
export type LeafRange = {
  readonly node: TextLeafNode;
  readonly from: number;
  readonly to: number;
};

/**
 * The text leaves a selection covers, each with its local range. A single-leaf
 * selection yields one entry; a cross-leaf selection walks the document in model
 * order from the start leaf to the end leaf. The walk uses `orderedTextLeaves`,
 * which descends into container scopes (a callout, a list), so a selection that
 * spans leaves *inside* a structural container is covered too — `store.order` is
 * only the top-level body order and would miss them. Zero-length local ranges
 * are dropped.
 */
export function leafRangesInSelection(
  store: EditorStore,
): readonly LeafRange[] {
  const range = textRange(store);
  if (!range) return [];
  if (range.start.node === range.end.node) {
    const node = store.requireTextNode(range.start.node);
    if (range.start.offset === range.end.offset) return [];
    return [{ from: range.start.offset, node, to: range.end.offset }];
  }
  const leaves = orderedLeavesInDocument(store);
  const startIndex = leaves.findIndex((leaf) => leaf.id === range.start.node);
  const endIndex = leaves.findIndex((leaf) => leaf.id === range.end.node);
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) return [];
  const out: LeafRange[] = [];
  for (let i = startIndex; i <= endIndex; i += 1) {
    const node = leaves[i]!;
    const from = i === startIndex ? range.start.offset : 0;
    const to = i === endIndex ? range.end.offset : node.content.text.length;
    if (to > from) out.push({ from, node, to });
  }
  return out;
}

/**
 * The document's text leaves in model order, descending into container scopes (a
 * callout, a list) via `childrenOf` — `store.order` alone is only the top-level
 * body. Local to this module so the block commands resolve a cross-scope
 * selection without importing the copy serializer (which would form an import
 * cycle through the store). Not a hot path: block-type/attr/format commands are
 * user gestures, not per-keystroke.
 */
export function orderedLeavesInDocument(store: EditorStore): TextLeafNode[] {
  const leaves: TextLeafNode[] = [];
  const visit = (scope: NodeId): void => {
    for (const id of childrenOf(store, scope)) {
      const node = store.getNode(id);
      if (!node) continue;
      if (node.kind === "text") leaves.push(node);
      else if (node.kind === "structural") visit(id);
    }
  };
  visit(store.bodyId);
  return leaves;
}

/**
 * Every text leaf a (possibly collapsed) range touches, start..end inclusive.
 * Like `leafRangesInSelection`, this walks document model order across container
 * scopes, so a multi-block selection inside a callout/list is covered (block-type
 * and block-attr commands operate on the nested leaves, not nothing).
 */
export function coveredTextLeaves(
  store: EditorStore,
  range: TextRange,
): readonly TextLeafNode[] {
  if (range.start.node === range.end.node) {
    return [store.requireTextNode(range.start.node)];
  }
  const leaves = orderedLeavesInDocument(store);
  const startIndex = leaves.findIndex((leaf) => leaf.id === range.start.node);
  const endIndex = leaves.findIndex((leaf) => leaf.id === range.end.node);
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) return [];
  return leaves.slice(startIndex, endIndex + 1);
}

/** Where an insert lands: at an index in a scope, replacing a placeholder, or splitting a leaf. */
export type InsertionPoint =
  | { readonly kind: "at"; readonly scope: NodeId; readonly index: number }
  | { readonly kind: "replace"; readonly node: NodeId }
  | {
      readonly kind: "split";
      readonly node: NodeId;
      readonly offset: number;
      readonly content: TextContent;
    };

/**
 * Whether an empty block is a placeholder the next insert should consume rather
 * than push aside (docs/019 §4.7). An empty *paragraph* is the canonical "blank
 * line waiting for content"; an empty heading/quote/list-item is explicit
 * structure and is never consumed. Inline atoms occupy a U+FFFC character, so
 * `content.text.length === 0` already excludes a leaf that still holds one.
 */
export function isDisposableEmpty(node: EditorNode): boolean {
  return (
    node.kind === "text" &&
    node.type === "paragraph" &&
    node.content.text.length === 0
  );
}

/** Apply an `InsertionPoint` + a node run to a transaction (docs/019 §4.8). */
export function placeNodes(
  tr: TransactionBuilder,
  store: EditorStore,
  point: InsertionPoint,
  nodes: readonly EditorNode[],
  // Optional descendant resolver (docs/030 §7.1 fragment paste / native clipboard). When a
  // top-level node is a structural container, its descendant subtree must ride the one
  // `insert-node` step as `descendants` (the engine ingests root + descendants atomically).
  // Flat callers omit it and insert leaf/object nodes with no children, exactly as before.
  descendantsOf?: (node: EditorNode) => readonly EditorNode[],
): void {
  const insert = (parent: NodeId, index: number, node: EditorNode): void => {
    const descendants = descendantsOf?.(node);
    if (descendants && descendants.length > 0) {
      tr.push({ descendants, index, node, parent, type: "insert-node" });
    } else {
      tr.insertNode(parent, index, node);
    }
  };
  if (point.kind === "replace") {
    const entry = store.parentEntry(point.node);
    const removed = store.getNode(point.node);
    if (entry && removed) {
      // Remove the placeholder, then insert at its vacated index. One
      // TransactionBuilder = one invertible transaction (undo restores it).
      tr.removeNode(entry.parent, entry.index, removed);
      nodes.forEach((node, i) => insert(entry.parent, entry.index + i, node));
      return;
    }
    // Defensive: the target vanished mid-race; append at the body end.
    nodes.forEach((node, i) =>
      insert(store.bodyId, store.order.length + i, node),
    );
    return;
  }
  if (point.kind === "split") {
    // Break the leaf at the caret and drop the run into the seam: head keeps
    // [0, offset), a fresh tail leaf carries the rest, and the inserted nodes go
    // between them (docs/019 §4.8/§7.7). If the leaf vanished, append at the end.
    const seam = splitLeafAt(tr, store, point);
    if (!seam) {
      nodes.forEach((node, i) =>
        insert(store.bodyId, store.order.length + i, node),
      );
      return;
    }
    nodes.forEach((node, i) => insert(seam.parent, seam.index + 1 + i, node));
    return;
  }
  nodes.forEach((node, i) => insert(point.scope, point.index + i, node));
}

/**
 * Break a text leaf at a caret into a head (the original, truncated) and a fresh
 * tail leaf holding [offset, end), with marks clipped and re-anchored exactly as
 * `compileSplit` does (docs/019 §7.7). Returns the seam: the parent scope and the
 * head's index, so a caller can splice content between head and tail. Pure
 * relative to the supplied `content` snapshot — it never re-reads the leaf text
 * from the store, so it is correct after a prior in-transaction delete (the
 * range-then-insert path, §7.8).
 */
/**
 * The block-level attrs a split continuation inherits (docs/018 §2.10). A new
 * line started with Enter keeps the depth (`indent`) of the block it split from,
 * and a list item keeps its flavour (`listType`) so a numbered list keeps
 * numbering instead of falling back to bullet. Heading-only attrs (`tag`) are not
 * carried — the continuation of a heading is a paragraph.
 */
export function continuationAttrs(
  attrs: JsonObject | undefined,
  type: TextLeafType,
): JsonObject | undefined {
  if (!attrs) return undefined;
  const out: Record<string, JsonValue> = {};
  if (attrs.indent !== undefined) out.indent = attrs.indent;
  // Carry the heading level onto a heading continuation (the offset-0 split that
  // keeps the tail a heading). Deliberately NOT `anchorId`: the new heading gets a
  // fresh NodeId anchor rather than duplicating the original's stable anchor.
  if (type === "heading" && attrs.tag !== undefined) out.tag = attrs.tag;
  if (type === "listitem" && attrs.listType !== undefined) {
    out.listType = attrs.listType;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function splitLeafAt(
  tr: TransactionBuilder,
  store: EditorStore,
  caret: {
    readonly node: NodeId;
    readonly offset: number;
    readonly content: TextContent;
  },
): {
  readonly newId: NodeId;
  readonly parent: NodeId;
  readonly index: number;
} | null {
  const splitNode = store.getNode(caret.node);
  if (!splitNode || splitNode.kind !== "text") return null;
  const entry = store.parentEntry(splitNode.id);
  if (!entry) return null;
  const at = caret.offset;
  const content = caret.content;
  const length = content.text.length;
  const tailSlice = sliceTextContent(content, at, length);
  const newId = tr.allocator.createNodeId();
  // A heading split mid/end demotes the continuation to a paragraph (Enter at the
  // end of a heading starts body text). But splitting at offset 0 moves the WHOLE
  // heading text into the tail, so the tail must keep the heading type/level —
  // otherwise pressing Enter at the start of a heading silently demotes its text to
  // a paragraph. The head left behind is an empty heading, which the TOC index
  // skips (bake.ts), so it does not pollute the contents list.
  const newType: TextLeafType =
    splitNode.type === "heading" && at > 0 ? "paragraph" : splitNode.type;
  const tailMarks = clipMarks(splitNode.marks, content, at, length, -at);
  const newNode = makeTextNode({
    attrs: continuationAttrs(splitNode.attrs, newType),
    content: tailSlice,
    id: newId,
    marks: reanchorMarks(tailMarks, tailSlice),
    type: newType,
  });
  // Head keeps [0, at): a removal of the tail (its marks clamp via the
  // replace-text remap). The new block carries the tail content and marks.
  tr.replaceText({
    at,
    inserted: "",
    node: splitNode.id,
    removed: content.text.slice(at),
  });
  tr.insertNode(entry.parent, entry.index + 1, newNode);
  // Positions past the split point belong to the new block now (§16 redirect).
  tr.redirect((pos) =>
    pos.node === splitNode.id && pos.offset > at
      ? { node: newId, offset: pos.offset - at }
      : undefined,
  );
  return { index: entry.index, newId, parent: entry.parent };
}

// ---------------------------------------------------------------------------
// Scope helpers (docs/019 §4.2/§4.4): a position lives in a scope, and scopes
// nest. These are the read-only primitives navigation and gap painting share —
// pure functions of (selection, document), no DOM, no mutation.
// ---------------------------------------------------------------------------

/**
 * The ordered children of a scope (docs/019 §4.2). The body's children are
 * `store.order`; a structural container's are its `children`; anything else
 * (an atom, a text leaf) has none.
 */
export function childrenOf(
  store: EditorStore,
  scope: NodeId,
): readonly NodeId[] {
  if (scope === store.bodyId) return store.order;
  const node = store.getNode(scope);
  return node && node.kind === "structural" ? node.children : [];
}

/** The innermost scope (container) enclosing a position (docs/019 §4.4). */
export function activeScope(
  store: EditorStore,
  position: EditorSelection,
): NodeId {
  if (position.type === "gap") return position.scope;
  const id = position.type === "node" ? position.node : position.focus.node;
  return store.parentEntry(id)?.parent ?? store.bodyId;
}

/**
 * Root-first chain of container ids enclosing a position: `[body, …, innermost]`
 * (docs/019 §4.4). Walks `parentEntry().parent` upward so navigation at a scope
 * edge can escape to the enclosing scope's gap (§4.10/§5.7).
 */
export function scopePath(
  store: EditorStore,
  position: EditorSelection,
): NodeId[] {
  const path: NodeId[] = [];
  let scope: NodeId | undefined = activeScope(store, position);
  const seen = new Set<NodeId>();
  while (scope && !seen.has(scope)) {
    seen.add(scope);
    path.push(scope);
    if (scope === store.bodyId) break;
    scope = store.parentEntry(scope)?.parent;
  }
  return path.toReversed();
}

/**
 * Resolve the current selection to an `InsertionPoint` (docs/019 §4.6).
 *
 * Pure and collapsed-only: a non-collapsed text range is collapsed by the
 * compiler (`insertionPointForInsert`) before this is consulted, so the focus is
 * a single caret here.
 */
export function resolveInsertionPoint(store: EditorStore): InsertionPoint {
  const sel = store.selection;
  if (!sel)
    return { index: store.order.length, kind: "at", scope: store.bodyId };
  if (sel.type === "gap") {
    return { index: sel.index, kind: "at", scope: sel.scope };
  }
  if (sel.type === "node") {
    const entry = store.parentEntry(sel.node);
    return entry
      ? { index: entry.index + 1, kind: "at", scope: entry.parent }
      : { index: store.order.length, kind: "at", scope: store.bodyId };
  }
  const leaf = store.getNode(sel.focus.node);
  if (!leaf || leaf.kind !== "text") {
    return { index: store.order.length, kind: "at", scope: store.bodyId };
  }
  return resolveTextCaretPoint(
    store,
    sel.focus.node,
    sel.focus.offset,
    leaf.content,
    isDisposableEmpty(leaf),
  );
}

/**
 * The `InsertionPoint` for a collapsed text caret (docs/019 §4.6, the `text`
 * rows). Shared by `resolveInsertionPoint` and the range path, which both arrive
 * at a single caret. A disposable-empty paragraph is replaced; offset 0 inserts
 * before the block; the end inserts after it; a strict mid-leaf caret splits the
 * leaf and drops the block into the seam (docs/019 §5.5/§7.7).
 */
export function resolveTextCaretPoint(
  store: EditorStore,
  leafId: NodeId,
  offset: number,
  content: TextContent,
  disposableEmpty: boolean,
): InsertionPoint {
  if (disposableEmpty) return { kind: "replace", node: leafId };
  const entry = store.parentEntry(leafId);
  if (!entry) {
    return { index: store.order.length, kind: "at", scope: store.bodyId };
  }
  if (offset > 0 && offset < content.text.length) {
    return { content, kind: "split", node: leafId, offset };
  }
  return {
    index: offset === 0 ? entry.index : entry.index + 1,
    kind: "at",
    scope: entry.parent,
  };
}

/**
 * Resolve where an insert lands, first collapsing a non-collapsed text range
 * (docs/019 §7.8): "replace my selection with a block." The range is deleted
 * into `tr`, then the point is resolved from the resulting collapsed caret —
 * `deleteRange` keeps `start.node`, so it is still addressable.
 */
export function insertionPointForInsert(
  tr: TransactionBuilder,
  store: EditorStore,
): InsertionPoint {
  const range = textRange(store);
  if (range && !pointsEqual(range.start, range.end)) {
    const caret = deleteRange(tr, store, range.start, range.end);
    const leaf = store.getNode(caret.node);
    const disposableEmpty =
      leaf?.kind === "text" &&
      leaf.type === "paragraph" &&
      caret.content.text.length === 0;
    return resolveTextCaretPoint(
      store,
      caret.node,
      caret.offset,
      caret.content,
      disposableEmpty,
    );
  }
  return resolveInsertionPoint(store);
}

// ---------------------------------------------------------------------------
// Object editing: set data + re-bake (docs/010 Phase 6 AC4).
// ---------------------------------------------------------------------------

/**
 * Replace one object's opaque data and re-bake it in the same transaction.
 *
 * The bake is recomputed from the registry baker so the static snapshot the
 * reader and export consume never drifts from the live data (docs/010 §5.9). An
 * object whose new data has no valid bake commits with `status: "invalid"` and
 * no baked snapshot — a recoverable error, not an unbakeable node (Phase 6 AC4).
 */
export function isMarkActive(store: EditorStore, kind: TextMarkKind): boolean {
  const range = textRange(store);
  if (!range) return false;
  if (
    range.start.node === range.end.node &&
    range.start.offset === range.end.offset
  ) {
    // Collapsed: a pending format (set by toggling at this caret) wins, so the
    // toolbar shows what the next typed character will be (docs/018 §2.0).
    const pending = store.pendingFormat;
    if (
      pending &&
      pending.node === range.start.node &&
      pending.offset === range.start.offset
    ) {
      return pending.marks.has(kind);
    }
    // Otherwise active if any mark of this kind contains the caret.
    const node = store.requireTextNode(range.start.node);
    return node.marks.some((mark) => {
      if (mark.kind !== kind) return false;
      const mFrom = resolveBoundaryOffset(node.content, mark.from);
      const mTo = resolveBoundaryOffset(node.content, mark.to);
      return mFrom <= range.start.offset && range.start.offset <= mTo;
    });
  }
  // A (possibly cross-leaf) selection is active only when every covered leaf
  // range is fully marked — the mirror of the cross-leaf toggle, so the toolbar
  // toggle and its active state agree on multi-block selections (AC2).
  const leaves = leafRangesInSelection(store);
  return (
    leaves.length > 0 &&
    leaves.every(({ node, from, to }) => isRangeMarked(node, kind, from, to))
  );
}

export function canIndent(store: EditorStore): boolean {
  const item = currentListItem(store);
  if (item) return item.index > 0;
  // Attribute-indent fallback: any text block can be pushed right, up to the cap.
  const range = textRange(store);
  if (!range) return false;
  return coveredTextLeaves(store, range).some(
    (node) =>
      (typeof node.attrs?.indent === "number" ? node.attrs.indent : 0) <
      MAX_INDENT,
  );
}

export function canOutdent(store: EditorStore): boolean {
  const item = currentListItem(store);
  if (item) return !!store.parentEntry(item.list.id);
  // Attribute-indent fallback: outdent applies when a block carries indent, or a
  // flat list item can drop back to a paragraph.
  const range = textRange(store);
  if (!range) return false;
  return coveredTextLeaves(store, range).some(
    (node) =>
      node.type === "listitem" ||
      (typeof node.attrs?.indent === "number" && node.attrs.indent > 0),
  );
}

export function currentBlockType(store: EditorStore): TextLeafType | null {
  const range = textRange(store);
  if (!range) return null;
  const node = store.getNode(range.start.node);
  return node && node.kind === "text" ? node.type : null;
}

/**
 * The list flavour of the current block, or null when it is not a list item
 * (docs/018 §2.10). A list item with no explicit `listType` reads as `bullet`,
 * so the toolbar can tell a bulleted item from a numbered one.
 */
export function currentListType(store: EditorStore): string | null {
  const range = textRange(store);
  if (!range) return null;
  const node = store.getNode(range.start.node);
  if (!node || node.kind !== "text" || node.type !== "listitem") return null;
  return typeof node.attrs?.listType === "string"
    ? node.attrs.listType
    : "bullet";
}

/**
 * The task-list state of the current block (docs/030 §4.3c): `true`/`false` when
 * the current list item is a checklist item (carries a `checked` flag), or `null`
 * when it is not a checklist item (a plain bullet, or not a list item at all). The
 * checklist toggle reads this so it knows whether to add or remove the flag.
 */
export function currentListChecked(store: EditorStore): boolean | null {
  const range = textRange(store);
  if (!range) return null;
  const node = store.getNode(range.start.node);
  if (!node || node.kind !== "text" || node.type !== "listitem") return null;
  return typeof node.attrs?.checked === "boolean" ? node.attrs.checked : null;
}

/**
 * The element alignment of the current block (note.md item 1). Alignment is stored
 * on the existing `attrs.format` field — the same field the compat layer already
 * round-trips to the legacy element `format` the reader maps to align
 * (`content-renderer` `elementAlign`); the owned engine simply never exposed a
 * control to set it before. A text leaf with no explicit alignment reads as
 * `"left"` (the default) so the toolbar can tell a left-aligned block from a
 * centered/justified one; null off a text leaf. The reader honours only
 * `center`/`right`/`justify`, so the set-command clears the attr for `left`.
 */
export function currentAlign(store: EditorStore): string | null {
  const range = textRange(store);
  if (!range) return null;
  const node = store.getNode(range.start.node);
  if (!node || node.kind !== "text") return null;
  return typeof node.attrs?.format === "string" && node.attrs.format.length > 0
    ? node.attrs.format
    : "left";
}

// ---------------------------------------------------------------------------
// Shared helpers.
// ---------------------------------------------------------------------------

export type ListItemContext = {
  readonly id: NodeId;
  readonly node: EditorNode;
  readonly list: StructuralNode;
  readonly index: number;
};

export function currentListItem(store: EditorStore): ListItemContext | null {
  const sel = store.selection;
  if (sel?.type !== "text") return null;
  const id = sel.focus.node;
  const node = store.getNode(id);
  if (!node) return null;
  const isListItem =
    (node.kind === "text" && node.type === "listitem") ||
    (node.kind === "structural" && node.type === "listitem");
  if (!isListItem) return null;
  const entry = store.parentEntry(id);
  if (!entry) return null;
  const list = store.getNode(entry.parent);
  if (!list || list.kind !== "structural" || list.type !== "list") return null;
  return { id, index: entry.index, list, node };
}

export type TextRange = { readonly start: TextPoint; readonly end: TextPoint };

/** The current text selection ordered start→end, or null when not editable. */
export function textRange(store: EditorStore): TextRange | null {
  const sel = store.selection;
  if (sel?.type !== "text") return null;
  let order: -1 | 0 | 1;
  try {
    order = store.comparePoints(sel.anchor, sel.focus);
  } catch {
    return null;
  }
  return order <= 0
    ? { end: sel.focus, start: sel.anchor }
    : { end: sel.anchor, start: sel.focus };
}

export function pointsEqual(a: TextPoint, b: TextPoint): boolean {
  return a.node === b.node && a.offset === b.offset;
}

/** Top-level sibling blocks fully covered by a same-parent range, plus the end node. */
export function coveredSiblings(
  store: EditorStore,
  startId: NodeId,
  endId: NodeId,
): readonly NodeId[] {
  const startEntry = store.parentEntry(startId);
  const endEntry = store.parentEntry(endId);
  if (
    !startEntry ||
    !endEntry ||
    startEntry.parent !== endEntry.parent ||
    endEntry.index <= startEntry.index
  ) {
    return [endId];
  }
  const parent = store.requireNode(startEntry.parent);
  if (parent.kind !== "structural") return [endId];
  // Remove the end node first (highest index) so lower indices stay valid.
  const ids: NodeId[] = [];
  for (let i = endEntry.index; i > startEntry.index; i -= 1) {
    ids.push(parent.children[i]!);
  }
  return ids;
}

export function previousTextLeaf(
  store: EditorStore,
  id: NodeId,
): TextLeafNode | null {
  const entry = store.parentEntry(id);
  // Inside a container scope (a table cell, a callout), find the previous text leaf
  // among earlier siblings, descending structural siblings to their last leaf, and
  // confined to the scope — so Backspace at the start of one cell paragraph folds
  // it into the previous paragraph *of the same cell*, but never merges across the
  // cell boundary (at the scope's first child there is no neighbor).
  if (entry && entry.parent !== store.bodyId) {
    const siblings = childrenOf(store, entry.parent);
    for (let i = entry.index - 1; i >= 0; i -= 1) {
      const leaf = lastTextLeafUnder(store, siblings[i]!);
      if (leaf) return leaf;
    }
    return null;
  }
  const index = store.order.indexOf(id);
  for (let i = index - 1; i >= 0; i -= 1) {
    const node = store.getNode(store.order[i]!);
    if (node && node.kind === "text") return node;
  }
  return null;
}

export function nextTextLeaf(
  store: EditorStore,
  id: NodeId,
): TextLeafNode | null {
  const entry = store.parentEntry(id);
  // Inside a container scope (a table cell, a callout), find the next text leaf
  // among later siblings, descending structural siblings to their first leaf, and
  // confined to the scope — so Delete at the end of one cell paragraph merges the
  // next paragraph *of the same cell*, but never reaches across the cell boundary.
  if (entry && entry.parent !== store.bodyId) {
    const siblings = childrenOf(store, entry.parent);
    for (let i = entry.index + 1; i < siblings.length; i += 1) {
      const leaf = firstTextLeafUnder(store, siblings[i]!);
      if (leaf) return leaf;
    }
    return null;
  }
  const index = store.order.indexOf(id);
  if (index < 0) return null;
  for (let i = index + 1; i < store.order.length; i += 1) {
    const node = store.getNode(store.order[i]!);
    if (node && node.kind === "text") return node;
  }
  return null;
}

/** The first text leaf at or under `id` (descending structural children). */
function firstTextLeafUnder(
  store: EditorStore,
  id: NodeId,
): TextLeafNode | null {
  const node = store.getNode(id);
  if (!node) return null;
  if (node.kind === "text") return node;
  if (node.kind === "structural") {
    for (const child of node.children) {
      const leaf = firstTextLeafUnder(store, child);
      if (leaf) return leaf;
    }
  }
  return null;
}

/** The last text leaf at or under `id` (descending structural children). */
function lastTextLeafUnder(
  store: EditorStore,
  id: NodeId,
): TextLeafNode | null {
  const node = store.getNode(id);
  if (!node) return null;
  if (node.kind === "text") return node;
  if (node.kind === "structural") {
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      const leaf = lastTextLeafUnder(store, node.children[i]!);
      if (leaf) return leaf;
    }
  }
  return null;
}

export function concatContent(a: TextContent, b: TextContent): TextContent {
  return concatSlices(a, b);
}

export function concatSlices(a: TextSlice, b: TextSlice): TextSlice {
  return replaceTextContent(a, a.text.length, 0, b);
}

/** Marks intersecting `[from, to)`, clipped to it and shifted by `shift`. */
export function clipMarks(
  marks: readonly TextMark[],
  content: TextContent,
  from: number,
  to: number,
  shift: number,
): readonly { mark: TextMark; from: number; to: number }[] {
  const out: { mark: TextMark; from: number; to: number }[] = [];
  for (const mark of marks) {
    const mFrom = resolveBoundaryOffset(content, mark.from);
    const mTo = resolveBoundaryOffset(content, mark.to);
    const clipFrom = Math.max(mFrom, from);
    const clipTo = Math.min(mTo, to);
    if (clipTo <= clipFrom) continue;
    out.push({ from: clipFrom + shift, mark, to: clipTo + shift });
  }
  return out;
}

export function reanchorMarks(
  clipped: readonly { mark: TextMark; from: number; to: number }[],
  content: TextContent,
): readonly TextMark[] {
  return clipped.map((entry) => reanchorMark(entry, content));
}

export function reanchorMark(
  entry: { mark: TextMark; from: number; to: number },
  content: TextContent,
): TextMark {
  return {
    ...entry.mark,
    from: boundaryAtOffset(content, entry.from, entry.mark.from.stickiness),
    to: boundaryAtOffset(content, entry.to, entry.mark.to.stickiness),
  };
}

export function markOver(
  node: TextLeafNode,
  kind: TextMarkKind,
  from: number,
  to: number,
  id: string,
): TextMark {
  return {
    from: boundaryAtOffset(node.content, from, "before"),
    id,
    kind,
    to: boundaryAtOffset(node.content, to, "after"),
  };
}

/** A copy of `mark` re-spanned to `[from, to)`, preserving its kind and attrs. */
export function cloneMarkOver(
  node: TextLeafNode,
  mark: TextMark,
  from: number,
  to: number,
  id: string,
): TextMark {
  return {
    ...(mark.attrs ? { attrs: mark.attrs } : {}),
    from: boundaryAtOffset(node.content, from, "before"),
    id,
    kind: mark.kind,
    to: boundaryAtOffset(node.content, to, "after"),
  };
}

/** The href of a `link` mark covering the caret/selection start, or null. */
export function activeLinkHref(store: EditorStore): string | null {
  const range = textRange(store);
  if (!range) return null;
  // A pending link set at this caret wins over the underlying mark (docs/018 §2.0).
  const pending = store.pendingFormat;
  if (
    pending &&
    pending.node === range.start.node &&
    pending.offset === range.start.offset &&
    pointsEqual(range.start, range.end)
  ) {
    return pending.link ? pending.link.href : null;
  }
  const node = store.getNode(range.start.node);
  if (!node || node.kind !== "text") return null;
  const at = range.start.offset;
  for (const mark of node.marks) {
    if (mark.kind !== "link") continue;
    const mFrom = resolveBoundaryOffset(node.content, mark.from);
    const mTo = resolveBoundaryOffset(node.content, mark.to);
    if (mFrom <= at && at <= mTo) {
      const href = mark.attrs?.href;
      return typeof href === "string" ? href : "";
    }
  }
  return null;
}

/**
 * The mark steps that apply a collapsed-caret pending format to a freshly
 * inserted range `[at, at+length)` on `node` (docs/018 §2.0). The typing path
 * folds these into the same transaction as the `replace-text` insert, so the run
 * is one undo step and the marks anchor to the post-insert content.
 *
 * `postContent` is the leaf content *after* the insert (the caller already
 * computed it); the store still holds the pre-insert node, so we read its marks
 * to decide what the inserted text already inherits. A pending mark the inserted
 * run already inherits (the caret sat inside an existing same-kind mark, which
 * the §4.5 remap extends over the new text) needs no step; a covering mark the
 * caret toggled *off* is carved out so "caret inside bold, press Bold, type"
 * yields unbolded text.
 */
export function pendingFormatMarkSteps(
  store: EditorStore,
  pending: PendingFormat,
  node: NodeId,
  at: number,
  length: number,
  postContent: TextContent,
): readonly Step[] {
  if (length <= 0) return [];
  const pre = store.getNode(node);
  if (!pre || pre.kind !== "text") return [];
  const covering = new Set<TextMarkKind>();
  const steps: Step[] = [];
  for (const mark of pre.marks) {
    if (mark.kind === "link") continue;
    const from = resolveBoundaryOffset(pre.content, mark.from);
    const to = resolveBoundaryOffset(pre.content, mark.to);
    // Strictly inside (`to > at`), not merely abutting: a mark that ends exactly
    // at the caret will NOT extend over the inserted run (the §4.5 remap clamps
    // its end at the insertion point), so the run still needs its own mark. This
    // is what makes a sticky pending format keep marking each new character
    // instead of silently relying on an extension that never happens.
    if (!(from <= at && to > at)) continue;
    covering.add(mark.kind);
    // A covering mark the caret turned off is split so the inserted run escapes
    // it; the §4.5 remap will have extended it over the insert otherwise.
    if (!pending.marks.has(mark.kind)) {
      steps.push({ mark, node, type: "remove-mark" });
      if (from < at) {
        steps.push({
          mark: formatMarkSpan(postContent, mark.kind, from, at, store, mark),
          node,
          type: "add-mark",
        });
      }
      steps.push({
        mark: formatMarkSpan(
          postContent,
          mark.kind,
          at + length,
          to + length,
          store,
          mark,
        ),
        node,
        type: "add-mark",
      });
    }
  }
  // Add each desired mark the inserted run does not already inherit.
  for (const kind of pending.marks) {
    if (covering.has(kind)) continue;
    steps.push({
      mark: formatMarkSpan(postContent, kind, at, at + length, store),
      node,
      type: "add-mark",
    });
  }
  if (pending.link && pending.link.href.length > 0) {
    steps.push({
      mark: {
        attrs: { href: pending.link.href },
        from: boundaryAtOffset(postContent, at, "before"),
        id: store.nextMarkId(),
        kind: "link",
        to: boundaryAtOffset(postContent, at + length, "after"),
      },
      node,
      type: "add-mark",
    });
  }
  return steps;
}

/** A format range mark over `[from, to)` of `content`, carrying `source`'s attrs. */
export function formatMarkSpan(
  content: TextContent,
  kind: TextMarkKind,
  from: number,
  to: number,
  store: EditorStore,
  source?: TextMark,
): TextMark {
  return {
    ...(source?.attrs ? { attrs: source.attrs } : {}),
    from: boundaryAtOffset(content, from, "before"),
    id: store.nextMarkId(),
    kind,
    to: boundaryAtOffset(content, to, "after"),
  };
}

export function isRangeMarked(
  node: TextLeafNode,
  kind: TextMarkKind,
  from: number,
  to: number,
): boolean {
  // Active when the whole range is covered by marks of this kind (one mark, or
  // adjacent marks with no gap).
  let cursor = from;
  for (const mark of [...node.marks].sort(
    (a, b) => boundaryOffset(node, a) - boundaryOffset(node, b),
  )) {
    if (mark.kind !== kind) continue;
    const mFrom = resolveBoundaryOffset(node.content, mark.from);
    const mTo = resolveBoundaryOffset(node.content, mark.to);
    if (mFrom > cursor) return false;
    if (mTo > cursor) cursor = mTo;
    if (cursor >= to) return true;
  }
  return cursor >= to;
}

export function boundaryOffset(node: TextLeafNode, mark: TextMark): number {
  return resolveBoundaryOffset(node.content, mark.from);
}

// Grapheme boundaries via Intl.Segmenter, so Backspace/Delete remove a whole
// cluster (emoji, combining marks), not a UTF-16 unit (docs/011 §13.1).
export const graphemeSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

export function graphemeBoundaries(text: string): readonly number[] {
  if (!graphemeSegmenter) {
    return Array.from({ length: text.length + 1 }, (_v, i) => i);
  }
  const bounds = [0];
  for (const segment of graphemeSegmenter.segment(text)) {
    bounds.push(segment.index + segment.segment.length);
  }
  return bounds;
}

export function graphemeBefore(text: string, offset: number): number {
  const bounds = graphemeBoundaries(text);
  let prev = 0;
  for (const b of bounds) {
    if (b >= offset) break;
    prev = b;
  }
  return prev;
}

export function graphemeAfter(text: string, offset: number): number {
  const bounds = graphemeBoundaries(text);
  for (const b of bounds) {
    if (b > offset) return b;
  }
  return text.length;
}

/**
 * Delete the document range `[start, end)`, returning the caret position and
 * the caret node's resulting content. Handles collapsed, same-node, and
 * same-parent cross-node ranges; a cross-parent range is left to the caller's
 * guard (textRange only reports comparable ranges).
 */
export function deleteRange(
  tr: TransactionBuilder,
  store: EditorStore,
  start: TextPoint,
  end: TextPoint,
): { node: NodeId; offset: number; content: TextContent } {
  const startNode = store.requireTextNode(start.node);
  if (start.node === end.node) {
    if (start.offset !== end.offset) {
      tr.replaceText({
        at: start.offset,
        inserted: "",
        node: start.node,
        removed: startNode.content.text.slice(start.offset, end.offset),
      });
    }
    const content = replaceTextContent(
      startNode.content,
      start.offset,
      end.offset - start.offset,
      EMPTY_SLICE,
    );
    return { content, node: start.node, offset: start.offset };
  }
  const endNode = store.requireTextNode(end.node);
  // A cross-scope range (endpoints in different containers — two table cells, a
  // cell and the body, a list item and a paragraph) is not a deletable text run:
  // merging tails across the boundary would strand the far block (empty a cell,
  // leave intermediate siblings untouched). The owned model has no cross-container
  // text range — that gesture is the table cell-range overlay, or block-atomic —
  // so deletion collapses to a no-op at `start` rather than corrupting the grid.
  // Same-parent multi-block ranges (body paragraphs, cells of one row) are the
  // supported case and fall through. Selection confinement at the creation sites
  // (drag, vertical extend, select-all) keeps such a range from forming; this is
  // the central safety net if one still reaches an editing command.
  if (
    store.parentEntry(start.node)?.parent !==
    store.parentEntry(end.node)?.parent
  ) {
    return {
      content: startNode.content,
      node: start.node,
      offset: start.offset,
    };
  }
  // Clip the start node's tail, then append the end node's tail, then remove the
  // fully covered blocks between them plus the end node.
  tr.replaceText({
    at: start.offset,
    inserted: "",
    node: start.node,
    removed: startNode.content.text.slice(start.offset),
  });
  const aHead = sliceTextContent(startNode.content, 0, start.offset);
  const bTail = sliceTextContent(
    endNode.content,
    end.offset,
    endNode.content.text.length,
  );
  tr.spliceText({
    at: start.offset,
    inserted: bTail,
    node: start.node,
    removed: "",
  });
  const finalContent = concatSlices(aHead, bTail);
  const shift = start.offset - end.offset;
  for (const mark of clipMarks(
    endNode.marks,
    endNode.content,
    end.offset,
    endNode.content.text.length,
    shift,
  )) {
    tr.addMark(start.node, reanchorMark(mark, finalContent));
  }
  const covered = coveredSiblings(store, start.node, end.node);
  for (const id of covered) {
    const entry = store.parentEntry(id);
    if (entry) tr.removeNode(entry.parent, entry.index, store.requireNode(id));
  }
  tr.redirect((pos) =>
    pos.node === end.node
      ? { node: start.node, offset: start.offset + (pos.offset - end.offset) }
      : undefined,
  );
  return { content: finalContent, node: start.node, offset: start.offset };
}

/** Deepest visual indent level a block can reach (mirrors the legacy editor). */
export const MAX_INDENT = 8;
