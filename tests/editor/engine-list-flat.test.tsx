// @vitest-environment jsdom
/**
 * docs/018 §2.10 — flat-list completeness (lists are flat top-level `listitem`
 * leaves + a `listType` attr, never a structural `list` node):
 *
 * - `listType` (bullet/number) round-trips through the compat projection and the
 *   Payload import flatten, so an ordered list survives import/export.
 * - The view computes each item's ordinal + first/last-in-run from body-order
 *   adjacency (`computeWindowListMeta`), so a numbered run is numbered correctly
 *   even when the window mounts only part of it (a CSS counter could not).
 * - `set-block-type` carries/clears the `listType` attr and `current-list-type`
 *   reports it; the `1. ` markdown prefix makes a numbered item, `- ` a bullet.
 * - The resting render groups a run into a real `<ul>`/`<ol>` by flavour.
 */
import { act, render } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import {
  OwnedModelEditorView,
  RestingDocument,
  compatFromSnapshot,
  computeWindowListMeta,
  createEditorStore,
  createEditorStoreFromCompat,
  createEngineScheduler,
  createIdAllocator,
  detectMarkdownShortcut,
  editorSnapshotFromCompat,
  importPayloadLexical,
  makeStructuralNode,
  makeTextNode,
  pointAtOffset,
  type EditorDocumentSnapshot,
  type EditorNode,
  type OwnedModelEditorViewHandle,
  type RichTextCompatNode,
} from "../../packages/editor/src";

function findChild(
  doc: { root: { children: readonly RichTextCompatNode[] } },
  predicate: (node: RichTextCompatNode) => boolean,
): RichTextCompatNode | undefined {
  return doc.root.children.find(predicate);
}

describe("§2.10 listType round-trips through the compat projection", () => {
  it("carries bullet/number on a flat listitem through import + export", () => {
    const compat = {
      root: {
        children: [
          {
            children: [
              { children: [{ text: "a", type: "text" }], type: "listitem" },
            ],
            type: "list",
          },
          {
            children: [
              { children: [{ text: "x", type: "text" }], type: "listitem" },
            ],
            listType: "number",
            type: "list",
          },
        ],
      },
    };
    const out = compatFromSnapshot(editorSnapshotFromCompat(compat));
    const items = out.root.children.filter((n) => n.type === "listitem");
    expect(items).toHaveLength(2);
    expect(items[0]?.listType).toBe("bullet");
    expect(items[1]?.listType).toBe("number");
    // No structural `list` node is ever produced (flat-by-design).
    expect(findChild(out, (n) => n.type === "list")).toBeUndefined();
  });

  it("keeps the ordered flavour through the Payload flatten", () => {
    const { document } = importPayloadLexical({
      root: {
        children: [
          {
            children: [
              { children: [{ text: "one", type: "text" }], type: "listitem" },
            ],
            listType: "number",
            type: "list",
          },
        ],
      },
    });
    const store = createEditorStoreFromCompat(document);
    const item = store.order
      .map((id) => store.requireNode(id))
      .find((n) => n.kind === "text" && n.type === "listitem");
    expect(item?.kind === "text" && item.attrs?.listType).toBe("number");
  });
});

function listStore(flavours: readonly ("bullet" | "number" | null)[]) {
  const allocator = createIdAllocator("idco_client_list_flat");
  const blocks = flavours.map((flavour, i) =>
    makeTextNode({
      attrs: flavour ? { listType: flavour } : undefined,
      content: allocator.createTextSlice(`item ${i}`),
      id: allocator.createNodeId(),
      type: flavour ? "listitem" : "paragraph",
    }),
  );
  const store = createEditorStore({
    allocator,
    snapshot: {
      body: {
        blocks: Object.fromEntries(blocks.map((b) => [b.id, b])),
        order: blocks.map((b) => b.id),
      },
      settings: {},
      version: 1,
    },
  });
  return { blocks, store };
}

