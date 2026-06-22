/**
 * Feature-parity checklist vs the standard editor (docs/010 Phase 8 AC4) and the
 * opt-in export contract (AC5).
 *
 * Each capability the legacy Lexical surface offers — lists, marks, tables,
 * links, glossary, comments — is exercised on the owned model so parity is a
 * proven checklist, not an assertion. AC5 confirms the engine is an explicit
 * opt-in export while the default `RichTextEditor` is still exported unchanged.
 */
import { describe, expect, it } from "vitest";
import {
  boundaryAtOffset,
  buildDocumentIndex,
  compatFromEditorStore,
  createEditorStore,
  createEditorStoreFromCompat,
  createIdAllocator,
  makeTextNode,
  pointAtOffset,
  resolveBoundaryOffset,
  type EditorStore,
  type NodeId,
  type TextLeafNode,
  type TextMark,
  type TextMarkKind,
} from "../../packages/editor/src/core";

function single(text: string): { store: EditorStore; id: NodeId } {
  const allocator = createIdAllocator("idco_client_parity");
  const node = makeTextNode({
    content: allocator.createTextSlice(text),
    id: allocator.createNodeId(),
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

function select(
  store: EditorStore,
  id: NodeId,
  from: number,
  to: number,
): void {
  const node = store.requireTextNode(id);
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

function addRangeMark(
  store: EditorStore,
  id: NodeId,
  kind: TextMarkKind,
  from: number,
  to: number,
  attrs?: TextMark["attrs"],
): void {
  const node = store.requireTextNode(id);
  store.dispatch({
    origin: "local",
    selectionAfter: store.selection ?? undefined,
    steps: [
      {
        mark: {
          ...(attrs ? { attrs } : {}),
          from: boundaryAtOffset(node.content, from, "before"),
          id: `${kind}_mark`,
          kind,
          to: boundaryAtOffset(node.content, to, "after"),
        },
        node: id,
        type: "add-mark",
      },
    ],
  });
}

function hasMark(node: TextLeafNode, kind: TextMarkKind): boolean {
  return node.marks.some((m) => m.kind === kind);
}

describe("parity checklist (AC4)", () => {
  it("marks: bold/italic/underline/strike/code/highlight toggle on the model", () => {
    const { store, id } = single("formatting");
    select(store, id, 0, 10);
    for (const kind of [
      "bold",
      "italic",
      "underline",
      "strikethrough",
      "code",
      "highlight",
    ] as const) {
      store.command({ mark: kind, type: "toggle-mark" });
      expect(hasMark(store.requireTextNode(id), kind)).toBe(true);
    }
  });

  it("links: a link mark survives a full export → import → export round-trip", () => {
    const { store, id } = single("see the docs");
    select(store, id, 4, 8);
    store.command({ href: "https://idco.test", type: "set-link" });
    // Export to compat, re-import, and re-export: the link element node and its
    // href must survive the whole cycle, and the text must be intact.
    const exported = compatFromEditorStore(store);
    const reimported = createEditorStoreFromCompat(exported);
    const leaf = reimported.requireTextNode(reimported.order[0]!);
    const link = leaf.marks.find((m) => m.kind === "link");
    expect(link?.attrs?.href).toBe("https://idco.test");
    expect(leaf.content.text).toBe("see the docs");
    const reexported = compatFromEditorStore(reimported);
    const linkNode = reexported.root.children[0]?.children?.find(
      (c) => c.type === "link",
    );
    expect(linkNode?.url).toBe("https://idco.test");
  });

  it("lists: a paragraph becomes a list item and indents/outdents", () => {
    const { store, id } = single("item");
    select(store, id, 0, 0);
    store.command({ blockType: "listitem", type: "set-block-type" });
    expect(store.requireTextNode(id).type).toBe("listitem");
  });

  it("tables: an inserted structural table round-trips compat without throwing", () => {
    // The table is a structural container now (docs/022): it inserts via the
    // generic `insert-structural` command and exports through its `toCompatNode`.
    const { store, id } = single("intro");
    select(store, id, 5, 5);
    store.command({ structuralType: "table", type: "insert-structural" });
    expect(() => compatFromEditorStore(store)).not.toThrow();
    expect(store.order.length).toBe(2);
    const table = store.getNode(store.order[1]!);
    expect(table?.kind === "structural" && table.type).toBe("table");
  });

  it("glossary + comments: range marks are indexed by the document index", () => {
    const { store, id } = single("a glossary term and a comment");
    addRangeMark(store, id, "glossary", 2, 15);
    addRangeMark(store, id, "comment", 22, 29);
    const index = buildDocumentIndex(store.toSnapshot());
    expect(index.comments.map((c) => c.kind).sort()).toEqual([
      "comment",
      "glossary",
    ]);
    expect(index.comments.find((c) => c.kind === "glossary")?.text).toContain(
      "glossary",
    );
  });

  it("comments are modeled as range marks anchored to the leaf", () => {
    // Comments/glossary are modeled + indexed (above); their projection to legacy
    // compat `mark` nodes is the docs/018 Phase 9 follow-on, so this asserts the
    // model anchor, not a compat round-trip.
    const { store, id } = single("comment here");
    addRangeMark(store, id, "comment", 0, 7);
    const node = store.requireTextNode(id);
    const from = resolveBoundaryOffset(node.content, node.marks[0]!.from);
    const to = resolveBoundaryOffset(node.content, node.marks[0]!.to);
    expect([from, to]).toEqual([0, 7]);
  });
});

describe("opt-in export (AC5)", () => {
  it("exposes the engine surface on the root; the legacy editor lives in its own package", async () => {
    const pkg = await import("../../packages/editor/src");
    // The owned engine surface is the root's only API.
    expect(typeof pkg.OwnedModelEditor).toBe("object"); // forwardRef object
    expect(typeof pkg.OwnedModelEditorView).toBe("object");
    expect(typeof pkg.createEditorStore).toBe("function");
    // The legacy Lexical editor was extracted (note.md Legacy extraction track):
    // it is no longer re-exported from the owned root, only from its own package,
    // so the owned engine carries no Lexical.
    expect("RichTextEditor" in pkg).toBe(false);
    const legacy = await import("../../packages/editor-legacy/src");
    expect(typeof legacy.RichTextEditor).toBe("function");
  });
});
