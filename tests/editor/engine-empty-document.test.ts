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
