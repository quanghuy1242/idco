/**
 * Phase 3 acceptance tests for the owned-model editor core.
 *
 * These tests intentionally stay headless. They are not checking React
 * rendering, DOM selection, EditContext, or virtualization. They prove the
 * contracts that later phases need to rely on:
 *
 * - text edits replace only the touched node object;
 * - every applied step has an inverse path through undo/redo;
 * - runtime range marks project to and from legacy split text nodes;
 * - stored points survive edits by character-id anchor;
 * - object data crosses the registry boundary explicitly;
 * - settings remain document-level data;
 * - Phase 3 has the collaboration-ready address fields but no collaboration
 *   machinery.
 */
import { describe, expect, it, vi } from "vitest";
import {
  BlockRegistry,
  TEXT_FORMAT,
  characterIdsForSlice,
  compatFromEditorStore,
  createEditorStore,
  createEditorStoreFromCompat,
  createIdAllocator,
  createTextMark,
  editorSnapshotFromCompat,
  makeObjectNode,
  makeTextNode,
  pointAtOffset,
  type BlockDefinition,
  type EditorDocumentSnapshot,
  type EditorNode,
  type NodeId,
  type TextLeafNode,
} from "../../packages/editor/src/core";

const CLIENT = "idco_client_phase3";

describe("owned-model editor core", () => {
  it("keeps a normalized node graph and isolates text edits by node identity", () => {
    /*
     * This is the hot-path shape docs/011 asks for: one node replacement and
     * one node subscriber notification for a text edit, with sibling references
     * and top-level order untouched.
     */
    const allocator = createIdAllocator(CLIENT);
    const first = makeTextNode({
      content: allocator.createTextSlice("alpha"),
      id: allocator.createNodeId(),
    });
    const second = makeTextNode({
      content: allocator.createTextSlice("beta"),
      id: allocator.createNodeId(),
    });
    const store = createEditorStore({
      allocator,
      snapshot: snapshot([first, second]),
    });
    const beforeSecond = store.requireNode(second.id);
    const firstSubscriber = vi.fn<() => void>();
    const secondSubscriber = vi.fn<() => void>();
    const orderSubscriber = vi.fn<() => void>();
    store.subscribeNode(first.id, firstSubscriber);
    store.subscribeNode(second.id, secondSubscriber);
    store.subscribeOrder(orderSubscriber);

    store.dispatch(
      store.transaction().replaceText({
        at: 1,
        inserted: "!",
        node: first.id,
        removed: "",
      }),
    );

    expect((store.requireNode(first.id) as TextLeafNode).content.text).toBe(
      "a!lpha",
    );
    expect(store.requireNode(second.id)).toBe(beforeSecond);
    expect(firstSubscriber).toHaveBeenCalledTimes(1);
    expect(secondSubscriber).not.toHaveBeenCalled();
    expect(orderSubscriber).not.toHaveBeenCalled();
    store.assertParentInvariant();
  });

  it("inverts steps and undo/redo returns to deep-equal snapshots", () => {
    const allocator = createIdAllocator(CLIENT);
    const node = makeTextNode({
      content: allocator.createTextSlice("hello"),
      id: allocator.createNodeId(),
    });
    const store = createEditorStore({
      allocator,
      snapshot: snapshot([node]),
    });
    const before = store.toSnapshot();

    store.dispatch(
      store.transaction().replaceText({
        at: 5,
        inserted: " world",
        node: node.id,
        removed: "",
      }),
    );
    store.dispatch({
      origin: "local",
      steps: [
        {
          from: "paragraph",
          node: node.id,
          to: "heading",
          type: "set-node-type",
        },
      ],
    });
    expect((store.requireNode(node.id) as TextLeafNode).type).toBe("heading");

    store.undo();
    store.undo();
    expect(store.toSnapshot()).toEqual(before);
    store.redo();
    store.redo();
    expect((store.requireNode(node.id) as TextLeafNode).content.text).toBe(
      "hello world",
    );
    expect((store.requireNode(node.id) as TextLeafNode).type).toBe("heading");
  });

  it("projects format range marks through compat split text nodes losslessly", () => {
    /*
     * Runtime marks can overlap, while legacy compatibility JSON only has a
     * bitmask per text node. The expected children prove the adapter splits at
     * every mark boundary and recombines to the same compatibility output after
     * a round trip.
     */
    const allocator = createIdAllocator(CLIENT);
    const content = allocator.createTextSlice("abcdef");
    const base = makeTextNode({
      content,
      id: allocator.createNodeId(),
    });
    const bold = createTextMark({
      from: 1,
      id: "m-bold",
      kind: "bold",
      node: base,
      to: 5,
    });
    const italic = createTextMark({
      from: 2,
      id: "m-italic",
      kind: "italic",
      node: base,
      to: 4,
    });
    const marked = makeTextNode({ ...base, marks: [bold, italic] });
    const store = createEditorStore({
      allocator,
      snapshot: snapshot([marked]),
    });

    const compat = compatFromEditorStore(store);
    expect(compat.root.children[0]?.children).toEqual([
      { format: 0, text: "a", type: "text" },
      { format: TEXT_FORMAT.bold, text: "b", type: "text" },
      {
        format: TEXT_FORMAT.bold | TEXT_FORMAT.italic,
        text: "cd",
        type: "text",
      },
      { format: TEXT_FORMAT.bold, text: "e", type: "text" },
      { format: 0, text: "f", type: "text" },
    ]);

    const roundTrip = createEditorStoreFromCompat(compat, {
      allocator: createIdAllocator(CLIENT),
    });
    expect(compatFromEditorStore(roundTrip)).toEqual(compat);
  });

  it("keeps character-id anchors stable while offsets resolve after edits", () => {
    const allocator = createIdAllocator(CLIENT);
    const node = makeTextNode({
      content: allocator.createTextSlice("abcd"),
      id: allocator.createNodeId(),
    });
    const point = pointAtOffset(node.id, node.content, 2);
    const anchor = point.anchor.kind === "char" ? point.anchor.id : undefined;
    const store = createEditorStore({
      allocator,
      selection: { anchor: point, focus: point, type: "text" },
      snapshot: snapshot([node]),
    });

    store.dispatch(
      store.transaction().replaceText({
        at: 0,
        inserted: "XX",
        node: node.id,
        removed: "",
      }),
    );

    expect(store.selection?.type).toBe("text");
    const selection = store.selection;
    if (selection?.type !== "text") throw new Error("expected text selection");
    expect(selection.anchor.anchor).toEqual({ id: anchor, kind: "char" });
    expect(selection.anchor.offset).toBe(4);
  });

  it("round-trips object registry data, baked status, and document settings", () => {
    /*
     * A fake object is enough for Phase 3: it proves custom objects must enter
     * through a registry definition and that baked/status/settings survive the
     * store <-> compatibility projection without implementing a real baker.
     */
    const fakeDefinition: BlockDefinition = {
      normalizeData(value) {
        if (
          typeof value !== "object" ||
          value === null ||
          !("label" in value)
        ) {
          throw new Error("fake-block requires a label");
        }
        return {
          baked: { kind: "html", payload: "<p>baked</p>" },
          data: { label: String(value.label) },
          status: "ready",
        };
      },
      type: "fake-block",
    };
    const registry = new BlockRegistry([fakeDefinition]);
    const allocator = createIdAllocator(CLIENT);
    const object = makeObjectNode({
      baked: { kind: "html", payload: "<p>baked</p>" },
      data: { label: "Demo" },
      id: allocator.createNodeId(),
      status: "ready",
      type: "fake-block",
    });
    const store = createEditorStore({
      allocator,
      snapshot: {
        ...snapshot([object]),
        settings: { pageSize: "wide", publication: { theme: "technical" } },
      },
    });

    const compat = compatFromEditorStore(store, registry);
    expect(compat.root.children[0]).toMatchObject({
      baked: { kind: "html", payload: "<p>baked</p>" },
      id: object.id,
      label: "Demo",
      status: "ready",
      type: "fake-block",
    });
    expect(compat.settings).toEqual({
      pageSize: "wide",
      publication: { theme: "technical" },
    });

    const next = createEditorStoreFromCompat(compat, {
      allocator: createIdAllocator(CLIENT),
      registry,
    });
    expect(next.toSnapshot().settings).toEqual(store.toSnapshot().settings);
    expect(compatFromEditorStore(next, registry)).toEqual(compat);
  });

  it("makes unknown object policy explicit", () => {
    const document = {
      root: {
        children: [{ type: "mystery-widget" }],
      },
    };

    expect(() =>
      editorSnapshotFromCompat(document, {
        allocator: createIdAllocator(CLIENT),
      }),
    ).toThrow(/Unknown compatibility node type/);
    expect(
      editorSnapshotFromCompat(document, {
        allocator: createIdAllocator(CLIENT),
        unknownObjectPolicy: "drop",
      }).body.order,
    ).toEqual([]);
  });

  it("keeps transactions local and node ids opaque rather than document indexes", () => {
    const allocator = createIdAllocator(CLIENT);
    const node = makeTextNode({
      content: allocator.createTextSlice("x"),
      id: allocator.createNodeId(),
    });
    const store = createEditorStore({
      allocator,
      snapshot: snapshot([node]),
    });

    const committed = store.dispatch(
      store.transaction().replaceText({
        at: 1,
        inserted: "y",
        node: node.id,
        removed: "",
      }),
    );

    expect(node.id).toMatch(/^idco_node_/);
    expect(node.id).not.toBe("0");
    expect(committed?.origin).toBe("local");
    expect(characterIdsForSlice(node.content)[0]?.client).toBe(CLIENT);
  });

  it("has no collaboration machinery in the core phase", async () => {
    const modules = await Promise.all([
      import("../../packages/editor/src/core/model"),
      import("../../packages/editor/src/core/registry"),
      import("../../packages/editor/src/core/steps"),
      import("../../packages/editor/src/core/store"),
      import("../../packages/editor/src/core/compat"),
    ]);
    const exportedNames = modules.flatMap((module) => Object.keys(module));
    expect(exportedNames.join(" ")).not.toMatch(
      /awareness|peer|provider|rebase|multiPeer/i,
    );
  });
});

function snapshot(nodes: readonly EditorNode[]): EditorDocumentSnapshot {
  const order = nodes.map((node) => node.id);
  return {
    body: {
      blocks: Object.fromEntries(
        nodes.map((node) => [node.id, node]),
      ) as Record<NodeId, EditorNode>,
      order,
    },
    settings: {},
    version: 1,
  };
}
