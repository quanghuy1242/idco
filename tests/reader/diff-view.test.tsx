// @vitest-environment jsdom
/**
 * `DiffView` — the dedicated diff surface (docs/036 §6.1, R6-F). These tests feed the REAL
 * engine (`diffSnapshots`) into the REAL reader surface (`<DiffView>`), so they prove three
 * things at once: (1) every block status renders with the right `.rt-diff-*` decoration on the
 * reader L1, tokens only; (2) an `unchanged` block renders identically to the plain `<Reader>`
 * (the R6-F parity assertion, extending docs/028); (3) the editor's `SnapshotDiff` is
 * structurally assignable to the reader's `ReaderSnapshotDiff` with no cast — a host computes
 * the diff with the editor and passes it straight in (the reader-below-editor boundary).
 *
 * Text/mark/move edits go through the real store (so they exercise the character-id identity
 * path); structural containers are seeded and edited through the store too, so a changed cell
 * inside an unchanged table is a genuine engine result, not a hand-built diff.
 */
import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DiffView, Reader } from "@quanghuy1242/idco-reader";
import {
  createEditorStore,
  createIdAllocator,
  createTextMark,
  diffSnapshots,
  type EditorDocumentSnapshot,
  type EditorNode,
  type EditorStore,
  makeObjectNode,
  makeStructuralNode,
  makeTextNode,
  type NodeId,
} from "../../packages/editor/src/core";

// --- store + snapshot helpers ------------------------------------------------

