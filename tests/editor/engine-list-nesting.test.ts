/**
 * Structural list nesting — Option A (docs/030 §7.3 D3, SN-1).
 *
 * Indent promotes *only the predecessor* of a flat body-level list item to a structural
 * `listitem` holding [prevLeaf, sublist[item]] in place at body order, so flat siblings stay
 * windowed leaves and only the nested subtree mounts as a unit. A second indent flows through
 * the existing structural algebra; outdent lifts back. The reader merges a heterogeneous
 * flat/structural run into one list. The model round-trips through `toSnapshot`/`createEditorStore`.
 */
import { render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { RestingDocument } from "../../packages/editor/src/view";
import {
  createEditorStore,
  createIdAllocator,
  makeStructuralNode,
  makeTextNode,
  pointAtOffset,
  type EditorDocumentSnapshot,
  type EditorNode,
  type NodeId,
  type StructuralNode,
  type TextLeafNode,
} from "../../packages/editor/src/core";

function listStore(...texts: readonly string[]) {
  const allocator = createIdAllocator("idco_client_nesting");
  const items = texts.map((text) =>
    makeTextNode({
      attrs: { listType: "bullet" },
      content: allocator.createTextSlice(text),
      id: allocator.createNodeId(),
      type: "listitem",
    }),
  );
  const snapshot: EditorDocumentSnapshot = {
    body: {
      blocks: Object.fromEntries(items.map((n) => [n.id, n])) as Record<
        NodeId,
        EditorNode
      >,
      order: items.map((n) => n.id),
    },
    settings: {},
    version: 1,
  };
  const store = createEditorStore({ allocator, snapshot });
  return { items, store };
}

function caretIn(
  store: ReturnType<typeof listStore>["store"],
  node: TextLeafNode,
) {
  const point = pointAtOffset(node.id, node.content, node.content.text.length);
  store.dispatch({
    origin: "local",
    selectionAfter: { anchor: point, focus: point, type: "text" },
    steps: [],
  });
}

describe("structural list nesting (SN-1)", () => {
  it("indent promotes the predecessor to a structural listitem; flat siblings stay", () => {
    const { items, store } = listStore("one", "two", "three");
    caretIn(store, store.getNode(items[1]!.id) as TextLeafNode);
    store.command({ type: "indent" });

    // body order: [container, three] — only the nested subtree collapses into a unit.
    const order = store.order;
    expect(order.length).toBe(2);
    const container = store.getNode(order[0]!) as StructuralNode;
    expect([container.kind, container.type]).toEqual([
      "structural",
      "listitem",
    ]);
    // container holds [prevLeaf(one), sublist[two]].
    const [innerId, sublistId] = container.children;
    expect(innerId).toBe(items[0]!.id);
    const sublist = store.getNode(sublistId!) as StructuralNode;
    expect([sublist.kind, sublist.type]).toEqual(["structural", "list"]);
    expect(sublist.children).toEqual([items[1]!.id]);
    // The third item is untouched — still a flat leaf at body order.
    expect(order[1]).toBe(items[2]!.id);
    expect(store.getNode(items[2]!.id)!.kind).toBe("text");
    store.assertParentInvariant();
  });

  it("a second indent nests through the existing structural algebra", () => {
    const { items, store } = listStore("one", "two", "three");
    caretIn(store, store.getNode(items[1]!.id) as TextLeafNode);
    store.command({ type: "indent" });
    // Now indent "three" under "two": "two" is inside the sublist (a structural list), so the
    // existing compileIndentItem path runs.
    caretIn(store, store.getNode(items[2]!.id) as TextLeafNode);
    // Move caret context: "three" is still a flat body item; indent should nest it under the
    // container's structure via the body-root path again (predecessor is the container).
    store.command({ type: "indent" });
    expect(store.order.length).toBe(1);
    store.assertParentInvariant();
  });

  it("outdent lifts a nested item back to body order and drops the empty sublist", () => {
    const { items, store } = listStore("one", "two");
    caretIn(store, store.getNode(items[1]!.id) as TextLeafNode);
    store.command({ type: "indent" });
    expect(store.order.length).toBe(1);
    const container = store.getNode(store.order[0]!) as StructuralNode;
    const sublistId = container.children[1]!;

    // Outdent "two": it sits in the sublist (parent is a structural list), so compileOutdent
    // lifts it out to body order and removes the now-empty sublist.
    caretIn(store, store.getNode(items[1]!.id) as TextLeafNode);
    store.command({ type: "outdent" });
    store.assertParentInvariant();

    // "two" is back at body order as a text leaf whose parent is the body.
    expect(store.order).toContain(items[1]!.id);
    expect(store.parentEntry(items[1]!.id)!.parent).toBe(store.bodyId);
    expect(store.getNode(items[1]!.id)!.kind).toBe("text");
    // The emptied sublist was cleaned up (no dangling empty structural list).
    expect(store.getNode(sublistId)).toBeUndefined();
  });

  it("round-trips the nested tree through toSnapshot/createEditorStore", () => {
    const { items, store } = listStore("one", "two");
    caretIn(store, store.getNode(items[1]!.id) as TextLeafNode);
    store.command({ type: "indent" });
    const snapshot = store.toSnapshot();
    const reopened = createEditorStore({
      allocator: createIdAllocator("idco_client_nesting_reopen"),
      snapshot,
    });
    expect(reopened.toSnapshot()).toEqual(snapshot);
    reopened.assertParentInvariant();
  });

  it("reader merges a heterogeneous flat/structural run into one list", () => {
    // Build a doc: flat item "alpha", a structural item holding "beta" + a sublist["gamma"],
    // flat item "delta" — all in one body run.
    const allocator = createIdAllocator("idco_client_nesting_reader");
    const id = () => allocator.createNodeId();
    const alpha = makeTextNode({
      attrs: { listType: "bullet" },
      content: allocator.createTextSlice("alpha"),
      id: id(),
      type: "listitem",
    });
    const beta = makeTextNode({
      attrs: { listType: "bullet" },
      content: allocator.createTextSlice("beta"),
      id: id(),
      type: "listitem",
    });
    const gamma = makeTextNode({
      attrs: { listType: "bullet" },
      content: allocator.createTextSlice("gamma"),
      id: id(),
      type: "listitem",
    });
    const sublist = makeStructuralNode({
      children: [gamma.id],
      id: id(),
      type: "list",
    });
    const container = makeStructuralNode({
      children: [beta.id, sublist.id],
      id: id(),
      type: "listitem",
    });
    const delta = makeTextNode({
      attrs: { listType: "bullet" },
      content: allocator.createTextSlice("delta"),
      id: id(),
      type: "listitem",
    });
    const nodes = [alpha, beta, gamma, sublist, container, delta];
    const snapshot: EditorDocumentSnapshot = {
      body: {
        blocks: Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<
          NodeId,
          EditorNode
        >,
        order: [alpha.id, container.id, delta.id],
      },
      settings: {},
      version: 1,
    };
    const { container: dom } = render(
      createElement(RestingDocument, { snapshot }),
    );
    // The flat leaves and the structural item all render inside a single <ul>.
    const lists = dom.querySelectorAll("ul");
    // One outer list for the run (plus one nested <ul> for the sublist).
    expect(lists.length).toBe(2);
    const outer = lists[0]!;
    const directItems = [...outer.children].filter((c) => c.tagName === "LI");
    // alpha, beta(structural), delta are the three direct <li> of the outer list.
    expect(directItems.length).toBe(3);
    expect(dom.textContent).toContain("alpha");
    expect(dom.textContent).toContain("beta");
    expect(dom.textContent).toContain("gamma");
    expect(dom.textContent).toContain("delta");
  });
});
