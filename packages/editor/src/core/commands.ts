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
  makeObjectNode,
  makeStructuralNode,
  makeTextNode,
  pointAtOffset,
  replaceTextContent,
  resolveBoundaryOffset,
  sliceTextContent,
  type EditorNode,
  type EditorSelection,
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
} from "./model";
import { bakeObjectData } from "./bake";
import type { MarkdownShortcut } from "./markdown-shortcuts";
import { safeHref } from "./url-safety";
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
  | {
      readonly type: "set-link";
      readonly href: string;
    }
  | { readonly type: "clear-link" }
  | {
      readonly type: "set-block-type";
      readonly blockType: TextLeafType;
      /** Optional heading tag (`h1`..`h6`) carried as a `tag` attr. */
      readonly tag?: string;
    }
  | { readonly type: "indent" }
  | { readonly type: "outdent" }
  | {
      readonly type: "move-block";
      readonly node: NodeId;
      /** New index in the body order (clamped). */
      readonly toIndex: number;
    }
  | {
      readonly type: "insert-object";
      readonly objectType: string;
      readonly data: JsonValue;
    }
  | {
      readonly type: "apply-markdown";
      readonly shortcut: MarkdownShortcut;
    }
  | {
      readonly type: "insert-blocks";
      readonly nodes: readonly EditorNode[];
    }
  | {
      readonly type: "set-object-data";
      readonly node: NodeId;
      readonly data: JsonValue;
    };

export type EditorCommandType = EditorCommand["type"];

/** A read-only query over current state for toolbar enabled/active flags. */
export type EditorQuery =
  | { readonly type: "is-mark-active"; readonly mark: TextMarkKind }
  | { readonly type: "can-indent" }
  | { readonly type: "can-outdent" }
  | { readonly type: "current-block-type" }
  | { readonly type: "active-link-href" };

type CommandCompiler = (
  store: EditorStore,
  command: EditorCommand,
) => TransactionBuilder | null;

