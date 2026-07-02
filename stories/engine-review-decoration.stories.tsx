import type { Story, StoryDefault } from "@ladle/react";
import { useMemo, useRef } from "react";
import {
  createDefaultBlockRegistry,
  createEditorStore,
  createIdAllocator,
  makeObjectNode,
  makeStructuralNode,
  makeTextNode,
  OwnedModelEditor,
  REVIEW_INDICATOR_CSS,
  useReviewChangeIndicator,
  type EditorDocumentSnapshot,
  type EditorNode,
  type NodeId,
} from "../packages/editor/src";

/**
 * The passive marker layer at any depth — docs/038 §7–§9, R6-J **J3**.
 *
 * What it PROVES, live, in the real editing surface (a Playwright legibility screenshot rides this):
 *   1. GUTTER BAR (R6-I, top level) — a top-level block that differs from the baseline carries a
 *      status-hued bar in the surface's LEFT INSET, outside the prose (info = edited, error tick =
 *      a removed neighbor). Its position aligns with the inset only at the top level, and being
 *      outside the prose box it is content-color-collision-safe, so it keeps a hue (docs/038 §9).
 *   2. ELEMENT RING (J3, any depth) — a NESTED element whose attr/object changed (here two table
 *      cells whose fill changed) carries an on-content TWO-TONE ring the inset bar could never reach.
 *      The ring is a dark-inner / status-band / light-outer box-shadow, so its shape survives on ANY
 *      background (the teal-ring-on-a-teal-cell problem, docs/038 §9) — the same "one visible ring on
 *      any surface" property the `focusRing` token was built for.
 *   3. THE ROUTER (docs/038 §8) — a re-colored cell rings; the row and table that merely CONTAIN it
 *      do not ring (the table gets the top-level bar as a breadcrumb, the row gets nothing). A nested
 *      text-run edit is NOT ringed here — that is T1 woven track-changes, which rides J6.
 *
 * The whole surface is opt-in and read-only: `useReviewChangeIndicator({ rootRef, store, baseline })`
 * diffs a captured baseline against the live document and sets a `data-*` attribute on each changed
 * element's existing DOM node (looked up by `data-engine-block-id`), which {@link REVIEW_INDICATOR_CSS}
 * paints — zero reflow, no re-render, virtualizes on remount. The detail chip and the scoped-diff
 * drill-in (T2/T3) ride the active review cursor (J4); this story is the passive layer only.
 */
export default {
  title: "Engine / Review Decoration",
} satisfies StoryDefault;

/** A table cell wrapping one child, optionally with a `backgroundColor` attr (whose change rings). */
function cell(
  childId: NodeId,
  id: NodeId,
  backgroundColor?: string,
): EditorNode {
  return makeStructuralNode({
    // `backgroundColor` is the key the cell renderer actually reads (table.tsx) — so the cell renders
    // a REAL fill and the ring's two-tone contrast-on-fill is genuinely exercised, not just asserted.
    attrs: backgroundColor ? { backgroundColor } : undefined,
    children: [childId],
    id,
    type: "tablecell",
  });
}

/** Assemble a snapshot from an explicit node list and a top-level order. */
function doc(
  nodes: readonly EditorNode[],
  order: readonly NodeId[],
): EditorDocumentSnapshot {
  return {
    body: {
      blocks: Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<
        NodeId,
        EditorNode
      >,
      order: [...order],
    },
    settings: {},
    version: 1,
  };
}

/**
 * Build a baseline ("before") and a live ("after") snapshot that SHARE node ids, so the diff reads
 * every difference as an identity-matched change, not add+remove:
 *   - a top-level paragraph whose text was edited → a gutter BAR;
 *   - two table cells whose `backgroundColor` attr changed → an element RING on each cell (the
 *     row/table containing them do not ring), and a nested code-block object whose language changed;
 *   - a top-level paragraph removed → a deletion TICK on its surviving neighbor.
 * Everything else (heading, the other cells, all inner paragraphs) is the SAME object in both trees,
 * so it stays `unchanged` and renders identically to the plain editor.
 */
