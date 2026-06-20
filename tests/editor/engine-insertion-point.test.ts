/**
 * docs/019 Phase 1 — positional insertion. `resolveInsertionPoint` maps any
 * selection to where a block lands (`at` / `replace`), and the insert compilers
 * consume it so a block goes where the caret is: top-of-document is reachable,
 * an empty paragraph the caret sits on is consumed, and a non-collapsed range is
 * deleted first. The reported bug (insert always lands after the touched block)
 * is the first assertion here.
 */
import { describe, expect, it } from "vitest";
import {
  createEditorStore,
  createIdAllocator,
  makeObjectNode,
  makeTextNode,
  pointAtOffset,
  resolveInsertionPoint,
  type EditorNode,
  type EditorStore,
  type IdAllocator,
} from "../../packages/editor/src";

function storeOf(nodes: readonly EditorNode[], allocator: IdAllocator) {
  return createEditorStore({
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
}

function para(allocator: IdAllocator, text: string) {
  return makeTextNode({
    content: allocator.createTextSlice(text),
    id: allocator.createNodeId(),
    type: "paragraph",
  });
}

function setCaret(
  store: EditorStore,
  node: Extract<EditorNode, { kind: "text" }>,
  offset: number,
) {
  const point = pointAtOffset(node.id, node.content, offset);
  store.dispatch({
    origin: "local",
    selectionAfter: { anchor: point, focus: point, type: "text" },
    steps: [],
  });
}

function setRange(
  store: EditorStore,
  node: Extract<EditorNode, { kind: "text" }>,
  from: number,
  to: number,
) {
  store.dispatch({
    origin: "local",
    selectionAfter: {
      anchor: pointAtOffset(node.id, node.content, from),
      focus: pointAtOffset(node.id, node.content, to),
      type: "text",
    },
    steps: [],
  });
}

describe("docs/019 §4.6 — resolveInsertionPoint maps the selection to a placement", () => {
  it("caret at offset 0 of the first block resolves BEFORE it (the reported bug)", () => {
    const allocator = createIdAllocator("idco_client_ip_before");
    const a = para(allocator, "aaa");
    const b = para(allocator, "bbb");
    const store = storeOf([a, b], allocator);
    setCaret(store, a, 0);
    expect(resolveInsertionPoint(store)).toEqual({
      index: 0,
      kind: "at",
      scope: store.bodyId,
    });
  });

  it("caret at the end of a block resolves AFTER it (unchanged behavior)", () => {
    const allocator = createIdAllocator("idco_client_ip_after");
    const a = para(allocator, "aaa");
    const b = para(allocator, "bbb");
    const store = storeOf([a, b], allocator);
    setCaret(store, a, 3);
    expect(resolveInsertionPoint(store)).toEqual({
      index: 1,
      kind: "at",
      scope: store.bodyId,
    });
  });

  it("caret in an empty paragraph resolves to REPLACE it", () => {
    const allocator = createIdAllocator("idco_client_ip_empty");
    const empty = para(allocator, "");
    const store = storeOf([empty], allocator);
    setCaret(store, empty, 0);
    expect(resolveInsertionPoint(store)).toEqual({
      kind: "replace",
      node: empty.id,
    });
  });

  it("an empty HEADING is explicit structure — not replaced", () => {
    const allocator = createIdAllocator("idco_client_ip_heading");
    const heading = makeTextNode({
      attrs: { tag: "h1" },
      content: allocator.createTextSlice(""),
      id: allocator.createNodeId(),
      type: "heading",
    });
    const store = storeOf([heading], allocator);
    setCaret(store, heading, 0);
    // offset 0 → insert before; the point is that it is "at", never "replace".
    expect(resolveInsertionPoint(store)).toEqual({
      index: 0,
      kind: "at",
      scope: store.bodyId,
    });
  });

  it("a node selection resolves AFTER the selected object", () => {
    const allocator = createIdAllocator("idco_client_ip_node");
    const divider = makeObjectNode({
      data: {},
      id: allocator.createNodeId(),
      status: "ready",
      type: "divider",
    });
    const p = para(allocator, "after");
    const store = storeOf([divider, p], allocator);
    store.dispatch({
      origin: "local",
      selectionAfter: { node: divider.id, type: "node" },
      steps: [],
    });
    expect(resolveInsertionPoint(store)).toEqual({
      index: 1,
      kind: "at",
      scope: store.bodyId,
    });
  });

  it("a gap selection is the insertion point (identity)", () => {
    const allocator = createIdAllocator("idco_client_ip_gap");
    const a = para(allocator, "a");
    const b = para(allocator, "b");
    const store = storeOf([a, b], allocator);
    store.dispatch({
      origin: "local",
      selectionAfter: { index: 1, scope: store.bodyId, type: "gap" },
      steps: [],
    });
    expect(resolveInsertionPoint(store)).toEqual({
      index: 1,
      kind: "at",
      scope: store.bodyId,
    });
  });

  it("no selection appends at the end of the body", () => {
    const allocator = createIdAllocator("idco_client_ip_null");
    const a = para(allocator, "a");
    const b = para(allocator, "b");
    const store = storeOf([a, b], allocator);
    expect(store.selection).toBeNull();
    expect(resolveInsertionPoint(store)).toEqual({
      index: 2,
      kind: "at",
      scope: store.bodyId,
    });
  });
});

describe("docs/019 §4.8/§7.8 — insert-blocks applies the resolved point", () => {
  it("inserts at the top of the document when the caret is at offset 0 of the first block", () => {
    const allocator = createIdAllocator("idco_client_ip_top");
    const a = para(allocator, "aaa");
    const b = para(allocator, "bbb");
    const store = storeOf([a, b], allocator);
    setCaret(store, a, 0);
    const fresh = para(allocator, "new");
    store.command({ nodes: [fresh], type: "insert-blocks" });
    expect(store.order).toEqual([fresh.id, a.id, b.id]);
  });

  it("replaces a disposable-empty paragraph, and one undo restores it", () => {
    const allocator = createIdAllocator("idco_client_ip_replace");
    const empty = para(allocator, "");
    const store = storeOf([empty], allocator);
    setCaret(store, empty, 0);
    const fresh = para(allocator, "content");
    store.command({ nodes: [fresh], type: "insert-blocks" });
    // The empty placeholder is gone; the inserted block took its slot.
    expect(store.order).toEqual([fresh.id]);
    store.undo();
    expect(store.order).toEqual([empty.id]);
  });

  it("a select-all range is deleted, emptying the paragraph, which is then replaced", () => {
    const allocator = createIdAllocator("idco_client_ip_range_all");
    const p = para(allocator, "hello");
    const store = storeOf([p], allocator);
    setRange(store, p, 0, 5);
    const fresh = para(allocator, "X");
    store.command({ nodes: [fresh], type: "insert-blocks" });
    expect(store.order).toEqual([fresh.id]);
  });

  it("a partial range is deleted, then the block lands at the collapsed caret", () => {
    const allocator = createIdAllocator("idco_client_ip_range_partial");
    const p = para(allocator, "hello world");
    const store = storeOf([p], allocator);
    setRange(store, p, 0, 6); // delete "hello ", leaving "world", caret at offset 0
    const fresh = para(allocator, "X");
    store.command({ nodes: [fresh], type: "insert-blocks" });
    expect(store.order).toEqual([fresh.id, p.id]);
    const remaining = store.requireNode(p.id);
    expect(remaining.kind === "text" && remaining.content.text).toBe("world");
  });
});