const compilers: { [K in EditorCommandType]: CommandCompiler } = {
  "apply-markdown": (store, command) =>
    command.type === "apply-markdown"
      ? compileApplyMarkdown(store, command.shortcut)
      : null,
  "clear-link": (store) => compileLink(store, null),
  "delete-backward": (store) => compileDelete(store, -1),
  "delete-forward": (store) => compileDelete(store, 1),
  "delete-selection": (store) => compileDeleteSelection(store),
  indent: (store) => compileIndent(store, "indent"),
  "insert-blocks": (store, command) =>
    command.type === "insert-blocks"
      ? compileInsertBlocks(store, command.nodes)
      : null,
  "insert-object": (store, command) =>
    command.type === "insert-object"
      ? compileInsertObject(store, command.objectType, command.data)
      : null,
  "insert-text": (store, command) =>
    command.type === "insert-text"
      ? compileInsertText(store, command.text)
      : null,
  "move-block": (store, command) =>
    command.type === "move-block"
      ? compileMoveBlock(store, command.node, command.toIndex)
      : null,
  outdent: (store) => compileIndent(store, "outdent"),
  "set-block-type": (store, command) =>
    command.type === "set-block-type"
      ? compileSetBlockType(store, command.blockType, command.tag)
      : null,
  "set-link": (store, command) =>
    command.type === "set-link" ? compileLink(store, command.href) : null,
  "set-object-data": (store, command) =>
    command.type === "set-object-data"
      ? compileSetObjectData(store, command.node, command.data)
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
): boolean | TextLeafType | string | null {
  switch (query.type) {
    case "is-mark-active":
      return isMarkActive(store, query.mark);
    case "can-indent":
      return canIndent(store);
    case "can-outdent":
      return canOutdent(store);
    case "current-block-type":
      return currentBlockType(store);
    case "active-link-href":
      return activeLinkHref(store);
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
  const tr = store.transaction();
  // Keep the FOCUSED leaf (`node`) as the surviving node so a cross-block merge
  // never removes the editable element the caret and the OS keyboard are bound
  // to. Destroying a just-focused EditContext host makes mobile re-evaluate the
  // soft keyboard (the Android flicker on the native input path), and handing
  // focus to a different leaf mid-autorepeat re-seeds a fresh controller (the
  // held-Backspace caret glitch on the polyfill path). Forward Delete already
  // merges the next leaf *into* `node`; backward Backspace folds the previous
  // leaf into `node`'s head instead of the reverse, with `node` adopting the
  // previous leaf's block type/attrs so "Backspace a paragraph into a heading"
  // still yields a heading (merge-into-previous semantics).
  if (direction === "forward") {
    const joinOffset = node.content.text.length;
    mergeLeafInto(tr, store, node, neighbor, 0);
    const finalContent = concatContent(node.content, neighbor.content);
    const focus = pointAtOffset(node.id, finalContent, joinOffset);
    return tr.setSelection({ anchor: focus, focus, type: "text" });
  }
  // Backward. Fold in place only when the previous leaf is the immediately
  // adjacent block. If a non-text node (an object/structural block) sits between
  // them, `previousTextLeaf` reached across it, so keep the old merge-into-
  // previous to leave the merged content on the same side of that node as before
  // — a rare case where we accept removing the focused leaf to preserve order.
  const adjacent =
    store.order.indexOf(neighbor.id) === store.order.indexOf(node.id) - 1;
  const joinOffset = neighbor.content.text.length;
  if (!adjacent) {
    mergeLeafInto(tr, store, neighbor, node, 0);
    const finalContent = concatContent(neighbor.content, node.content);
    const focus = pointAtOffset(neighbor.id, finalContent, joinOffset);
    return tr.setSelection({ anchor: focus, focus, type: "text" });
  }
  mergeHeadInto(tr, store, node, neighbor);
  const finalContent = concatContent(neighbor.content, node.content);
  const focus = pointAtOffset(node.id, finalContent, joinOffset);
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
 * The prepend mirror of `mergeLeafInto`: fold `head`'s content onto the FRONT of
 * `survivor` (the focused leaf), move `head`'s marks into the survivor's new
 * prefix, have the survivor adopt `head`'s block type/attrs, then remove `head`.
 * Used by a backward merge that must keep the focused leaf alive so a cross-block
 * Backspace never destroys the editable element the OS keyboard is bound to.
 */
function mergeHeadInto(
  tr: TransactionBuilder,
  store: EditorStore,
  survivor: TextLeafNode,
  head: TextLeafNode,
): void {
  const headLen = head.content.text.length;
  const headSlice = sliceTextContent(head.content, 0, headLen);
  // Prepend `head`'s content (char ids preserved) at the survivor's start; the
  // replace-text remap shifts the survivor's own marks right by `headLen`.
  tr.spliceText({ at: 0, inserted: headSlice, node: survivor.id, removed: "" });
  const mergedContent = concatContent(head.content, survivor.content);
  // `head`'s marks now occupy [0, headLen) of the survivor (no offset shift).
  for (const mark of clipMarks(head.marks, head.content, 0, headLen, 0)) {
    tr.addMark(survivor.id, reanchorMark(mark, mergedContent));
  }
  // Adopt `head`'s block type and attributes (merge-into-previous semantics).
  if (survivor.type !== head.type) {
    tr.push({
      from: survivor.type,
      node: survivor.id,
      to: head.type,
      type: "set-node-type",
    });
  }
  for (const key of unionKeys(survivor.attrs, head.attrs)) {
    const from = survivor.attrs?.[key];
    const to = head.attrs?.[key];
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      tr.push({ from, key, node: survivor.id, to, type: "set-node-attr" });
    }
  }
  const entry = store.parentEntry(head.id);
  if (entry) tr.removeNode(entry.parent, entry.index, head);
  // Positions inside the removed `head` map to the same offset in the survivor
  // (head became the survivor's prefix).
  tr.redirect((pos) =>
    pos.node === head.id
      ? { node: survivor.id, offset: pos.offset }
      : undefined,
  );
}

/** The union of the keys present on either attribute record. */
function unionKeys(
  a: Readonly<Record<string, JsonValue>> | undefined,
  b: Readonly<Record<string, JsonValue>> | undefined,
): readonly string[] {
  const keys = new Set<string>();
  if (a) for (const key of Object.keys(a)) keys.add(key);
  if (b) for (const key of Object.keys(b)) keys.add(key);
  return [...keys];
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

/** One text leaf intersected by a selection, with the local `[from, to)` range. */
type LeafRange = {
  readonly node: TextLeafNode;
  readonly from: number;
  readonly to: number;
};

/**
 * The text leaves a selection covers, each with its local range. A single-leaf
 * selection yields one entry; a cross-leaf selection walks the body order from
 * the start leaf to the end leaf (top-level prose, which is blog parity — nested
 * list-item leaves are a books follow-on). Zero-length local ranges are dropped.
 */
function leafRangesInSelection(store: EditorStore): readonly LeafRange[] {
  const range = textRange(store);
  if (!range) return [];
  if (range.start.node === range.end.node) {
    const node = store.requireTextNode(range.start.node);
    if (range.start.offset === range.end.offset) return [];
    return [{ from: range.start.offset, node, to: range.end.offset }];
  }
  const order = store.order;
  const startIndex = order.indexOf(range.start.node);
  const endIndex = order.indexOf(range.end.node);
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) return [];
  const out: LeafRange[] = [];
  for (let i = startIndex; i <= endIndex; i += 1) {
    const node = store.getNode(order[i]!);
    if (!node || node.kind !== "text") continue;
    const from = i === startIndex ? range.start.offset : 0;
    const to = i === endIndex ? range.end.offset : node.content.text.length;
    if (to > from) out.push({ from, node, to });
  }
  return out;
}

/** Every text leaf a (possibly collapsed) range touches, start..end inclusive. */
function coveredTextLeaves(
  store: EditorStore,
  range: TextRange,
): readonly TextLeafNode[] {
  if (range.start.node === range.end.node) {
    return [store.requireTextNode(range.start.node)];
  }
  const order = store.order;
  const startIndex = order.indexOf(range.start.node);
  const endIndex = order.indexOf(range.end.node);
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) return [];
  const out: TextLeafNode[] = [];
  for (let i = startIndex; i <= endIndex; i += 1) {
    const node = store.getNode(order[i]!);
    if (node && node.kind === "text") out.push(node);
  }
  return out;
}

