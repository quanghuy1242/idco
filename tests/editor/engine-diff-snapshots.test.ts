/**
 * Diff assembly + the parity oracle (docs/036 R6-E, DoD §11).
 *
 * The oracle: an edit made through the real store commands, captured as two
 * snapshots, must diff back to exactly that edit — insert/delete text, mark add,
 * block add/remove, reorder-as-move, type change. Plus the assembly seams:
 * settings, collections, identity (all-unchanged, zero stats), and JSON
 * serializability of the whole result.
 */
import { describe, expect, it } from "vitest";
import {
  type BlockDiff,
  createEditorStore,
  createIdAllocator,
  createTextMark,
  diffSnapshots,
  type EditorDocumentSnapshot,
  type EditorStore,
  makeStructuralNode,
  makeTextNode,
  type NodeId,
} from "../../packages/editor/src/core";
import { alloc, leaf, snap } from "./diff-fixtures";

function freshStore(texts: readonly string[]): {
  store: EditorStore;
  ids: NodeId[];
  next: () => NodeId;
  paragraph: (text: string, id: NodeId) => ReturnType<typeof makeTextNode>;
} {
  const allocator = createIdAllocator("idco_client_oracle");
  const nodes = texts.map((t) =>
    makeTextNode({
      content: allocator.createTextSlice(t),
      id: allocator.createNodeId(),
    }),
  );
  const store = createEditorStore({ allocator, snapshot: snap(nodes) });
  return {
    ids: nodes.map((n) => n.id),
    next: () => allocator.createNodeId(),
    paragraph: (text, id) =>
      makeTextNode({ content: allocator.createTextSlice(text), id }),
    store,
  };
}

function topBlock(diff: ReturnType<typeof diffSnapshots>, id: NodeId) {
  return diff.blocks.find((b) => b.id === id)!;
}

