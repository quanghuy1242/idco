/**
 * Command compiler and query registry for the owned-model editor (docs/011 §6.12).
 *
 * Why this file exists
 * --------------------
 * The public surface speaks intents ("split the block", "delete back"), never
 * raw steps. Each command is a pure function from the current store plus the
 * command to a `TransactionBuilder`, or `null` when the intent does not apply.
 * `store.command(c)` looks the command up here, compiles it, and dispatches the
 * result through the single chokepoint, so the host inherits invertible history,
 * scoped notify, and the no-cascade guarantee for free (§12.4).
 *
 * The read-side counterpart is the query registry: pure functions over the
 * current state for toolbar active/enabled flags (`isMarkActive`, `canIndent`).
 * Queries never build steps.
 *
 * Split and merge are composite transactions over the existing step set (§6.2),
 * not new step kinds, so they invert for free by reversing the step list.
 */
import {
  boundaryAtOffset,
  makeStructuralNode,
  makeTextNode,
  pointAtOffset,
  replaceTextContent,
  resolveBoundaryOffset,
  sliceTextContent,
  type EditorNode,
  type EditorSelection,
  type NodeId,
  type StructuralNode,
  type TextContent,
  type TextLeafNode,
  type TextLeafType,
  type TextMark,
  type TextMarkKind,
  type TextPoint,
  type TextSlice,
} from "./model";
import type { EditorStore, TransactionBuilder } from "./store";

const EMPTY_SLICE: TextSlice = { runs: [], text: "" };

/** A high-level editing intent. Never a raw `Step` (docs/011 §12.2). */
export type EditorCommand =
  | { readonly type: "insert-text"; readonly text: string }
  | { readonly type: "delete-backward" }
  | { readonly type: "delete-forward" }
  | { readonly type: "delete-selection" }
  | { readonly type: "split-block" }
  | {
      readonly type: "toggle-mark";
      readonly mark: TextMarkKind;
    }
  | { readonly type: "set-block-type"; readonly blockType: TextLeafType }
  | { readonly type: "indent" }
  | { readonly type: "outdent" };

export type EditorCommandType = EditorCommand["type"];

/** A read-only query over current state for toolbar enabled/active flags. */
export type EditorQuery =
  | { readonly type: "is-mark-active"; readonly mark: TextMarkKind }
  | { readonly type: "can-indent" }
  | { readonly type: "can-outdent" }
  | { readonly type: "current-block-type" };

type CommandCompiler = (
  store: EditorStore,
  command: EditorCommand,
) => TransactionBuilder | null;

const compilers: { [K in EditorCommandType]: CommandCompiler } = {
  "delete-backward": (store) => compileDelete(store, -1),
  "delete-forward": (store) => compileDelete(store, 1),
  "delete-selection": (store) => compileDeleteSelection(store),
  indent: (store) => compileIndent(store, "indent"),
  "insert-text": (store, command) =>
    command.type === "insert-text"
      ? compileInsertText(store, command.text)
      : null,
  outdent: (store) => compileIndent(store, "outdent"),
  "set-block-type": (store, command) =>
    command.type === "set-block-type"
      ? compileSetBlockType(store, command.blockType)
      : null,
  "split-block": (store) => compileSplit(store),
  "toggle-mark": (store, command) =>
    command.type === "toggle-mark"
      ? compileToggleMark(store, command.mark)
      : null,
};

/** Compile a command to a transaction, or `null` when it does not apply. */
export function compileCommand(
  store: EditorStore,
  command: EditorCommand,
): TransactionBuilder | null {
  return compilers[command.type](store, command);
}

/** Answer a read-only query over the current state. */
export function runQuery(
  store: EditorStore,
  query: EditorQuery,
): boolean | TextLeafType | null {
  switch (query.type) {
    case "is-mark-active":
      return isMarkActive(store, query.mark);
    case "can-indent":
      return canIndent(store);
    case "can-outdent":
      return canOutdent(store);
    case "current-block-type":
      return currentBlockType(store);
  }
}

// ---------------------------------------------------------------------------
// Prose editing: insert, delete, split, merge.
// ---------------------------------------------------------------------------

function compileInsertText(
  store: EditorStore,
  text: string,
): TransactionBuilder | null {
  const range = textRange(store);
  if (!range) return null;
  const tr = store.transaction();
  const caret = deleteRange(tr, store, range.start, range.end);
  const insertedLength = text.length;
  tr.replaceText({
    at: caret.offset,
    inserted: text,
    node: caret.node,
    removed: "",
  });
  const finalContent = replaceTextContent(
    caret.content,
    caret.offset,
    0,
    store.allocator.createTextSlice(text),
  );
  const focus = pointAtOffset(
    caret.node,
    finalContent,
    caret.offset + insertedLength,
  );
  return tr.setSelection({ anchor: focus, focus, type: "text" });
}

