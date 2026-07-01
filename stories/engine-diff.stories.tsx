import type { Story, StoryDefault } from "@ladle/react";
import { type ReactNode, useMemo, useState } from "react";
import { DiffView } from "@quanghuy1242/idco-reader";
import {
  createEditorStore,
  createIdAllocator,
  createTextMark,
  diffSnapshots,
  type EditorDocumentSnapshot,
  type EditorNode,
  makeObjectNode,
  makeStructuralNode,
  makeTextNode,
  type NodeId,
} from "../packages/editor/src";

/**
 * Stories for the diff view (docs/036 §6.1, R6-F). Each computes a REAL diff with the editor
 * engine — `diffSnapshots(base, target)` over two `EditorDocumentSnapshot`s — and renders it
 * with the reader's `<DiffView>`, the exact consumer flow document-history review uses
 * (compute with the editor, render with the reader). Text/mark/move edits run through the
 * store, so they exercise the character-id identity path (a move reads as a move, a re-flowed
 * sentence as a minimal edit), not a text-alignment guess.
 */
export default {
  title: "Engine / Diff View",
} satisfies StoryDefault;

// --- builders ----------------------------------------------------------------

function alloc(seed: string) {
  return createIdAllocator(`idco_client_${seed}` as `idco_client_${string}`);
}

/** Assemble a snapshot from a top-level order plus every (possibly nested) node. */
function snapshot(
  order: readonly EditorNode[],
  nested: readonly EditorNode[] = [],
): EditorDocumentSnapshot {
  const all = [...order, ...nested];
  return {
    body: {
      blocks: Object.fromEntries(all.map((n) => [n.id, n])) as Record<
        NodeId,
        EditorNode
      >,
      order: order.map((n) => n.id),
    },
    settings: {},
    version: 1,
  };
}

const wrap = (children: ReactNode) => (
  <div style={{ maxWidth: 900 }}>{children}</div>
);

const caption = (text: ReactNode) => (
  <p style={{ font: "12px ui-sans-serif", marginTop: 16, opacity: 0.7 }}>
    {text}
  </p>
);

// --- Overview (everything at once) -------------------------------------------

/** Build one document, then edit it many ways, so one diff carries every status. */
function overviewDiff() {
  const a = alloc("overview");
  const title = makeTextNode({
    attrs: { tag: "h1" },
    content: a.createTextSlice("Release notes"),
    id: a.createNodeId(),
    type: "heading",
  });
  const intro = makeTextNode({
    content: a.createTextSlice("This release ships the diff view."),
    id: a.createNodeId(),
  });
  const keep = makeTextNode({
    content: a.createTextSlice("Unchanged paragraph."),
    id: a.createNodeId(),
  });
  const doomed = makeTextNode({
    content: a.createTextSlice("This line will be removed."),
    id: a.createNodeId(),
  });
  const mover = makeTextNode({
    content: a.createTextSlice("I will move up."),
    id: a.createNodeId(),
  });
  const item1 = makeTextNode({
    content: a.createTextSlice("First item"),
    id: a.createNodeId(),
    type: "listitem",
  });
  const item2 = makeTextNode({
    content: a.createTextSlice("Second item"),
    id: a.createNodeId(),
    type: "listitem",
  });
  const list = makeStructuralNode({
    children: [item1.id, item2.id],
    id: a.createNodeId(),
    type: "list",
  });

  const store = createEditorStore({
    allocator: a,
    snapshot: snapshot(
      [title, intro, keep, doomed, mover, list],
      [item1, item2],
    ),
  });
  const base = store.toSnapshot();

  // Edit the intro text (identity path), bold "diff view", remove a line, move one up,
  // add a new paragraph, and edit a list item.
  store.dispatch(
    store.transaction().replaceText({
      at: 13,
      inserted: "finally ",
      node: intro.id,
      removed: "",
    }),
  );
  const liveIntro = store.requireTextNode(intro.id);
  store.dispatch(
    store.transaction().addMark(
      intro.id,
      createTextMark({
        from: 31,
        id: "m-diff",
        kind: "bold",
        node: liveIntro,
        to: 40,
      }),
    ),
  );
  store.dispatch(
    store.transaction().removeNode(store.bodyId, 3, store.getNode(doomed.id)!),
  );
  store.dispatch({
    origin: "local",
    steps: [
      {
        from: { index: 3, parent: store.bodyId },
        node: mover.id,
        to: { index: 1, parent: store.bodyId },
        type: "move-node",
      },
    ],
  });
  const added = makeTextNode({
    content: a.createTextSlice("A brand-new closing note."),
    id: a.createNodeId(),
  });
  store.dispatch(store.transaction().insertNode(store.bodyId, 2, added));
  store.dispatch(
    store.transaction().replaceText({
      at: 5,
      inserted: " (edited)",
      node: item2.id,
      removed: "",
    }),
  );

  return diffSnapshots(base, store.toSnapshot());
}

