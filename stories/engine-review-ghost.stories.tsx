import type { Story, StoryDefault } from "@ladle/react";
import { useMemo } from "react";
import {
  createEditorStoreFromCompat,
  OwnedModelEditor,
  useReviewGhostPlan,
  type EditorDocumentSnapshot,
  type EditorStore,
  type RichTextCompatDocument,
} from "../packages/editor/src";

/**
 * Ghost-render spike — docs/038 §5, R6-J **J0** (the gate before the rest of the woven overlay).
 *
 * What it PROVES, live, in the real editing surface (the gate's load-bearing mechanism):
 *   1. RENDER — a block removed since the captured baseline appears IN PLACE as an inert red
 *      "removed …" ghost (a `GhostBlock`), spliced into the flow at its old slot.
 *   2. MEASURE + VIRTUALIZE — the ghost carries `data-engine-block-id`, so the existing
 *      ResizeObserver measures it and the treap offset model windows it like a live block; scroll
 *      far enough and a ghost unmounts, scroll back and it remounts.
 *   3. NO TEAR (narrow) — live blocks keep their React key, so a ghost splicing in as a keyed
 *      sibling does not remount the neighbouring live block, and typing next to a ghost keeps the
 *      caret. A ghost is inert (`contentEditable=false`, no pointer/selection), so the caret skips it.
 *   4. LIST INTEGRITY — a removed list item is run-NEUTRAL: surviving items renumber to the target
 *      numbering across the ghost, not reset (the H1 fix; unit-proven in `engine-list-flat.test.tsx`).
 *
 * Honest scope (proven-narrower-than-the-label; the rest is J1+):
 *   - NO TEAR is proven for DESKTOP + printable typing + a STATIC ghost set only. The hard cases the
 *     woven design must eventually survive — mobile EditContext-host flicker, cross-block Backspace /
 *     merge, and an edit that splices a ghost *newly adjacent* to the caret — are NOT tested here;
 *     they are a named J-phase gate (docs/038 §13/§15).
 *   - MEASURE is "seeded coarse, measured exact": a ghost seeds at the global-mean height (the
 *     virtualizer's `seedFor` can't reach the base node) and snaps to real height on first measure,
 *     so a far-from-mean ghost (a removed heading/media) pops once. Content-aware ghost seeding is J1.
 *   - A removed *container* ghost shows a badge, not its subtree, so it under-measures its old
 *     height; faithful container ghosts + removed-child recursion are J2 (docs/038 §5).
 *
 * The whole review path is opt-in: `useReviewGhostPlan(store, baseline)` diffs a captured baseline
 * against the live document and hands the merged order + ghost map to the editor's `reviewOrder` /
 * `reviewGhosts` props. With no baseline the editor renders its ordinary body order (the two extra
 * O(1) per-block checks aside, the shipped path is unchanged).
 */
export default {
  title: "Engine / Review Ghost",
} satisfies StoryDefault;

// A tall document (headings + body paragraphs) so the window virtualizes at a 500px viewport and a
// ghost near the bottom starts windowed-out. Built programmatically to stay compact.
function makeSample(): RichTextCompatDocument {
  const children: RichTextCompatDocument["root"]["children"] = [
    {
      children: [{ text: "Ghost-render spike — docs/038 J0", type: "text" }],
      tag: "h1",
      type: "heading",
    },
  ];
  for (let i = 1; i <= 56; i += 1) {
    if (i % 8 === 1) {
      children.push({
        children: [{ text: `Section ${Math.ceil(i / 8)}`, type: "text" }],
        tag: "h2",
        type: "heading",
      });
    }
    children.push({
      children: [
        {
          text: `Paragraph ${i}. Body text long enough to give the block a realistic height, so a removed one leaves a ghost of comparable size and the offset model has something meaningful to measure.`,
          type: "text",
        },
      ],
      type: "paragraph",
    });
  }
  return { root: { children } };
}

// Indices (into the initial top-level order) removed AFTER the baseline is captured, so the diff
// reports them "removed" and the editor renders each as an in-place ghost. Scattered across the
// document (top, middle, bottom) so at least one starts below the fold — the virtualization case.
const REMOVE_AT = [3, 7, 14, 30, 47, 58];

function useGhostSpike(): {
  store: EditorStore;
  baseline: EditorDocumentSnapshot;
} {
  return useMemo(() => {
    const store = createEditorStoreFromCompat(makeSample());
    // Capture the baseline BEFORE removing anything — the diff's base side.
    const baseline = store.toSnapshot();
    const ids = [...store.order];
    for (const index of REMOVE_AT) {
      const id = ids[index];
      if (id) store.command({ node: id, type: "remove-block" });
    }
    return { baseline, store };
  }, []);
}

/**
 * The spike. Six scattered blocks were removed after the baseline was captured, so six inert ghosts
 * render in place. Click into any live paragraph next to a ghost and type — the caret holds and the
 * ghost stays (no EditContext tear). Scroll to the bottom to see a ghost mount that started windowed
 * out (virtualization).
 */
export const GhostSpike: Story = () => {
  const { store, baseline } = useGhostSpike();
  const plan = useReviewGhostPlan(store, baseline);
  return (
    <div style={{ height: 560, maxWidth: 900 }}>
      <OwnedModelEditor
        reviewGhosts={plan?.ghosts}
        reviewOrder={plan?.order}
        store={store}
        viewportHeight={500}
      />
      <p style={{ font: "12px ui-sans-serif", marginTop: 12, opacity: 0.7 }}>
        docs/038 J0 — removed blocks render in place as inert{" "}
        <strong>ghosts</strong> (red bands), spliced into the live flow,
        measured and virtualized through the same{" "}
        <code>data-engine-block-id</code> stack as live blocks. Type next to a
        ghost: the caret and the ghost both hold. Scroll: ghosts window in and
        out like any block.
      </p>
    </div>
  );
};
