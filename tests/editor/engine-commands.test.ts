/**
 * docs/010 Phase 5.5 — structural editing, command compiler, and Mapping.
 *
 * Headless proof that split/merge/delete/insert/indent/outdent compile to
 * invertible composite transactions over the existing step set (AC1), that the
 * intra-transaction Mapping threads positions through earlier steps in
 * node-relative coordinates (AC2), and that the command/query registry is the
 * public mutation entry (AC3). Nothing here touches React, the DOM, or keys.
 */
import { describe, expect, it } from "vitest";
import {
  Mapping,
  ROOT_NODE_ID,
  boundaryAtOffset,
  createEditorStore,
  createIdAllocator,
  createOwnedEditorHandle,
  makeStructuralNode,
  makeTextNode,
  pointAtOffset,
  resolveBoundaryOffset,
  type EditorSelection,
  type IdAllocator,
  type NodeId,
  type StructuralNode,
  type TextContent,
  type TextLeafNode,
  type TextMark,
} from "../../packages/editor/src/core";

const CLIENT = "idco_client_phase55";

/** Build a store whose body is a flat list of paragraphs from the given strings. */
function paragraphStore(texts: readonly string[]): {
  store: ReturnType<typeof createEditorStore>;
  ids: NodeId[];
  allocator: IdAllocator;
} {
  const allocator = createIdAllocator(CLIENT);
  const nodes = texts.map((text) =>
    makeTextNode({
      content: allocator.createTextSlice(text),
      id: allocator.createNodeId(),
    }),
  );
  const store = createEditorStore({
    allocator,
    snapshot: {
      body: {
        blocks: Object.fromEntries(nodes.map((n) => [n.id, n])),
        order: nodes.map((n) => n.id),
      },
      settings: {},
      version: 1,
    },
  });
  return { allocator, ids: nodes.map((n) => n.id), store };
}

function caretAt(
  store: ReturnType<typeof createEditorStore>,
  id: NodeId,
  offset: number,
): void {
  const node = store.requireTextNode(id);
  const point = pointAtOffset(id, node.content, offset);
  store.dispatch({
    origin: "local",
    selectionAfter: { anchor: point, focus: point, type: "text" },
    steps: [],
  });
}

function selectRange(
  store: ReturnType<typeof createEditorStore>,
  anchorId: NodeId,
  anchorOffset: number,
  focusId: NodeId,
  focusOffset: number,
): void {
  const anchor = pointAtOffset(
    anchorId,
    store.requireTextNode(anchorId).content,
    anchorOffset,
  );
  const focus = pointAtOffset(
    focusId,
    store.requireTextNode(focusId).content,
    focusOffset,
  );
  store.dispatch({
    origin: "local",
    selectionAfter: { anchor, focus, type: "text" },
    steps: [],
  });
}

function textOf(
  store: ReturnType<typeof createEditorStore>,
  id: NodeId,
): string {
  return store.requireTextNode(id).content.text;
}