function compileToggleMark(
  store: EditorStore,
  kind: TextMarkKind,
): TransactionBuilder | null {
  const leaves = leafRangesInSelection(store);
  if (leaves.length === 0) return null;
  const tr = store.transaction();
  // Toggle semantics: if every covered range already carries the mark, remove it
  // everywhere; otherwise add it to the parts that lack it. This matches a native
  // toolbar across single- and multi-block selections (AC2).
  const allMarked = leaves.every(({ node, from, to }) =>
    isRangeMarked(node, kind, from, to),
  );
  for (const { node, from, to } of leaves) {
    if (allMarked) {
      removeMarkOverRange(tr, store, node, kind, from, to);
    } else if (!isRangeMarked(node, kind, from, to)) {
      tr.addMark(node.id, markOver(node, kind, from, to, newMarkId(store)));
    }
  }
  return tr.setSelection(store.selection as EditorSelection);
}

/** Remove a mark kind from `[from, to)` on one leaf, re-adding the outside parts. */
function removeMarkOverRange(
  tr: TransactionBuilder,
  store: EditorStore,
  node: TextLeafNode,
  kind: TextMarkKind,
  from: number,
  to: number,
): void {
  for (const mark of node.marks) {
    if (mark.kind !== kind) continue;
    const mFrom = resolveBoundaryOffset(node.content, mark.from);
    const mTo = resolveBoundaryOffset(node.content, mark.to);
    if (mTo <= from || mFrom >= to) continue;
    tr.removeMark(node.id, mark);
    if (mFrom < from) {
      tr.addMark(
        node.id,
        cloneMarkOver(node, mark, mFrom, from, `${mark.id}_l`),
      );
    }
    if (mTo > to) {
      tr.addMark(node.id, cloneMarkOver(node, mark, to, mTo, `${mark.id}_r`));
    }
  }
}

