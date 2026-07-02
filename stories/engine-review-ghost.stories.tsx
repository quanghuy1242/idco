import type { Story, StoryDefault } from "@ladle/react";
import { useMemo } from "react";
import {
  createEditorStore,
  createIdAllocator,
  makeStructuralNode,
  makeTextNode,
  OwnedModelEditor,
  useReviewModel,
  type EditorDocumentSnapshot,
  type EditorNode,
  type EditorStore,
  type NodeId,
} from "../packages/editor/src";

/**
 * Woven review render — docs/038 §5, R6-J **J0 (top-level)** + **J2 (in-container + budget)**.
 *
 * What it PROVES, live, in the real editing surface:
 *   1. TOP-LEVEL GHOSTS (J0) — a top-level block removed since the baseline appears IN PLACE as an
 *      inert red "removed …" ghost, spliced at its old slot, measured and VIRTUALIZED (scroll far
 *      enough and a ghost unmounts/remounts like any block; the treap windows ghost ids too).
 *   2. IN-CONTAINER GHOSTS (J2) — a removed *list item* renders in place INSIDE its surviving list,
 *      via the merged child order the `ReviewModel` splices through `block-dispatch` (not a top-level
 *      short-circuit). Surviving numbered items renumber to the target across the ghost (the H1 fix,
 *      one level down).
 *   3. PER-CONTAINER BUDGET (J2) — a deletion-heavy list splices at most `containerGhostBudget`
 *      ghost items and drops the surplus (containers do not internally virtualize, so this bounds
 *      their mount cost); the dropped count is recorded on `ReviewModel.collapsed` — J3 renders the
 *      visible "+N removed" affordance. This story uses a tiny budget (4) so a 6-item deletion drops 2.
 *   4. NO TEAR — typing in a live paragraph next to a ghost keeps the caret and the ghost (the live
 *      block keeps its EditContext host; a ghost is inert, `contentEditable=false`).
 *
 * The whole review path is opt-in: `useReviewModel(store, baseline, { containerGhostBudget })` diffs
 * the captured baseline against the live document and hands the plan to the editor's `review` prop.
 * With no baseline the editor renders its ordinary body order (the shipped path is unchanged).
 *
 * Honest scope (J2): a removed *container* is one ghost (a badge, not its subtree — it under-measures
 * its old height); faithful reader-parity ghost content and the drill-in affordance for a collapsed
 * container are J3. Content-aware ghost seeding IS in J2 (a removed block seeds from its base node's
 * metrics, so it does not pop). The incremental idle-coalesced re-diff rides J6 (editing-during-review).
 */
export default {
  title: "Engine / Review Ghost",
} satisfies StoryDefault;

const ITEM_TEXT = (label: string) =>
  `${label} — body text long enough to give the block a realistic height so a removed one leaves a ghost of comparable size and the offset model has something meaningful to measure.`;

/**
 * Build a tall document natively (so the story controls list children precisely): top-level
 * paragraphs (for top-level ghosts + virtualization at a 500px viewport), a numbered list (for
 * in-place item ghosts + renumbering), and a bullet list (for the per-container budget collapse).
 */