describe("owned-model commands (Phase 5.5)", () => {
  it("splits a block at the caret and inverts on undo (AC1)", () => {
    const { store, ids } = paragraphStore(["hello world"]);
    caretAt(store, ids[0]!, 5);
    const before = store.toSnapshot();

    store.command({ type: "split-block" });

    expect(store.order).toHaveLength(2);
    expect(textOf(store, store.order[0]!)).toBe("hello");
    expect(textOf(store, store.order[1]!)).toBe(" world");
    const sel = store.selection as { focus: { node: NodeId; offset: number } };
    expect(sel.focus.node).toBe(store.order[1]!);
    expect(sel.focus.offset).toBe(0);

    store.undo();
    expect(store.toSnapshot()).toEqual(before);
    store.redo();
    expect(store.order).toHaveLength(2);
    expect(textOf(store, store.order[1]!)).toBe(" world");
  });

  it("splits and carries the tail's marks to the new block (AC1)", () => {
    const allocator = createIdAllocator(CLIENT);
    const content = allocator.createTextSlice("hello world");
    const node = makeTextNode({
      content,
      id: allocator.createNodeId(),
      marks: [boldOver(content, 6, 11, "m1")],
    });
    const store = createEditorStore({
      allocator,
      snapshot: {
        body: { blocks: { [node.id]: node }, order: [node.id] },
        settings: {},
        version: 1,
      },
    });
    caretAt(store, node.id, 5);
    store.command({ type: "split-block" });

    const head = store.requireTextNode(store.order[0]!);
    const tail = store.requireTextNode(store.order[1]!);
    expect(head.marks).toHaveLength(0); // " world" left the head
    expect(tail.marks).toHaveLength(1);
    const tailMark = tail.marks[0]!;
    expect(tailMark.kind).toBe("bold");
    // " world" -> tail "_world"; bold was on "world" (head offsets 6..11),
    // now tail offsets 1..6.
    expect(resolvedRange(tail, tailMark)).toEqual([1, 6]);
  });

  it("merges backward into the previous block, preserving marks (AC1)", () => {
    const allocator = createIdAllocator(CLIENT);
    const a = makeTextNode({
      content: allocator.createTextSlice("hello"),
      id: allocator.createNodeId(),
    });
    const bContent = allocator.createTextSlice(" world");
    const b = makeTextNode({
      content: bContent,
      id: allocator.createNodeId(),
      marks: [boldOver(bContent, 1, 6, "mb")],
    });
    const store = createEditorStore({
      allocator,
      snapshot: {
        body: { blocks: { [a.id]: a, [b.id]: b }, order: [a.id, b.id] },
        settings: {},
        version: 1,
      },
    });
    const before = store.toSnapshot();
    caretAt(store, b.id, 0);

    store.command({ type: "delete-backward" });

    expect(store.order).toEqual([a.id]);
    expect(textOf(store, a.id)).toBe("hello world");
    const merged = store.requireTextNode(a.id);
    expect(merged.marks).toHaveLength(1);
    expect(resolvedRange(merged, merged.marks[0]!)).toEqual([6, 11]);
    const sel = store.selection as { focus: { offset: number } };
    expect(sel.focus.offset).toBe(5);

    store.undo();
    expect(store.toSnapshot()).toEqual(before);
  });

  it("delete-forward at end of a block merges the next block (AC1)", () => {
    const { store, ids } = paragraphStore(["hello", "world"]);
    caretAt(store, ids[0]!, 5);
    store.command({ type: "delete-forward" });
    expect(store.order).toEqual([ids[0]!]);
    expect(textOf(store, ids[0]!)).toBe("helloworld");
  });

  it("deletes a selection that spans two blocks and inverts (delete AC1)", () => {
    const { store, ids } = paragraphStore(["hello", "world"]);
    const before = store.toSnapshot();
    selectRange(store, ids[0]!, 3, ids[1]!, 2);
    store.command({ type: "delete-selection" });

    expect(store.order).toEqual([ids[0]!]);
    expect(textOf(store, ids[0]!)).toBe("helrld");
    const sel = store.selection as { focus: { node: NodeId; offset: number } };
    expect(sel.focus.node).toBe(ids[0]!);
    expect(sel.focus.offset).toBe(3);

    store.undo();
    expect(store.toSnapshot()).toEqual(before);
  });

  it("delete-backward removes one grapheme, including astral clusters", () => {
    const { store, ids } = paragraphStore(["a😀b"]);
    caretAt(store, ids[0]!, 3); // after the emoji (length 2)
    store.command({ type: "delete-backward" });
    expect(textOf(store, ids[0]!)).toBe("ab");
    const sel = store.selection as { focus: { offset: number } };
    expect(sel.focus.offset).toBe(1);
  });

  it("insert-text replaces a selection (paste over range)", () => {
    const { store, ids } = paragraphStore(["hello world"]);
    selectRange(store, ids[0]!, 0, ids[0]!, 5);
    store.command({ type: "insert-text", text: "HI" });
    expect(textOf(store, ids[0]!)).toBe("HI world");
    const sel = store.selection as { focus: { offset: number } };
    expect(sel.focus.offset).toBe(2);
  });

  it("toggles a mark over a range and reports it through the query (AC3)", () => {
    const { store, ids } = paragraphStore(["hello world"]);
    selectRange(store, ids[0]!, 0, ids[0]!, 5);
    expect(store.query({ mark: "bold", type: "is-mark-active" })).toBe(false);
    store.command({ mark: "bold", type: "toggle-mark" });
    expect(store.query({ mark: "bold", type: "is-mark-active" })).toBe(true);
    const node = store.requireTextNode(ids[0]!);
    expect(resolvedRange(node, node.marks[0]!)).toEqual([0, 5]);
    store.command({ mark: "bold", type: "toggle-mark" });
    expect(store.query({ mark: "bold", type: "is-mark-active" })).toBe(false);
    expect(store.requireTextNode(ids[0]!).marks).toHaveLength(0);
  });

  it("sets a block type through a command and query (AC3)", () => {
    const { store, ids } = paragraphStore(["hello"]);
    caretAt(store, ids[0]!, 0);
    expect(store.query({ type: "current-block-type" })).toBe("paragraph");
    store.command({ blockType: "heading", type: "set-block-type" });
    expect(store.query({ type: "current-block-type" })).toBe("heading");
    expect(store.requireTextNode(ids[0]!).type).toBe("heading");
  });

  it("returns null/no-op for inapplicable commands", () => {
    const { store, ids } = paragraphStore(["hello"]);
    caretAt(store, ids[0]!, 0);
    // delete-backward at the very start with no previous block is a no-op.
    expect(store.command({ type: "delete-backward" })).toBeNull();
    expect(textOf(store, ids[0]!)).toBe("hello");
  });
});

