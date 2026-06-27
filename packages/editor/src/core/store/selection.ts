/**
 * Model-order selection serialization for the owned-model editor.
 *
 * Why this file exists
 * --------------------
 * Under virtualization the DOM holds only the viewport window, so the browser
 * can copy only what is on screen. docs/011 §13.9 / docs/010 §5.6 require the
 * opposite: clipboard reads the model, so a selection spanning virtualized gaps
 * copies the full range including the offscreen middle. This module walks the
 * document in model order and slices the selected text without ever touching
 * the DOM, which is what makes cross-virtual copy structural rather than a
 * feature bolted onto the renderer.
 *
 * It is framework-free on purpose (no React, no DOM): the view layer calls it
 * from a `copy`/`cut` handler, but the function itself only reads the store.
 */
import type { EditorSelection, NodeId, TextLeafNode } from "../model";
import { resolvePointOffset } from "../model";
import { ROOT_NODE_ID, type EditorStore } from "./editor-store";

type LeafEntry = {
  readonly id: NodeId;
  readonly node: TextLeafNode;
};

/**
 * @categoryDefault Engine Core — Commands
 */

/**
 * Flatten the document into its text leaves in model order.
 *
 * The walk is depth-first over `order` and each structural node's `children`,
 * so a nested list contributes its items in reading order. Object nodes are
 * skipped here: this phase copies their plain-text projection through the block
 * definition later (docs/011 §2.7); a text range that merely spans them keeps
 * the surrounding prose contiguous.
 */
export function orderedTextLeaves(store: EditorStore): readonly LeafEntry[] {
  const leaves: LeafEntry[] = [];
  const visit = (ids: readonly NodeId[]): void => {
    for (const id of ids) {
      const node = store.getNode(id);
      if (!node) continue;
      if (node.kind === "text") {
        leaves.push({ id, node });
      } else if (node.kind === "structural") {
        visit(node.children);
      }
    }
  };
  const root = store.getNode(ROOT_NODE_ID);
  visit(root?.kind === "structural" ? root.children : store.order);
  return leaves;
}

/**
 * Serialize the selected text range to plain text in model order.
 *
 * The full range is read from the store, so offscreen blocks between the two
 * endpoints are included even though they are unmounted. Blocks join with a
 * newline, matching how the leaves render as separate lines. A collapsed caret
 * or a non-text selection serializes to an empty string this phase.
 */
export function collectSelectionText(
  store: EditorStore,
  selection: EditorSelection | null,
): string {
  if (!selection || selection.type !== "text") return "";
  const leaves = orderedTextLeaves(store);
  const indexOf = new Map(
    leaves.map((leaf, index) => [leaf.id, index] as const),
  );
  const anchorIndex = indexOf.get(selection.anchor.node);
  const focusIndex = indexOf.get(selection.focus.node);
  if (anchorIndex === undefined || focusIndex === undefined) return "";

  const anchorOffset = resolvePointOffset(
    leaves[anchorIndex]!.node.content,
    selection.anchor,
  );
  const focusOffset = resolvePointOffset(
    leaves[focusIndex]!.node.content,
    selection.focus,
  );
  const forward =
    anchorIndex < focusIndex ||
    (anchorIndex === focusIndex && anchorOffset <= focusOffset);
  const startIndex = forward ? anchorIndex : focusIndex;
  const endIndex = forward ? focusIndex : anchorIndex;
  const startOffset = forward ? anchorOffset : focusOffset;
  const endOffset = forward ? focusOffset : anchorOffset;

  if (startIndex === endIndex) {
    return leaves[startIndex]!.node.content.text.slice(startOffset, endOffset);
  }
  const parts: string[] = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    const text = leaves[index]!.node.content.text;
    if (index === startIndex) parts.push(text.slice(startOffset));
    else if (index === endIndex) parts.push(text.slice(0, endOffset));
    else parts.push(text);
  }
  return parts.join("\n");
}