describe("§2.10 render-time ordinals from body-order adjacency", () => {
  it("numbers a run and resets across a flavour change / non-list block", () => {
    // bullet, bullet | number, number, number | paragraph | number
    const { blocks, store } = listStore([
      "bullet",
      "bullet",
      "number",
      "number",
      "number",
      null,
      "number",
    ]);
    const meta = computeWindowListMeta(store, store.order, 0);
    const at = (i: number) => meta.get(blocks[i]!.id);

    expect(at(0)).toMatchObject({
      firstInRun: true,
      listType: "bullet",
      ordinal: 1,
    });
    expect(at(1)).toMatchObject({ lastInRun: true, ordinal: 2 });
    // The number run starts its own ordinal at 1 even though it abuts the bullets.
    expect(at(2)).toMatchObject({
      firstInRun: true,
      listType: "number",
      ordinal: 1,
    });
    expect(at(3)).toMatchObject({ ordinal: 2 });
    expect(at(4)).toMatchObject({ lastInRun: true, ordinal: 3 });
    // The lone number after the paragraph is a new run of one.
    expect(at(6)).toMatchObject({
      firstInRun: true,
      lastInRun: true,
      ordinal: 1,
    });
  });

  it("seeds the ordinal from the run prefix that began before the window", () => {
    const { blocks, store } = listStore([
      "number",
      "number",
      "number",
      "number",
    ]);
    // A window that starts at the 3rd item (index 2) must still report ordinal 3,
    // not 1 — the bug a CSS counter would produce under virtualization.
    const windowIds = store.order.slice(2);
    const meta = computeWindowListMeta(store, windowIds, 2);
    expect(meta.get(blocks[2]!.id)).toMatchObject({
      ordinal: 3,
      firstInRun: false,
    });
    expect(meta.get(blocks[3]!.id)).toMatchObject({
      ordinal: 4,
      lastInRun: true,
    });
  });
});

describe("§2.10 set-block-type + current-list-type", () => {
  it("toggles a paragraph to a numbered item and reports the flavour", () => {
    const { blocks, store } = listStore([null]);
    const para = blocks[0]!;
    const caret = pointAtOffset(
      para.id,
      store.requireTextNode(para.id).content,
      0,
    );
    store.dispatch({
      origin: "local",
      selectionAfter: { anchor: caret, focus: caret, type: "text" },
      steps: [],
    });

    store.command({
      blockType: "listitem",
      listType: "number",
      type: "set-block-type",
    });
    expect(store.requireTextNode(para.id).type).toBe("listitem");
    expect(store.requireTextNode(para.id).attrs?.listType).toBe("number");
    expect(store.query({ type: "current-list-type" })).toBe("number");

    // Toggling back to a paragraph clears the stray listType.
    store.command({ blockType: "paragraph", type: "set-block-type" });
    expect(store.requireTextNode(para.id).attrs?.listType).toBeUndefined();
    expect(store.query({ type: "current-list-type" })).toBeNull();
  });
});

describe("§2.10 ordered/bulleted markdown prefixes", () => {
  it("maps `1. ` to a numbered item and `- ` to a bullet", () => {
    const ordered = detectMarkdownShortcut("1. ", 3, "paragraph");
    expect(ordered).toMatchObject({
      blockType: "listitem",
      listType: "number",
    });
    const bullet = detectMarkdownShortcut("- ", 2, "paragraph");
    expect(bullet).toMatchObject({ blockType: "listitem", listType: "bullet" });
  });
});

