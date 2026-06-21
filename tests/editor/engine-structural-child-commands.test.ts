/**
 * Structural SPI extension-surface tests (docs/021 §8.1, §8.2, §9, §11).
 *
 * These prove the two additions the rich-container work makes to the structural
 * node SPI, using a *synthetic* nested container (`test-grid → test-row →
 * test-cell → paragraph`) that is deliberately not the table — so the contract is
 * shown to generalize, not to be table-shaped (docs/021 §10):
 *
 * - §8.1 (open union): brand-new structural type strings (`test-grid` etc., none
 *   of them a `StructuralNodeType` literal) construct via `makeStructuralNode` and
 *   insert through the generic `insert-structural` command.
 * - §8.2 (generic structural-child commands): `insert-structural-child` adds a
 *   pre-built child subtree at `{scope, index}` and `remove-structural-child`
 *   removes it, both as single invertible transactions; one `undo` reverses each.
 */
import { describe, expect, it } from "vitest";
import {
  createEditorStore,
  createIdAllocator,
  makeStructuralNode,
  makeTextNode,
  registerGlobalStructuralDefinition,
  type EditorNode,
  type IdAllocator,
  type NodeId,
  type StructuralDefinition,
  type StructuralNode,
} from "../../packages/editor/src/core";

/** A `test-cell` wrapping one empty paragraph; returns the cell + its descendants. */
function buildCell(allocator: IdAllocator): {
  cell: EditorNode;
  descendants: EditorNode[];
  paragraphId: NodeId;
} {
  const paragraphId = allocator.createNodeId();
  const paragraph = makeTextNode({
    content: allocator.createTextSlice(""),
    id: paragraphId,
    type: "paragraph",
  });
  const cell = makeStructuralNode({
    children: [paragraphId],
    id: allocator.createNodeId(),
    type: "test-cell",
  });
  return { cell, descendants: [paragraph], paragraphId };
}

/** A `test-row` of `cols` cells; returns the row + its full flat descendant list. */
function buildRow(
  allocator: IdAllocator,
  cols: number,
): { row: EditorNode; descendants: EditorNode[]; firstParagraphId: NodeId } {
  const cells = Array.from({ length: cols }, () => buildCell(allocator));
  const row = makeStructuralNode({
    children: cells.map((c) => c.cell.id),
    id: allocator.createNodeId(),
    type: "test-row",
  });
  const descendants = cells.flatMap((c) => [c.cell, ...c.descendants]);
  return { descendants, firstParagraphId: cells[0]!.paragraphId, row };
}

// Register the synthetic container's core half so `insert-structural` resolves it
// (docs/021 §6.1/§7.2). None of these type strings is a built-in union member, so
// this only typechecks because the union is the registry-driven open set (§8.1).
const gridDefinition: StructuralDefinition = {
  createSubtree(allocator) {
    const row = buildRow(allocator, 1);
    const root = makeStructuralNode({
      children: [row.row.id],
      id: allocator.createNodeId(),
      type: "test-grid",
    });
    return {
      caret: row.firstParagraphId,
      descendants: [row.row, ...row.descendants],
      root,
    };
  },
  fromCompatNode(node, ctx) {
    return { children: ctx.importChildren(node.children) };
  },
  type: "test-grid",
};
registerGlobalStructuralDefinition(gridDefinition);

function makeStore() {
  const allocator = createIdAllocator("idco_client_grid");
  const paragraphId = allocator.createNodeId();
  const paragraph = makeTextNode({
    content: allocator.createTextSlice(""),
    id: paragraphId,
    type: "paragraph",
  });
  return createEditorStore({
    allocator,
    snapshot: {
      body: { blocks: { [paragraphId]: paragraph }, order: [paragraphId] },
      settings: {},
      version: 1,
    },
  });
}

function gridNode(store: ReturnType<typeof makeStore>): StructuralNode {
  const id = store.order.find(
    (nodeId) => store.getNode(nodeId)?.type === "test-grid",
  );
  const node = id ? store.getNode(id) : undefined;
  if (!node || node.kind !== "structural") throw new Error("no grid");
  return node;
}

describe("structural SPI — open union + generic insert-structural (docs/021 §8.1)", () => {
  it("inserts a brand-new structural type as a deep subtree", () => {
    const store = makeStore();
    store.command({ structuralType: "test-grid", type: "insert-structural" });

    const grid = gridNode(store);
    expect(grid.type).toBe("test-grid");
    // grid → 1 row → 1 cell → 1 paragraph, all registered from the one subtree.
    const rowId = grid.children[0]!;
    const row = store.getNode(rowId);
    expect(row?.kind === "structural" && row.type).toBe("test-row");
    const cellId = row?.kind === "structural" ? row.children[0]! : undefined;
    const cell = cellId ? store.getNode(cellId) : undefined;
    expect(cell?.kind === "structural" && cell.type).toBe("test-cell");
    // The caret landed in the cell's paragraph (createSubtree.caret).
    const focus =
      store.selection?.type === "text" ? store.selection.focus.node : null;
    const paragraphId =
      cell?.kind === "structural" ? cell.children[0] : undefined;
    expect(focus).toBe(paragraphId);
  });
});