/**
 * Set or clear a `link` mark over the current selection (AC4 link editing). A
 * non-null href adds/replaces the link with its href attr; null removes it.
 */
function compileLink(
  store: EditorStore,
  href: string | null,
): TransactionBuilder | null {
  const leaves = leafRangesInSelection(store);
  if (leaves.length === 0) return null;
  // Sanitize the href at the model boundary so an unsafe URL never reaches a
  // navigable anchor in the reader render (docs/010 §10.5). An unsafe/empty href
  // clears the link rather than storing a dangerous one.
  const cleaned = href === null ? "" : safeHref(href);
  const tr = store.transaction();
  for (const { node, from, to } of leaves) {
    // Clear any existing link over the range first so set replaces, not stacks.
    removeMarkOverRange(tr, store, node, "link", from, to);
    if (cleaned.length > 0) {
      tr.addMark(node.id, {
        attrs: { href: cleaned },
        from: boundaryAtOffset(node.content, from, "before"),
        id: newMarkId(store),
        kind: "link",
        to: boundaryAtOffset(node.content, to, "after"),
      });
    }
  }
  return tr.setSelection(store.selection as EditorSelection);
}

function compileSetBlockType(
  store: EditorStore,
  blockType: TextLeafType,
  tag?: string,
): TransactionBuilder | null {
  const range = textRange(store);
  if (!range) return null;
  // Apply across every covered leaf so a multi-block selection retypes as one
  // transaction (e.g. turn three paragraphs into headings). Works for a collapsed
  // caret too (start.node === end.node), which the range-based helper would drop.
  const targets = coveredTextLeaves(store, range);
  if (targets.length === 0) return null;
  const tr = store.transaction();
  let changed = false;
  for (const node of targets) {
    if (node.type !== blockType) {
      tr.push({
        from: node.type,
        node: node.id,
        to: blockType,
        type: "set-node-type",
      });
      changed = true;
    }
    // Heading level rides on the `tag` attr; set it (or clear it for non-headings).
    const currentTag = node.attrs?.tag;
    const nextTag = blockType === "heading" ? (tag ?? "h2") : undefined;
    if (currentTag !== nextTag) {
      tr.push({
        from: currentTag,
        key: "tag",
        node: node.id,
        to: nextTag,
        type: "set-node-attr",
      });
      changed = true;
    }
  }
  if (!changed) return null;
  return tr.setSelection(store.selection as EditorSelection);
}

/**
 * Apply a detected markdown shortcut (AC8). Block prefixes strip the prefix and
 * retype the block in one invertible transaction; inline-code wrapping is the
 * docs/010 Phase 9 typing-loop follow-on and compiles to a no-op here.
 */
function compileApplyMarkdown(
  store: EditorStore,
  shortcut: MarkdownShortcut,
): TransactionBuilder | null {
  if (shortcut.kind !== "block") return null;
  const sel = store.selection;
  if (sel?.type !== "text") return null;
  const node = store.getNode(sel.focus.node);
  if (!node || node.kind !== "text") return null;
  const text = node.content.text;
  if (text.length < shortcut.removeTo) return null;
  const tr = store.transaction();
  tr.replaceText({
    at: 0,
    inserted: "",
    node: node.id,
    removed: text.slice(0, shortcut.removeTo),
  });
  if (node.type !== shortcut.blockType) {
    tr.push({
      from: node.type,
      node: node.id,
      to: shortcut.blockType,
      type: "set-node-type",
    });
  }
  const nextTag =
    shortcut.blockType === "heading" ? (shortcut.tag ?? "h2") : undefined;
  if (node.attrs?.tag !== nextTag) {
    tr.push({
      from: node.attrs?.tag,
      key: "tag",
      node: node.id,
      to: nextTag,
      type: "set-node-attr",
    });
  }
  const finalContent = replaceTextContent(
    node.content,
    0,
    shortcut.removeTo,
    EMPTY_SLICE,
  );
  const focus = pointAtOffset(node.id, finalContent, 0);
  return tr.setSelection({ anchor: focus, focus, type: "text" });
}