/** A mixed document that exercises added / removed / moved / changed and a mark, with a mode toggle. */
export const Overview: Story = () => {
  const diff = useMemo(overviewDiff, []);
  const [mode, setMode] = useState<"unified" | "side-by-side">("unified");
  return wrap(
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {(["unified", "side-by-side"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              border: "1px solid var(--color-base-300, #ccc)",
              borderRadius: 6,
              fontWeight: mode === m ? 700 : 400,
              padding: "4px 10px",
            }}
            type="button"
          >
            {m}
          </button>
        ))}
      </div>
      <DiffView diff={diff} mode={mode} />
      {caption(
        <>
          One document edited many ways (docs/036 §6.1). The stats header sums
          the block changes; toggle <strong>unified</strong> vs{" "}
          <strong>side-by-side</strong>. Every block is drawn by the reader's
          own <code>renderBlock</code>, so an unchanged block is identical to
          the published page and only changes carry <code>.rt-diff-*</code>
          decoration.
        </>,
      )}
    </>,
  );
};

// --- text leaves + marks -----------------------------------------------------

/** Text-leaf edits: insert, delete, substitution, heading retype, and a mark add. */
export const TextLeavesAndMarks: Story = () => {
  const diff = useMemo(() => {
    const a = alloc("text");
    const insert = makeTextNode({
      content: a.createTextSlice("hello world"),
      id: a.createNodeId(),
    });
    const del = makeTextNode({
      content: a.createTextSlice("keep the good parts only"),
      id: a.createNodeId(),
    });
    const sub = makeTextNode({
      content: a.createTextSlice("Hello there"),
      id: a.createNodeId(),
    });
    const retype = makeTextNode({
      content: a.createTextSlice("Now a heading"),
      id: a.createNodeId(),
    });
    const marked = makeTextNode({
      content: a.createTextSlice("emphasize these words"),
      id: a.createNodeId(),
    });
    const store = createEditorStore({
      allocator: a,
      snapshot: snapshot([insert, del, sub, retype, marked]),
    });
    const base = store.toSnapshot();
    store.dispatch(
      store
        .transaction()
        .replaceText({ at: 5, inserted: " big", node: insert.id, removed: "" }),
    );
    store.dispatch(
      store
        .transaction()
        .replaceText({ at: 9, inserted: "", node: del.id, removed: "good " }),
    );
    store.dispatch(
      store
        .transaction()
        .replaceText({ at: 0, inserted: "Hi", node: sub.id, removed: "Hello" }),
    );
    store.dispatch({
      origin: "local",
      steps: [
        {
          from: "paragraph",
          node: retype.id,
          to: "heading",
          type: "set-node-type",
        },
      ],
    });
    const live = store.requireTextNode(marked.id);
    store.dispatch(
      store.transaction().addMark(
        marked.id,
        createTextMark({
          from: 10,
          id: "m",
          kind: "bold",
          node: live,
          to: 21,
        }),
      ),
    );
    return diffSnapshots(base, store.toSnapshot());
  }, []);
  return wrap(
    <>
      <DiffView diff={diff} />
      {caption(
        <>
          Character-id diff (§5.2): an insertion tints green, a deletion strikes
          red, a substitution shows both adjacent (Hello → Hi), a paragraph
          retyped to a heading is one changed leaf, and a bold added over
          unchanged text shows the dotted mark overlay.
        </>,
      )}
    </>,
  );
};

// --- add / remove / move -----------------------------------------------------

/** Block-level structure: add, remove, and reorder-as-move at the body. */
export const AddRemoveMove: Story = () => {
  const diff = useMemo(() => {
    const a = alloc("arm");
    const nodes = ["Alpha", "Beta", "Gamma", "Delta"].map((t) =>
      makeTextNode({ content: a.createTextSlice(t), id: a.createNodeId() }),
    );
    const store = createEditorStore({
      allocator: a,
      snapshot: snapshot(nodes),
    });
    const base = store.toSnapshot();
    store.dispatch(
      store
        .transaction()
        .removeNode(store.bodyId, 1, store.getNode(nodes[1]!.id)!),
    ); // remove Beta
    const added = makeTextNode({
      content: a.createTextSlice("Epsilon (new)"),
      id: a.createNodeId(),
    });
    store.dispatch(store.transaction().insertNode(store.bodyId, 1, added));
    store.dispatch({
      origin: "local",
      steps: [
        {
          from: { index: 3, parent: store.bodyId },
          node: nodes[3]!.id,
          to: { index: 0, parent: store.bodyId },
          type: "move-node",
        },
      ],
    });
    return diffSnapshots(base, store.toSnapshot());
  }, []);
  return wrap(
    <>
      <DiffView diff={diff} />
      {caption(
        <>
          Identity move detection (§5.4): reordering Delta to the top reads as
          one <em>moved</em> block (amber, "moved from position N"), not a
          delete-plus-insert — the LCS spine keeps every following block from
          being flagged.
        </>,
      )}
    </>,
  );
};