describe("structural SPI — generic structural-child commands (docs/021 §8.2)", () => {
  it("insert- then remove-structural-child add and drop a subtree, each undoable", () => {
    const store = makeStore();
    store.command({ structuralType: "test-grid", type: "insert-structural" });
    const gridId = gridNode(store).id;
    const before = gridNode(store).children.length; // 1 (the seed row)

    // Insert a second row (2 cells) at the end of the grid.
    const row = buildRow(store.allocator, 2);
    store.command({
      descendants: row.descendants,
      index: before,
      node: row.row,
      scope: gridId,
      type: "insert-structural-child",
    });
    expect(gridNode(store).children.length).toBe(before + 1);
    expect(store.getNode(row.row.id)?.type).toBe("test-row");
    expect(
      row.descendants.every((d) => store.getNode(d.id) !== undefined),
    ).toBe(true);

    // Remove it again: the whole subtree (row + cells + paragraphs) goes.
    store.command({
      index: before,
      scope: gridId,
      type: "remove-structural-child",
    });
    expect(gridNode(store).children.length).toBe(before);
    expect(store.getNode(row.row.id)).toBeUndefined();
    expect(
      row.descendants.every((d) => store.getNode(d.id) === undefined),
    ).toBe(true);

    // One undo reverses the remove: the subtree is restored intact.
    store.undo();
    expect(gridNode(store).children.length).toBe(before + 1);
    expect(store.getNode(row.row.id)?.type).toBe("test-row");
    expect(
      row.descendants.every((d) => store.getNode(d.id) !== undefined),
    ).toBe(true);

    // A second undo reverses the insert: back to the seed row only.
    store.undo();
    expect(gridNode(store).children.length).toBe(before);
    expect(store.getNode(row.row.id)).toBeUndefined();
  });

  it("relocates a caret sitting deep inside a removed subtree", () => {
    // docs/021 §8.2: remove must not strand a caret that sat in a *deep*
    // descendant of the removed container (a table cell whose row is deleted).
    const store = makeStore();
    store.command({ structuralType: "test-grid", type: "insert-structural" });
    const gridId = gridNode(store).id;
    // `insert-structural` landed the caret in the seed row's cell paragraph — a
    // grandchild of the row, not the row itself.
    const caretNode =
      store.selection?.type === "text" ? store.selection.focus.node : null;
    expect(caretNode).not.toBeNull();

    // Add a second row so removing the first does not empty the grid.
    const row = buildRow(store.allocator, 1);
    store.command({
      descendants: row.descendants,
      index: 1,
      node: row.row,
      scope: gridId,
      type: "insert-structural-child",
    });
    expect(store.selection?.type === "text" && store.selection.focus.node).toBe(
      caretNode,
    );

    // Remove the first row — the subtree that contains the caret's paragraph.
    store.command({ index: 0, scope: gridId, type: "remove-structural-child" });

    // The deep paragraph is gone, and the selection was relocated to a live
    // position rather than left dangling on the deleted node. Whatever variant
    // it landed on, the node it references must still exist and not be the
    // deleted caret paragraph — asserted unconditionally over the referenced id.
    expect(store.getNode(caretNode!)).toBeUndefined();
    const sel = store.selection;
    expect(sel).not.toBeNull();
    const referenced =
      sel?.type === "text"
        ? sel.focus.node
        : sel?.type === "gap"
          ? sel.scope
          : sel?.type === "node"
            ? sel.node
            : undefined;
    expect(referenced).toBeDefined();
    expect(referenced).not.toBe(caretNode);
    expect(store.getNode(referenced!)).toBeDefined();
  });

  it("rejects a child op on a non-structural scope or an out-of-range index", () => {
    const store = makeStore();
    const textLeafId = store.order[0]!; // a paragraph leaf, not a scope
    expect(
      store.command({
        index: 0,
        scope: textLeafId,
        type: "remove-structural-child",
      }),
    ).toBeNull();

    const orphan = makeTextNode({
      content: store.allocator.createTextSlice(""),
      id: store.allocator.createNodeId(),
      type: "paragraph",
    });
    expect(
      store.command({
        index: 999,
        node: orphan,
        scope: store.bodyId,
        type: "insert-structural-child",
      }),
    ).toBeNull();
    // The rejected insert never registered the orphan node.
    expect(store.getNode(orphan.id)).toBeUndefined();
  });

  it("treats the body as a valid scope for child ops", () => {
    const store = makeStore();
    const para = makeTextNode({
      content: store.allocator.createTextSlice("appended"),
      id: store.allocator.createNodeId(),
      type: "paragraph",
    });
    const lengthBefore = store.order.length;
    store.command({
      index: lengthBefore,
      node: para,
      scope: store.bodyId,
      type: "insert-structural-child",
    });
    expect(store.order.length).toBe(lengthBefore + 1);
    expect(store.order.at(-1)).toBe(para.id);
    store.undo();
    expect(store.order.length).toBe(lengthBefore);
    expect(store.getNode(para.id)).toBeUndefined();
  });
});