function structuralListSnapshot() {
  // list → [ leaf "A", structuralItem → [ leaf "B", subList → [ leaf "C" ] ] ]
  const allocator = createIdAllocator("idco_client_structural");
  const leaf = (text: string) =>
    makeTextNode({
      attrs: { listType: "bullet" },
      content: allocator.createTextSlice(text),
      id: allocator.createNodeId(),
      type: "listitem",
    });
  const a = leaf("A");
  const b = leaf("B");
  const c = leaf("C");
  const subList = makeStructuralNode({
    children: [c.id],
    id: allocator.createNodeId(),
    type: "list",
  });
  const structuralItem = makeStructuralNode({
    children: [b.id, subList.id],
    id: allocator.createNodeId(),
    type: "listitem",
  });
  const list = makeStructuralNode({
    children: [a.id, structuralItem.id],
    id: allocator.createNodeId(),
    type: "list",
  });
  const all: EditorNode[] = [list, a, structuralItem, b, subList, c];
  const snapshot: EditorDocumentSnapshot = {
    body: {
      blocks: Object.fromEntries(all.map((n) => [n.id, n])),
      order: [list.id],
    },
    settings: {},
    version: 1,
  };
  return { allocator, snapshot };
}

describe("§2.11 structural containers render recursively (no placeholder)", () => {
  it("renders a structural list + nested sublist in the editor surface", () => {
    const { allocator, snapshot } = structuralListSnapshot();
    const store = createEditorStore({ allocator, snapshot });
    const scheduler = createEngineScheduler({ publishDashboard: false });
    const ref = createRef<OwnedModelEditorViewHandle>();
    let container!: HTMLElement;
    act(() => {
      const result = render(
        <OwnedModelEditorView
          forcePolyfill
          ref={ref}
          scheduler={scheduler}
          store={store}
          virtualize={false}
        />,
      );
      container = result.container;
    });
    // The `[list]` placeholder is gone: the container and its descendants render.
    expect(container.textContent).not.toContain("[list]");
    expect(
      container.querySelectorAll('[data-engine-structural="list"]'),
    ).toHaveLength(2);
    // Every item — including the deeply nested one — is a real editable block.
    const items = container.querySelectorAll(
      '[data-engine-block-type="listitem"]',
    );
    expect(items).toHaveLength(3);
    expect(container.textContent).toContain("A");
    expect(container.textContent).toContain("B");
    expect(container.textContent).toContain("C");
  });

  it("renders a structural list as nested <ul> at rest", () => {
    const { snapshot } = structuralListSnapshot();
    const { container } = render(<RestingDocument snapshot={snapshot} />);
    // Outer list + nested sublist are both real <ul> elements; "C" sits in the
    // inner one (a <ul> inside an <li>).
    expect(container.querySelectorAll("ul").length).toBeGreaterThanOrEqual(2);
    // The leaf <li> holding only "C" lives in the nested <ul>, which is itself a
    // child of the parent item's <li> (a real nested list, not a flattened one).
    const leafLi = Array.from(container.querySelectorAll("li")).find(
      (li) => (li.textContent ?? "").trim() === "C",
    );
    expect(leafLi?.closest("ul")?.parentElement?.tagName).toBe("LI");
  });
});

describe("§2.10 resting render groups runs into <ul>/<ol> by flavour", () => {
  it("emits a real <ol> for a numbered run and <ul> for a bullet run", () => {
    const allocator = createIdAllocator("idco_client_rest_list");
    const item = (text: string, listType: "bullet" | "number") =>
      makeTextNode({
        attrs: { listType },
        content: allocator.createTextSlice(text),
        id: allocator.createNodeId(),
        type: "listitem",
      });
    const nodes = [
      item("b1", "bullet"),
      item("n1", "number"),
      item("n2", "number"),
    ];
    const snapshot: EditorDocumentSnapshot = {
      body: {
        blocks: Object.fromEntries(nodes.map((n) => [n.id, n])),
        order: nodes.map((n) => n.id),
      },
      settings: {},
      version: 1,
    };
    const { container } = render(<RestingDocument snapshot={snapshot} />);
    expect(container.querySelectorAll("ul")).toHaveLength(1);
    expect(container.querySelectorAll("ol")).toHaveLength(1);
    // The ordered run is its own <ol> with both numbered items.
    expect(container.querySelector("ol")?.querySelectorAll("li")).toHaveLength(
      2,
    );
    expect(container.querySelector("ul")?.textContent).toContain("b1");
  });
});