describe("intra-transaction Mapping (Phase 5.5 AC2)", () => {
  it("maps an offset through a same-node ReplaceText (§8.8)", () => {
    const mapping = new Mapping();
    mapping.append({
      at: 2,
      inserted: { runs: [], text: "" },
      node: "n1" as NodeId,
      removed: { runs: [], text: "xyz" },
      type: "replace-text",
    });
    // before the edit: unchanged; inside the removed range: to the boundary;
    // after: shifted by -3.
    expect(mapping.mapPos({ node: "n1" as NodeId, offset: 1 })).toEqual({
      node: "n1",
      offset: 1,
    });
    expect(mapping.mapPos({ node: "n1" as NodeId, offset: 3 }, -1)).toEqual({
      node: "n1",
      offset: 2,
    });
    expect(mapping.mapPos({ node: "n1" as NodeId, offset: 8 })).toEqual({
      node: "n1",
      offset: 5,
    });
  });

  it("split redirects tail positions to the new block; merge redirects to the target", () => {
    const { store, ids } = paragraphStore(["hello world"]);
    caretAt(store, ids[0]!, 5);
    // Drive split through the public command and read the new block back.
    store.command({ type: "split-block" });
    const tailId = store.order[1]!;
    expect(textOf(store, tailId)).toBe(" world");

    // Merge produces a target-relative position for a source-node position.
    const { store: s2, ids: ids2 } = paragraphStore(["hello", "world"]);
    caretAt(s2, ids2[1]!, 0);
    s2.command({ type: "delete-backward" });
    expect(textOf(s2, ids2[0]!)).toBe("helloworld");
  });

  it("leaves an offset inside a moved node unchanged (move maps to identity)", () => {
    const mapping = new Mapping();
    mapping.append({
      from: { index: 0, parent: ROOT_NODE_ID },
      node: "n1" as NodeId,
      to: { index: 2, parent: ROOT_NODE_ID },
      type: "move-node",
    });
    expect(mapping.mapPos({ node: "n1" as NodeId, offset: 4 })).toEqual({
      node: "n1",
      offset: 4,
    });
  });

  it("maps a position in a removed node to null without a redirect", () => {
    const node = makeTextNode({
      content: { runs: [], text: "x" },
      id: "n1" as NodeId,
    });
    const mapping = new Mapping();
    mapping.append({
      index: 0,
      node,
      parent: ROOT_NODE_ID,
      type: "remove-node",
    });
    expect(mapping.mapPos({ node: "n1" as NodeId, offset: 0 })).toBeNull();
  });
});

