import type { Story, StoryDefault } from "@ladle/react";
import { type ReactNode, useMemo, useRef } from "react";
import { Button } from "@idco/ui";
import { DiffView } from "@quanghuy1242/idco-reader";
import {
  createDefaultBlockRegistry,
  createEditorStore,
  createIdAllocator,
  createTextMark,
  diffSnapshots,
  makeObjectNode,
  makeStructuralNode,
  makeTextNode,
  nodeDiffResolver,
  OwnedModelEditor,
  pointAtOffset,
  REVIEW_INDICATOR_CSS,
  useReviewChangeIndicator,
  type EditorDocumentSnapshot,
  type EditorNode,
  type EditorStore,
  type NodeId,
} from "../packages/editor/src";

/**
 * Stories for the R6-I review affordances (docs/036 §6.2.1/§6.4). `ChangeDetail` proves the diff
 * view now shows every change class — a removed mark (unstyled bold), node attrs (heading level, a
 * list flavour, a table cell's fill), and an object's `diffData` fields (a code edit) — none of
 * which touch a text run. `ChangeIndicator` proves the live in-editor indicator: each block that
 * differs from a baseline gets a status-colored left bar in the SAME palette as the diff view.
 */
export default {
  title: "Engine / Diff Detail",
} satisfies StoryDefault;

function soloDoc(node: EditorNode): EditorDocumentSnapshot {
  return {
    body: { blocks: { [node.id]: node }, order: [node.id] },
    settings: {},
    version: 1,
  };
}

const caption = (text: ReactNode) => (
  <p style={{ font: "12px ui-sans-serif", marginTop: 16, opacity: 0.7 }}>
    {text}
  </p>
);

/** A flat list item, optionally numbered (its `listType` attr is the flavour). */
function listItem(
  id: NodeId,
  content: ReturnType<ReturnType<typeof createIdAllocator>["createTextSlice"]>,
  numbered: boolean,
) {
  return makeTextNode({
    attrs: numbered ? { listType: "number" } : undefined,
    content,
    id,
    type: "listitem",
  });
}

// --- ChangeDetail: every §6.4 change class in one diff -----------------------

function detailDiff() {
  const a = createIdAllocator("idco_client_reviewdetail");

  // 1. A paragraph that loses its bold mark (a mark removal — no text edit). Marks need a store to
  //    resolve their character anchors, so build it through one.
  const pid = a.createNodeId();
  const pStore = createEditorStore({
    allocator: a,
    snapshot: soloDoc(
      makeTextNode({
        content: a.createTextSlice("This sentence was bold; now it is plain."),
        id: pid,
      }),
    ),
  });
  const live = pStore.requireTextNode(pid);
  pStore.dispatch(
    pStore
      .transaction()
      .addMark(
        pid,
        createTextMark({ from: 0, id: "mb", kind: "bold", node: live, to: 13 }),
      ),
  );
  const boldPara = pStore.requireTextNode(pid);
  pStore.dispatch(
    pStore.transaction().removeMark(pid, pStore.requireTextNode(pid).marks[0]!),
  );
  const plainPara = pStore.requireTextNode(pid);

  // 2. A heading whose level changes h2 → h3 (an attr change).
  const hid = a.createNodeId();
  const hc = a.createTextSlice("A section heading");
  const h2 = makeTextNode({
    attrs: { tag: "h2" },
    content: hc,
    id: hid,
    type: "heading",
  });
  const h3 = makeTextNode({
    attrs: { tag: "h3" },
    content: hc,
    id: hid,
    type: "heading",
  });

  // 3. A code block whose source changes (an object field diff through the `diffData` seam).
  const registry = createDefaultBlockRegistry();
  const codeDef = registry.require("code-block");
  const cid = a.createNodeId();
  const code = (source: string) => {
    const data = codeDef.normalizeData({ code: source, language: "ts" }).data;
    return makeObjectNode({
      baked: codeDef.bake?.(data) ?? undefined,
      data,
      id: cid,
      status: "ready",
      type: "code-block",
    });
  };

  // 4. A flat list converted bullet → numbered (a per-item `listType` attr change).
  const l1 = a.createNodeId();
  const l2 = a.createNodeId();
  const lc1 = a.createTextSlice("First step");
  const lc2 = a.createTextSlice("Second step");

  // 5. A table cell that loses its background color (a structural attr change, shown inside the cell).
  const cellTextId = a.createNodeId();
  const cellId = a.createNodeId();
  const rowId = a.createNodeId();
  const tableId = a.createNodeId();
  const cellText = makeTextNode({
    content: a.createTextSlice("On track"),
    id: cellTextId,
  });
  const cellColored = makeStructuralNode({
    attrs: { backgroundColor: "#14532d" },
    children: [cellTextId],
    id: cellId,
    type: "tablecell",
  });
  const cellPlain = makeStructuralNode({
    children: [cellTextId],
    id: cellId,
    type: "tablecell",
  });
  const row = makeStructuralNode({
    children: [cellId],
    id: rowId,
    type: "tablerow",
  });
  const table = makeStructuralNode({
    children: [rowId],
    id: tableId,
    type: "table",
  });

  const order = [pid, hid, cid, l1, l2, tableId];
  const doc = (
    para: EditorNode,
    heading: EditorNode,
    codeNode: EditorNode,
    item1: EditorNode,
    item2: EditorNode,
    cell: EditorNode,
  ): EditorDocumentSnapshot => ({
    body: {
      blocks: {
        [pid]: para,
        [hid]: heading,
        [cid]: codeNode,
        [l1]: item1,
        [l2]: item2,
        [tableId]: table,
        [rowId]: row,
        [cellId]: cell,
        [cellTextId]: cellText,
      },
      order,
    },
    settings: {},
    version: 1,
  });

  const base = doc(
    boldPara,
    h2,
    code("const total = a + b;"),
    listItem(l1, lc1, false),
    listItem(l2, lc2, false),
    cellColored,
  );
  const target = doc(
    plainPara,
    h3,
    code("const total = a + b + c;"),
    listItem(l1, lc1, true),
    listItem(l2, lc2, true),
    cellPlain,
  );
  return diffSnapshots(base, target, { getNodeDefinition: nodeDiffResolver() });
}

