/** Block command compilers: block type/attr, markdown shortcuts, indent/outdent (docs/020 §7.5). */
import {
  boundaryAtOffset,
  makeObjectNode,
  makeStructuralNode,
  makeTextNode,
  pointAtOffset,
  replaceTextContent,
  type EditorNode,
  type EditorSelection,
  type JsonValue,
  type NodeId,
  type TextLeafType,
} from "../model";
import type {
  AutolinkShortcut,
  BlockObjectShortcut,
  BlockShortcut,
  InlineCodeShortcut,
  InlineLinkShortcut,
  MarkPairShortcut,
  MarkdownShortcut,
  SubstituteShortcut,
  WrapPairShortcut,
} from "../markdown-shortcuts";
import { bakeObjectData } from "../bake";
import { safeHref } from "../url-safety";
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
  checked?: boolean,
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
    // The task-list flag rides on `checked` (docs/030 §4.3c). It is reconciled to
    // the requested value (a checklist toggle passes `false`/`true`); any other
    // block-type change passes `undefined`, which clears a stale flag so a
    // checklist→bullet/paragraph conversion never leaves a phantom checkbox.
    const currentChecked = node.attrs?.checked;
    const nextChecked = blockType === "listitem" ? checked : undefined;
    if (currentChecked !== nextChecked) {
      tr.push({
        from: currentChecked,
        key: "checked",
        node: node.id,
        to: nextChecked,
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
    case "block-object":
      return compileBlockObjectShortcut(store, shortcut);
    case "inline-code":
      return compileInlineCodeShortcut(store, shortcut);
    case "mark-pair":
      return compileMarkPairShortcut(store, shortcut);
    case "inline-link":
      return compileInlineLinkShortcut(store, shortcut);
    case "autolink":
      return compileAutolinkShortcut(store, shortcut);
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
  // A `[ ] `/`[x] ` prefix marks the new item as a checklist item (the flag is
  // present even when `false`); every other prefix carries `undefined` so a stray
  // `checked` is cleared (docs/030 §4.3c).
  const nextChecked =
    shortcut.blockType === "listitem" ? shortcut.checked : undefined;
  if (node.attrs?.checked !== nextChecked) {
    tr.push({
      from: node.attrs?.checked,
      key: "checked",
      node: node.id,
      to: nextChecked,
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
 * Wrap `` `x` `` in a `code` mark and remove both backticks (docs/018 §2.1).
 * Inline-code keeps its own shortcut shape for API stability, but the mechanics
 * are the general paired-marker case (length-1 marker, `code` kind), so this just
 * delegates to `compileMarkPairShortcut` rather than duplicating the removal +
 * mark dance (docs/030 §4.1).
 */
export function compileInlineCodeShortcut(
  store: EditorStore,
  shortcut: InlineCodeShortcut,
): TransactionBuilder | null {
  return compileMarkPairShortcut(store, {
    closeFrom: shortcut.closeBacktick,
    kind: "mark-pair",
    markKind: "code",
    markerLength: 1,
    openFrom: shortcut.openBacktick,
  });
}

/**
 * Wrap a paired-marker run (`**bold**`, `*italic*`, `` `code` ``, …) in its mark
 * and remove both markers (docs/030 §4.1). The close marker is removed first
 * (higher offset) so the open offset stays live, then the surviving run gets the
 * mark and the caret lands at its end. Generalizes inline-code to any marker
 * length and mark kind.
 */
export function compileMarkPairShortcut(
  store: EditorStore,
  shortcut: MarkPairShortcut,
): TransactionBuilder | null {
  const sel = store.selection;
  if (sel?.type !== "text") return null;
  const node = store.getNode(sel.focus.node);
  if (!node || node.kind !== "text") return null;
  const text = node.content.text;
  const { openFrom, closeFrom, markerLength: length, markKind } = shortcut;
  // Re-validate against the live text: both markers must still be the same run of
  // `length` marker chars and enclose at least one content char.
  const openMarker = text.slice(openFrom, openFrom + length);
  const closeMarker = text.slice(closeFrom, closeFrom + length);
  if (
    openMarker.length !== length ||
    openMarker !== closeMarker ||
    closeFrom - (openFrom + length) < 1
  ) {
    return null;
  }
  const tr = store.transaction();
  // Remove the close marker first so `openFrom` stays a valid offset.
  tr.replaceText({
    at: closeFrom,
    inserted: "",
    node: node.id,
    removed: closeMarker,
  });
  tr.replaceText({
    at: openFrom,
    inserted: "",
    node: node.id,
    removed: openMarker,
  });
  const afterClose = replaceTextContent(
    node.content,
    closeFrom,
    length,
    EMPTY_SLICE,
  );
  const finalContent = replaceTextContent(
    afterClose,
    openFrom,
    length,
    EMPTY_SLICE,
  );
  // The inner run [openFrom+length, closeFrom) becomes [openFrom, closeFrom-length)
  // once both markers go.
  const markFrom = openFrom;
  const markTo = closeFrom - length;
  tr.addMark(node.id, {
    from: boundaryAtOffset(finalContent, markFrom, "before"),
    id: store.nextMarkId(),
    kind: markKind,
    to: boundaryAtOffset(finalContent, markTo, "after"),
  });
  const focus = pointAtOffset(node.id, finalContent, markTo);
  return tr.setSelection({ anchor: focus, focus, type: "text" });
}

/**
 * Inline link `[text](url)` → `text` carrying a `link` mark (docs/030 §4.1). The
 * whole `[text](url)` run is replaced by `text`; the href is sanitized at the
 * model boundary (a `javascript:` URL clears to empty and the run stays plain
 * text), mirroring `compileLink` (docs/010 §10.5).
 */
export function compileInlineLinkShortcut(
  store: EditorStore,
  shortcut: InlineLinkShortcut,
): TransactionBuilder | null {
  const sel = store.selection;
  if (sel?.type !== "text") return null;
  const node = store.getNode(sel.focus.node);
  if (!node || node.kind !== "text") return null;
  const { from, to, text: linkText, url } = shortcut;
  const expected = `[${linkText}](${url})`;
  if (node.content.text.slice(from, to) !== expected) return null;
  const href = safeHref(url);
  const tr = store.transaction();
  tr.replaceText({
    at: from,
    inserted: linkText,
    node: node.id,
    removed: expected,
  });
  const finalContent = replaceTextContent(
    node.content,
    from,
    to - from,
    store.allocator.createTextSlice(linkText),
  );
  const markTo = from + linkText.length;
  if (href.length > 0) {
    tr.addMark(node.id, {
      attrs: { href },
      from: boundaryAtOffset(finalContent, from, "before"),
      id: store.nextMarkId(),
      kind: "link",
      to: boundaryAtOffset(finalContent, markTo, "after"),
    });
  }
  const focus = pointAtOffset(node.id, finalContent, markTo);
  return tr.setSelection({ anchor: focus, focus, type: "text" });
}

/**
 * Autolink: give a bare URL a `link` mark in place without changing the text
 * (docs/030 §4.1). The just-typed space stays; only the URL run gains the mark.
 * An unsafe URL is left untouched.
 */
export function compileAutolinkShortcut(
  store: EditorStore,
  shortcut: AutolinkShortcut,
): TransactionBuilder | null {
  const sel = store.selection;
  if (sel?.type !== "text") return null;
  const node = store.getNode(sel.focus.node);
  if (!node || node.kind !== "text") return null;
  const { from, to, url } = shortcut;
  if (node.content.text.slice(from, to) !== url) return null;
  const href = safeHref(url);
  if (href.length === 0) return null;
  const tr = store.transaction();
  tr.addMark(node.id, {
    attrs: { href },
    from: boundaryAtOffset(node.content, from, "before"),
    id: store.nextMarkId(),
    kind: "link",
    to: boundaryAtOffset(node.content, to, "after"),
  });
  // The caret is already past the typed space; leave the selection where it is.
  return tr.setSelection(store.selection as EditorSelection);
}

/**
 * Line→object markdown (docs/030 §4.1): replace the current marker-only paragraph
 * with an object node — `---`/`***`/`___` → `divider`, ` ``` ` → `code-block`.
 * The object is normalized + baked through the registry so it is publish-ready
 * immediately, exactly like an insert or a compat import. A `divider` is an atom,
 * so a fresh empty paragraph is appended to land the caret; a `code-block` is
 * editable, so this leaves the same node-selection an insert leaves. The view
 * then drills into that selection (`activateInsertedObject`, gated on the node
 * view's `activateOnInsert`) so the caret lands in the code surface — kept in the
 * view because activation is runtime focus state, not a document/history step.
 */
export function compileBlockObjectShortcut(
  store: EditorStore,
  shortcut: BlockObjectShortcut,
): TransactionBuilder | null {
  const sel = store.selection;
  if (sel?.type !== "text") return null;
  const node = store.getNode(sel.focus.node);
  if (!node || node.kind !== "text") return null;
  const entry = store.parentEntry(node.id);
  if (!entry) return null;
  const definition = store.registry.get(shortcut.objectType);
  if (!definition) return null;
  const normalized = definition.normalizeData({});
  const baked = bakeObjectData(
    store.registry,
    shortcut.objectType,
    normalized.data,
  );
  const objectId = store.allocator.createNodeId();
  const objectNode = makeObjectNode({
    baked: baked.baked ?? undefined,
    data: normalized.data,
    id: objectId,
    status: baked.status,
    type: shortcut.objectType,
  });
  const tr = store.transaction();
  // Replace the marker leaf in place (remove + insert at the same index), the
  // same swap `placeSubtree`'s replace branch uses.
  tr.removeNode(entry.parent, entry.index, node);
  tr.insertNode(entry.parent, entry.index, objectNode);
  if (shortcut.objectType === "divider") {
    const paragraph = makeTextNode({
      content: store.allocator.createTextSlice(""),
      id: store.allocator.createNodeId(),
      type: "paragraph",
    });
    tr.insertNode(entry.parent, entry.index + 1, paragraph);
    const focus = pointAtOffset(paragraph.id, paragraph.content, 0);
    return tr.setSelection({ anchor: focus, focus, type: "text" });
  }
  return tr.setSelection({ node: objectId, type: "node" });
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
  // Structural nesting from a flat body-level list (docs/030 §7.3 D3 Option A): indenting a
  // flat `listitem` at body order under a preceding list item promotes *only the predecessor*
  // to a structural `listitem` holding [prevLeaf, sublist[item]] — in place at body order —
  // so the flat siblings stay windowed leaves and only the nested subtree mounts as a unit.
  // Once nested, the item's parent is a structural `list`, so a further indent flows through
  // the existing `compileIndentItem` algebra and outdent through `compileOutdentItem`.
  if (direction === "indent") {
    const nested = compileIndentBodyItem(store);
    if (nested) return nested;
  }
  // No list-nesting context (a flat list with no predecessor, or an ordinary
  // paragraph/heading — the shape the Payload import produces, docs/010 §14):
  // indent/outdent adjust a visual `indent` level on the block(s), the way the
  // legacy Lexical editor indents any element. Outdenting a list item already at
  // zero indent drops it back to a paragraph.
  return compileIndentAttr(store, direction);
}

/**
 * The Option A body-root indent (docs/030 §7.3): promote a flat `listitem` leaf at body order
 * under its preceding list item. Mirrors the `else`-branch of `compileIndentItem` with the
 * body as the list parent — the only new producer of the first structural list from flat
 * leaves. Returns null when the focus is not a flat body-level list item with a preceding
 * list item (so `compileIndent` falls back to visual indent).
 */
function compileIndentBodyItem(store: EditorStore): TransactionBuilder | null {
  const sel = store.selection;
  if (sel?.type !== "text") return null;
  const id = sel.focus.node;
  const node = store.getNode(id);
  if (!node || node.kind !== "text" || node.type !== "listitem") return null;
  const entry = store.parentEntry(id);
  if (!entry || entry.parent !== store.bodyId || entry.index === 0) return null;
  const prevId = store.order[entry.index - 1]!;
  const prev = store.getNode(prevId);
  if (!prev) return null;
  const prevIsItem =
    (prev.kind === "text" && prev.type === "listitem") ||
    (prev.kind === "structural" && prev.type === "listitem");
  if (!prevIsItem) return null;
  const tr = store.transaction();
  if (prev.kind === "structural" && prev.type === "listitem") {
    // Predecessor is already a structural item: reuse its trailing sublist, or add one, and
    // move the flat item into it (the same reuse path as `compileIndentItem`).
    const last = prev.children.at(-1);
    const lastNode = last ? store.requireNode(last) : undefined;
    if (
      lastNode &&
      lastNode.kind === "structural" &&
      lastNode.type === "list"
    ) {
      tr.push({
        from: { index: entry.index, parent: store.bodyId },
        node: id,
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
        from: { index: entry.index, parent: store.bodyId },
        node: id,
        to: { index: 0, parent: sublistId },
        type: "move-node",
      });
    }
  } else {
    // Predecessor is a flat leaf: wrap it into a structural item holding [prevLeaf,
    // sublist[item]], inserted in place at body order. The index arithmetic mirrors
    // `compileIndentItem`'s else-branch (container at `index`, then prev and item move in,
    // each `from` index live-valid after the prior step).
    const containerId = tr.allocator.createNodeId();
    const sublistId = tr.allocator.createNodeId();
    tr.insertNode(
      store.bodyId,
      entry.index,
      makeStructuralNode({ id: containerId, type: "listitem" }),
    );
    tr.insertNode(
      containerId,
      0,
      makeStructuralNode({ id: sublistId, type: "list" }),
    );
    tr.push({
      from: { index: entry.index - 1, parent: store.bodyId },
      node: prevId,
      to: { index: 0, parent: containerId },
      type: "move-node",
    });
    tr.push({
      from: { index: entry.index, parent: store.bodyId },
      node: id,
      to: { index: 0, parent: sublistId },
      type: "move-node",
    });
  }
  return tr.setSelection(store.selection as EditorSelection);
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