describe("list editing: indent / outdent (Phase 5.5 AC6)", () => {
  function listStore(): {
    store: ReturnType<typeof createEditorStore>;
    listId: NodeId;
    itemIds: NodeId[];
  } {
    const allocator = createIdAllocator(CLIENT);
    const items = ["First", "Second", "Third"].map((text) =>
      makeTextNode({
        content: allocator.createTextSlice(text),
        id: allocator.createNodeId(),
        type: "listitem",
      }),
    );
    const list = makeStructuralNode({
      children: items.map((i) => i.id),
      id: allocator.createNodeId(),
      type: "list",
    });
    const store = createEditorStore({
      allocator,
      snapshot: {
        body: {
          blocks: Object.fromEntries([list, ...items].map((n) => [n.id, n])),
          order: [list.id],
        },
        settings: {},
        version: 1,
      },
    });
    return { itemIds: items.map((i) => i.id), listId: list.id, store };
  }

  it("indents an item by nesting it under the previous sibling, and inverts", () => {
    const { store, listId, itemIds } = listStore();
    const before = store.toSnapshot();
    caretAt(store, itemIds[1]!, 0);
    expect(store.query({ type: "can-indent" })).toBe(true);

    store.command({ type: "indent" });

    // The list now holds a wrapper item (First + sublist[Second]) then Third.
    const list = store.requireNode(listId) as StructuralNode;
    expect(list.children).toHaveLength(2);
    const wrapper = store.requireNode(list.children[0]!) as StructuralNode;
    expect(wrapper.kind).toBe("structural");
    expect(wrapper.type).toBe("listitem");
    expect(store.requireTextNode(wrapper.children[0]!).content.text).toBe(
      "First",
    );
    const sublist = store.requireNode(wrapper.children[1]!) as StructuralNode;
    expect(sublist.type).toBe("list");
    expect(sublist.children).toEqual([itemIds[1]!]);
    // Third stays at the top level.
    expect(store.requireTextNode(list.children[1]!).content.text).toBe("Third");

    store.undo();
    expect(store.toSnapshot()).toEqual(before);
  });

  it("indents into an existing sublist when the previous item already nests", () => {
    const { store, itemIds } = listStore();
    caretAt(store, itemIds[1]!, 0);
    store.command({ type: "indent" }); // Second nests under First
    caretAt(store, itemIds[2]!, 0);
    store.command({ type: "indent" }); // Third should join the same sublist as Second

    // Both Second and Third now live in First's sublist.
    const item = store.parentEntry(itemIds[2]!)!;
    const sublist = store.requireNode(item.parent) as StructuralNode;
    expect(sublist.type).toBe("list");
    expect(sublist.children).toEqual([itemIds[1]!, itemIds[2]!]);
  });

  it("outdents a nested item back to the outer list, and inverts", () => {
    const { store, listId, itemIds } = listStore();
    caretAt(store, itemIds[1]!, 0);
    store.command({ type: "indent" });
    const afterIndent = store.toSnapshot();
    expect(store.query({ type: "can-outdent" })).toBe(true);

    caretAt(store, itemIds[1]!, 0);
    store.command({ type: "outdent" });

    // Second is a top-level sibling again; the emptied sublist is gone.
    const list = store.requireNode(listId) as StructuralNode;
    expect(list.children).toContain(itemIds[1]!);
    const wrapper = store.requireNode(list.children[0]!) as StructuralNode;
    expect(wrapper.children).toHaveLength(1); // just "First", sublist removed

    store.undo();
    expect(store.toSnapshot()).toEqual(afterIndent);
  });

  it("Enter on an empty list item outdents it (AC6)", () => {
    const { store, itemIds } = listStore();
    caretAt(store, itemIds[1]!, 0);
    store.command({ type: "indent" }); // nest Second under First
    // Empty the nested item, then press Enter.
    selectRange(store, itemIds[1]!, 0, itemIds[1]!, "Second".length);
    store.command({ type: "delete-selection" });
    expect(textOf(store, itemIds[1]!)).toBe("");
    caretAt(store, itemIds[1]!, 0);
    store.command({ type: "split-block" });
    // It outdented rather than splitting into a second empty item.
    const entry = store.parentEntry(itemIds[1]!)!;
    const parent = store.requireNode(entry.parent) as StructuralNode;
    expect(parent.type).toBe("list");
  });
});

