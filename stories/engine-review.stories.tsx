import type { Story, StoryDefault } from "@ladle/react";
import { useMemo } from "react";
import {
  createEditorStoreFromCompat,
  OwnedModelEditor,
  type EditorStore,
  type RichTextCompatDocument,
} from "../packages/editor/src";

/**
 * Stories for the Review surfaces (docs/027): the side-panel dock and its panes.
 * Each named export demos one slice of the design as it lands, phase by phase.
 */
export default {
  title: "Engine / Review",
} satisfies StoryDefault;

// A heading-rich document so the Outline pane has something to list. Plain compat
// JSON (the same shape `createEditorStoreFromCompat` ingests elsewhere), kept inline
// so the story is self-contained.
const OUTLINE_SAMPLE: RichTextCompatDocument = {
  root: {
    children: [
      {
        children: [{ text: "The Owned Editor", type: "text" }],
        tag: "h1",
        type: "heading",
      },
      {
        children: [
          {
            text: "Scroll the document or use the Outline panel to jump between sections.",
            type: "text",
          },
        ],
        type: "paragraph",
      },
      {
        children: [{ text: "Architecture", type: "text" }],
        tag: "h2",
        type: "heading",
      },
      {
        children: [
          {
            text: "The model is the source of truth, React renders it.",
            type: "text",
          },
        ],
        type: "paragraph",
      },
      {
        children: [{ text: "The store", type: "text" }],
        tag: "h3",
        type: "heading",
      },
      {
        children: [
          {
            text: "A normalized node graph with transactional history.",
            type: "text",
          },
        ],
        type: "paragraph",
      },
      {
        children: [{ text: "The scheduler", type: "text" }],
        tag: "h3",
        type: "heading",
      },
      {
        children: [
          {
            text: "Derived work runs off the typing path on the idle lane.",
            type: "text",
          },
        ],
        type: "paragraph",
      },
      {
        children: [{ text: "The view", type: "text" }],
        tag: "h2",
        type: "heading",
      },
      {
        children: [
          {
            text: "Blocks subscribe to one node each and virtualize.",
            type: "text",
          },
        ],
        type: "paragraph",
      },
      {
        children: [{ text: "Chrome", type: "text" }],
        tag: "h2",
        type: "heading",
      },
      {
        children: [
          {
            text: "Toolbar, flyout, slash menu, and now the dock.",
            type: "text",
          },
        ],
        type: "paragraph",
      },
    ],
  },
};

function useOutlineStore(): EditorStore {
  return useMemo(() => createEditorStoreFromCompat(OUTLINE_SAMPLE), []);
}

/**
 * The side-panel dock (docs/027 §8) with its first pane, Outline (§8.4 — the outline
 * "reunion"). Open the View tab and press Outline: the dock opens as a side column
 * listing every heading from the off-thread document index (§2.2 — derive, do not
 * store). Click a heading to jump to it; press Outline again (or the dock's X) to
 * close. On a narrow viewport the column becomes an overlay sheet (§8.3).
 */
export const DockOutline: Story = () => {
  const store = useOutlineStore();
  return (
    <div style={{ height: 520, maxWidth: 980 }}>
      <OwnedModelEditor store={store} viewportHeight={460} />
      <p style={{ font: "12px ui-sans-serif", marginTop: 12, opacity: 0.7 }}>
        Side-panel dock (docs/027 §8): <strong>View → Outline</strong> opens the
        dock. The Outline pane lists headings from the live document index and
        scrolls to one on click — under virtualization, through the engine, not
        a dead <code>#hash</code>. The dock is a sibling of the scroller, so
        opening it only narrows the surface (§8.3).
      </p>
    </div>
  );
};