/** Reorder a top-level block to a new body index (AC9 block reorder). */
function compileMoveBlock(
  store: EditorStore,
  node: NodeId,
  toIndex: number,
): TransactionBuilder | null {
  const entry = store.parentEntry(node);
  if (!entry) return null;
  const parent = store.requireNode(entry.parent);
  if (parent.kind !== "structural") return null;
  const clamped = Math.max(0, Math.min(parent.children.length - 1, toIndex));
  if (clamped === entry.index) return null;
  const tr = store.transaction();
  tr.push({
    from: { index: entry.index, parent: entry.parent },
    node,
    to: { index: clamped, parent: entry.parent },
    type: "move-node",
  });
  return tr.setSelection(store.selection as EditorSelection);
}

/**
 * Insert a new object block after the current block (AC9 slash/insert menu). The
 * data is normalized and baked through the registry so the inserted node is
 * publish-ready immediately, exactly like a compat import.
 */
function compileInsertObject(
  store: EditorStore,
  objectType: string,
  data: JsonValue,
): TransactionBuilder | null {
  const definition = store.registry.get(objectType);
  if (!definition) return null;
  const normalized = definition.normalizeData(data);
  const result = bakeObjectData(store.registry, objectType, normalized.data);
  const id = store.allocator.createNodeId();
  const objectNode = makeObjectNode({
    baked: result.baked ?? undefined,
    data: normalized.data,
    id,
    status: result.status,
    type: objectType,
  });
  const insertIndex = insertionIndexAfterSelection(store);
  const tr = store.transaction();
  tr.insertNode(store.bodyId, insertIndex, objectNode);
  return tr.setSelection({ node: id, type: "node" });
}

/**
 * Insert pre-built blocks after the current block (AC8 HTML paste). The view
 * builds the nodes from sanitized HTML through the compat importer with the
 * store's allocator, so their ids are unique; this just splices them into the
 * body order and lands the caret at the end of the last inserted leaf.
 */
function compileInsertBlocks(
  store: EditorStore,
  nodes: readonly EditorNode[],
): TransactionBuilder | null {
  if (nodes.length === 0) return null;
  const insertIndex = insertionIndexAfterSelection(store);
  const tr = store.transaction();
  nodes.forEach((node, i) =>
    tr.insertNode(store.bodyId, insertIndex + i, node),
  );
  const last = nodes[nodes.length - 1]!;
  if (last.kind === "text") {
    const focus = pointAtOffset(
      last.id,
      last.content,
      last.content.text.length,
    );
    tr.setSelection({ anchor: focus, focus, type: "text" });
  } else {
    tr.setSelection({ node: last.id, type: "node" });
  }
  return tr;
}