function buildPair(): {
  before: EditorDocumentSnapshot;
  after: EditorDocumentSnapshot;
} {
  const a = createIdAllocator("idco_client_j3decoration");
  const nid = (): NodeId => a.createNodeId();

  const heading = makeTextNode({
    content: a.createTextSlice("Suggested edits — passive marker layer"),
    id: nid(),
    type: "heading",
  });
  // The edited top-level paragraph: same id, different text → a BAR.
  const p1Id = nid();
  const p1Before = makeTextNode({
    content: a.createTextSlice(
      "This introduction is untouched in the baseline.",
    ),
    id: p1Id,
  });
  const p1After = makeTextNode({
    content: a.createTextSlice(
      "This introduction was edited — so the whole block carries a gutter bar in the left inset.",
    ),
    id: p1Id,
  });
  const p2 = makeTextNode({
    content: a.createTextSlice(
      "A second paragraph, unchanged, to space the layout.",
    ),
    id: nid(),
  });
  // A top-level paragraph present only in the baseline → removed → a deletion tick on its neighbor.
  const p3 = makeTextNode({
    content: a.createTextSlice(
      "This paragraph is removed in the live document.",
    ),
    id: nid(),
  });

  // A 2x2 table. Two cells change their `backgroundColor` attr (→ RING); the rest is shared/unchanged.
  const innerP = (text: string) =>
    makeTextNode({ content: a.createTextSlice(text), id: nid() });

  const cA1P = innerP("Fill changed");
  const cA2P = innerP("Header B");
  const cB1P = innerP("Body A");
  const cB2P = innerP("Fill changed");

  const cA1Id = nid();
  const cB2Id = nid();
  // Changed cells: attrs differ between before/after (same id) → the diff emits `.attrs` → RING.
  const cA1Before = cell(cA1P.id, cA1Id, "oklch(0.9 0.05 20)");
  const cA1After = cell(cA1P.id, cA1Id, "oklch(0.85 0.12 150)");
  const cB2Before = cell(cB2P.id, cB2Id, "oklch(0.9 0.05 20)");
  const cB2After = cell(cB2P.id, cB2Id, "oklch(0.85 0.12 150)");
  // Unchanged cells: one shared object each.
  const cA2 = cell(cA2P.id, nid());
  const cB1 = cell(cB1P.id, nid());

  const rowAId = nid();
  const rowBId = nid();
  const rowABefore = makeStructuralNode({
    children: [cA1Before.id, cA2.id],
    id: rowAId,
    type: "tablerow",
  });
  const rowAAfter = makeStructuralNode({
    children: [cA1After.id, cA2.id],
    id: rowAId,
    type: "tablerow",
  });
  const rowBBefore = makeStructuralNode({
    children: [cB1.id, cB2Before.id],
    id: rowBId,
    type: "tablerow",
  });
  const rowBAfter = makeStructuralNode({
    children: [cB1.id, cB2After.id],
    id: rowBId,
    type: "tablerow",
  });
  const tableId = nid();
  const tableBefore = makeStructuralNode({
    children: [rowABefore.id, rowBBefore.id],
    id: tableId,
    type: "table",
  });
  const tableAfter = makeStructuralNode({
    children: [rowAAfter.id, rowBAfter.id],
    id: tableId,
    type: "table",
  });

  // A callout containing a code-block OBJECT whose language changed → the object's `.object` diff
  // fires at depth ≥ 1 → a RING on the object. This is the case the second adversarial pass caught:
  // an object carries the hover/live `box-shadow` chrome (`ENGINE_OBJECT_CHROME_CSS`), which would
  // REPLACE a box-shadow-only ring on hover — so the ring must also paint an `outline`, which the
  // chrome never touches. Hover this code block in the story: the ring stays.
  const codeDef = createDefaultBlockRegistry().require("code-block");
  const codeId = nid();
  const codeNode = (language: string) => {
    const data = codeDef.normalizeData({ code: "const x = 1;", language }).data;
    return makeObjectNode({
      baked: codeDef.bake?.(data) ?? undefined,
      data,
      id: codeId,
      status: "ready",
      type: "code-block",
    });
  };
  const codeBefore = codeNode("ts");
  const codeAfter = codeNode("js");
  const calloutIntro = makeTextNode({
    content: a.createTextSlice(
      "A callout — its code block's language changed:",
    ),
    id: nid(),
  });
  const calloutId = nid();
  const calloutBefore = makeStructuralNode({
    children: [calloutIntro.id, codeBefore.id],
    id: calloutId,
    type: "callout",
  });
  const calloutAfter = makeStructuralNode({
    children: [calloutIntro.id, codeAfter.id],
    id: calloutId,
    type: "callout",
  });

  const shared = [heading, p2, cA1P, cA2P, cB1P, cB2P, cA2, cB1, calloutIntro];
  const beforeNodes: EditorNode[] = [
    ...shared,
    p1Before,
    p3,
    cA1Before,
    cB2Before,
    rowABefore,
    rowBBefore,
    tableBefore,
    codeBefore,
    calloutBefore,
  ];
  const afterNodes: EditorNode[] = [
    ...shared,
    p1After,
    cA1After,
    cB2After,
    rowAAfter,
    rowBAfter,
    tableAfter,
    codeAfter,
    calloutAfter,
  ];
  return {
    after: doc(afterNodes, [heading.id, p1Id, p2.id, tableId, calloutId]),
    before: doc(beforeNodes, [
      heading.id,
      p1Id,
      p2.id,
      p3.id,
      tableId,
      calloutId,
    ]),
  };
}

