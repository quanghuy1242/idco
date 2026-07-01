// @vitest-environment jsdom
/**
 * `DiffView` — the dedicated diff surface (docs/036 §6.1/§6.3, R6-F). These tests feed the REAL
 * engine (`diffSnapshots`) into the REAL reader surface (`<DiffView>`), proving the §6.3 design
 * system renders on the reader L1: every change is a **change card** with a single **status tag**;
 * text edits are inline **track-changes** (insert / delete, not chips); a removed text block is
 * **struck** (still readable); moves are labelled; unchanged blocks are bare/foldable context; and
 * an `unchanged` block is byte-identical to plain `<Reader>` (the §11 parity assertion). They also
 * prove the editor's `SnapshotDiff` is assignable to `ReaderSnapshotDiff` with no cast.
 *
 * Visual quality (spacing, alignment, hue) is verified separately by the Playwright story capture;
 * these tests assert structure/semantics.
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

/** Render a diff and return the DiffView root plus a `within` scope. */
function renderDiff(
  diff: ReturnType<typeof diffSnapshots>,
  props?: {
    mode?: "unified" | "side-by-side";
    showStats?: boolean;
    context?: "all" | "focused";
    contextRadius?: number;
  },
) {
  const utils = render(<DiffView diff={diff} {...props} />);
  const root = utils.container.querySelector(".rt-diff-view") as HTMLElement;
  return { ...utils, root, q: within(root) };
}

// --- parity (the R6-F guarantee) ---------------------------------------------

describe("DiffView — unchanged parity with the plain reader (R6-F)", () => {
  it("renders an unchanged block byte-identical to <Reader>, with no change card", () => {
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

    for (const sel of ["h2", "p"]) {
      const fromReader = readerOut.container.querySelector(sel)!;
      const fromDiff = diffOut.root.querySelector(sel)!;
      expect(fromDiff.outerHTML).toBe(fromReader.outerHTML);
    }
    expect(diffOut.root.querySelector("[data-rt-diff]")).toBeNull();
    expect(diffOut.root.querySelector(".rt-diff-card")).toBeNull();
    expect(diffOut.q.getByText("No changes")).toBeTruthy();
  });
});

// --- block statuses: the change card + one status tag ------------------------

describe("DiffView — change cards and the status tag (§6.3)", () => {
  it("wraps an added block in a green card with an 'Added' tag", () => {
    const { store, next, para } = paragraphStore(["a", "b"]);
    const base = store.toSnapshot();
    const newId = next();
    store.dispatch(
      store.transaction().insertNode(store.bodyId, 2, para("c", newId)),
    );
    const { root } = renderDiff(diffSnapshots(base, store.toSnapshot()));
    const card = root.querySelector('[data-rt-diff="added"]')!;
    expect(card).toHaveClass("rt-diff-card", "rt-diff-card-added");
    const tag = card.querySelector(".rt-diff-tag")!;
    expect(tag).toHaveClass("rt-diff-tag-added");
    expect(tag.textContent).toContain("Added");
    expect(card.querySelector(".rt-diff-card-body")?.textContent).toContain(
      "c",
    );
  });

  it("strikes a removed text block (still readable) with a 'Removed' tag", () => {
    const { store, ids } = paragraphStore(["alpha", "beta", "gamma"]);
    const base = store.toSnapshot();
    store.dispatch(
      store.transaction().removeNode(store.bodyId, 1, store.getNode(ids[1]!)!),
    );
    const { root } = renderDiff(diffSnapshots(base, store.toSnapshot()));
    const card = root.querySelector('[data-rt-diff="removed"]')!;
    expect(card).toHaveClass("rt-diff-card-removed");
    expect(card.querySelector(".rt-diff-tag")?.textContent).toContain(
      "Removed",
    );
    // The removed text is struck through — present in the DOM, not hidden.
    const struck = card.querySelector(".rt-diff-struck")!;
    expect(struck.textContent).toContain("beta");
  });

  it("labels a reordered block 'Moved from ¶N', not delete+add", () => {
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
    const card = root.querySelector('[data-rt-diff="moved"]')!;
    expect(card).toHaveClass("rt-diff-card-moved");
    expect(card.querySelector(".rt-diff-tag")?.textContent).toContain("Moved");
    expect(card.querySelector(".rt-diff-tag-detail")?.textContent).toMatch(
      /from ¶\d/,
    );
    expect(root.querySelector('[data-rt-diff="added"]')).toBeNull();
    expect(root.querySelector('[data-rt-diff="removed"]')).toBeNull();
  });
});

