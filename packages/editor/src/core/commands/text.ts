/** Prose-editing command compilers: insert, delete, split, merge (docs/020 §7.5). */
import {
  pointAtOffset,
  replaceTextContent,
  sliceTextContent,
  type JsonValue,
  type NodeId,
  type TextLeafNode,
} from "../model";
import type { EditorStore, TransactionBuilder } from "../store";
import { compileIndent } from "./blocks";
import {
  EMPTY_SLICE,
  canOutdent,
  childrenOf,
  clipMarks,
  concatContent,
  deleteRange,
  graphemeAfter,
  graphemeBefore,
  nextTextLeaf,
  pointsEqual,
  previousTextLeaf,
  reanchorMark,
  splitLeafAt,
  textRange,
} from "./shared";
export function compileInsertText(
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

export function compileDeleteSelection(
  store: EditorStore,
): TransactionBuilder | null {
  const range = textRange(store);
  if (!range || pointsEqual(range.start, range.end)) return null;
  const tr = store.transaction();
  const caret = deleteRange(tr, store, range.start, range.end);
  const focus = pointAtOffset(caret.node, caret.content, caret.offset);
  return tr.setSelection({ anchor: focus, focus, type: "text" });
}

export function compileDelete(
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
    // At the start, an immediately-preceding atom (a divider/image) is deleted
    // whole — the caret rests beside it, so Backspace removes it rather than
    // skipping past it to merge across (docs/019 §4.12.6: atoms have no interior).
    const prevAtom = adjacentSiblingAtom(store, node.id, -1);
    if (prevAtom) return deleteAdjacentAtom(store, node, prevAtom, offset);
    const merged = mergeWithNeighbor(store, node, "backward");
    if (merged) return merged;
    // No previous text leaf to merge into (the block is first, or only atoms
    // precede it). An empty placeholder paragraph that is not the only block is
    // removed outright — the "delete this empty line" gesture that otherwise had
    // no effect at the top of the document (docs/019 §4.11).
    if (node.type === "paragraph" && length === 0) {
      return removeEmptyBlock(store, node);
    }
    return null;
  }
  if (offset < length) {
    const to = graphemeAfter(node.content.text, offset);
    return deleteWithin(store, node, offset, to);
  }
  const nextAtom = adjacentSiblingAtom(store, node.id, 1);
  if (nextAtom) return deleteAdjacentAtom(store, node, nextAtom, offset);
  return mergeWithNeighbor(store, node, "forward");
}

/**
 * The immediate sibling of `id` in its scope in `direction`, if it is an atom
 * (an object: divider/image/embed/code/…). Containers and text leaves are not
 * atoms and fall through to the merge path (docs/019 §4.2).
 */
export function adjacentSiblingAtom(
  store: EditorStore,
  id: NodeId,
  direction: -1 | 1,
): NodeId | null {
  const entry = store.parentEntry(id);
  if (!entry) return null;
  const siblings = childrenOf(store, entry.parent);
  const sibling = siblings[entry.index + direction];
  if (!sibling) return null;
  return store.getNode(sibling)?.kind === "object" ? sibling : null;
}

/**
 * Remove an atom adjacent to the caret in one transaction, leaving the caret
 * where it was (docs/019 §4.11). The text leaf is untouched, so the OS keyboard
 * stays bound to the same EditContext host (no focus churn).
 */
export function deleteAdjacentAtom(
  store: EditorStore,
  node: TextLeafNode,
  atomId: NodeId,
  offset: number,
): TransactionBuilder | null {
  const entry = store.parentEntry(atomId);
  const atom = store.getNode(atomId);
  if (!entry || !atom) return null;
  const tr = store.transaction();
  tr.removeNode(entry.parent, entry.index, atom);
  const point = pointAtOffset(node.id, node.content, offset);
  return tr.setSelection({ anchor: point, focus: point, type: "text" });
}

/**
 * Remove an empty placeholder paragraph that has no text leaf to merge into,
 * landing the caret on its previous neighbour — the end of a preceding text
 * leaf, or a gap beside a preceding atom / at the scope top (docs/019 §4.11).
 * Returns null for the only block in a scope: a scope is never emptied this way.
 */
export function removeEmptyBlock(
  store: EditorStore,
  node: TextLeafNode,
): TransactionBuilder | null {
  const entry = store.parentEntry(node.id);
  if (!entry) return null;
  const siblings = childrenOf(store, entry.parent);
  if (siblings.length <= 1) return null;
  const tr = store.transaction();
  tr.removeNode(entry.parent, entry.index, node);
  const prevId = entry.index > 0 ? siblings[entry.index - 1] : undefined;
  const prev = prevId ? store.getNode(prevId) : undefined;
  if (prev && prev.kind === "text") {
    const point = pointAtOffset(
      prev.id,
      prev.content,
      prev.content.text.length,
    );
    return tr.setSelection({ anchor: point, focus: point, type: "text" });
  }
  // No previous text leaf: rest at the gap the block vacated (before the next
  // sibling, or the scope top), clamped to the post-removal child count.
  const index = Math.min(entry.index, siblings.length - 1);
  return tr.setSelection({ index, scope: entry.parent, type: "gap" });
}

export function deleteWithin(
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

export function compileSplit(store: EditorStore): TransactionBuilder | null {
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
  const seam = splitLeafAt(tr, store, caret);
  if (!seam) return null;
  const tailSlice = sliceTextContent(
    caret.content,
    caret.offset,
    caret.content.text.length,
  );
  const focus = pointAtOffset(seam.newId, tailSlice, 0);
  return tr.setSelection({ anchor: focus, focus, type: "text" });
}

export function mergeWithNeighbor(
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
export function mergeLeafInto(
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
export function mergeHeadInto(
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
export function unionKeys(
  a: Readonly<Record<string, JsonValue>> | undefined,
  b: Readonly<Record<string, JsonValue>> | undefined,
): readonly string[] {
  const keys = new Set<string>();
  if (a) for (const key of Object.keys(a)) keys.add(key);
  if (b) for (const key of Object.keys(b)) keys.add(key);
  return [...keys];
}
