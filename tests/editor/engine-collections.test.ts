/**
 * Document Collections SPI core (docs/027 §5): the `set-collection` step round-trips
 * through the snapshot and history, the type-first flow is one atomic transaction, and
 * the document index passes collections through and carries each occurrence's ref.
 */
import { describe, expect, it } from "vitest";
import {
  boundaryAtOffset,
  buildDocumentIndex,
  createEditorStore,
  createIdAllocator,
  makeTextNode,
  pointAtOffset,
  type CollectionItem,
  type EditorStore,
  type NodeId,
  type TextLeafNode,
} from "../../packages/editor/src/core";
import {
  createTermOverSelection,
  deleteTerm,
  type GlossaryTerm,
} from "../../packages/editor/src/view/chrome/panes";

function leafStore(text: string): { store: EditorStore; id: NodeId } {
  const allocator = createIdAllocator("idco_client_collections");
  const node = makeTextNode({
    content: allocator.createTextSlice(text),
    id: allocator.createNodeId(),
    type: "paragraph",
  });
  const store = createEditorStore({
    allocator,
    snapshot: {
      body: { blocks: { [node.id]: node }, order: [node.id] },
      settings: {},
      version: 1,
    },
  });
  return { id: node.id, store };
}

function selectRange(store: EditorStore, id: NodeId, from: number, to: number) {
  const node = store.requireNode(id) as TextLeafNode;
  store.dispatch({
    origin: "local",
    selectionAfter: {
      anchor: pointAtOffset(id, node.content, from),
      focus: pointAtOffset(id, node.content, to),
      type: "text",
    },
    steps: [],
  });
}

const TERM: GlossaryTerm = {
  definition: "Service Provider Interface",
  id: "term-spi",
  term: "SPI",
};

describe("set-collection step (docs/027 §5.3)", () => {
  it("sets, serializes, and round-trips a collection through the snapshot", () => {
    const { store } = leafStore("hello");
    store.command({
      collection: "glossary",
      items: [TERM],
      type: "set-collection",
    });
    expect(store.getCollection("glossary")).toEqual([TERM]);
    const snapshot = store.toSnapshot();
    expect(snapshot.collections).toEqual({ glossary: [TERM] });

    // Deserialize: a fresh store from the snapshot carries the collection.
    const reloaded = createEditorStore({
      allocator: createIdAllocator("idco_client_reload"),
      snapshot,
    });
    expect(reloaded.getCollection("glossary")).toEqual([TERM]);
  });

  it("omits the collections key entirely when empty (byte-compat)", () => {
    const { store } = leafStore("hello");
    expect("collections" in store.toSnapshot()).toBe(false);
  });

  it("is undoable on its own and restores the prior items", () => {
    const { store } = leafStore("hello");
    store.command({
      collection: "glossary",
      items: [TERM],
      type: "set-collection",
    });
    store.command({
      collection: "glossary",
      items: [{ ...TERM, definition: "edited" } as CollectionItem],
      type: "set-collection",
    });
    expect(store.getCollection("glossary")[0]!.definition).toBe("edited");
    store.undo();
    expect(store.getCollection("glossary")[0]!.definition).toBe(
      "Service Provider Interface",
    );
    store.undo();
    expect(store.getCollection("glossary")).toEqual([]);
    store.redo();
    expect(store.getCollection("glossary")).toEqual([TERM]);
  });
});

describe("type-first glossary creation is atomic (docs/027 §5.3/§6.2)", () => {
  it("marks the range and adds the term in one undoable transaction", () => {
    const { store, id } = leafStore("alpha beta");
    selectRange(store, id, 0, 5); // "alpha"
    const ok = createTermOverSelection(store, TERM);
    expect(ok).toBe(true);

    const marks = (store.requireNode(id) as TextLeafNode).marks;
    expect(marks.some((m) => m.kind === "glossary")).toBe(true);
    expect(store.getCollection("glossary")).toEqual([TERM]);

    // One undo reverses BOTH halves — never a mark pointing at a removed term.
    store.undo();
    expect(
      (store.requireNode(id) as TextLeafNode).marks.some(
        (m) => m.kind === "glossary",
      ),
    ).toBe(false);
    expect(store.getCollection("glossary")).toEqual([]);
  });

  it("delete-and-unmark removes the term and its occurrence atomically", () => {
    const { store, id } = leafStore("alpha beta");
    selectRange(store, id, 0, 5);
    createTermOverSelection(store, TERM);
    const index = buildDocumentIndex(store.toSnapshot());
    deleteTerm(store, index, TERM.id, true);
    expect(store.getCollection("glossary")).toEqual([]);
    expect(
      (store.requireNode(id) as TextLeafNode).marks.some(
        (m) => m.kind === "glossary",
      ),
    ).toBe(false);
    // Atomic: one undo brings back both the term and the mark.
    store.undo();
    expect(store.getCollection("glossary")).toEqual([TERM]);
    expect(
      (store.requireNode(id) as TextLeafNode).marks.some(
        (m) => m.kind === "glossary",
      ),
    ).toBe(true);
  });
});

describe("buildDocumentIndex collections + ref (docs/027 §5.4)", () => {
  it("passes collections through and tags each glossary occurrence with its ref", () => {
    const { store, id } = leafStore("alpha beta");
    // Construct a glossary mark by hand over "beta" via the same boundary helpers.
    const node = store.requireNode(id) as TextLeafNode;
    store.dispatch(
      store
        .transaction()
        .setCollection("glossary", [TERM])
        .addMark(id, {
          attrs: { term: TERM.id },
          from: boundaryAtOffset(node.content, 6, "before"),
          id: "mark-1",
          kind: "glossary",
          to: boundaryAtOffset(node.content, 10, "after"),
        }),
    );
    const index = buildDocumentIndex(store.toSnapshot());
    expect(index.collections.glossary).toEqual([TERM]);
    const occ = index.comments.find((c) => c.kind === "glossary");
    expect(occ?.ref).toBe(TERM.id);
    expect(occ?.text).toBe("beta");
  });
});
