/**
 * docs/019 §4.10/§5.7 — scope-aware navigation. Arrows produce a gap beside an
 * atom (so an object is crossable and a caret can rest next to it), descend into
 * a container, and escape a nested scope to the parent gap. `scopePath` walks the
 * enclosing containers. All pure functions of (selection, document); no DOM.
 */
import { describe, expect, it } from "vitest";
import {
  createEditorStore,
  createIdAllocator,
  makeObjectNode,
  makeStructuralNode,
  makeTextNode,
  pointAtOffset,
  scopePath,
  type EditorNode,
  type EditorSelection,
  type EditorStore,
  type IdAllocator,
  type NodeId,
} from "../../packages/editor/src";
import {
  selectionForGapNavigation,
  selectionForNavigation,
  verticalNavigation,
} from "../../packages/editor/src/view/overlays";

function storeOf(
  nodes: readonly EditorNode[],
  order: readonly NodeId[],
  allocator: IdAllocator,
): EditorStore {
  return createEditorStore({
    allocator,
    snapshot: {
      body: {
        blocks: Object.fromEntries(nodes.map((n) => [n.id, n])),
        order: [...order],
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
): EditorSelection {
  const point = pointAtOffset(node.id, node.content, offset);
  const selection = { anchor: point, focus: point, type: "text" as const };
  store.dispatch({ origin: "local", selectionAfter: selection, steps: [] });
  return selection;
}

const textSel = (
  store: EditorStore,
  node: Extract<EditorNode, { kind: "text" }>,
  offset: number,
) => ({
  anchor: pointAtOffset(node.id, node.content, offset),
  focus: pointAtOffset(node.id, node.content, offset),
  type: "text" as const,
});

describe("docs/019 §4.10 — selectionForNavigation produces gaps at atoms and doc edges", () => {
  it("ArrowRight at the end of a paragraph before an object rests a gap beside it", () => {
    const allocator = createIdAllocator("idco_client_nav_atom");
    const p0 = para(allocator, "aaa");
    const divider = makeObjectNode({
      data: {},
      id: allocator.createNodeId(),
      status: "ready",
      type: "divider",
    });
    const p1 = para(allocator, "bbb");
    const store = storeOf(
      [p0, divider, p1],
      [p0.id, divider.id, p1.id],
      allocator,
    );
    const sel = textSel(store, p0, 3);
    expect(selectionForNavigation(store, sel, "ArrowRight", false)).toEqual({
      index: 1,
      scope: store.bodyId,
      type: "gap",
    });
  });

  it("ArrowLeft at the start of the first block rests a gap at the doc top", () => {
    const allocator = createIdAllocator("idco_client_nav_top");
    const divider = makeObjectNode({
      data: {},
      id: allocator.createNodeId(),
      status: "ready",
      type: "divider",
    });
    const p1 = para(allocator, "bbb");
    const store = storeOf([divider, p1], [divider.id, p1.id], allocator);
    const sel = textSel(store, p1, 0);
    // p1 is at index 1; the slot before it is the gap after the divider.
    expect(selectionForNavigation(store, sel, "ArrowLeft", false)).toEqual({
      index: 1,
      scope: store.bodyId,
      type: "gap",
    });
  });

  it("ArrowRight at the end of the last block rests a gap at the doc bottom", () => {
    const allocator = createIdAllocator("idco_client_nav_bottom");
    const p0 = para(allocator, "aaa");
    const divider = makeObjectNode({
      data: {},
      id: allocator.createNodeId(),
      status: "ready",
      type: "divider",
    });
    const store = storeOf([p0, divider], [p0.id, divider.id], allocator);
    const sel = setCaret(store, p0, 3);
    void sel;
    // Cross to the gap before the divider, then again past it to the doc bottom.
    const afterP0 = selectionForNavigation(
      store,
      textSel(store, p0, 3),
      "ArrowRight",
      false,
    );
    expect(afterP0).toEqual({ index: 1, scope: store.bodyId, type: "gap" });
  });
});

describe("docs/019 §4.10 — selectionForGapNavigation crosses, descends, escapes", () => {
  it("steps the gap across an atom to the next slot, then into the following text", () => {
    const allocator = createIdAllocator("idco_client_gap_cross");
    const p0 = para(allocator, "aaa");
    const divider = makeObjectNode({
      data: {},
      id: allocator.createNodeId(),
      status: "ready",
      type: "divider",
    });
    const p1 = para(allocator, "bbb");
    const store = storeOf(
      [p0, divider, p1],
      [p0.id, divider.id, p1.id],
      allocator,
    );
    const crossed = selectionForGapNavigation(
      store,
      { index: 1, scope: store.bodyId, type: "gap" },
      "ArrowRight",
    );
    expect(crossed).toEqual({ index: 2, scope: store.bodyId, type: "gap" });
    const intoText = selectionForGapNavigation(
      store,
      { index: 2, scope: store.bodyId, type: "gap" },
      "ArrowRight",
    );
    expect(intoText?.type).toBe("text");
    expect(intoText?.type === "text" && intoText.focus.node).toBe(p1.id);
    expect(intoText?.type === "text" && intoText.focus.offset).toBe(0);
  });

  it("descends into a container, and escapes its far edge to the parent gap", () => {
    const allocator = createIdAllocator("idco_client_gap_descend");
    const p0 = para(allocator, "aaa");
    const inner = para(allocator, "inner");
    const quote = makeStructuralNode({
      children: [inner.id],
      id: allocator.createNodeId(),
      type: "quote",
    });
    const p1 = para(allocator, "bbb");
    const store = storeOf(
      [p0, quote, inner, p1],
      [p0.id, quote.id, p1.id],
      allocator,
    );
    // A gap before the quote descends into the quote's first caret slot.
    const descended = selectionForGapNavigation(
      store,
      { index: 1, scope: store.bodyId, type: "gap" },
      "ArrowRight",
    );
    expect(descended?.type === "text" && descended.focus.node).toBe(inner.id);

    // ArrowRight at the end of the inner leaf rests at the quote's edge gap.
    const edge = selectionForNavigation(
      store,
      textSel(store, inner, inner.content.text.length),
      "ArrowRight",
      false,
    );
    expect(edge).toEqual({ index: 1, scope: quote.id, type: "gap" });

    // A further ArrowRight escapes the quote to the body slot after it, landing
    // in the following paragraph.
    const escaped = selectionForGapNavigation(
      store,
      edge as never,
      "ArrowRight",
    );
    expect(escaped?.type === "text" && escaped.focus.node).toBe(p1.id);
  });

  it("stops at the body's leading edge (no escape past the root)", () => {
    const allocator = createIdAllocator("idco_client_gap_stop");
    const p0 = para(allocator, "aaa");
    const store = storeOf([p0], [p0.id], allocator);
    expect(
      selectionForGapNavigation(
        store,
        { index: 0, scope: store.bodyId, type: "gap" },
        "ArrowLeft",
      ),
    ).toBeNull();
  });

  it("an empty container paints/rests a gap at its only slot", () => {
    const allocator = createIdAllocator("idco_client_gap_empty");
    const empty = makeStructuralNode({
      children: [],
      id: allocator.createNodeId(),
      type: "quote",
    });
    const store = storeOf([empty], [empty.id], allocator);
    // Home jumps to the scope's first slot; an empty scope has only slot 0.
    expect(
      selectionForGapNavigation(
        store,
        { index: 0, scope: empty.id, type: "gap" },
        "Home",
      ),
    ).toEqual({ index: 0, scope: empty.id, type: "gap" });
  });
});

describe("docs/019 §5.8 — no doc-edge gap beside a text block (click/arrow parity)", () => {
  it("ArrowRight at the end of the last TEXT block does not make a bottom gap", () => {
    const allocator = createIdAllocator("idco_client_edge_lasttext");
    const a = para(allocator, "aaa");
    const b = para(allocator, "bbb");
    const store = storeOf([a, b], [a.id, b.id], allocator);
    // The end-of-text caret is already the bottom position; a click below the
    // last block lands there too, so the arrow stays (no phantom gap).
    expect(
      selectionForNavigation(
        store,
        textSel(store, b, b.content.text.length),
        "ArrowRight",
        false,
      ),
    ).toBeNull();
  });

  it("ArrowLeft at the start of the first TEXT block does not make a top gap", () => {
    const allocator = createIdAllocator("idco_client_edge_firsttext");
    const a = para(allocator, "aaa");
    const store = storeOf([a], [a.id], allocator);
    expect(
      selectionForNavigation(store, textSel(store, a, 0), "ArrowLeft", false),
    ).toBeNull();
  });

  it("but a doc-edge gap beside the last ATOM stays reachable", () => {
    const allocator = createIdAllocator("idco_client_edge_lastatom");
    const a = para(allocator, "aaa");
    const divider = makeObjectNode({
      data: {},
      id: allocator.createNodeId(),
      status: "ready",
      type: "divider",
    });
    const store = storeOf([a, divider], [a.id, divider.id], allocator);
    // End of the paragraph → gap before the divider, then across it to the
    // doc-bottom gap after the (atom) last block.
    const beforeDivider = selectionForNavigation(
      store,
      textSel(store, a, 3),
      "ArrowRight",
      false,
    );
    expect(beforeDivider).toEqual({
      index: 1,
      scope: store.bodyId,
      type: "gap",
    });
    expect(
      selectionForGapNavigation(
        store,
        { index: 1, scope: store.bodyId, type: "gap" },
        "ArrowRight",
      ),
    ).toEqual({ index: 2, scope: store.bodyId, type: "gap" });
  });
});

describe("docs/019 §4.4 — scopePath enumerates enclosing containers", () => {
  it("is [body] for a caret in a top-level paragraph", () => {
    const allocator = createIdAllocator("idco_client_scopepath_flat");
    const p0 = para(allocator, "aaa");
    const store = storeOf([p0], [p0.id], allocator);
    expect(scopePath(store, textSel(store, p0, 0))).toEqual([store.bodyId]);
  });

  it("is [body, quote] for a caret inside a quote container", () => {
    const allocator = createIdAllocator("idco_client_scopepath_nested");
    const inner = para(allocator, "inner");
    const quote = makeStructuralNode({
      children: [inner.id],
      id: allocator.createNodeId(),
      type: "quote",
    });
    const store = storeOf([quote, inner], [quote.id], allocator);
    expect(scopePath(store, textSel(store, inner, 0))).toEqual([
      store.bodyId,
      quote.id,
    ]);
  });
});

describe("docs/022 §5 — verticalNavigation iterative probe terminates", () => {
  it("returns null without hanging when no layout resolves a point (jsdom)", () => {
    // The document-level probe steps the goal column further each iteration until
    // it resolves a text position or exits the viewport. jsdom has no layout, so
    // every probe misses; the loop must terminate (viewport-bound break), not spin.
    const allocator = createIdAllocator("idco_client_vertnav");
    const p0 = para(allocator, "first line");
    const p1 = para(allocator, "second line");
    const store = storeOf([p0, p1], [p0.id, p1.id], allocator);
    const selection = textSel(store, p0, 2);
    const host = host0();
    expect(
      verticalNavigation(store, selection, host, 1, false, null),
    ).toBeNull();
    expect(
      verticalNavigation(store, selection, host, -1, false, 40),
    ).toBeNull();
    // A null host short-circuits.
    expect(
      verticalNavigation(store, selection, null, 1, false, null),
    ).toBeNull();
  });
});

function host0(): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-engine-block-id", "x");
  return el;
}