/** A store over a list of paragraph texts, sharing one allocator (so edits keep char ids). */
function paragraphStore(texts: readonly string[]): {
  store: EditorStore;
  ids: NodeId[];
  next: () => NodeId;
  para: (text: string, id: NodeId) => ReturnType<typeof makeTextNode>;
} {
  const allocator = createIdAllocator("idco_client_diffview");
  const nodes = texts.map((t) =>
    makeTextNode({
      content: allocator.createTextSlice(t),
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
  return {
    ids: nodes.map((n) => n.id),
    next: () => allocator.createNodeId(),
    para: (text, id) =>
      makeTextNode({ content: allocator.createTextSlice(text), id }),
    store,
  };
}

/** A single-node document snapshot (shared by the leaf/object/kind-change cases). */
function soloDoc(node: EditorNode): EditorDocumentSnapshot {
  return {
    body: { blocks: { [node.id]: node }, order: [node.id] },
    settings: {},
    version: 1,
  };
}

/** Render a diff and return the DiffView root plus a `within` scope. */
function renderDiff(
  diff: ReturnType<typeof diffSnapshots>,
  props?: { mode?: "unified" | "side-by-side"; showStats?: boolean },
) {
  const utils = render(<DiffView diff={diff} {...props} />);
  const root = utils.container.querySelector(".rt-diff-view") as HTMLElement;
  return { ...utils, root, q: within(root) };
}

// --- parity (the R6-F guarantee) ---------------------------------------------

describe("DiffView — unchanged parity with the plain reader (R6-F)", () => {
  it("renders an unchanged block byte-identical to <Reader>, with no diff wrapper", () => {
    const a = createIdAllocator("idco_client_parity");
    const heading = makeTextNode({
      attrs: { tag: "h2" },
      content: a.createTextSlice("Title"),
      id: a.createNodeId(),
      type: "heading",
    });
    const para = makeTextNode({
      content: a.createTextSlice("A paragraph with words."),
      id: a.createNodeId(),
    });
    const snapshot: EditorDocumentSnapshot = {
      body: {
        blocks: { [heading.id]: heading, [para.id]: para },
        order: [heading.id, para.id],
      },
      settings: {},
      version: 1,
    };
    const readerOut = render(<Reader value={snapshot} />);
    const diffOut = renderDiff(diffSnapshots(snapshot, snapshot));

    // Same semantic elements, byte-identical outerHTML.
    for (const sel of ["h2", "p"]) {
      const fromReader = readerOut.container.querySelector(sel)!;
      const fromDiff = diffOut.root.querySelector(sel)!;
      expect(fromDiff.outerHTML).toBe(fromReader.outerHTML);
    }
    // An all-unchanged diff carries zero `.rt-diff-*` block wrappers.
    expect(diffOut.root.querySelector("[data-rt-diff]")).toBeNull();
    expect(diffOut.q.getByText("No changes")).toBeTruthy();
  });
});

// --- block statuses ----------------------------------------------------------

describe("DiffView — block statuses (§6.3)", () => {
  it("wraps an added block in a green change bar", () => {
    const { store, next, para } = paragraphStore(["a", "b"]);
    const base = store.toSnapshot();
    const newId = next();
    store.dispatch(
      store.transaction().insertNode(store.bodyId, 2, para("c", newId)),
    );
    const { root } = renderDiff(diffSnapshots(base, store.toSnapshot()));
    const added = root.querySelector('[data-rt-diff="added"]')!;
    expect(added).toHaveClass("rt-diff", "rt-diff-added");
    expect(added.textContent).toContain("c");
  });

  it("renders a removed block dimmed with a red bar and a badge", () => {
    const { store, ids } = paragraphStore(["a", "b", "c"]);
    const base = store.toSnapshot();
    store.dispatch(
      store.transaction().removeNode(store.bodyId, 1, store.getNode(ids[1]!)!),
    );
    const { root } = renderDiff(diffSnapshots(base, store.toSnapshot()));
    const removed = root.querySelector('[data-rt-diff="removed"]')!;
    expect(removed).toHaveClass("rt-diff-removed");
    expect(within(removed as HTMLElement).getByText("removed")).toHaveClass(
      "rt-diff-badge",
    );
  });

  it("marks a reordered block as moved (amber) with a moved-from note, not add+remove", () => {
    const { store, ids } = paragraphStore(["a", "b", "c"]);
    const base = store.toSnapshot();
    store.dispatch({
      origin: "local",
      steps: [
        {
          from: { index: 2, parent: store.bodyId },
          node: ids[2]!,
          to: { index: 0, parent: store.bodyId },
          type: "move-node",
        },
      ],
    });
    const { root } = renderDiff(diffSnapshots(base, store.toSnapshot()));
    const moved = root.querySelector('[data-rt-diff="moved"]')!;
    expect(moved).toHaveClass("rt-diff-moved");
    expect(moved.querySelector(".rt-diff-note")?.textContent).toMatch(
      /moved from position/,
    );
    // A move is not a delete+add.
    expect(root.querySelector('[data-rt-diff="added"]')).toBeNull();
    expect(root.querySelector('[data-rt-diff="removed"]')).toBeNull();
  });
});

// --- Tier 1: changed text leaf ------------------------------------------------

describe("DiffView — changed text leaf run pass (§5.2, §6.3 Tier 1)", () => {
  it("tints an inserted phrase green and keeps surrounding text plain", () => {
    const { store, ids } = paragraphStore(["hello world"]);
    const base = store.toSnapshot();
    store.dispatch(
      store
        .transaction()
        .replaceText({ at: 5, inserted: " big", node: ids[0]!, removed: "" }),
    );
    const { root } = renderDiff(diffSnapshots(base, store.toSnapshot()));
    const ins = root.querySelector(".rt-diff-ins")!;
    expect(ins.textContent).toBe(" big");
    // No delete run for a pure insertion.
    expect(root.querySelector(".rt-diff-del")).toBeNull();
  });

  it("shows a substitution as adjacent delete (struck) + insert runs (Hello → Hi)", () => {
    const { store, ids } = paragraphStore(["Hello"]);
    const base = store.toSnapshot();
    // Replace "ello" with "i": H | ello→del | i→ins.
    store.dispatch(
      store
        .transaction()
        .replaceText({ at: 1, inserted: "i", node: ids[0]!, removed: "ello" }),
    );
    const { root } = renderDiff(diffSnapshots(base, store.toSnapshot()));
    expect(root.querySelector(".rt-diff-del")!.textContent).toBe("ello");
    expect(root.querySelector(".rt-diff-ins")!.textContent).toBe("i");
    expect(root.textContent).toContain("H");
  });

  it("falls back to a heuristic text alignment badge when the leaf shares no char ids", () => {
    // Two independent allocators → disjoint character-id lineage → §5.2 fallback.
    const a = createIdAllocator("idco_client_fb_a");
    const b = createIdAllocator("idco_client_fb_b");
    const id = a.createNodeId();
    const baseLeaf = makeTextNode({ content: a.createTextSlice("alpha"), id });
    const targetLeaf = makeTextNode({
      content: b.createTextSlice("alpine"),
      id,
    });
    const { root } = renderDiff(
      diffSnapshots(soloDoc(baseLeaf), soloDoc(targetLeaf)),
    );
    expect(root.querySelector(".rt-diff-fallback")).toBeTruthy();
  });
});

// --- marks -------------------------------------------------------------------

describe("DiffView — mark changes (§5.3)", () => {
  it("overlays a dotted mark decoration when a bold mark is added over unchanged text", () => {
    const { store, ids } = paragraphStore(["hello"]);
    const base = store.toSnapshot();
    const live = store.requireTextNode(ids[0]!);
    store.dispatch(
      store.transaction().addMark(
        ids[0]!,
        createTextMark({
          from: 0,
          id: "m1",
          kind: "bold",
          node: live,
          to: 5,
        }),
      ),
    );
    const diff = diffSnapshots(base, store.toSnapshot());
    const { root } = renderDiff(diff);
    // The leaf is changed (bold applied); every run is `keep`, so the change shows as the
    // dotted `.rt-diff-mark` overlay, and the new bold still renders.
    expect(root.querySelector(".rt-diff-mark")).toBeTruthy();
    expect(root.querySelector("strong")?.textContent).toBe("hello");
  });
});

// --- objects -----------------------------------------------------------------

describe("DiffView — object blocks (§5.6)", () => {
  const bakedDivider = { kind: "divider", payload: {} };

  it("renders an added object block (divider) with a green bar", () => {
    const a = createIdAllocator("idco_client_obj_add");
    const p = makeTextNode({
      content: a.createTextSlice("intro"),
      id: a.createNodeId(),
    });
    const divider = makeObjectNode({
      baked: bakedDivider,
      data: {},
      id: a.createNodeId(),
      status: "ready",
      type: "divider",
    });
    const base: EditorDocumentSnapshot = {
      body: { blocks: { [p.id]: p }, order: [p.id] },
      settings: {},
      version: 1,
    };
    const target: EditorDocumentSnapshot = {
      body: {
        blocks: { [p.id]: p, [divider.id]: divider },
        order: [p.id, divider.id],
      },
      settings: {},
      version: 1,
    };
    const { root } = renderDiff(diffSnapshots(base, target));
    const added = root.querySelector('[data-rt-diff="added"]')!;
    expect(added.querySelector("hr")).toBeTruthy();
  });

  it("summarizes a changed object's fields via the diffData seam", () => {
    const a = createIdAllocator("idco_client_obj_chg");
    const id = a.createNodeId();
    const mediaBase = makeObjectNode({
      baked: { kind: "media", payload: { alt: "", src: "/a.png" } },
      data: { alt: "", src: "/a.png" },
      id,
      status: "ready",
      type: "media",
    });
    const mediaTarget = makeObjectNode({
      baked: { kind: "media", payload: { alt: "", src: "/b.png" } },
      data: { alt: "", src: "/b.png" },
      id,
      status: "ready",
      type: "media",
    });
    // A definition whose diffData reports the `src` field change (D6 seam).
    const diff = diffSnapshots(soloDoc(mediaBase), soloDoc(mediaTarget), {
      getNodeDefinition: (type) =>
        type === "media"
          ? {
              diffData: (b, t) => {
                const bo = b as { src?: string };
                const to = t as { src?: string };
                return bo.src === to.src
                  ? []
                  : [
                      {
                        base: bo.src ?? null,
                        path: "src",
                        target: to.src ?? null,
                      },
                    ];
              },
              type: "media",
            }
          : undefined,
    });
    const { root } = renderDiff(diff);
    const fields = root.querySelector(".rt-diff-fields")!;
    expect(fields.textContent).toContain("src");
    expect(fields.textContent).toContain("/b.png");
  });
});

// --- structural recursion ----------------------------------------------------

/** Seed a store from a hand snapshot (containers + their children resolvable). */
function seededStore(
  order: NodeId[],
  blocks: Record<string, ReturnType<typeof makeTextNode>>,
  allocator: ReturnType<typeof createIdAllocator>,
): EditorStore {
  return createEditorStore({
    allocator,
    snapshot: { body: { blocks, order }, settings: {}, version: 1 },
  });
}

describe("DiffView — structural recursion decorates only changed descendants (§5.5)", () => {
  it("a changed cell inside a table marks the table changed but only the cell content tinted", () => {
    const a = createIdAllocator("idco_client_table");
    const para = makeTextNode({
      content: a.createTextSlice("v1"),
      id: a.createNodeId(),
    });
    const cell = makeStructuralNode({
      children: [para.id],
      id: a.createNodeId(),
      type: "tablecell",
    });
    const row = makeStructuralNode({
      children: [cell.id],
      id: a.createNodeId(),
      type: "tablerow",
    });
    const table = makeStructuralNode({
      children: [row.id],
      id: a.createNodeId(),
      type: "table",
    });
    const blocks = {
      [cell.id]: cell,
      [para.id]: para,
      [row.id]: row,
      [table.id]: table,
    } as Record<string, ReturnType<typeof makeTextNode>>;
    const store = seededStore([table.id], blocks, a);
    const base = store.toSnapshot();
    store.dispatch(
      store
        .transaction()
        .replaceText({ at: 2, inserted: "!", node: para.id, removed: "" }),
    );
    const { root } = renderDiff(diffSnapshots(base, store.toSnapshot()));
    // The table (flow container) carries the changed bar and still renders as a real <table>.
    const changed = root.querySelector('[data-rt-diff="changed"]')!;
    expect(changed.querySelector("table")).toBeTruthy();
    // The changed leaf inside the cell shows the inserted "!" tinted.
    expect(root.querySelector("td .rt-diff-ins")?.textContent).toBe("!");
  });

  it("a changed callout child marks the callout changed with the child edit inline", () => {
    const a = createIdAllocator("idco_client_callout");
    const keep = makeTextNode({
      content: a.createTextSlice("keep me"),
      id: a.createNodeId(),
    });
    const edit = makeTextNode({
      content: a.createTextSlice("edit me"),
      id: a.createNodeId(),
    });
    const callout = makeStructuralNode({
      attrs: { tone: "warning" },
      children: [keep.id, edit.id],
      id: a.createNodeId(),
      type: "callout",
    });
    const blocks = {
      [callout.id]: callout,
      [edit.id]: edit,
      [keep.id]: keep,
    } as Record<string, ReturnType<typeof makeTextNode>>;
    const store = seededStore([callout.id], blocks, a);
    const base = store.toSnapshot();
    store.dispatch(
      store
        .transaction()
        .replaceText({ at: 7, inserted: "!", node: edit.id, removed: "" }),
    );
    const { root } = renderDiff(diffSnapshots(base, store.toSnapshot()));
    const changed = root.querySelector('[data-rt-diff="changed"]')!;
    // Reuses the reader shell: the callout tone survives.
    expect(
      changed.querySelector('[data-rt-callout-tone="warning"]'),
    ).toBeTruthy();
    expect(root.querySelector(".rt-diff-ins")?.textContent).toBe("!");
  });

  it("a changed list item inside a list renders the edit inline within its <li>", () => {
    const a = createIdAllocator("idco_client_list");
    const one = makeTextNode({
      content: a.createTextSlice("one"),
      id: a.createNodeId(),
      type: "listitem",
    });
    const two = makeTextNode({
      content: a.createTextSlice("two"),
      id: a.createNodeId(),
      type: "listitem",
    });
    const list = makeStructuralNode({
      children: [one.id, two.id],
      id: a.createNodeId(),
      type: "list",
    });
    const blocks = {
      [list.id]: list,
      [one.id]: one,
      [two.id]: two,
    } as Record<string, ReturnType<typeof makeTextNode>>;
    const store = seededStore([list.id], blocks, a);
    const base = store.toSnapshot();
    store.dispatch(
      store
        .transaction()
        .replaceText({ at: 3, inserted: "!", node: two.id, removed: "" }),
    );
    const { root } = renderDiff(diffSnapshots(base, store.toSnapshot()));
    // A real <ul> with two <li>; the edited item carries the inline insert tint.
    expect(root.querySelectorAll("ul li").length).toBe(2);
    expect(root.querySelector("li .rt-diff-ins")?.textContent).toBe("!");
  });

  it("renders a changed STRUCTURAL list item (SN-1 nested) as one valid <li>, not a nested <ul>", () => {
    // A structural `listitem`: an inner text `listitem` leaf plus a nested paragraph. The reader
    // has no `renderBlock` shell for it, so a naive render would emit the inner leaf as its own
    // <ul><li>, producing invalid `ul > ul` markup. It must render as one <li> with the edit inline.
    const a = createIdAllocator("idco_client_snitem");
    const innerLeaf = makeTextNode({
      content: a.createTextSlice("task one"),
      id: a.createNodeId(),
      type: "listitem",
    });
    const nested = makeTextNode({
      content: a.createTextSlice("a detail line"),
      id: a.createNodeId(),
    });
    const structItem = makeStructuralNode({
      children: [innerLeaf.id, nested.id],
      id: a.createNodeId(),
      type: "listitem",
    });
    const list = makeStructuralNode({
      children: [structItem.id],
      id: a.createNodeId(),
      type: "list",
    });
    const blocks = {
      [innerLeaf.id]: innerLeaf,
      [list.id]: list,
      [nested.id]: nested,
      [structItem.id]: structItem,
    } as Record<string, ReturnType<typeof makeTextNode>>;
    const store = seededStore([list.id], blocks, a);
    const base = store.toSnapshot();
    store.dispatch(
      store
        .transaction()
        .replaceText({ at: 8, inserted: "!", node: innerLeaf.id, removed: "" }),
    );
    const { root } = renderDiff(diffSnapshots(base, store.toSnapshot()));
    // Exactly one <ul> (the inner leaf is inline, not its own list); one valid <li> child.
    expect(root.querySelectorAll("ul").length).toBe(1);
    expect(root.querySelectorAll("ul > li").length).toBe(1);
    // The nested paragraph still renders, and the inner-leaf edit is tinted inline.
    expect(root.querySelector("li")?.textContent).toContain("a detail line");
    expect(root.querySelector("li .rt-diff-ins")?.textContent).toBe("!");
  });

  it("renders a moved list item without an invalid <span> sibling inside the <ul>", () => {
    const a = createIdAllocator("idco_client_limove");
    const items = ["one", "two", "three"].map((t) =>
      makeTextNode({
        content: a.createTextSlice(t),
        id: a.createNodeId(),
        type: "listitem",
      }),
    );
    const list = makeStructuralNode({
      children: items.map((n) => n.id),
      id: a.createNodeId(),
      type: "list",
    });
    const blocks = Object.fromEntries([
      [list.id, list],
      ...items.map((n) => [n.id, n] as const),
    ]) as Record<string, ReturnType<typeof makeTextNode>>;
    const store = seededStore([list.id], blocks, a);
    const base = store.toSnapshot();
    // Move the last item to the front, inside the list container.
    store.dispatch({
      origin: "local",
      steps: [
        {
          from: { index: 2, parent: list.id },
          node: items[2]!.id,
          to: { index: 0, parent: list.id },
          type: "move-node",
        },
      ],
    });
    const { root } = renderDiff(diffSnapshots(base, store.toSnapshot()));
    // Three valid <li> and NO <span> emitted as a direct child of the <ul> (the old bug).
    expect(root.querySelectorAll("ul > li").length).toBe(3);
    expect(root.querySelector("ul > span")).toBeNull();
    // The moved item IS still signalled — an inline "moved" chip lives inside its <li>.
    const badge = root.querySelector("li > .rt-diff-moved-badge");
    expect(badge?.textContent).toBe("moved");
  });
});

// --- side-by-side ------------------------------------------------------------

describe("DiffView — side-by-side layout (§6.1)", () => {
  it("renders two columns; an added block appears only in the Target column, not Base", () => {
    const { store, next, para } = paragraphStore(["alpha", "beta"]);
    const base = store.toSnapshot();
    const newId = next();
    store.dispatch(
      store.transaction().insertNode(store.bodyId, 2, para("gamma-new", newId)),
    );
    const { root } = renderDiff(diffSnapshots(base, store.toSnapshot()), {
      mode: "side-by-side",
    });
    expect(root.querySelector(".rt-diff-cols")).toBeTruthy();
    const cols = root.querySelectorAll(".rt-diff-col");
    expect(cols.length).toBe(2);
    // The added block appears in Target (col 2) but NOT in Base (col 1).
    expect(cols[0]!.textContent).not.toContain("gamma-new");
    expect(cols[1]!.textContent).toContain("gamma-new");
  });

  it("shows the Base column in base order for a reorder (not merged/target order)", () => {
    const { store, ids } = paragraphStore(["one", "two", "three"]);
    const base = store.toSnapshot();
    // Move "three" (index 2) to the front.
    store.dispatch({
      origin: "local",
      steps: [
        {
          from: { index: 2, parent: store.bodyId },
          node: ids[2]!,
          to: { index: 0, parent: store.bodyId },
          type: "move-node",
        },
      ],
    });
    const { root } = renderDiff(diffSnapshots(base, store.toSnapshot()), {
      mode: "side-by-side",
    });
    const cols = root.querySelectorAll(".rt-diff-col");
    // Base column keeps base order (one, two, three); Target shows the moved order (three, one, two).
    const baseText = cols[0]!.textContent ?? "";
    const targetText = cols[1]!.textContent ?? "";
    expect(baseText.indexOf("one")).toBeLessThan(baseText.indexOf("three"));
    expect(targetText.indexOf("three")).toBeLessThan(targetText.indexOf("one"));
  });
});

// --- stats header ------------------------------------------------------------

describe("DiffView — stats header (§6.1)", () => {
  it("summarizes added / removed / changed counts and can be hidden", () => {
    const { store, ids, next, para } = paragraphStore([
      "alpha",
      "beta",
      "gamma",
    ]);
    const base = store.toSnapshot();
    store.dispatch(
      store
        .transaction()
        .replaceText({ at: 0, inserted: "A", node: ids[0]!, removed: "" }),
    );
    const addId = next();
    store.dispatch(
      store.transaction().insertNode(store.bodyId, 3, para("delta", addId)),
    );
    store.dispatch(
      store.transaction().removeNode(store.bodyId, 1, store.getNode(ids[1]!)!),
    );
    const diff = diffSnapshots(base, store.toSnapshot());

    const shown = renderDiff(diff);
    const stats = shown.root.querySelector(".rt-diff-stats")!;
    expect(stats.querySelector(".rt-diff-stat-added")?.textContent).toBe("+1");
    expect(stats.querySelector(".rt-diff-stat-removed")?.textContent).toBe(
      "−1",
    );
    expect(stats.querySelector(".rt-diff-stat-changed")?.textContent).toBe(
      "1 changed",
    );

    const hidden = renderDiff(diff, { showStats: false });
    expect(hidden.root.querySelector(".rt-diff-stats")).toBeNull();
  });
});

// --- edge cases --------------------------------------------------------------

describe("DiffView — edge cases (§8)", () => {
  it("a kind change (leaf → object) shows removed-old over added-new", () => {
    const a = createIdAllocator("idco_client_kind");
    const id = a.createNodeId();
    const asLeaf = makeTextNode({ content: a.createTextSlice("was text"), id });
    const asObject = makeObjectNode({
      baked: { kind: "divider", payload: {} },
      data: {},
      id,
      status: "ready",
      type: "divider",
    });
    const { root } = renderDiff(
      diffSnapshots(soloDoc(asLeaf), soloDoc(asObject)),
    );
    expect(
      root.querySelector('[data-rt-diff="removed"]')?.textContent,
    ).toContain("was text");
    expect(root.querySelector('[data-rt-diff="added"] hr')).toBeTruthy();
  });

  it("an empty diff (identical snapshots) renders no decoration and a clean stats line", () => {
    const a = createIdAllocator("idco_client_empty");
    const p = makeTextNode({
      content: a.createTextSlice("stable"),
      id: a.createNodeId(),
    });
    const s: EditorDocumentSnapshot = {
      body: { blocks: { [p.id]: p }, order: [p.id] },
      settings: {},
      version: 1,
    };
    const { root, q } = renderDiff(diffSnapshots(s, s));
    expect(root.querySelector("[data-rt-diff]")).toBeNull();
    expect(q.getByText("No changes")).toBeTruthy();
  });
});
