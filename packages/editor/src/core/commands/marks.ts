/** Mark command compilers: toggle-mark, set/clear link (docs/020 §7.5). */
import {
  boundaryAtOffset,
  resolveBoundaryOffset,
  type EditorSelection,
  type TextLeafNode,
  type TextMarkKind,
} from "../model";
import { safeHref } from "../url-safety";
import type { EditorStore, TransactionBuilder } from "../store";
import {
  cloneMarkOver,
  isRangeMarked,
  leafRangesInSelection,
  markOver,
} from "./shared";
export function compileToggleMark(
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
      tr.addMark(node.id, markOver(node, kind, from, to, store.nextMarkId()));
    }
  }
  return tr.setSelection(store.selection as EditorSelection);
}

/** Remove a mark kind from `[from, to)` on one leaf, re-adding the outside parts. */
export function removeMarkOverRange(
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
export function compileLink(
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
        id: store.nextMarkId(),
        kind: "link",
        to: boundaryAtOffset(node.content, to, "after"),
      });
    }
  }
  return tr.setSelection(store.selection as EditorSelection);
}