/**
 * Passive markers at any depth. The editor renders the live ("after") document; the indicator diffs
 * it against the captured baseline ("before") and decorates: a bar on the edited paragraph, a ring on
 * each re-colored cell, a deletion tick where a paragraph was removed. Nothing is edited at runtime,
 * so the decoration is a stable, screenshot-legible snapshot of the passive layer.
 */
export const PassiveMarkers: Story = () => {
  const { store, baseline } = useMemo(() => {
    const { before, after } = buildPair();
    const editorStore = createEditorStore({
      allocator: createIdAllocator("idco_client_j3reviewer"),
      snapshot: after,
    });
    return { baseline: before, store: editorStore };
  }, []);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const changed = useReviewChangeIndicator({
    baseline,
    rootRef: editorRef,
    store,
  });
  return (
    <div style={{ maxWidth: 900 }}>
      {/* The stylesheet is injected once here (the hook is not a component, so it cannot own CSS). */}
      <style>{REVIEW_INDICATOR_CSS}</style>
      <div ref={editorRef}>
        <OwnedModelEditor store={store} virtualize={false} />
      </div>
      <p style={{ font: "12px ui-sans-serif", marginTop: 12, opacity: 0.7 }}>
        docs/038 J3 — the passive marker layer at any depth. The edited
        paragraph carries a <strong>gutter bar</strong> in the left inset; each
        re-colored table cell and the callout&rsquo;s code block (its language
        changed) carry a two-tone <strong>element ring</strong> (the rows,
        table, and callout that contain them do not ring — they get the
        top-level bar). Hover the code block: its ring survives the object hover
        chrome (the ring paints an outline the chrome never touches). A removed
        paragraph leaves a red <strong>deletion tick</strong> on its neighbor.{" "}
        {changed.length} top-level {changed.length === 1 ? "block" : "blocks"}{" "}
        changed. The detail chip and drill-in (T2/T3) ride the review cursor
        (J4).
      </p>
    </div>
  );
};