function compileDeleteSelection(store: EditorStore): TransactionBuilder | null {
  const range = textRange(store);
  if (!range || pointsEqual(range.start, range.end)) return null;
  const tr = store.transaction();
  const caret = deleteRange(tr, store, range.start, range.end);
  const focus = pointAtOffset(caret.node, caret.content, caret.offset);
  return tr.setSelection({ anchor: focus, focus, type: "text" });
}

function compileDelete(
  store: EditorStore,
  direction: -1 | 1,
): TransactionBuilder | null {
  const range = textRange(store);
  if (!range) return null;
  // A non-collapsed selection deletes the range regardless of direction.
  if (!pointsEqual(range.start, range.end)) {
    return compileDeleteSelection(store);
  }
  const node = store.requireTextNode(range.start.node);
  const offset = range.start.offset;
  const length = node.content.text.length;
  if (direction < 0) {
    if (offset > 0) {
      const from = graphemeBefore(node.content.text, offset);
      return deleteWithin(store, node, from, offset);
    }
    return mergeWithNeighbor(store, node, "backward");
  }
  if (offset < length) {
    const to = graphemeAfter(node.content.text, offset);
    return deleteWithin(store, node, offset, to);
  }
  return mergeWithNeighbor(store, node, "forward");
}

function deleteWithin(
  store: EditorStore,
  node: TextLeafNode,
  from: number,
  to: number,
): TransactionBuilder {
  const tr = store.transaction();
  const removed = node.content.text.slice(from, to);
  tr.replaceText({ at: from, inserted: "", node: node.id, removed });
  const finalContent = replaceTextContent(
    node.content,
    from,
    to - from,
    EMPTY_SLICE,
  );
  const focus = pointAtOffset(node.id, finalContent, from);
  return tr.setSelection({ anchor: focus, focus, type: "text" });
}

function compileSplit(store: EditorStore): TransactionBuilder | null {
  const range = textRange(store);
  if (!range) return null;
  const node = store.requireTextNode(range.start.node);
  // Enter on an empty list item outdents instead of inserting an empty item.
  if (
    node.type === "listitem" &&
    node.content.text.length === 0 &&
    canOutdent(store)
  ) {
    return compileIndent(store, "outdent");
  }
  const tr = store.transaction();
  // A range first collapses (Enter over a selection replaces it), then splits.
  const caret = pointsEqual(range.start, range.end)
    ? { content: node.content, node: node.id, offset: range.start.offset }
    : deleteRange(tr, store, range.start, range.end);
  const splitNode = store.requireTextNode(caret.node);
  const at = caret.offset;
  const entry = store.parentEntry(splitNode.id);
  if (!entry) return null;
  const length = caret.content.text.length;
  const tailSlice = sliceTextContent(caret.content, at, length);
  const newId = tr.allocator.createNodeId();
  const newType: TextLeafType =
    splitNode.type === "heading" ? "paragraph" : splitNode.type;
  const tailMarks = clipMarks(splitNode.marks, caret.content, at, length, -at);
  const newNode = makeTextNode({
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
    removed: caret.content.text.slice(at),
  });
  tr.insertNode(entry.parent, entry.index + 1, newNode);
  // Positions past the split point belong to the new block now (§16 redirect).
  tr.redirect((pos) =>
    pos.node === splitNode.id && pos.offset > at
      ? { node: newId, offset: pos.offset - at }
      : undefined,
  );
  const focus = pointAtOffset(newId, tailSlice, 0);
  return tr.setSelection({ anchor: focus, focus, type: "text" });
}

function mergeWithNeighbor(
  store: EditorStore,
  node: TextLeafNode,
  direction: "backward" | "forward",
): TransactionBuilder | null {
  const neighbor =
    direction === "backward"
      ? previousTextLeaf(store, node.id)
      : nextTextLeaf(store, node.id);
  if (!neighbor) {
    // Backspace at the very start of a list item with no previous leaf outdents.
    if (
      direction === "backward" &&
      node.type === "listitem" &&
      canOutdent(store)
    )
      return compileIndent(store, "outdent");
    return null;
  }
  const target = direction === "backward" ? neighbor : node;
  const source = direction === "backward" ? node : neighbor;
  const tr = store.transaction();
  const joinOffset = target.content.text.length;
  mergeLeafInto(tr, store, target, source, 0);
  const finalContent = concatContent(target.content, source.content);
  const focus = pointAtOffset(target.id, finalContent, joinOffset);
  return tr.setSelection({ anchor: focus, focus, type: "text" });
}

