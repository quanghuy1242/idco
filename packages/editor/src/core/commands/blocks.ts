/** Block command compilers: block type/attr, markdown shortcuts, indent/outdent (docs/020 §7.5). */
import {
  boundaryAtOffset,
  makeStructuralNode,
  pointAtOffset,
  replaceTextContent,
  type EditorNode,
  type EditorSelection,
  type JsonValue,
  type NodeId,
  type TextLeafType,
} from "../model";
import type {
  BlockShortcut,
  InlineCodeShortcut,
  MarkdownShortcut,
  SubstituteShortcut,
  WrapPairShortcut,
} from "../markdown-shortcuts";
import type { EditorStore, TransactionBuilder } from "../store";
import {
  coveredTextLeaves,
  currentListItem,
  EMPTY_SLICE,
  MAX_INDENT,
  textRange,
  type ListItemContext,
} from "./shared";
export function compileSetBlockAttr(
  store: EditorStore,
  key: string,
  value: JsonValue | undefined,
  target?: NodeId,
): TransactionBuilder | null {
  // A specific target (the floating block chrome) sets the attr on that node
  // regardless of the caret; otherwise it applies across the covered leaves. A
  // structural container's chrome (the callout tone gear) targets the container
  // node itself, which is not a text leaf, so a targeted set accepts any node.
  let targets: readonly EditorNode[];
  if (target) {
    const node = store.getNode(target);
    if (!node || (node.kind !== "text" && node.kind !== "structural"))
      return null;
    targets = [node];
  } else {
    const range = textRange(store);
    if (!range) return null;
    targets = coveredTextLeaves(store, range);
  }
  if (targets.length === 0) return null;
  const tr = store.transaction();
  let changed = false;
  for (const node of targets) {
    const current = node.attrs?.[key];
    if (current === value) continue;
    tr.push({
      from: current,
      key,
      node: node.id,
      to: value,
      type: "set-node-attr",
    });
    changed = true;
  }
  if (!changed) return null;
  return tr.setSelection(store.selection as EditorSelection);
}

export function compileSetBlockType(
  store: EditorStore,
  blockType: TextLeafType,
  tag?: string,
  listType?: string,
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
    // List flavour rides on the `listType` attr; set it for a list item (default
    // bullet), clear it for any other block type so a list→paragraph toggle never
    // leaves a stray `listType` behind (docs/018 §2.10).
    const itemListType = node.attrs?.listType;
    const nextListType =
      blockType === "listitem" ? (listType ?? "bullet") : undefined;
    if (itemListType !== nextListType) {
      tr.push({
        from: itemListType,
        key: "listType",
        node: node.id,
        to: nextListType,
        type: "set-node-attr",
      });
      changed = true;
    }
  }
  if (!changed) return null;
  return tr.setSelection(store.selection as EditorSelection);
}

/**
 * Apply a detected markdown shortcut (AC8 + docs/018 §2.1). Block prefixes strip
 * the prefix and retype the block; inline code wraps the run in a `code` mark and
 * removes both backticks; auto-pairing wraps/inserts the closing partner. Each is
 * one invertible transaction.
 */
export function compileApplyMarkdown(
  store: EditorStore,
  shortcut: MarkdownShortcut,
): TransactionBuilder | null {
  switch (shortcut.kind) {
    case "block":
      return compileBlockShortcut(store, shortcut);
    case "inline-code":
      return compileInlineCodeShortcut(store, shortcut);
    case "substitute":
      return compileSubstituteShortcut(store, shortcut);
    case "wrap-pair":
      return compileWrapPairShortcut(store, shortcut);
  }
}

/** Replace one character (a straight quote) with its curly form (docs/018 §2.1). */
export function compileSubstituteShortcut(
  store: EditorStore,
  shortcut: SubstituteShortcut,
): TransactionBuilder | null {
  const sel = store.selection;
  if (sel?.type !== "text") return null;
  const node = store.getNode(sel.focus.node);
  if (!node || node.kind !== "text") return null;
  const at = shortcut.at;
  const removed = node.content.text.slice(at, at + 1);
  if (removed.length !== 1) return null;
  const tr = store.transaction();
  tr.replaceText({ at, inserted: shortcut.to, node: node.id, removed });
  const finalContent = replaceTextContent(
    node.content,
    at,
    1,
    store.allocator.createTextSlice(shortcut.to),
  );
  const focus = pointAtOffset(node.id, finalContent, at + shortcut.to.length);
  return tr.setSelection({ anchor: focus, focus, type: "text" });
}