export const ChangeDetail: Story = () => {
  const diff = useMemo(detailDiff, []);
  return (
    <div style={{ maxWidth: 820 }}>
      <DiffView diff={diff} />
      {caption(
        "Every change here is invisible to a text-run diff: bold removed (a mark), a heading level, a bullet→numbered list, a code-block edit (object fields), and a table cell losing its fill — all now shown (docs/036 §6.4).",
      )}
    </div>
  );
};

// --- ListChanges: list items earn the SAME change card as any block ----------

/**
 * Two list scenarios a plain run-diff (and the first-cut inset bar) got wrong:
 *   1. A flat list turned bullet → numbered — every item is an `Edited` CARD, aligned with the
 *      paragraph card below, not a faint indented bar.
 *   2. Indent the middle item, THEN number the list. Indenting wraps the predecessor into a
 *      structural list item (Option-A nesting, docs/030 §7.3), so the diff calls the first item
 *      `moved`-into-an-added-container and the middle item `moved`-into-an-added-sublist. The
 *      earlier renderer dropped BOTH items' `listType` change; now every item — flat, nested, or
 *      moved — shows its bullet → number edit.
 */
function listChangesDiff() {
  const a = createIdAllocator("idco_client_listchanges");
  const p0 = a.createNodeId();
  const i1 = a.createNodeId();
  const i2 = a.createNodeId();
  const i3 = a.createNodeId();
  const item = (id: NodeId, text: string) =>
    makeTextNode({ content: a.createTextSlice(text), id, type: "listitem" });
  const base: EditorDocumentSnapshot = {
    body: {
      blocks: {
        [p0]: makeTextNode({
          content: a.createTextSlice(
            "Indent the middle item, then number the list:",
          ),
          id: p0,
          type: "paragraph",
        }),
        [i1]: item(i1, "Marks render to the DOM"),
        [i2]: item(i2, "Toolbar drives the model"),
        [i3]: item(i3, "Find works under virtualization"),
      },
      order: [p0, i1, i2, i3],
    },
    settings: {},
    version: 1,
  };
  const store = createEditorStore({ allocator: a, snapshot: base });
  // Indent the middle item (Option-A nesting wraps the first item into a structural container).
  const n2 = store.requireTextNode(i2);
  const c2 = pointAtOffset(i2, n2.content, 0);
  store.dispatch({
    origin: "local",
    selectionAfter: { anchor: c2, focus: c2, type: "text" },
    steps: [],
  });
  store.command({ type: "indent" });
  // Select all three items and turn the list numbered.
  const n1 = store.requireTextNode(i1);
  const n3 = store.requireTextNode(i3);
  store.dispatch({
    origin: "local",
    selectionAfter: {
      anchor: pointAtOffset(i1, n1.content, 0),
      focus: pointAtOffset(i3, n3.content, n3.content.text.length),
      type: "text",
    },
    steps: [],
  });
  store.command({
    type: "set-block-type",
    blockType: "listitem",
    listType: "number",
  });
  return diffSnapshots(base, store.toSnapshot(), {
    getNodeDefinition: nodeDiffResolver(),
  });
}