/**
 * Append `source`'s content from `srcFrom` onto the end of `target`, move the
 * affected source marks across (shifted into target coordinates), and remove
 * source. Shared by merge and cross-node range delete.
 */
function mergeLeafInto(
  tr: TransactionBuilder,
  store: EditorStore,
  target: TextLeafNode,
  source: TextLeafNode,
  srcFrom: number,
): void {
  const targetLen = target.content.text.length;
  const srcLen = source.content.text.length;
  const tailSlice = sliceTextContent(source.content, srcFrom, srcLen);
  tr.spliceText({
    at: targetLen,
    inserted: tailSlice,
    node: target.id,
    removed: "",
  });
  const mergedContent = replaceTextContent(
    target.content,
    targetLen,
    0,
    tailSlice,
  );
  const shift = targetLen - srcFrom;
  for (const mark of clipMarks(
    source.marks,
    source.content,
    srcFrom,
    srcLen,
    shift,
  )) {
    tr.addMark(target.id, reanchorMark(mark, mergedContent));
  }
  const entry = store.parentEntry(source.id);
  if (entry) tr.removeNode(entry.parent, entry.index, source);
  tr.redirect((pos) =>
    pos.node === source.id
      ? { node: target.id, offset: targetLen + (pos.offset - srcFrom) }
      : undefined,
  );
}

/**
 * Delete the document range `[start, end)`, returning the caret position and
 * the caret node's resulting content. Handles collapsed, same-node, and
 * same-parent cross-node ranges; a cross-parent range is left to the caller's
 * guard (textRange only reports comparable ranges).
 */
