/**
 * D3 (note.md §5.6) — `emptyDocument()` is a fresh, editable document.
 *
 * Before the factory, a consumer opening a new document had to hand-build the seed
 * paragraph (an empty `body.order: []` has no caret target and accepts no input).
 * These prove the factory yields a single empty paragraph, that the store loads it
 * and accepts typed input at its caret, and that the seed id does not collide with
 * the store's own allocator (a first edit that mints a node id must not overwrite
 * the seed).
 */
import { describe, expect, it } from "vitest";
import {
  createEditorStore,
  createIdAllocator,
  emptyDocument,
  makeObjectNode,
  pointAtOffset,
} from "../../packages/editor/src/core";

describe("emptyDocument", () => {
  it("is a single empty paragraph", () => {
    const doc = emptyDocument();
    expect(doc.version).toBe(1);
    expect(doc.body.order).toHaveLength(1);
    const node = doc.body.blocks[doc.body.order[0]!]!;
    expect(node.kind).toBe("text");
    expect(node.type).toBe("paragraph");
    expect(node.kind === "text" ? node.content.text : "<non-text>").toBe("");
  });

  it("loads into a store and accepts typed input at its caret target", () => {
    const store = createEditorStore({
      allocator: createIdAllocator(),
      snapshot: emptyDocument(),
    });
    expect(store.order).toHaveLength(1);
    const id = store.order[0]!;
    const node = store.requireTextNode(id);
    const point = pointAtOffset(id, node.content, 0);
    store.dispatch({
      origin: "local",
      selectionAfter: { anchor: point, focus: point, type: "text" },
      steps: [],
    });
    store.command({ type: "insert-text", text: "hello" });
    expect(store.requireTextNode(id).content.text).toBe("hello");
  });

  it("mints a seed id in a separate space from the store allocator (no collision)", () => {
    const snapshot = emptyDocument();
    const seedId = snapshot.body.order[0]!;
    const store = createEditorStore({
      allocator: createIdAllocator(),
      snapshot,
    });
    const node = store.requireTextNode(seedId);
    store.dispatch({
      origin: "local",
      selectionAfter: {
        anchor: pointAtOffset(seedId, node.content, 0),
        focus: pointAtOffset(seedId, node.content, 0),
        type: "text",
      },
      steps: [],
    });
    // A split mints a fresh node id from the store allocator; the seed must survive.
    store.command({ type: "split-block" });
    expect(store.order.length).toBeGreaterThan(1);
    expect(store.order).toContain(seedId);
    expect(new Set(store.order).size).toBe(store.order.length);
  });
});

describe("removing the body's last block never leaves an empty document", () => {
  // note.md §5.3 follow-up (the empty-doc B3 repro): inserting an object into an
  // empty doc replaces the only paragraph, so removing that object would empty the
  // body — no caret target, the selection falls back to a root gap that paints
  // nothing. `compileRemoveBlock` must re-seed a paragraph + land a text caret.
  it("re-seeds an empty paragraph with a text caret when the only block is removed", () => {
    const allocator = createIdAllocator("idco_client_reseed");
    const table = makeObjectNode({
      data: {},
      id: allocator.createNodeId(),
      type: "table",
    });
    const store = createEditorStore({
      allocator,
      snapshot: {
        body: { blocks: { [table.id]: table }, order: [table.id] },
        settings: {},
        version: 1,
      },
    });
    expect(store.order).toEqual([table.id]);

    const ok = store.command({ node: table.id, type: "remove-block" });
    expect(ok).toBeTruthy();

    // The body is not empty: it holds exactly one fresh (non-table) paragraph.
    expect(store.order).toHaveLength(1);
    const seeded = store.requireTextNode(store.order[0]!);
    expect(seeded.type).toBe("paragraph");
    expect(seeded.content.text).toBe("");
    // The selection is a real text caret in that paragraph (not a gap).
    const sel = store.selection;
    expect(sel?.type).toBe("text");
    expect(sel?.type === "text" ? sel.focus.node : null).toBe(seeded.id);
  });

  it("does not re-seed when other blocks survive the removal", () => {
    const allocator = createIdAllocator("idco_client_reseed2");
    const keep = makeObjectNode({
      data: {},
      id: allocator.createNodeId(),
      type: "divider",
    });
    const drop = makeObjectNode({
      data: {},
      id: allocator.createNodeId(),
      type: "table",
    });
    const store = createEditorStore({
      allocator,
      snapshot: {
        body: {
          blocks: { [keep.id]: keep, [drop.id]: drop },
          order: [keep.id, drop.id],
        },
        settings: {},
        version: 1,
      },
    });
    store.command({ node: drop.id, type: "remove-block" });
    // Only the dropped block is gone; no spurious paragraph is inserted.
    expect(store.order).toEqual([keep.id]);
  });
});