// --- track-changes (inline text) ---------------------------------------------

describe("DiffView — inline track-changes (§5.2, §6.3)", () => {
  it("underlines an inserted phrase (no delete run) inside an Edited card", () => {
    const { store, ids } = paragraphStore(["hello world"]);
    const base = store.toSnapshot();
    store.dispatch(
      store
        .transaction()
        .replaceText({ at: 5, inserted: " big", node: ids[0]!, removed: "" }),
    );
    const { root } = renderDiff(diffSnapshots(base, store.toSnapshot()));
    const card = root.querySelector('[data-rt-diff="changed"]')!;
    expect(card.querySelector(".rt-diff-tag")?.textContent).toContain("Edited");
    expect(root.querySelector(".rt-diff-ins")?.textContent).toBe(" big");
    expect(root.querySelector(".rt-diff-del")).toBeNull();
  });

  it("shows a substitution as adjacent delete (struck) + insert (Hello → Hi)", () => {
    const { store, ids } = paragraphStore(["Hello"]);
    const base = store.toSnapshot();
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

  it("renders the disjoint-id fallback as whole old-struck + new-inserted, flagged in the tag", () => {
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
    // Whole units, not interleaved character noise.
    expect(root.querySelector(".rt-diff-del")?.textContent).toBe("alpha");
    expect(root.querySelector(".rt-diff-ins")?.textContent).toBe("alpine");
    // The heuristic flag lives in the card header, not inline.
    expect(root.querySelector(".rt-diff-tag-detail")?.textContent).toContain(
      "rewritten",
    );
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
    const { root } = renderDiff(diffSnapshots(base, store.toSnapshot()));
    expect(root.querySelector(".rt-diff-mark")).toBeTruthy();
    expect(root.querySelector("strong")?.textContent).toBe("hello");
  });
});

// --- objects -----------------------------------------------------------------

describe("DiffView — object blocks (§5.6)", () => {
  it("renders an added object block (divider) as a green card", () => {
    const a = createIdAllocator("idco_client_obj_add");
    const p = makeTextNode({
      content: a.createTextSlice("intro"),
      id: a.createNodeId(),
    });
    const divider = makeObjectNode({
      baked: { kind: "divider", payload: {} },
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
    expect(root.querySelector('[data-rt-diff="added"] hr')).toBeTruthy();
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
    const diff = diffSnapshots(soloDoc(mediaBase), soloDoc(mediaTarget), {
      getNodeDefinition: (type) =>
        type === "media"
          ? {
              diffData: (base, target) => {
                const bo = base as { src?: string };
                const to = target as { src?: string };
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

describe("DiffView — structural recursion decorates only changed descendants (§5.5)", () => {
  it("a changed cell inside a table marks the table Edited but only the cell content tinted", () => {
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
    const card = root.querySelector('[data-rt-diff="changed"]')!;
    expect(card.querySelector("table")).toBeTruthy();
    expect(root.querySelector("td .rt-diff-ins")?.textContent).toBe("!");
  });

  it("a changed callout child marks the callout Edited, tone preserved, edit inline", () => {
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
    const card = root.querySelector('[data-rt-diff="changed"]')!;
    expect(card.querySelector('[data-rt-callout-tone="warning"]')).toBeTruthy();
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
    expect(root.querySelectorAll("ul li").length).toBe(2);
    expect(root.querySelector("li .rt-diff-ins")?.textContent).toBe("!");
  });

  it("renders a changed STRUCTURAL list item (SN-1 nested) as one valid <li>, not a nested <ul>", () => {
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
    expect(root.querySelectorAll("ul").length).toBe(1);
    expect(root.querySelectorAll("ul > li").length).toBe(1);
    expect(root.querySelector("li")?.textContent).toContain("a detail line");
    expect(root.querySelector("li .rt-diff-ins")?.textContent).toBe("!");
  });

  it("renders a moved list item without an invalid <span> sibling, with an inline marker", () => {
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
    expect(root.querySelectorAll("ul > li").length).toBe(3);
    expect(root.querySelector("ul > span")).toBeNull();
    expect(root.querySelector("li > .rt-diff-moved-marker")?.textContent).toBe(
      "moved",
    );
  });
});

// --- side-by-side ------------------------------------------------------------

describe("DiffView — side-by-side layout (§6.1)", () => {
  it("renders a 2-column grid with a gap opposite an added block", () => {
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
    expect(root.querySelectorAll(".rt-diff-colhead").length).toBe(2);
    // The added block has no base-side counterpart → a clean gap exists opposite it.
    expect(root.querySelector(".rt-diff-gap")).toBeTruthy();
    expect(root.textContent).toContain("gamma-new");
  });

  it("shows a reorder as the block moved at both ends (two-ended), anchors aligned", () => {
    const { store, ids } = paragraphStore(["one", "two", "three"]);
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
    const { root } = renderDiff(diffSnapshots(base, store.toSnapshot()), {
      mode: "side-by-side",
    });
    // "three" is the moved block; it appears at its base row (left) and target row (right),
    // each as a moved card — two-ended.
    const moved = root.querySelectorAll('[data-rt-diff="moved"]');
    expect(moved.length).toBe(2);
    for (const card of moved) expect(card.textContent).toContain("three");
    // one/two are unchanged anchors, aligned (no card).
    expect(root.querySelectorAll("[data-rt-diff]").length).toBe(2);
  });
});

// --- context folding ---------------------------------------------------------

describe("DiffView — focused context folding (§6.3)", () => {
  it("folds far unchanged runs into a separator, keeping the change and its neighbours", () => {
    const texts = Array.from({ length: 12 }, (_v, i) => `para ${i}`);
    const { store, ids } = paragraphStore(texts);
    const base = store.toSnapshot();
    // Edit only the middle paragraph.
    store.dispatch(
      store
        .transaction()
        .replaceText({ at: 0, inserted: "X", node: ids[6]!, removed: "" }),
    );
    const target = store.toSnapshot();
    // "all" shows every block, no fold.
    const all = renderDiff(diffSnapshots(base, target), { context: "all" });
    expect(all.root.querySelector(".rt-diff-fold")).toBeNull();
    // "focused" folds the far unchanged blocks.
    const focused = renderDiff(diffSnapshots(base, target), {
      context: "focused",
      contextRadius: 1,
    });
    const folds = focused.root.querySelectorAll(".rt-diff-fold");
    expect(folds.length).toBeGreaterThan(0);
    expect(focused.root.querySelector('[data-rt-diff="changed"]')).toBeTruthy();
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
  it("a kind change (leaf → object) shows a struck removed card over an added card", () => {
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
    const removed = root.querySelector('[data-rt-diff="removed"]')!;
    expect(removed.querySelector(".rt-diff-struck")?.textContent).toContain(
      "was text",
    );
    expect(root.querySelector('[data-rt-diff="added"] hr')).toBeTruthy();
  });

  it("an empty diff (identical snapshots) renders no card and a clean stats line", () => {
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
    expect(root.querySelector(".rt-diff-card")).toBeNull();
    expect(q.getByText("No changes")).toBeTruthy();
  });
});