// --- structural containers ---------------------------------------------------

/** Structural containers (callout, list) with a changed child — only the child is decorated. */
export const StructuralContainers: Story = () => {
  const diff = useMemo(() => {
    const a = alloc("struct");
    const cKeep = makeTextNode({
      content: a.createTextSlice("Heads up: stable line."),
      id: a.createNodeId(),
    });
    const cEdit = makeTextNode({
      content: a.createTextSlice("This detail changes."),
      id: a.createNodeId(),
    });
    const callout = makeStructuralNode({
      attrs: { tone: "warning" },
      children: [cKeep.id, cEdit.id],
      id: a.createNodeId(),
      type: "callout",
    });
    const li1 = makeTextNode({
      content: a.createTextSlice("Buy milk"),
      id: a.createNodeId(),
      type: "listitem",
    });
    const li2 = makeTextNode({
      content: a.createTextSlice("Buy eggs"),
      id: a.createNodeId(),
      type: "listitem",
    });
    const list = makeStructuralNode({
      children: [li1.id, li2.id],
      id: a.createNodeId(),
      type: "list",
    });
    const store = createEditorStore({
      allocator: a,
      snapshot: snapshot([callout, list], [cKeep, cEdit, li1, li2]),
    });
    const base = store.toSnapshot();
    store.dispatch(
      store.transaction().replaceText({
        at: 19,
        inserted: " a lot",
        node: cEdit.id,
        removed: "",
      }),
    );
    store.dispatch(
      store.transaction().replaceText({
        at: 8,
        inserted: " and bread",
        node: li2.id,
        removed: "",
      }),
    );
    return diffSnapshots(base, store.toSnapshot());
  }, []);
  return wrap(
    <>
      <DiffView diff={diff} />
      {caption(
        <>
          Structural recursion (§5.5): the callout and the list are marked
          changed (blue bar), but the decoration lives only on the edited child
          — a one-line edit does not wash the whole container. The reader shell
          is reused, so the callout tone survives.
        </>,
      )}
    </>,
  );
};

// --- inner structural (deep) -------------------------------------------------

/** Deep nesting: a table (table → row → cell → paragraph) with one changed cell. */
export const InnerStructuralTable: Story = () => {
  const diff = useMemo(() => {
    const a = alloc("table");
    const mkCell = (text: string) => {
      const p = makeTextNode({
        content: a.createTextSlice(text),
        id: a.createNodeId(),
      });
      const cell = makeStructuralNode({
        children: [p.id],
        id: a.createNodeId(),
        type: "tablecell",
      });
      return { cell, p };
    };
    const c11 = mkCell("Name");
    const c12 = mkCell("Status");
    const c21 = mkCell("Diff view");
    const c22 = mkCell("planned");
    const row1 = makeStructuralNode({
      children: [c11.cell.id, c12.cell.id],
      id: a.createNodeId(),
      type: "tablerow",
    });
    const row2 = makeStructuralNode({
      children: [c21.cell.id, c22.cell.id],
      id: a.createNodeId(),
      type: "tablerow",
    });
    const table = makeStructuralNode({
      children: [row1.id, row2.id],
      id: a.createNodeId(),
      type: "table",
    });
    const store = createEditorStore({
      allocator: a,
      snapshot: snapshot(
        [table],
        [
          row1,
          row2,
          c11.cell,
          c12.cell,
          c21.cell,
          c22.cell,
          c11.p,
          c12.p,
          c21.p,
          c22.p,
        ],
      ),
    });
    const base = store.toSnapshot();
    // "planned" → "shipped"
    store.dispatch(
      store.transaction().replaceText({
        at: 0,
        inserted: "shipped",
        node: c22.p.id,
        removed: "planned",
      }),
    );
    return diffSnapshots(base, store.toSnapshot());
  }, []);
  return wrap(
    <>
      <DiffView diff={diff} />
      {caption(
        <>
          Deep structural recursion (§5.5): editing one cell marks the table
          changed, but only that cell's text shows the delete/insert runs — the
          grid, borders, and other cells render unchanged through the reader's
          own table primitives.
        </>,
      )}
    </>,
  );
};

// --- object blocks -----------------------------------------------------------