function deleteRange(
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

// ---------------------------------------------------------------------------
// Marks and block type.
// ---------------------------------------------------------------------------

function compileToggleMark(
  store: EditorStore,
  kind: TextMarkKind,
): TransactionBuilder | null {
  const range = textRange(store);
  // Phase 5.5 toggles a real range on one leaf; a collapsed caret (pending
  // format) and cross-leaf toggles are Phase 8 toolbar work.
  if (!range || range.start.node !== range.end.node) return null;
  if (range.start.offset === range.end.offset) return null;
  const node = store.requireTextNode(range.start.node);
  const from = range.start.offset;
  const to = range.end.offset;
  const tr = store.transaction();
  if (isRangeMarked(node, kind, from, to)) {
    // Remove the covering marks of this kind, re-adding the parts outside the
    // toggled range so a partial overlap keeps its remaining formatting.
    for (const mark of node.marks) {
      if (mark.kind !== kind) continue;
      const mFrom = resolveBoundaryOffset(node.content, mark.from);
      const mTo = resolveBoundaryOffset(node.content, mark.to);
      if (mTo <= from || mFrom >= to) continue;
      tr.removeMark(node.id, mark);
      if (mFrom < from) {
        tr.addMark(node.id, markOver(node, kind, mFrom, from, `${mark.id}_l`));
      }
      if (mTo > to) {
        tr.addMark(node.id, markOver(node, kind, to, mTo, `${mark.id}_r`));
      }
    }
  } else {
    tr.addMark(node.id, markOver(node, kind, from, to, newMarkId(store)));
  }
  return tr.setSelection(store.selection as EditorSelection);
}

function compileSetBlockType(
  store: EditorStore,
  blockType: TextLeafType,
): TransactionBuilder | null {
  const range = textRange(store);
  if (!range) return null;
  const node = store.requireTextNode(range.start.node);
  if (node.type === blockType) return null;
  const tr = store.transaction();
  tr.push({
    from: node.type,
    node: node.id,
    to: blockType,
    type: "set-node-type",
  });
  return tr.setSelection(store.selection as EditorSelection);
}

// ---------------------------------------------------------------------------
// List editing: indent / outdent (docs/010 Phase 5.5 AC6).
// ---------------------------------------------------------------------------

function compileIndent(
  store: EditorStore,
  direction: "indent" | "outdent",
): TransactionBuilder | null {
  const item = currentListItem(store);
  if (!item) return null;
  return direction === "indent"
    ? compileIndentItem(store, item)
    : compileOutdentItem(store, item);
}

function compileIndentItem(
  store: EditorStore,
  item: ListItemContext,
): TransactionBuilder | null {
  // Need a previous sibling in the same list to nest under.
  if (item.index === 0) return null;
  const tr = store.transaction();
  const prevId = item.list.children[item.index - 1]!;
  const prev = store.requireNode(prevId);
  if (prev.kind === "structural" && prev.type === "listitem") {
    // Reuse the previous item's trailing sublist, or create one, then move in.
    const last = prev.children.at(-1);
    const lastNode = last ? store.requireNode(last) : undefined;
    if (
      lastNode &&
      lastNode.kind === "structural" &&
      lastNode.type === "list"
    ) {
      tr.push({
        from: { index: item.index, parent: item.list.id },
        node: item.id,
        to: { index: lastNode.children.length, parent: lastNode.id },
        type: "move-node",
      });
    } else {
      const sublistId = tr.allocator.createNodeId();
      tr.insertNode(
        prev.id,
        prev.children.length,
        makeStructuralNode({ id: sublistId, type: "list" }),
      );
      tr.push({
        from: { index: item.index, parent: item.list.id },
        node: item.id,
        to: { index: 0, parent: sublistId },
        type: "move-node",
      });
    }
  } else {
    // Previous sibling is a plain leaf item: wrap it into a structural item
    // holding [prevLeaf, sublist[item]]. Order keeps every index live-valid.
    const containerId = tr.allocator.createNodeId();
    const sublistId = tr.allocator.createNodeId();
    tr.insertNode(
      item.list.id,
      item.index,
      makeStructuralNode({ id: containerId, type: "listitem" }),
    );
    tr.insertNode(
      containerId,
      0,
      makeStructuralNode({ id: sublistId, type: "list" }),
    );
    // Move prev (still at index-1; the container inserted at `index` sits after
    // it) into the container before the sublist.
    tr.push({
      from: { index: item.index - 1, parent: item.list.id },
      node: prevId,
      to: { index: 0, parent: containerId },
      type: "move-node",
    });
    // After prev leaves the list, the item that was at index+1 shifts down to
    // `index`; move it into the sublist.
    tr.push({
      from: { index: item.index, parent: item.list.id },
      node: item.id,
      to: { index: 0, parent: sublistId },
      type: "move-node",
    });
  }
  return tr.setSelection(store.selection as EditorSelection);
}

function compileOutdentItem(
  store: EditorStore,
  item: ListItemContext,
): TransactionBuilder | null {
  const listEntry = store.parentEntry(item.list.id);
  if (!listEntry) return null;
  const grandparent = store.requireNode(listEntry.parent);
  const tr = store.transaction();
  if (grandparent.kind === "structural" && grandparent.type === "listitem") {
    // Nested list inside a structural item: lift the item to be the next sibling
    // of that item in the outer list.
    const outerEntry = store.parentEntry(grandparent.id);
    if (!outerEntry) return null;
    tr.push({
      from: { index: item.index, parent: item.list.id },
      node: item.id,
      to: { index: outerEntry.index + 1, parent: outerEntry.parent },
      type: "move-node",
    });
    // Drop the sublist if it is now empty.
    if (item.list.children.length === 1) {
      tr.removeNode(grandparent.id, listEntry.index, item.list);
    }
    return tr.setSelection(store.selection as EditorSelection);
  }
  // Top-level list (directly in the body): move the item out after the list and
  // make it a paragraph. Items after it stay in the list.
  if (item.node.kind === "text" && item.node.type === "listitem") {
    tr.push({
      from: { index: item.index, parent: item.list.id },
      node: item.id,
      to: { index: listEntry.index + 1, parent: listEntry.parent },
      type: "move-node",
    });
    tr.push({
      from: "listitem",
      node: item.id,
      to: "paragraph",
      type: "set-node-type",
    });
    if (item.list.children.length === 1) {
      tr.removeNode(listEntry.parent, listEntry.index, item.list);
    }
    return tr.setSelection(store.selection as EditorSelection);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Queries.
// ---------------------------------------------------------------------------

function isMarkActive(store: EditorStore, kind: TextMarkKind): boolean {
  const range = textRange(store);
  if (!range || range.start.node !== range.end.node) return false;
  if (range.start.offset === range.end.offset) {
    // Collapsed: active if any mark of this kind contains the caret.
    const node = store.requireTextNode(range.start.node);
    return node.marks.some((mark) => {
      if (mark.kind !== kind) return false;
      const mFrom = resolveBoundaryOffset(node.content, mark.from);
      const mTo = resolveBoundaryOffset(node.content, mark.to);
      return mFrom <= range.start.offset && range.start.offset <= mTo;
    });
  }
  const node = store.requireTextNode(range.start.node);
  return isRangeMarked(node, kind, range.start.offset, range.end.offset);
}

function canIndent(store: EditorStore): boolean {
  const item = currentListItem(store);
  return !!item && item.index > 0;
}

function canOutdent(store: EditorStore): boolean {
  const item = currentListItem(store);
  if (!item) return false;
  const listEntry = store.parentEntry(item.list.id);
  return !!listEntry;
}

function currentBlockType(store: EditorStore): TextLeafType | null {
  const range = textRange(store);
  if (!range) return null;
  const node = store.getNode(range.start.node);
  return node && node.kind === "text" ? node.type : null;
}

// ---------------------------------------------------------------------------
// Shared helpers.
// ---------------------------------------------------------------------------

type ListItemContext = {
  readonly id: NodeId;
  readonly node: EditorNode;
  readonly list: StructuralNode;
  readonly index: number;
};

function currentListItem(store: EditorStore): ListItemContext | null {
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

type TextRange = { readonly start: TextPoint; readonly end: TextPoint };

/** The current text selection ordered start→end, or null when not editable. */
function textRange(store: EditorStore): TextRange | null {
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

function pointsEqual(a: TextPoint, b: TextPoint): boolean {
  return a.node === b.node && a.offset === b.offset;
}

/** Top-level sibling blocks fully covered by a same-parent range, plus the end node. */
function coveredSiblings(
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

function previousTextLeaf(store: EditorStore, id: NodeId): TextLeafNode | null {
  const index = store.order.indexOf(id);
  for (let i = index - 1; i >= 0; i -= 1) {
    const node = store.getNode(store.order[i]!);
    if (node && node.kind === "text") return node;
  }
  return null;
}

function nextTextLeaf(store: EditorStore, id: NodeId): TextLeafNode | null {
  const index = store.order.indexOf(id);
  if (index < 0) return null;
  for (let i = index + 1; i < store.order.length; i += 1) {
    const node = store.getNode(store.order[i]!);
    if (node && node.kind === "text") return node;
  }
  return null;
}

function concatContent(a: TextContent, b: TextContent): TextContent {
  return concatSlices(a, b);
}

function concatSlices(a: TextSlice, b: TextSlice): TextSlice {
  return replaceTextContent(a, a.text.length, 0, b);
}

/** Marks intersecting `[from, to)`, clipped to it and shifted by `shift`. */
function clipMarks(
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

function reanchorMarks(
  clipped: readonly { mark: TextMark; from: number; to: number }[],
  content: TextContent,
): readonly TextMark[] {
  return clipped.map((entry) => reanchorMark(entry, content));
}

function reanchorMark(
  entry: { mark: TextMark; from: number; to: number },
  content: TextContent,
): TextMark {
  return {
    ...entry.mark,
    from: boundaryAtOffset(content, entry.from, entry.mark.from.stickiness),
    to: boundaryAtOffset(content, entry.to, entry.mark.to.stickiness),
  };
}

function markOver(
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

function isRangeMarked(
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

function boundaryOffset(node: TextLeafNode, mark: TextMark): number {
  return resolveBoundaryOffset(node.content, mark.from);
}

let markCounter = 0;
function newMarkId(store: EditorStore): string {
  markCounter += 1;
  return `${store.allocator.clientId}_mark_${markCounter}`;
}

// Grapheme boundaries via Intl.Segmenter, so Backspace/Delete remove a whole
// cluster (emoji, combining marks), not a UTF-16 unit (docs/011 §13.1).
const graphemeSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

function graphemeBoundaries(text: string): readonly number[] {
  if (!graphemeSegmenter) {
    return Array.from({ length: text.length + 1 }, (_v, i) => i);
  }
  const bounds = [0];
  for (const segment of graphemeSegmenter.segment(text)) {
    bounds.push(segment.index + segment.segment.length);
  }
  return bounds;
}

function graphemeBefore(text: string, offset: number): number {
  const bounds = graphemeBoundaries(text);
  let prev = 0;
  for (const b of bounds) {
    if (b >= offset) break;
    prev = b;
  }
  return prev;
}

function graphemeAfter(text: string, offset: number): number {
  const bounds = graphemeBoundaries(text);
  for (const b of bounds) {
    if (b > offset) return b;
  }
  return text.length;
}
