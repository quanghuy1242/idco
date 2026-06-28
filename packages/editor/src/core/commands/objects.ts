/** Object/structural insert + mutation compilers (docs/020 §7.5). */
import {
  makeObjectNode,
  makeStructuralNode,
  makeTextNode,
  pointAtOffset,
  type EditorNode,
  type EditorSelection,
  type JsonValue,
  type NodeId,
} from "../model";
import { bakeObjectData } from "../bake";
import { getStructuralDefinition } from "../registry";
import type { StructuralInsertParams } from "../registry";
import type { EditorStore, TransactionBuilder } from "../store";
import {
  childrenOf,
  insertionPointForInsert,
  placeNodes,
  splitLeafAt,
  type InsertionPoint,
} from "./shared";
export function compileMoveBlock(
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
 * Remove one top-level block (the floating chrome's delete button). The selection
 * is left to `mapSelection` (§8.8), which relocates a caret off the removed node
 * to the deletion boundary rather than stranding it.
 */
export function compileRemoveBlock(
  store: EditorStore,
  node: NodeId,
): TransactionBuilder | null {
  const entry = store.parentEntry(node);
  if (!entry) return null;
  const target = store.getNode(node);
  if (!target) return null;
  const tr = store.transaction();
  tr.removeNode(entry.parent, entry.index, target);
  // The body must never be left empty (note.md §5.3, the empty-doc B3 repro). On an
  // empty document, inserting a block-object (a table) REPLACES the only paragraph,
  // so removing that object would leave `body.order: []` — no caret target at all.
  // The selection then falls back to a root `gap`, which paints nothing once focus
  // drops to <body> (the focus-within gate), so neither the text caret nor the
  // horizontal gap cursor shows and typing is dead. Re-seed a fresh empty paragraph
  // in the vacated body and land a real text caret in it (the "an editor always keeps
  // one paragraph" invariant); the commit-driven focus reclaim in react-view then
  // re-homes DOM focus onto it. Scoped to the body — emptying a nested container (the
  // last cell of a table) is the structural command's own concern, not this rule.
  const siblings = childrenOf(store, entry.parent);
  if (
    entry.parent === store.bodyId &&
    siblings.length === 1 &&
    siblings[0] === node
  ) {
    const paragraph = makeTextNode({
      content: store.allocator.createTextSlice(""),
      id: store.allocator.createNodeId(),
      type: "paragraph",
    });
    tr.insertNode(entry.parent, 0, paragraph);
    const caret = pointAtOffset(paragraph.id, paragraph.content, 0);
    return tr.setSelection({ anchor: caret, focus: caret, type: "text" });
  }
  return tr;
}

/**
 * Insert a new object block after the current block (AC9 slash/insert menu). The
 * data is normalized and baked through the registry so the inserted node is
 * publish-ready immediately, exactly like a compat import.
 */
export function compileInsertObject(
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
  const tr = store.transaction();
  const point = insertionPointForInsert(tr, store);
  placeNodes(tr, store, point, [objectNode]);
  return tr.setSelection({ node: id, type: "node" });
}

/**
 * Insert pre-built blocks at the caret (AC8 HTML paste). The view builds the
 * nodes from sanitized HTML through the compat importer with the store's
 * allocator, so their ids are unique; this resolves the positional insertion
 * point (docs/019) and lands the caret at the end of the last inserted leaf.
 */
export function compileInsertBlocks(
  store: EditorStore,
  nodes: readonly EditorNode[],
): TransactionBuilder | null {
  if (nodes.length === 0) return null;
  const tr = store.transaction();
  const point = insertionPointForInsert(tr, store);
  placeNodes(tr, store, point, nodes);
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

/**
 * Insert a native snapshot fragment at the caret (docs/030 §7.1 / §7.2): the markdown-paste
 * builder and the native-clipboard reader both produce `{ order, blocks }` where a structural
 * top-level node references descendants by id. Unlike `compileInsertBlocks` (flat leaves
 * only), this gathers each top-level node's descendant subtree from `blocks` so the whole
 * container inserts as one atomic, invertible subtree (one undo). The caret lands at the end
 * of the last top-level leaf, or node-selects the last block when it is an object/container —
 * the same caret contract HTML paste already uses, so focus reclaim behaves identically.
 */
export function compileInsertFragment(
  store: EditorStore,
  fragment: {
    readonly order: readonly NodeId[];
    readonly blocks: Readonly<Record<NodeId, EditorNode>>;
  },
): TransactionBuilder | null {
  // Remap every node id (and text-mark id) to a fresh store-unique id before inserting. A
  // native-clipboard fragment carries the *original* ids of the copied nodes, so pasting it
  // back into the same document would collide with the live nodes ("Node exists") — the
  // headline lossless workflow. Remapping also lets the same fragment paste many times.
  const remapped = remapFragment(store, fragment);
  const tops = remapped.order
    .map((id) => remapped.blocks[id])
    .filter((node): node is EditorNode => Boolean(node));
  if (tops.length === 0) return null;
  const tr = store.transaction();
  const point = insertionPointForInsert(tr, store);
  placeNodes(tr, store, point, tops, (node) =>
    gatherDescendants(remapped.blocks, node),
  );
  const last = tops[tops.length - 1]!;
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

/**
 * Rewrite a fragment so every node id (and text-mark id) is fresh and store-unique, keeping
 * the graph internally consistent (structural `children` and `order` are remapped through the
 * same old→new map). This is what makes a native copy/paste collision-free on the same
 * document. A dangling child id (not in `blocks`) maps to itself and is dropped downstream.
 */
function remapFragment(
  store: EditorStore,
  fragment: {
    readonly order: readonly NodeId[];
    readonly blocks: Readonly<Record<NodeId, EditorNode>>;
  },
): {
  readonly order: readonly NodeId[];
  readonly blocks: Readonly<Record<NodeId, EditorNode>>;
} {
  const idMap = new Map<NodeId, NodeId>();
  for (const oldId of Object.keys(fragment.blocks) as NodeId[]) {
    idMap.set(oldId, store.allocator.createNodeId());
  }
  const mapId = (id: NodeId): NodeId => idMap.get(id) ?? id;
  const blocks: Record<NodeId, EditorNode> = {};
  for (const [oldId, node] of Object.entries(fragment.blocks) as [
    NodeId,
    EditorNode,
  ][]) {
    const id = mapId(oldId);
    if (node.kind === "structural") {
      blocks[id] = makeStructuralNode({
        ...node,
        children: node.children.map(mapId),
        id,
      });
    } else if (node.kind === "text") {
      blocks[id] = makeTextNode({
        ...node,
        id,
        // Mark ids must also be store-unique (an undo/redo or a later edit keys off them).
        marks: node.marks.map((mark) => ({ ...mark, id: store.nextMarkId() })),
      });
    } else {
      blocks[id] = makeObjectNode({ ...node, id });
    }
  }
  return { blocks, order: fragment.order.map(mapId) };
}

/** Depth-first descendant subtree of a structural node, resolved from a fragment's blocks. */
function gatherDescendants(
  blocks: Readonly<Record<NodeId, EditorNode>>,
  node: EditorNode,
): readonly EditorNode[] {
  if (node.kind !== "structural") return [];
  const out: EditorNode[] = [];
  const visit = (id: NodeId): void => {
    const child = blocks[id];
    if (!child) return;
    out.push(child);
    if (child.kind === "structural") child.children.forEach(visit);
  };
  node.children.forEach(visit);
  return out;
}

/**
 * Insert a structural container at the caret (the generic structural insert, note
 * §7). The container's initial subtree (root + descendants + caret target) comes
 * from the type's `StructuralDefinition.createSubtree`, so no per-type command is
 * needed — callout, the future table, and any registered structural type all
 * insert through this one path. A structural node is a scope, not an atom: it can
 * hold lists/paragraphs and an arrow can walk into and out of it. The container
 * plus its descendants are inserted as one subtree (one invertible transaction);
 * the caret lands in the definition's `caret` leaf when it has one.
 */
export function compileInsertStructural(
  store: EditorStore,
  structuralType: string,
  params?: StructuralInsertParams,
): TransactionBuilder | null {
  const definition = getStructuralDefinition(structuralType);
  if (!definition) return null;
  const subtree = definition.createSubtree(store.allocator, params);
  const tr = store.transaction();
  const point = insertionPointForInsert(tr, store);
  placeSubtree(tr, store, point, subtree.root, subtree.descendants);
  if (subtree.caret) {
    const caretNode =
      subtree.descendants.find((node) => node.id === subtree.caret) ??
      (subtree.root.id === subtree.caret ? subtree.root : undefined);
    if (caretNode?.kind === "text") {
      const focus = pointAtOffset(caretNode.id, caretNode.content, 0);
      return tr.setSelection({ anchor: focus, focus, type: "text" });
    }
  }
  return tr.setSelection({ node: subtree.root.id, type: "node" });
}

/**
 * Insert a pre-built child subtree into a structural scope at `index` (docs/021
 * §8.2). The generic structural-child insert: a container feature (the table's
 * "insert row", "insert column") composes this rather than registering a bespoke
 * command, so core gains no grid knowledge. `node` is the child root; its
 * `descendants` (a row's cells and their paragraphs) ride the one `insert-node`
 * step so the whole subtree registers atomically and one undo reverses it. The
 * selection is left to `mapSelection` so the caller decides where the caret goes.
 */
export function compileInsertStructuralChild(
  store: EditorStore,
  scope: NodeId,
  index: number,
  node: EditorNode,
  descendants: readonly EditorNode[] = [],
): TransactionBuilder | null {
  const parent = store.getNode(scope);
  if (!parent || parent.kind !== "structural") return null;
  if (index < 0 || index > childrenOf(store, scope).length) return null;
  const tr = store.transaction();
  tr.push({ descendants, index, node, parent: scope, type: "insert-node" });
  return tr;
}

/**
 * Remove the child at `index` of a structural scope (docs/021 §8.2), the generic
 * structural-child remove the table's "delete row"/"delete column" compose. The
 * removed subtree is captured for undo by the `remove-node` step; the selection is
 * relocated off the removed node by `mapSelection`.
 */
export function compileRemoveStructuralChild(
  store: EditorStore,
  scope: NodeId,
  index: number,
): TransactionBuilder | null {
  const parent = store.getNode(scope);
  if (!parent || parent.kind !== "structural") return null;
  const children = childrenOf(store, scope);
  if (index < 0 || index >= children.length) return null;
  const child = store.getNode(children[index]!);
  if (!child) return null;
  const tr = store.transaction();
  tr.removeNode(scope, index, child);
  return tr;
}

/**
 * Place a single container subtree (a root node plus its already-built
 * descendants) at an `InsertionPoint`, mirroring `placeNodes` but carrying the
 * descendants on the insert step so the whole subtree registers at once. Used by
 * container inserts (a callout wrapping a paragraph) that `placeNodes`' flat
 * sibling run cannot express.
 */
export function placeSubtree(
  tr: TransactionBuilder,
  store: EditorStore,
  point: InsertionPoint,
  root: EditorNode,
  descendants: readonly EditorNode[],
): void {
  const insert = (parent: NodeId, index: number) =>
    tr.push({ descendants, index, node: root, parent, type: "insert-node" });
  if (point.kind === "replace") {
    const entry = store.parentEntry(point.node);
    const removed = store.getNode(point.node);
    if (entry && removed) {
      tr.removeNode(entry.parent, entry.index, removed);
      insert(entry.parent, entry.index);
      return;
    }
    insert(store.bodyId, store.order.length);
    return;
  }
  if (point.kind === "split") {
    const seam = splitLeafAt(tr, store, point);
    if (!seam) {
      insert(store.bodyId, store.order.length);
      return;
    }
    insert(seam.parent, seam.index + 1);
    return;
  }
  insert(point.scope, point.index);
}

// ---------------------------------------------------------------------------
// Positional insertion (docs/019 §4): resolve any selection to where a block
// lands. Insertion is a caret operation — a block goes where the caret is, and
// an empty paragraph the caret sits on is consumed by what is put on it.
// ---------------------------------------------------------------------------

/**
 * Where a block-level insert should land (docs/019 §4.5).
 *
 * `at` splices into a scope's child order; `replace` consumes a disposable-empty
 * block (remove + insert at the same index). The `split` variant (mid-text
 * break, docs/019 §5.5) is Phase 3; until it ships a mid-block caret degrades to
 * `at` after the block (see `resolveTextCaretPoint`).
 */
export function compileSetObjectData(
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