describe("attribute indent fallback (flat blocks, no list container)", () => {
  it("indents and outdents an ordinary paragraph via an indent attr, and inverts", () => {
    const { store, ids } = paragraphStore(["alpha"]);
    const before = store.toSnapshot();
    caretAt(store, ids[0]!, 0);

    expect(store.query({ type: "can-indent" })).toBe(true);
    expect(store.query({ type: "can-outdent" })).toBe(false);

    store.command({ type: "indent" });
    expect(store.requireNode(ids[0]!).attrs?.indent).toBe(1);
    store.command({ type: "indent" });
    expect(store.requireNode(ids[0]!).attrs?.indent).toBe(2);
    expect(store.query({ type: "can-outdent" })).toBe(true);

    store.command({ type: "outdent" });
    expect(store.requireNode(ids[0]!).attrs?.indent).toBe(1);
    store.command({ type: "outdent" });
    // Back to flush-left: the indent attr is cleared, not left at 0, so the doc
    // round-trips deep-equal (docs/010 §14).
    expect(store.requireNode(ids[0]!).attrs?.indent).toBeUndefined();
    expect(store.toSnapshot()).toEqual(before);
  });

  it("outdenting a flat list item at zero indent drops it to a paragraph", () => {
    const allocator = createIdAllocator(`${CLIENT}_flatlist`);
    const item = makeTextNode({
      content: allocator.createTextSlice("a flat item"),
      id: allocator.createNodeId(),
      type: "listitem",
    });
    const store = createEditorStore({
      allocator,
      snapshot: {
        body: { blocks: { [item.id]: item }, order: [item.id] },
        settings: {},
        version: 1,
      },
    });
    caretAt(store, item.id, 0);
    store.command({ type: "outdent" });
    expect(store.requireNode(item.id).type).toBe("paragraph");
  });
});

describe("OwnedEditorHandle SPI (Phase 5.5 AC4)", () => {
  it("drives editing, undo/redo, dirty, and events entirely through the handle", () => {
    const { store, ids } = paragraphStore(["hello world"]);
    const handle = createOwnedEditorHandle(store);

    const changes: number[] = [];
    const dirtyFlips: boolean[] = [];
    const selectionChanges: number[] = [];
    handle.on("change", () => changes.push(1));
    handle.on("dirtychange", () => dirtyFlips.push(handle.isDirty()));
    handle.on("selectionchange", () => selectionChanges.push(1));

    expect(handle.isDirty()).toBe(false);

    // Place the caret (selection event, not a content change) then split.
    handle.setSelection(caretSelection(store, ids[0]!, 5));
    expect(selectionChanges.length).toBeGreaterThan(0);
    expect(changes).toHaveLength(0);

    handle.dispatch({ type: "split-block" });
    expect(changes).toHaveLength(1);
    expect(handle.isDirty()).toBe(true);
    expect(dirtyFlips).toEqual([true]);
    expect(handle.getEditorSnapshot().body.order).toHaveLength(2);

    // The compat projection reflects the split.
    expect(handle.getDocument().root.children).toHaveLength(2);

    handle.markClean();
    expect(handle.isDirty()).toBe(false);

    handle.undo();
    expect(handle.getEditorSnapshot().body.order).toHaveLength(1);
    handle.redo();
    expect(handle.getEditorSnapshot().body.order).toHaveLength(2);
  });

  it("a caret-only transaction does not enter undo history (content-anchored undo, §10.5/AC5)", () => {
    const { store, ids } = paragraphStore(["abc"]);
    const handle = createOwnedEditorHandle(store);
    handle.setSelection(caretSelection(store, ids[0]!, 3));
    handle.dispatch({ type: "insert-text", text: "X" }); // "abcX"
    // Move the caret around (selection-only transactions).
    handle.setSelection(caretSelection(store, ids[0]!, 0));
    handle.setSelection(caretSelection(store, ids[0]!, 2));
    // A single undo reverts the typed run, not a caret move.
    handle.undo();
    expect(textOf(store, ids[0]!)).toBe("abc");
  });
});

function caretSelection(
  store: ReturnType<typeof createEditorStore>,
  id: NodeId,
  offset: number,
): EditorSelection {
  const point = pointAtOffset(id, store.requireTextNode(id).content, offset);
  return { anchor: point, focus: point, type: "text" };
}

function boldOver(
  content: TextContent,
  from: number,
  to: number,
  id: string,
): TextMark {
  return {
    from: boundaryAtOffset(content, from, "before"),
    id,
    kind: "bold",
    to: boundaryAtOffset(content, to, "after"),
  };
}

function resolvedRange(node: TextLeafNode, mark: TextMark): [number, number] {
  return [
    resolveBoundaryOffset(node.content, mark.from),
    resolveBoundaryOffset(node.content, mark.to),
  ];
}