function findBlock(
  diff: ReturnType<typeof diffSnapshots>,
  id: NodeId,
): BlockDiff | undefined {
  const walk = (list: readonly BlockDiff[]): BlockDiff | undefined => {
    for (const b of list) {
      if (b.id === id) return b;
      if (b.children) {
        const hit = walk(b.children);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  return walk(diff.blocks);
}

describe("diffSnapshots — parity oracle over real store edits (R6-E)", () => {
  it("reconstructs an inserted phrase on the id path", () => {
    const { store, ids } = freshStore(["hello world"]);
    const base = store.toSnapshot();
    store.dispatch(
      store
        .transaction()
        .replaceText({ at: 5, inserted: " big", node: ids[0]!, removed: "" }),
    );
    const diff = diffSnapshots(base, store.toSnapshot());
    const block = topBlock(diff, ids[0]!);
    expect(block.status).toBe("changed");
    expect(block.text!.alignment).toBe("id");
    expect(
      block.text!.runs.filter((r) => r.op === "insert").map((r) => r.text),
    ).toEqual([" big"]);
    expect(diff.stats).toEqual({ added: 0, changed: 1, moved: 0, removed: 0 });
  });

  it("reconstructs a deletion", () => {
    const { store, ids } = freshStore(["hello world"]);
    const base = store.toSnapshot();
    store.dispatch(
      store
        .transaction()
        .replaceText({ at: 5, inserted: "", node: ids[0]!, removed: " world" }),
    );
    const diff = diffSnapshots(base, store.toSnapshot());
    const block = topBlock(diff, ids[0]!);
    expect(
      block.text!.runs.filter((r) => r.op === "delete").map((r) => r.text),
    ).toEqual([" world"]);
  });

  it("reconstructs a mark addition", () => {
    const { store, ids } = freshStore(["hello"]);
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
    expect(topBlock(diff, ids[0]!).text!.markChanges).toEqual([
      { from: 0, kind: "bold", op: "added", to: 5 },
    ]);
  });

  it("reconstructs a block insertion", () => {
    const { store, ids, next, paragraph } = freshStore(["a", "b"]);
    const base = store.toSnapshot();
    const newId = next();
    store.dispatch(
      store.transaction().insertNode(store.bodyId, 2, paragraph("c", newId)),
    );
    const diff = diffSnapshots(base, store.toSnapshot());
    expect(topBlock(diff, newId).status).toBe("added");
    expect(topBlock(diff, ids[0]!).status).toBe("unchanged");
    expect(diff.stats.added).toBe(1);
  });

  it("reconstructs a block removal", () => {
    const { store, ids } = freshStore(["a", "b", "c"]);
    const base = store.toSnapshot();
    store.dispatch(
      store.transaction().removeNode(store.bodyId, 1, store.getNode(ids[1]!)!),
    );
    const diff = diffSnapshots(base, store.toSnapshot());
    expect(topBlock(diff, ids[1]!).status).toBe("removed");
    expect(diff.stats.removed).toBe(1);
  });

  it("reconstructs a reorder as a move", () => {
    const { store, ids } = freshStore(["a", "b", "c"]);
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
    const diff = diffSnapshots(base, store.toSnapshot());
    expect(topBlock(diff, ids[2]!).status).toBe("moved");
    expect(diff.stats.moved).toBe(1);
    expect(diff.stats.added + diff.stats.removed).toBe(0);
  });

  it("reconstructs a text-leaf type change (paragraph → heading)", () => {
    const { store, ids } = freshStore(["title"]);
    const base = store.toSnapshot();
    store.dispatch({
      origin: "local",
      steps: [
        {
          from: "paragraph",
          node: ids[0]!,
          to: "heading",
          type: "set-node-type",
        },
      ],
    });
    const diff = diffSnapshots(base, store.toSnapshot());
    const block = topBlock(diff, ids[0]!);
    expect(block.status).toBe("changed");
    expect(block.node.type).toBe("heading");
  });

  it("reconstructs a compound edit (text + insert + remove) in one diff", () => {
    const { store, ids, next, paragraph } = freshStore([
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
      store
        .transaction()
        .insertNode(store.bodyId, 3, paragraph("delta", addId)),
    );
    store.dispatch(
      store.transaction().removeNode(store.bodyId, 1, store.getNode(ids[1]!)!),
    );
    const diff = diffSnapshots(base, store.toSnapshot());
    expect(topBlock(diff, ids[0]!).status).toBe("changed");
    expect(topBlock(diff, addId).status).toBe("added");
    expect(topBlock(diff, ids[1]!).status).toBe("removed");
    expect(topBlock(diff, ids[2]!).status).toBe("unchanged");
    expect(diff.stats).toEqual({ added: 1, changed: 1, moved: 0, removed: 1 });
  });

  it("reconstructs a mark removal via commands (DoD §11 mark add/remove)", () => {
    const { store, ids } = freshStore(["hello"]);
    const live = store.requireTextNode(ids[0]!);
    const m = createTextMark({
      from: 0,
      id: "m1",
      kind: "bold",
      node: live,
      to: 5,
    });
    store.dispatch(store.transaction().addMark(ids[0]!, m));
    const base = store.toSnapshot(); // the mark is present here
    store.dispatch(store.transaction().removeMark(ids[0]!, m));
    const diff = diffSnapshots(base, store.toSnapshot());
    const block = topBlock(diff, ids[0]!);
    expect(block.status).toBe("changed");
    expect(block.text!.markChanges).toEqual([
      { from: 0, kind: "bold", op: "removed", to: 5 },
    ]);
  });

  it("reconstructs a nested-container edit via commands (DoD §11 nested-container)", () => {
    // A store seeded with a real list > listitem, edited through the command path.
    const allocator = createIdAllocator("idco_client_nested");
    const child = makeTextNode({
      content: allocator.createTextSlice("item"),
      id: allocator.createNodeId(),
      type: "listitem",
    });
    const list = makeStructuralNode({
      children: [child.id],
      id: allocator.createNodeId(),
      type: "list",
    });
    const store = createEditorStore({
      allocator,
      snapshot: {
        body: {
          blocks: { [child.id]: child, [list.id]: list },
          order: [list.id],
        },
        settings: {},
        version: 1,
      },
    });
    const base = store.toSnapshot();
    store.dispatch(
      store
        .transaction()
        .replaceText({ at: 4, inserted: "!", node: child.id, removed: "" }),
    );
    const diff = diffSnapshots(base, store.toSnapshot());
    expect(findBlock(diff, list.id)!.status).toBe("changed");
    const childDiff = findBlock(diff, child.id)!;
    expect(childDiff.status).toBe("changed");
    expect(
      childDiff.text!.runs.filter((r) => r.op === "insert").map((r) => r.text),
    ).toEqual(["!"]);
  });
});

describe("diffSnapshots — assembly seams (R6-E)", () => {
  it("reports identical snapshots as all-unchanged with zero stats and no collections", () => {
    const a = alloc("asm_same");
    const s = snap([leaf(a, "x")], {
      collections: { glossary: [{ id: "t1", term: "A" }] },
      settings: { theme: "light" },
    });
    const diff = diffSnapshots(s, s);
    expect(diff.blocks[0]!.status).toBe("unchanged");
    expect(diff.stats).toEqual({ added: 0, changed: 0, moved: 0, removed: 0 });
    expect(diff.collections).toEqual([]);
    expect(diff.settingsChanged).toBe(false);
    expect(diff.settingsDetail).toBeUndefined();
  });

  it("diffs document settings into added/removed/changed", () => {
    const a = alloc("asm_settings");
    const l = leaf(a, "x");
    const diff = diffSnapshots(
      snap([l], { settings: { keep: 1, mode: "a" } }),
      snap([l], { settings: { extra: 9, keep: 1, mode: "b" } }),
    );
    expect(diff.settingsChanged).toBe(true);
    expect(diff.settingsDetail!.added).toEqual({ extra: 9 });
    expect(diff.settingsDetail!.changed).toEqual({
      mode: { base: "a", target: "b" },
    });
  });

  it("diffs collections by item id (added/removed/changed), omitting unchanged keys", () => {
    const a = alloc("asm_coll");
    const l = leaf(a, "x");
    const diff = diffSnapshots(
      snap([l], {
        collections: {
          bib: [{ id: "b1", cite: "one" }],
          glossary: [
            { id: "t1", term: "A" },
            { id: "t2", term: "B" },
          ],
        },
      }),
      snap([l], {
        collections: {
          bib: [{ id: "b1", cite: "one" }],
          glossary: [
            { id: "t1", term: "A-edited" },
            { id: "t3", term: "C" },
          ],
        },
      }),
    );
    // `bib` is unchanged, so it is omitted; only `glossary` appears.
    expect(diff.collections).toEqual([
      { added: ["t3"], changed: ["t1"], key: "glossary", removed: ["t2"] },
    ]);
  });

  it("produces a JSON-serializable result that round-trips", () => {
    const a = alloc("asm_json");
    const A = leaf(a, "A");
    const B = leaf(a, "B");
    const X = leaf(a, "X");
    const base: EditorDocumentSnapshot = snap([A, B]);
    const target: EditorDocumentSnapshot = snap([A, X], { settings: { k: 1 } });
    const diff = diffSnapshots(base, target);
    const round = JSON.parse(JSON.stringify(diff)) as typeof diff;
    expect(round.blocks.map((b) => [b.id, b.status])).toEqual(
      diff.blocks.map((b) => [b.id, b.status]),
    );
    expect(round.stats).toEqual(diff.stats);
  });
});