/** Object nodes: an added divider, a removed code block, and a changed media src (field summary). */
export const ObjectBlocks: Story = () => {
  const diff = useMemo(() => {
    const a = alloc("objects");
    const intro = makeTextNode({
      content: a.createTextSlice("Assets below."),
      id: a.createNodeId(),
    });
    const code = makeObjectNode({
      baked: {
        kind: "code",
        payload: { code: "const x = 1;", language: "ts" },
      },
      data: { code: "const x = 1;", language: "ts" },
      id: a.createNodeId(),
      status: "ready",
      type: "code",
    });
    const mediaId = a.createNodeId();
    const mediaBase = makeObjectNode({
      baked: { kind: "media", payload: { alt: "before", src: "/before.png" } },
      data: { alt: "before", src: "/before.png" },
      id: mediaId,
      status: "ready",
      type: "media",
    });
    const mediaTarget = makeObjectNode({
      baked: { kind: "media", payload: { alt: "before", src: "/after.png" } },
      data: { alt: "before", src: "/after.png" },
      id: mediaId,
      status: "ready",
      type: "media",
    });
    const divider = makeObjectNode({
      baked: { kind: "divider", payload: {} },
      data: {},
      id: a.createNodeId(),
      status: "ready",
      type: "divider",
    });
    const base = snapshot([intro, code, mediaBase]);
    const target = snapshot([intro, mediaTarget, divider]);
    return diffSnapshots(base, target, {
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
  }, []);
  return wrap(
    <>
      <DiffView diff={diff} />
      {caption(
        <>
          Object diff (§5.6): the code block is removed (dimmed, red bar), a
          divider is added (green bar), and the media's changed <code>src</code>{" "}
          is summarized field-by-field via the <code>diffData</code> seam — a
          removed image is the whole block dimmed, never a struck grid.
        </>,
      )}
    </>,
  );
};

// --- side-by-side ------------------------------------------------------------

/** The same overview edit, in side-by-side layout (base | target), aligned by identity. */
export const SideBySide: Story = () => {
  const diff = useMemo(overviewDiff, []);
  return wrap(
    <>
      <DiffView diff={diff} mode="side-by-side" />
      {caption(
        <>
          Side-by-side (§6.1): two columns aligned by identity — a block missing
          on a side gets a striped placeholder, a changed block shows its base
          and target versions across the row. Better for large structural
          change; unified is the default.
        </>,
      )}
    </>,
  );
};

// --- edge cases --------------------------------------------------------------

/** Edge cases: a kind change, the text-alignment fallback, and an identical (empty) diff. */
export const EdgeCases: Story = () => {
  const kindChange = useMemo(() => {
    const a = alloc("kind");
    const id = a.createNodeId();
    const asLeaf = makeTextNode({
      content: a.createTextSlice("This was a paragraph"),
      id,
    });
    const asDivider = makeObjectNode({
      baked: { kind: "divider", payload: {} },
      data: {},
      id,
      status: "ready",
      type: "divider",
    });
    return diffSnapshots(snapshot([asLeaf]), snapshot([asDivider]));
  }, []);
  const fallback = useMemo(() => {
    // Two independent clients → disjoint character ids → the §5.2 text-alignment fallback.
    const a = alloc("fb1");
    const b = alloc("fb2");
    const id = a.createNodeId();
    const before = makeTextNode({
      content: a.createTextSlice("retyped from scratch"),
      id,
    });
    const after = makeTextNode({
      content: b.createTextSlice("retyped from memory"),
      id,
    });
    return diffSnapshots(snapshot([before]), snapshot([after]));
  }, []);
  const identical = useMemo(() => {
    const a = alloc("same");
    const p = makeTextNode({
      content: a.createTextSlice("Nothing changed here."),
      id: a.createNodeId(),
    });
    const s = snapshot([p]);
    return diffSnapshots(s, s);
  }, []);
  return wrap(
    <>
      <h3 style={{ font: "600 13px ui-sans-serif", margin: "4px 0" }}>
        Kind change (leaf → object)
      </h3>
      <DiffView diff={kindChange} showStats={false} />
      <h3 style={{ font: "600 13px ui-sans-serif", margin: "16px 0 4px" }}>
        Text-alignment fallback (disjoint ids)
      </h3>
      <DiffView diff={fallback} showStats={false} />
      <h3 style={{ font: "600 13px ui-sans-serif", margin: "16px 0 4px" }}>
        Identical snapshots
      </h3>
      <DiffView diff={identical} />
      {caption(
        <>
          §8 failure modes: a matched id whose kind flipped renders removed-old
          over added-new; a leaf that shares no character ids falls back to a
          heuristic character LCS (the <code>text</code> badge); identical
          snapshots decorate nothing and report "No changes".
        </>,
      )}
    </>,
  );
};
