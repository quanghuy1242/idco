/**
 * docs/010 Phase 8 — toolbar/authoring command extensions.
 *
 * Headless proof that the Phase 8 command additions compile to invertible
 * transactions on the model selection: cross-leaf mark toggle, link set/clear,
 * multi-block set-block-type with heading tags, block reorder, and object insert
 * through the registry. Each asserts the effect plus undo round-trips.
 */
import { describe, expect, it } from "vitest";
import {
  createEditorStore,
  createIdAllocator,
  makeTextNode,
  pointAtOffset,
  resolveBoundaryOffset,
  type EditorStore,
  type NodeId,
  type TextLeafNode,
} from "../../packages/editor/src/core";

function build(texts: readonly string[]): {
  store: EditorStore;
  ids: NodeId[];
} {
  const allocator = createIdAllocator("idco_client_p8");
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
  return { ids: nodes.map((n) => n.id), store };
}

function selectRange(
  store: EditorStore,
  fromId: NodeId,
  fromOff: number,
  toId: NodeId,
  toOff: number,
): void {
  const a = store.requireTextNode(fromId);
  const b = store.requireTextNode(toId);
  store.dispatch({
    origin: "local",
    selectionAfter: {
      anchor: pointAtOffset(fromId, a.content, fromOff),
      focus: pointAtOffset(toId, b.content, toOff),
      type: "text",
    },
    steps: [],
  });
}

function markKindsAt(node: TextLeafNode, offset: number): string[] {
  return node.marks
    .filter((mark) => {
      const from = resolveBoundaryOffset(node.content, mark.from);
      const to = resolveBoundaryOffset(node.content, mark.to);
      return from <= offset && offset < to;
    })
    .map((mark) => mark.kind);
}

describe("Phase 8 commands", () => {
  it("toggles a mark across multiple leaves and inverts", () => {
    const { store, ids } = build(["alpha", "bravo"]);
    selectRange(store, ids[0]!, 2, ids[1]!, 3);
    expect(store.command({ mark: "bold", type: "toggle-mark" })).not.toBeNull();
    expect(markKindsAt(store.requireTextNode(ids[0]!), 3)).toContain("bold");
    expect(markKindsAt(store.requireTextNode(ids[1]!), 1)).toContain("bold");
    // Toggle again removes it from both (all-marked -> remove).
    store.command({ mark: "bold", type: "toggle-mark" });
    expect(store.requireTextNode(ids[0]!).marks).toHaveLength(0);
    expect(store.requireTextNode(ids[1]!).marks).toHaveLength(0);
  });

  it("sets and clears a link mark with its href", () => {
    const { store, ids } = build(["see docs here"]);
    selectRange(store, ids[0]!, 4, ids[0]!, 8);
    store.command({ href: "https://x.test", type: "set-link" });
    const link = store
      .requireTextNode(ids[0]!)
      .marks.find((m) => m.kind === "link");
    expect(link?.attrs?.href).toBe("https://x.test");
    // A caret inside the link reports its href; outside the link reports null.
    selectRange(store, ids[0]!, 5, ids[0]!, 5);
    expect(store.query({ type: "active-link-href" })).toBe("https://x.test");
    selectRange(store, ids[0]!, 0, ids[0]!, 0);
    expect(store.query({ type: "active-link-href" })).toBe(null);
    selectRange(store, ids[0]!, 4, ids[0]!, 8);
    store.command({ type: "clear-link" });
    expect(
      store.requireTextNode(ids[0]!).marks.some((m) => m.kind === "link"),
    ).toBe(false);
  });

  it("sets heading type and tag across blocks", () => {
    const { store, ids } = build(["one", "two"]);
    selectRange(store, ids[0]!, 0, ids[1]!, 3);
    store.command({ blockType: "heading", tag: "h2", type: "set-block-type" });
    for (const id of ids) {
      const node = store.requireTextNode(id);
      expect(node.type).toBe("heading");
      expect(node.attrs?.tag).toBe("h2");
    }
  });

  it("reorders a block and inverts", () => {
    const { store, ids } = build(["a", "b", "c"]);
    store.command({ node: ids[2]!, toIndex: 0, type: "move-block" });
    expect(store.order).toEqual([ids[2], ids[0], ids[1]]);
    store.undo();
    expect(store.order).toEqual([ids[0], ids[1], ids[2]]);
  });

  it("inserts an object through the registry and bakes it", () => {
    const { store, ids } = build(["intro"]);
    selectRange(store, ids[0]!, 5, ids[0]!, 5);
    store.command({ data: {}, objectType: "divider", type: "insert-object" });
    expect(store.order).toHaveLength(2);
    const inserted = store.requireNode(store.order[1]!);
    expect(inserted.kind).toBe("object");
    expect(inserted.kind === "object" && inserted.baked?.kind).toBe("divider");
  });
});
