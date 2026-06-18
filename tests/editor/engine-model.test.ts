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
import { render, screen } from "@testing-library/react";
import { RichTextRenderer } from "@idco/content-renderer";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  BlockRegistry,
  ROOT_NODE_ID,
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
  type JsonValue,
  type NodeId,
  type Step,
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

  it("does not walk the whole document on a text edit (AC9 hot path)", () => {
    /*
     * The reverse parent index only changes on structural steps, so the O(N)
     * `assertParentInvariant` walk must not run on the keystroke path
     * (010 §10.1 AC9 / 011 §10.4). It must still run after a structural edit,
     * which is where the index can actually break.
     */
    const allocator = createIdAllocator(CLIENT);
    const node = makeTextNode({
      content: allocator.createTextSlice("alpha"),
      id: allocator.createNodeId(),
    });
    const store = createEditorStore({ allocator, snapshot: snapshot([node]) });
    const walk = vi.spyOn(store, "assertParentInvariant");

    store.dispatch(
      store.transaction().replaceText({
        at: 1,
        inserted: "!",
        node: node.id,
        removed: "",
      }),
    );
    expect(walk).not.toHaveBeenCalled();

    const inserted = makeTextNode({
      content: allocator.createTextSlice("beta"),
      id: allocator.createNodeId(),
    });
    store.dispatch({
      origin: "local",
      steps: [
        { index: 1, node: inserted, parent: ROOT_NODE_ID, type: "insert-node" },
      ],
    });
    expect(walk).toHaveBeenCalledTimes(1);
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

  it("proves every Phase 3 step kind is invertible over generated cases", () => {
    for (const testCase of invertibleStepCases()) {
      const before = testCase.store.toSnapshot();
      testCase.store.dispatch({ origin: "local", steps: [testCase.step] });
      testCase.store.undo();
      expect(testCase.store.toSnapshot()).toEqual(before);
    }
  });

  it("undoes and redoes a generated edit sequence back to exact snapshots", () => {
    const allocator = createIdAllocator(CLIENT);
    const node = makeTextNode({
      content: allocator.createTextSlice("seed"),
      id: allocator.createNodeId(),
    });
    const store = createEditorStore({
      allocator,
      snapshot: snapshot([node]),
    });
    const before = store.toSnapshot();

    for (const edit of generatedTextEdits()) {
      const current = store.requireTextNode(node.id);
      store.dispatch(
        store.transaction().replaceText({
          at: Math.min(edit.at, current.content.text.length),
          inserted: edit.inserted,
          node: node.id,
          removed: current.content.text.slice(
            Math.min(edit.at, current.content.text.length),
            Math.min(edit.at, current.content.text.length) + edit.remove,
          ),
        }),
      );
    }
    const after = store.toSnapshot();

    for (let index = 0; index < generatedTextEdits().length; index += 1) {
      store.undo();
    }
    expect(store.toSnapshot()).toEqual(before);
    for (let index = 0; index < generatedTextEdits().length; index += 1) {
      store.redo();
    }
    expect(store.toSnapshot()).toEqual(after);
  });

  it("restores marks a deletion destroys or clamps when the edit is undone", () => {
    /*
     * docs/011 §4.5: the information a clamp would lose rides in the inverse.
     * A delete that drops a fully-covered mark and clamps an overlapping one
     * must round-trip exactly through undo, then reproduce the lossy edit on
     * redo.
     */
    const allocator = createIdAllocator(CLIENT);
    const base = makeTextNode({
      content: allocator.createTextSlice("abcdef"),
      id: allocator.createNodeId(),
    });
    const dropped = createTextMark({
      from: 1,
      id: "m-dropped",
      kind: "bold",
      node: base,
      to: 3,
    });
    const clamped = createTextMark({
      from: 2,
      id: "m-clamped",
      kind: "italic",
      node: base,
      to: 6,
    });
    const node = makeTextNode({ ...base, marks: [dropped, clamped] });
    const store = createEditorStore({ allocator, snapshot: snapshot([node]) });
    const before = store.toSnapshot();

    store.dispatch(
      store.transaction().replaceText({
        at: 0,
        inserted: "",
        node: node.id,
        removed: "abc",
      }),
    );
    const afterDelete = store.requireNode(node.id) as TextLeafNode;
    expect(afterDelete.content.text).toBe("def");
    expect(afterDelete.marks.map((mark) => mark.id)).toEqual(["m-clamped"]);
    const afterDeleteSnapshot = store.toSnapshot();

    store.undo();
    expect(store.toSnapshot()).toEqual(before);

    store.redo();
    expect(store.toSnapshot()).toEqual(afterDeleteSnapshot);
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

  it("round-trips generated overlapping and adjacent format ranges", () => {
    const markKinds = ["bold", "italic", "underline"] as const;
    for (let from = 0; from < 6; from += 1) {
      for (let to = from + 1; to <= 6; to += 1) {
        const allocator = createIdAllocator(CLIENT);
        const content = allocator.createTextSlice("abcdef");
        const base = makeTextNode({
          content,
          id: allocator.createNodeId(),
        });
        const marks = markKinds.map((kind, index) =>
          createTextMark({
            from: Math.max(0, from - index),
            id: `${kind}-${from}-${to}`,
            kind,
            node: base,
            to: Math.min(6, to + index),
          }),
        );
        const marked = makeTextNode({ ...base, marks });
        const store = createEditorStore({
          allocator,
          snapshot: snapshot([marked]),
        });
        const compat = compatFromEditorStore(store);
        const roundTrip = createEditorStoreFromCompat(compat, {
          allocator: createIdAllocator(CLIENT),
        });
        expect(compatFromEditorStore(roundTrip), `${from}-${to}`).toEqual(
          compat,
        );
      }
    }
  });

  it("preserves nested list structure instead of flattening it into list-item text", () => {
    const compat = {
      root: {
        children: [
          {
            children: [
              {
                children: [
                  { text: "Parent", type: "text" },
                  {
                    children: [
                      {
                        children: [{ text: "Child", type: "text" }],
                        type: "listitem",
                      },
                    ],
                    listType: "bullet",
                    type: "list",
                  },
                ],
                type: "listitem",
              },
            ],
            listType: "bullet",
            type: "list",
          },
        ],
      },
    };

    const store = createEditorStoreFromCompat(compat, {
      allocator: createIdAllocator(CLIENT),
    });
    const list = store.requireNode(store.order[0]!);
    if (list.kind !== "structural") throw new Error("expected structural list");
    const item = store.requireNode(list.children[0]!);
    expect(item.kind).toBe("structural");
    expect(compatFromEditorStore(store).root.children[0]).toMatchObject(
      compat.root.children[0],
    );
  });

  it("stores code-block bodies as piece tables while exporting legacy text", () => {
    const store = createEditorStoreFromCompat(
      {
        root: {
          children: [
            {
              id: "idco_node_code",
              language: "ts",
              text: "const answer = 42;",
              type: "code-block",
            },
          ],
        },
      },
      { allocator: createIdAllocator(CLIENT) },
    );
    const node = store.requireNode("idco_node_code" as NodeId);
    expect(node.kind).toBe("object");
    if (node.kind !== "object") throw new Error("expected object node");
    expect((node.data as { readonly code?: JsonValue }).code).toMatchObject({
      kind: "piece-table",
      original: "const answer = 42;",
      pieces: [{ buffer: "original", from: 0, length: 18 }],
    });
    expect(compatFromEditorStore(store).root.children[0]).toMatchObject({
      language: "ts",
      text: "const answer = 42;",
      type: "code-block",
    });
  });

  it("matches a committed golden compatibility document and renders through the read tier", () => {
    const store = createEditorStoreFromCompat(GOLDEN_COMPAT_INPUT, {
      allocator: createIdAllocator(CLIENT),
    });
    store.dispatch(
      store.transaction().replaceText({
        at: 5,
        inserted: " model",
        node: "idco_node_para" as NodeId,
        removed: "",
      }),
    );

    const golden = compatFromEditorStore(store);
    expect(golden).toEqual(GOLDEN_COMPAT_OUTPUT);
    render(createElement(RichTextRenderer, { value: golden }));
    expect(screen.getByText(/Owned model text/)).toBeInTheDocument();
    expect(screen.getByText("Nested child").closest("ul")).not.toBeNull();
    expect(screen.getByText("const answer = 42;")).toBeInTheDocument();
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

function invertibleStepCases(): Array<{
  readonly name: string;
  readonly store: ReturnType<typeof createEditorStore>;
  readonly step: Step;
}> {
  const cases: Array<{
    readonly name: string;
    readonly store: ReturnType<typeof createEditorStore>;
    readonly step: Step;
  }> = [];

  {
    const allocator = createIdAllocator(CLIENT);
    const node = makeTextNode({
      content: allocator.createTextSlice("abc"),
      id: allocator.createNodeId(),
    });
    cases.push({
      name: "replace-text",
      step: {
        at: 1,
        inserted: allocator.createTextSlice("Z"),
        node: node.id,
        removed: { runs: [], text: "" },
        type: "replace-text",
      },
      store: createEditorStore({ allocator, snapshot: snapshot([node]) }),
    });
  }

  {
    const allocator = createIdAllocator(CLIENT);
    const node = makeTextNode({
      content: allocator.createTextSlice("abc"),
      id: allocator.createNodeId(),
    });
    const mark = createTextMark({
      from: 0,
      id: "add-bold",
      kind: "bold",
      node,
      to: 2,
    });
    cases.push({
      name: "add-mark",
      step: { mark, node: node.id, type: "add-mark" },
      store: createEditorStore({ allocator, snapshot: snapshot([node]) }),
    });
  }

  {
    const allocator = createIdAllocator(CLIENT);
    const base = makeTextNode({
      content: allocator.createTextSlice("abc"),
      id: allocator.createNodeId(),
    });
    const mark = createTextMark({
      from: 0,
      id: "remove-bold",
      kind: "bold",
      node: base,
      to: 2,
    });
    const node = makeTextNode({ ...base, marks: [mark] });
    cases.push({
      name: "remove-mark",
      step: { mark, node: node.id, type: "remove-mark" },
      store: createEditorStore({ allocator, snapshot: snapshot([node]) }),
    });
  }

  {
    const allocator = createIdAllocator(CLIENT);
    const node = makeTextNode({
      content: allocator.createTextSlice("abc"),
      id: allocator.createNodeId(),
    });
    cases.push({
      name: "set-node-type",
      step: {
        from: "paragraph",
        node: node.id,
        to: "heading",
        type: "set-node-type",
      },
      store: createEditorStore({ allocator, snapshot: snapshot([node]) }),
    });
  }

  {
    const allocator = createIdAllocator(CLIENT);
    const node = makeTextNode({
      attrs: { align: "left" },
      content: allocator.createTextSlice("abc"),
      id: allocator.createNodeId(),
    });
    cases.push({
      name: "set-node-attr",
      step: {
        from: "left",
        key: "align",
        node: node.id,
        to: "center",
        type: "set-node-attr",
      },
      store: createEditorStore({ allocator, snapshot: snapshot([node]) }),
    });
  }

  {
    const allocator = createIdAllocator(CLIENT);
    const node = makeTextNode({
      content: allocator.createTextSlice("abc"),
      id: allocator.createNodeId(),
    });
    const inserted = makeTextNode({
      content: allocator.createTextSlice("inserted"),
      id: allocator.createNodeId(),
    });
    cases.push({
      name: "insert-node",
      step: {
        index: 1,
        node: inserted,
        parent: ROOT_NODE_ID,
        type: "insert-node",
      },
      store: createEditorStore({ allocator, snapshot: snapshot([node]) }),
    });
  }

  {
    const allocator = createIdAllocator(CLIENT);
    const first = makeTextNode({
      content: allocator.createTextSlice("first"),
      id: allocator.createNodeId(),
    });
    const second = makeTextNode({
      content: allocator.createTextSlice("second"),
      id: allocator.createNodeId(),
    });
    cases.push({
      name: "remove-node",
      step: {
        index: 1,
        node: second,
        parent: ROOT_NODE_ID,
        type: "remove-node",
      },
      store: createEditorStore({
        allocator,
        snapshot: snapshot([first, second]),
      }),
    });
  }

  {
    const allocator = createIdAllocator(CLIENT);
    const first = makeTextNode({
      content: allocator.createTextSlice("first"),
      id: allocator.createNodeId(),
    });
    const second = makeTextNode({
      content: allocator.createTextSlice("second"),
      id: allocator.createNodeId(),
    });
    cases.push({
      name: "move-node",
      step: {
        from: { index: 1, parent: ROOT_NODE_ID },
        node: second.id,
        to: { index: 0, parent: ROOT_NODE_ID },
        type: "move-node",
      },
      store: createEditorStore({
        allocator,
        snapshot: snapshot([first, second]),
      }),
    });
  }

  {
    const allocator = createIdAllocator(CLIENT);
    const object = makeObjectNode({
      baked: { kind: "html", payload: "<p>old</p>" },
      data: { value: "old" },
      id: allocator.createNodeId(),
      status: "ready",
      type: "fake-object",
    });
    cases.push({
      name: "set-object-data",
      step: {
        bakedFrom: { kind: "html", payload: "<p>old</p>" },
        bakedTo: { kind: "html", payload: "<p>new</p>" },
        from: { value: "old" },
        node: object.id,
        statusFrom: "ready",
        statusTo: "dirty",
        to: { value: "new" },
        type: "set-object-data",
      },
      store: createEditorStore({ allocator, snapshot: snapshot([object]) }),
    });
  }

  {
    const allocator = createIdAllocator(CLIENT);
    const node = makeTextNode({
      content: allocator.createTextSlice("abc"),
      id: allocator.createNodeId(),
    });
    cases.push({
      name: "set-settings",
      step: {
        from: {},
        to: { pageSize: "wide" },
        type: "set-settings",
      },
      store: createEditorStore({ allocator, snapshot: snapshot([node]) }),
    });
  }

  return cases;
}

function generatedTextEdits(): ReadonlyArray<{
  readonly at: number;
  readonly inserted: string;
  readonly remove: number;
}> {
  return [
    { at: 4, inserted: "-a", remove: 0 },
    { at: 1, inserted: "B", remove: 1 },
    { at: 6, inserted: "tail", remove: 0 },
    { at: 2, inserted: "", remove: 2 },
    { at: 0, inserted: "start-", remove: 0 },
    { at: 5, inserted: "_", remove: 1 },
  ];
}

const GOLDEN_COMPAT_INPUT = {
  root: {
    children: [
      {
        children: [{ text: "Owned text", type: "text" }],
        id: "idco_node_para",
        type: "paragraph",
      },
      {
        children: [{ format: TEXT_FORMAT.bold, text: "Heading", type: "text" }],
        id: "idco_node_heading",
        tag: "h2",
        type: "heading",
      },
      {
        children: [
          {
            children: [
              { text: "Parent item", type: "text" },
              {
                children: [
                  {
                    children: [{ text: "Nested child", type: "text" }],
                    id: "idco_node_nested_item",
                    type: "listitem",
                  },
                ],
                id: "idco_node_nested_list",
                listType: "bullet",
                type: "list",
              },
            ],
            id: "idco_node_parent_item",
            type: "listitem",
          },
        ],
        id: "idco_node_list",
        listType: "bullet",
        type: "list",
      },
      {
        id: "idco_node_code",
        language: "ts",
        status: "ready",
        text: "const answer = 42;",
        type: "code-block",
      },
    ],
  },
  settings: { pageSize: "wide" },
} as const;

const GOLDEN_COMPAT_OUTPUT = {
  root: {
    children: [
      {
        children: [
          {
            format: 0,
            text: "Owned model text",
            type: "text",
          },
        ],
        id: "idco_node_para",
        type: "paragraph",
      },
      {
        children: [
          {
            format: TEXT_FORMAT.bold,
            text: "Heading",
            type: "text",
          },
        ],
        id: "idco_node_heading",
        tag: "h2",
        type: "heading",
      },
      {
        children: [
          {
            children: [
              {
                format: 0,
                text: "Parent item",
                type: "text",
              },
              {
                children: [
                  {
                    children: [
                      {
                        format: 0,
                        text: "Nested child",
                        type: "text",
                      },
                    ],
                    id: "idco_node_nested_item",
                    type: "listitem",
                  },
                ],
                id: "idco_node_nested_list",
                listType: "bullet",
                type: "list",
              },
            ],
            id: "idco_node_parent_item",
            type: "listitem",
          },
        ],
        id: "idco_node_list",
        listType: "bullet",
        type: "list",
      },
      {
        id: "idco_node_code",
        language: "ts",
        status: "ready",
        text: "const answer = 42;",
        type: "code-block",
      },
    ],
  },
  settings: { pageSize: "wide" },
} as const;
