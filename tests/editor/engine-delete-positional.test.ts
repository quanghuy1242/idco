/**
 * docs/019 §4.11/§4.12.6 — positional deletion around atoms and empty blocks.
 *
 * The caret rests beside an atom (a divider/image), so Backspace/Delete there
 * removes the atom rather than skipping past it to merge text across it. An empty
 * placeholder paragraph with no text leaf to merge into (the first block, or one
 * preceded only by atoms) is removed outright instead of no-op'ing.
 */
import { describe, expect, it } from "vitest";
import {
  createEditorStore,
  createIdAllocator,
  makeObjectNode,
  makeTextNode,
  pointAtOffset,
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

const para = (allocator: IdAllocator, text: string) =>
  makeTextNode({
    content: allocator.createTextSlice(text),
    id: allocator.createNodeId(),
    type: "paragraph",
  });

const divider = (allocator: IdAllocator) =>
  makeObjectNode({
    data: {},
    id: allocator.createNodeId(),
    status: "ready",
    type: "divider",
  });

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

describe("docs/019 — Backspace/Delete remove an adjacent atom", () => {
  it("Backspace at the start of a paragraph after a divider removes the divider", () => {
    const allocator = createIdAllocator("idco_client_del_backatom");
    const d = divider(allocator);
    const p = para(allocator, "text");
    const store = storeOf([d, p], allocator);
    setCaret(store, p, 0);
    store.command({ type: "delete-backward" });
    expect(store.order).toEqual([p.id]);
    // The caret stayed in the paragraph (no cross-merge).
    expect(store.selection).toMatchObject({ type: "text" });
  });

  it("Delete at the end of a paragraph before a divider removes the divider", () => {
    const allocator = createIdAllocator("idco_client_del_fwdatom");
    const p = para(allocator, "text");
    const d = divider(allocator);
    const store = storeOf([p, d], allocator);
    setCaret(store, p, p.content.text.length);
    store.command({ type: "delete-forward" });
    expect(store.order).toEqual([p.id]);
  });

  it("does NOT cross-merge text across a divider on Backspace", () => {
    const allocator = createIdAllocator("idco_client_del_nocross");
    const a = para(allocator, "above");
    const d = divider(allocator);
    const b = para(allocator, "below");
    const store = storeOf([a, d, b], allocator);
    setCaret(store, b, 0);
    store.command({ type: "delete-backward" });
    // The divider is gone; the two paragraphs stay separate (not merged).
    expect(store.order).toEqual([a.id, b.id]);
    expect(store.requireNode(a.id)).toMatchObject({
      content: { text: "above" },
    });
    expect(store.requireNode(b.id)).toMatchObject({
      content: { text: "below" },
    });
  });
});

describe("docs/019 §4.11 — removing an empty placeholder paragraph", () => {
  it("Backspace on an empty first paragraph removes it and rests a gap at the top", () => {
    const allocator = createIdAllocator("idco_client_del_emptyfirst");
    const empty = para(allocator, "");
    const d = divider(allocator);
    const tail = para(allocator, "tail");
    const store = storeOf([empty, d, tail], allocator);
    setCaret(store, empty, 0);
    store.command({ type: "delete-backward" });
    expect(store.order).toEqual([d.id, tail.id]);
    // The caret lands on the gap above the (now first) divider.
    expect(store.selection).toEqual({
      index: 0,
      scope: store.bodyId,
      type: "gap",
    });
  });

  it("Backspace on the sole empty paragraph is a no-op (a scope keeps one block)", () => {
    const allocator = createIdAllocator("idco_client_del_solitary");
    const empty = para(allocator, "");
    const store = storeOf([empty], allocator);
    setCaret(store, empty, 0);
    store.command({ type: "delete-backward" });
    expect(store.order).toEqual([empty.id]);
  });

  it("an empty paragraph after an atom Backspaces by removing the empty line, not the atom", () => {
    const allocator = createIdAllocator("idco_client_del_emptyafteratom");
    const d = divider(allocator);
    const empty = para(allocator, "");
    const store = storeOf([d, empty], allocator);
    setCaret(store, empty, 0);
    // The disposable empty *line* is what Backspace removes — never the object
    // above it. Deleting the node above an empty line (the previous behaviour)
    // was surprising: an empty paragraph under an in-cell code block deleted the
    // code block. The caret rests on the gap the line vacated, beside the atom.
    store.command({ type: "delete-backward" });
    expect(store.order).toEqual([d.id]);
    expect(store.selection).toEqual({
      index: 1,
      scope: store.bodyId,
      type: "gap",
    });
  });
});