export const ListChanges: Story = () => {
  const diff = useMemo(listChangesDiff, []);
  return (
    <div style={{ maxWidth: 820 }}>
      <DiffView diff={diff} />
      {caption(
        "Indenting the middle item nests it (Option-A structural nesting), so the diff sees the first two items as moved into new containers — yet every item still shows its bullet → number edit, each as a full change card that aligns with the paragraph card, not a faint indented bar (docs/036 §6.3/§6.4).",
      )}
    </div>
  );
};

// --- ChangeIndicator: the live in-editor left-bar ----------------------------

function useIndicatorStore(): {
  store: EditorStore;
  editId: NodeId;
  delId: NodeId;
} {
  return useMemo(() => {
    const a = createIdAllocator("idco_client_reviewind_story");
    const editId = a.createNodeId();
    const delId = a.createNodeId();
    const nodes = [
      makeTextNode({
        attrs: { tag: "h2" },
        content: a.createTextSlice("Live change indicator"),
        id: a.createNodeId(),
        type: "heading",
      }),
      makeTextNode({
        content: a.createTextSlice(
          "Type in any paragraph, or use the button — its block gets a status-colored left bar, the same palette as the diff view's change cards.",
        ),
        id: a.createNodeId(),
      }),
      makeTextNode({
        content: a.createTextSlice(
          "The button appends text to this paragraph.",
        ),
        id: editId,
      }),
      makeTextNode({
        content: a.createTextSlice(
          "Delete this paragraph — it has no live element to mark, so its neighbor gets a red tick.",
        ),
        id: delId,
      }),
      makeTextNode({
        content: a.createTextSlice("A steady closing paragraph, untouched."),
        id: a.createNodeId(),
      }),
    ];
    return {
      delId,
      editId,
      store: createEditorStore({
        allocator: a,
        snapshot: {
          body: {
            blocks: Object.fromEntries(nodes.map((n) => [n.id, n])),
            order: nodes.map((n) => n.id),
          },
          settings: {},
          version: 1,
        },
      }),
    };
  }, []);
}

export const ChangeIndicator: Story = () => {
  const { store, editId, delId } = useIndicatorStore();
  const baseline = useMemo(() => store.toSnapshot(), [store]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const changed = useReviewChangeIndicator({
    baseline,
    enabled: true,
    rootRef,
    store,
  });
  return (
    <div style={{ maxWidth: 820 }}>
      <style>{REVIEW_INDICATOR_CSS}</style>
      <div ref={rootRef}>
        <OwnedModelEditor store={store} virtualize={false} />
      </div>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          gap: 8,
          margin: "12px 0",
        }}
      >
        <Button
          onClick={() => {
            const node = store.requireTextNode(editId);
            store.dispatch(
              store.transaction().replaceText({
                at: node.content.text.length,
                inserted: " — edited!",
                node: editId,
                removed: "",
              }),
            );
          }}
          size="sm"
          variant="secondary"
        >
          Edit a paragraph
        </Button>
        <Button
          onClick={() => {
            const node = store.getNode(delId);
            const index = store.order.indexOf(delId);
            if (node && index >= 0)
              store.dispatch(
                store.transaction().removeNode(store.bodyId, index, node),
              );
          }}
          size="sm"
          variant="secondary"
        >
          Delete a paragraph
        </Button>
        <span style={{ font: "12px ui-sans-serif", opacity: 0.7 }}>
          {changed.length} {changed.length === 1 ? "block" : "blocks"} changed
        </span>
      </div>
      {caption(
        "The live indicator (docs/036 §6.2.1): each changed block gets a status-colored gutter bar OUTSIDE the block, and a deleted block — which has no live element — leaves a red tick on its surviving neighbor. Same palette as the diff view; detail is the diff view.",
      )}
    </div>
  );
};