export function compileBlockShortcut(
  store: EditorStore,
  shortcut: BlockShortcut,
): TransactionBuilder | null {
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
  // A `- `/`* `/`1. ` prefix carries the list flavour onto the new item; a
  // non-list prefix clears any stale `listType` (docs/018 §2.10).
  const nextListType =
    shortcut.blockType === "listitem"
      ? (shortcut.listType ?? "bullet")
      : undefined;
  if (node.attrs?.listType !== nextListType) {
    tr.push({
      from: node.attrs?.listType,
      key: "listType",
      node: node.id,
      to: nextListType,
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

/**
 * Wrap `` `x` `` in a `code` mark and remove both backticks (docs/018 §2.1). The
 * close backtick is removed first (higher offset) so the open offset stays live,
 * then the surviving run gets a code mark and the caret lands at its end.
 */
export function compileInlineCodeShortcut(
  store: EditorStore,
  shortcut: InlineCodeShortcut,
): TransactionBuilder | null {
  const sel = store.selection;
  if (sel?.type !== "text") return null;
  const node = store.getNode(sel.focus.node);
  if (!node || node.kind !== "text") return null;
  const text = node.content.text;
  const { openBacktick: open, closeBacktick: close } = shortcut;
  if (text[open] !== "`" || text[close] !== "`" || close - open < 2)
    return null;
  const tr = store.transaction();
  // Remove the close backtick first so `open` stays a valid offset.
  tr.replaceText({ at: close, inserted: "", node: node.id, removed: "`" });
  tr.replaceText({ at: open, inserted: "", node: node.id, removed: "`" });
  const afterClose = replaceTextContent(node.content, close, 1, EMPTY_SLICE);
  const finalContent = replaceTextContent(afterClose, open, 1, EMPTY_SLICE);
  // The inner run [open+1, close) becomes [open, close-1) once both ticks go.
  const markFrom = open;
  const markTo = close - 1;
  tr.addMark(node.id, {
    from: boundaryAtOffset(finalContent, markFrom, "before"),
    id: store.nextMarkId(),
    kind: "code",
    to: boundaryAtOffset(finalContent, markTo, "after"),
  });
  const focus = pointAtOffset(node.id, finalContent, markTo);
  return tr.setSelection({ anchor: focus, focus, type: "text" });
}

/**
 * Auto-pairing (docs/018 §2.1): the user typed an opening bracket/quote. With a
 * selection, wrap it in the pair (the just-typed open char already replaced the
 * selection on the input path, so the model holds `(`; we re-insert the wrapped
 * run). With a collapsed caret, insert the closing partner after the caret and
 * leave the caret between the two. Smart quotes ride this same path with curly
 * partners.
 */
export function compileWrapPairShortcut(
  store: EditorStore,
  shortcut: WrapPairShortcut,
): TransactionBuilder | null {
  const sel = store.selection;
  if (sel?.type !== "text") return null;
  const node = store.getNode(sel.focus.node);
  if (!node || node.kind !== "text") return null;
  const at = shortcut.at;
  if (node.content.text[at] !== shortcut.open) return null;
  const tr = store.transaction();
  // Insert the closing partner just after the opening char the user typed.
  tr.replaceText({
    at: at + 1,
    inserted: shortcut.close,
    node: node.id,
    removed: "",
  });
  const finalContent = replaceTextContent(
    node.content,
    at + 1,
    0,
    store.allocator.createTextSlice(shortcut.close),
  );
  // Caret stays between the pair (just after the opening char).
  const focus = pointAtOffset(node.id, finalContent, at + 1);
  return tr.setSelection({ anchor: focus, focus, type: "text" });
}

/** Reorder a top-level block to a new body index (AC9 block reorder). */

export function compileIndent(
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

export function compileIndentAttr(
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
export function compileIndentItem(
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

export function compileOutdentItem(
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