function buildDocument(): {
  snapshot: EditorDocumentSnapshot;
  ids: {
    paragraphs: NodeId[];
    numberedItems: NodeId[];
    bulletItems: NodeId[];
    numberedList: NodeId;
    bulletList: NodeId;
    tableRows: NodeId[];
    table: NodeId;
  };
} {
  const a = createIdAllocator("idco_client_j2spike");
  const nodes: EditorNode[] = [];
  const order: NodeId[] = [];
  const para = (text: string): NodeId => {
    const node = makeTextNode({
      content: a.createTextSlice(text),
      id: a.createNodeId(),
    });
    nodes.push(node);
    return node.id;
  };

  order.push(
    para(
      "Woven review spike — docs/038 J2. Scroll, type next to a ghost, watch a list item vanish in place.",
    ),
  );
  const paragraphs: NodeId[] = [];
  for (let i = 1; i <= 24; i += 1) {
    const id = para(ITEM_TEXT(`Paragraph ${i}`));
    order.push(id);
    paragraphs.push(id);
  }

  // The editing surface reads a list item's flavour from the ITEM's own `listType` attr (flat-list
  // model, styles.ts `listFlavourOf`), not the container's — so set it per item for the numbered run
  // to renumber across a ghost (the container attr still drives the resting `<ol>`/`<ul>`).
  const listItem = (label: string, listType: "number" | "bullet"): NodeId => {
    const node = makeTextNode({
      attrs: { listType },
      content: a.createTextSlice(label),
      id: a.createNodeId(),
      type: "listitem",
    });
    nodes.push(node);
    return node.id;
  };
  const numberedItems = Array.from({ length: 8 }, (_v, i) =>
    listItem(`Numbered item ${i + 1}`, "number"),
  );
  const numberedList = makeStructuralNode({
    attrs: { listType: "number" },
    children: numberedItems,
    id: a.createNodeId(),
    type: "list",
  });
  nodes.push(numberedList);
  order.push(numberedList.id);

  const bulletItems = Array.from({ length: 8 }, (_v, i) =>
    listItem(`Bullet row ${i + 1}`, "bullet"),
  );
  const bulletList = makeStructuralNode({
    attrs: { listType: "bullet" },
    children: bulletItems,
    id: a.createNodeId(),
    type: "list",
  });
  nodes.push(bulletList);
  order.push(bulletList.id);

  // A small table (table > tablerow > tablecell > paragraph), so removing a row exercises the J2
  // table gate: the removed row must NOT splice a `<div>` ghost into the real `<table>`; the table
  // renders its live rows only (faithful `<tr>` ghosts are J3).
  const cell = (label: string): NodeId => {
    const p = makeTextNode({
      content: a.createTextSlice(label),
      id: a.createNodeId(),
    });
    nodes.push(p);
    const c = makeStructuralNode({
      children: [p.id],
      id: a.createNodeId(),
      type: "tablecell",
    });
    nodes.push(c);
    return c.id;
  };
  const row = (label: string): NodeId => {
    const r = makeStructuralNode({
      children: [cell(`${label}·1`), cell(`${label}·2`)],
      id: a.createNodeId(),
      type: "tablerow",
    });
    nodes.push(r);
    return r.id;
  };
  const tableRows = [row("Row A"), row("Row B"), row("Row C")];
  const table = makeStructuralNode({
    children: tableRows,
    id: a.createNodeId(),
    type: "table",
  });
  nodes.push(table);
  order.push(table.id);

  const snapshot: EditorDocumentSnapshot = {
    body: {
      blocks: Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<
        NodeId,
        EditorNode
      >,
      order,
    },
    settings: {},
    version: 1,
  };
  return {
    ids: {
      bulletItems,
      bulletList: bulletList.id,
      numberedItems,
      numberedList: numberedList.id,
      paragraphs,
      table: table.id,
      tableRows,
    },
    snapshot,
  };
}

/** Remove a node by id, re-resolving its current parent + index (works for top-level and list children). */
function removeById(store: EditorStore, id: NodeId): void {
  const node = store.getNode(id);
  if (!node) return;
  const top = store.order.indexOf(id);
  if (top !== -1) {
    store.dispatch(store.transaction().removeNode(store.bodyId, top, node));
    return;
  }
  for (const containerId of store.order) {
    const container = store.getNode(containerId);
    if (container?.kind !== "structural") continue;
    const index = container.children.indexOf(id);
    if (index !== -1) {
      store.dispatch(store.transaction().removeNode(containerId, index, node));
      return;
    }
  }
}

function useSpike(): { store: EditorStore; baseline: EditorDocumentSnapshot } {
  return useMemo(() => {
    const { snapshot, ids } = buildDocument();
    const store = createEditorStore({
      allocator: createIdAllocator("idco_client_j2reviewer"),
      snapshot,
    });
    // Capture the baseline BEFORE removing anything — the diff's base side.
    const baseline = store.toSnapshot();
    // Top-level removals (J0 ghosts, scattered so at least one starts below the fold).
    for (const index of [3, 9, 20]) removeById(store, ids.paragraphs[index]!);
    // In-container removals in the numbered list (J2 in-place item ghosts + renumbering).
    removeById(store, ids.numberedItems[1]!);
    removeById(store, ids.numberedItems[4]!);
    // Deletion-heavy bullet list (J2 per-container budget: 6 removed, budget 4 → collapse 2).
    for (const index of [0, 1, 2, 3, 4, 5])
      removeById(store, ids.bulletItems[index]!);
    // A removed table row (J2 table gate: the table renders live rows, no invalid `<div>` ghost).
    removeById(store, ids.tableRows[1]!);
    return { baseline, store };
  }, []);
}

/**
 * The spike. Blocks removed after the baseline was captured render in place as inert ghosts — at the
 * top level AND inside the numbered list; the bullet list collapses its over-budget removals. Click a
 * live paragraph next to a ghost and type — the caret holds. Scroll to see ghosts window in and out.
 */
export const GhostSpike: Story = () => {
  const { store, baseline } = useSpike();
  const plan = useReviewModel(store, baseline, { containerGhostBudget: 4 });
  return (
    <div style={{ height: 560, maxWidth: 900 }}>
      <OwnedModelEditor
        review={plan ?? undefined}
        store={store}
        viewportHeight={500}
      />
      <p style={{ font: "12px ui-sans-serif", marginTop: 12, opacity: 0.7 }}>
        docs/038 J2 — removed blocks render in place as inert{" "}
        <strong>ghosts</strong> (red bands): top-level, and inside the numbered
        list (surviving items renumber across the ghost). The bullet list
        splices at most its budget of ghosts and drops the surplus (the count is
        on the review model; the visible &ldquo;+N removed&rdquo; affordance is
        J3). Type next to a ghost: the caret and the ghost both hold.
      </p>
    </div>
  );
};