/** Body index just after the current selection's top-level block (or the end). */
function insertionIndexAfterSelection(store: EditorStore): number {
  const sel = store.selection;
  const anchorId =
    sel?.type === "text"
      ? sel.focus.node
      : sel?.type === "node" || sel?.type === "gap"
        ? sel.node
        : null;
  if (!anchorId) return store.order.length;
  const index = store.order.indexOf(anchorId);
  return index < 0 ? store.order.length : index + 1;
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
function compileSetObjectData(
  store: EditorStore,
  node: NodeId,
  data: JsonValue,
): TransactionBuilder | null {
  const current = store.getNode(node);
  if (!current || current.kind !== "object") return null;
  // Normalize incoming data through the registry first, so the view can pass
  // plain field values (e.g. code as a string) and the object's own shape (the
  // code-block piece table) is reconstructed before baking.
  const normalized = store.registry.normalizeSnapshotObject(current.type, data);
  const nextData = normalized.data;
  const baked = bakeObjectData(store.registry, current.type, nextData);
  const bakedTo: JsonValue | undefined = baked.baked ?? undefined;
  const bakedFrom: JsonValue | undefined = current.baked ?? undefined;
  // No-op when neither the data nor the resulting bake/status changes.
  if (
    JSON.stringify(current.data) === JSON.stringify(nextData) &&
    JSON.stringify(bakedFrom) === JSON.stringify(bakedTo) &&
    current.status === baked.status
  ) {
    return null;
  }
  const tr = store.transaction();
  tr.setObjectData({
    bakedFrom,
    bakedTo,
    from: current.data,
    node,
    statusFrom: current.status,
    statusTo: baked.status,
    to: nextData,
  });
  return tr;
}

// ---------------------------------------------------------------------------
// List editing: indent / outdent (docs/010 Phase 5.5 AC6).
// ---------------------------------------------------------------------------

/** Deepest visual indent level a block can reach (mirrors the legacy editor). */
const MAX_INDENT = 8;

function compileIndent(
  store: EditorStore,
  direction: "indent" | "outdent",
): TransactionBuilder | null {
  const item = currentListItem(store);
  if (item) {
    return direction === "indent"
      ? compileIndentItem(store, item)
      : compileOutdentItem(store, item);
  }
  // No nested-list context (a flat body-level `listitem` or an ordinary
  // paragraph/heading — the shape the Payload import produces, docs/010 §14):
  // indent/outdent adjust a visual `indent` level on the block(s), the way the
  // legacy Lexical editor indents any element. Outdenting a list item already at
  // zero indent drops it back to a paragraph.
  return compileIndentAttr(store, direction);
}

function compileIndentAttr(
  store: EditorStore,
  direction: "indent" | "outdent",
): TransactionBuilder | null {
  const range = textRange(store);
  if (!range) return null;
  const targets = coveredTextLeaves(store, range);
  if (targets.length === 0) return null;
  const tr = store.transaction();
  let changed = false;
  for (const node of targets) {
    const current =
      typeof node.attrs?.indent === "number" ? node.attrs.indent : 0;
    let next =
      direction === "indent" ? Math.min(current + 1, MAX_INDENT) : current - 1;
    if (next < 0) {
      // Already flush left: a list item drops its list formatting; other blocks
      // simply have nothing left to outdent.
      if (node.type === "listitem") {
        tr.push({
          from: "listitem",
          node: node.id,
          to: "paragraph",
          type: "set-node-type",
        });
        changed = true;
      }
      next = 0;
    }
    if (next !== current) {
      tr.push({
        from: node.attrs?.indent,
        key: "indent",
        node: node.id,
        // Keep `indent: 0` off the node so a flush block stays attr-clean and
        // round-trips deep-equal (docs/010 §14).
        to: next === 0 ? undefined : next,
        type: "set-node-attr",
      });
      changed = true;
    }
  }
  if (!changed) return null;
  return tr.setSelection(store.selection as EditorSelection);
}

// Nest a list item under its previous sibling, building structural `list`
// containers as needed.
//
// UNREACHABLE BY DESIGN (today): this only runs when `currentListItem` returns
// non-null, which requires the item's parent to already be a structural `list`
// node — and nothing user-facing creates that first structural list. The toolbar
// makes flat top-level `listitem` leaves (parent = ROOT), plain indent uses the
// `attrs.indent` fallback (`compileIndentAttr`), and the import flattens lists. So
// from any user-creatable or imported document there is no path into here; it can
// only fire atop a hand-built structural list (a story fixture). Kept (not deleted)
// because it is the correct nesting algebra the day structural containers become a
// real producer — but it is dormant. Lists are flat-by-design (docs/018 §2.10).
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
  if (!range) return false;
  if (
    range.start.node === range.end.node &&
    range.start.offset === range.end.offset
  ) {
    // Collapsed: active if any mark of this kind contains the caret.
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

function canIndent(store: EditorStore): boolean {
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

function canOutdent(store: EditorStore): boolean {
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

/** A copy of `mark` re-spanned to `[from, to)`, preserving its kind and attrs. */
function cloneMarkOver(
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
function activeLinkHref(store: EditorStore): string | null {
  const range = textRange(store);
  if (!range) return null;
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
