import type { Story, StoryDefault } from "@ladle/react";
import { useEffect, useMemo, useState } from "react";
import {
  createEditorStoreFromCompat,
  OwnedModelEditor,
  registerCommentSource,
  unregisterCommentSource,
  type EditorStore,
  type RichTextCompatDocument,
} from "../packages/editor/src";
import { createInMemoryCommentSource } from "./_fake-comment-source";

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

/**
 * The Glossary pane + type-first add flow (docs/027 §6). Two terms are pre-seeded
 * (define-first) so the pane shows them as "unused"; select a word and choose
 * "Add to glossary" in the selection flyout (or the Review ribbon) to link an existing
 * term or create a new one — one atomic, undoable transaction (§5.3/§6.2). A marked
 * occurrence renders as a dotted-underline abbr (§6.1), counts toward the term's
 * occurrence badge, and jumps from the pane. Editing a definition once updates the
 * single stored item — there is no second copy to drift (§6.1).
 */
export const DockGlossary: Story = () => {
  const store = useMemo(() => {
    const built = createEditorStoreFromCompat(OUTLINE_SAMPLE);
    // Seed two terms (define-first); they start unused until the author marks words.
    built.command({
      collection: "glossary",
      items: [
        {
          definition:
            "Service Provider Interface — the editor's extension seams.",
          id: "g-spi",
          term: "SPI",
        },
        {
          definition: "The off-thread pass that derives the document index.",
          id: "g-bake",
          term: "bake",
        },
      ],
      type: "set-collection",
    });
    return built;
  }, []);
  return (
    <div style={{ height: 520, maxWidth: 980 }}>
      <OwnedModelEditor store={store} viewportHeight={460} />
      <p style={{ font: "12px ui-sans-serif", marginTop: 12, opacity: 0.7 }}>
        Glossary (docs/027 §6): open <strong>Review → Glossary</strong> to
        manage terms, or select a word and pick <em>Add to glossary</em> in the
        flyout. The term registry is the single source of truth — a glossary
        mark stores only a reference, so editing a definition updates every
        occurrence and there is no copy to drift.
      </p>
    </div>
  );
};

/**
 * The Insights pane (docs/027 §9.4): the first Review surface and what makes the
 * Review tab appear (§7.7 — registry-driven). Open Review → Insights for live
 * word/character/sentence counts, reading time, and a Flesch readability estimate,
 * all derived from the off-thread document index (§2.2). Select text for a
 * selection-scoped section (§9.4 / §10).
 */
export const DockInsights: Story = () => {
  const store = useOutlineStore();
  return (
    <div style={{ height: 520, maxWidth: 980 }}>
      <OwnedModelEditor store={store} viewportHeight={460} />
      <p style={{ font: "12px ui-sans-serif", marginTop: 12, opacity: 0.7 }}>
        Insights pane (docs/027 §9.4): <strong>Review → Insights</strong>. The
        Review tab is registry-driven — it shows because Insights (always
        available) registered (§7.7). Counts update as you type; select text for
        selection-scoped counts.
      </p>
    </div>
  );
};

/**
 * Comments (docs/027 §7), host-owned through a registered `CommentSource`. This story
 * registers a fake in-memory source (a real deployment registers one backed by its
 * thread store), which lights up the Comments pane and the add action (§7.7). Select
 * text and choose "Comment" in the flyout to open a thread: the host creates it, then a
 * comment mark anchors it (host-first, §7.3), the range highlights, and the thread
 * appears in Review → Comments where it can be replied to, resolved, or deleted. No
 * comment body lives in the document — only the anchor mark and a thin snapshot.
 */
function useInMemoryCommentSource(): void {
  // Register on first render (before the editor gates its surfaces), tear down on
  // unmount so it does not leak into the other stories (the registry is a singleton).
  useState(() => {
    registerCommentSource(createInMemoryCommentSource());
    return null;
  });
  useEffect(() => () => unregisterCommentSource("comments"), []);
}

// A deliberately unhealthy document: a heading-level skip (h1 → h3), an empty
// heading, and a vague link — so the Accessibility pane has something to flag.
const HEALTH_SAMPLE: RichTextCompatDocument = {
  root: {
    children: [
      {
        children: [{ text: "Document health", type: "text" }],
        tag: "h1",
        type: "heading",
      },
      {
        children: [{ text: "The next heading skips a level.", type: "text" }],
        type: "paragraph",
      },
      {
        children: [{ text: "A deep heading", type: "text" }],
        tag: "h3",
        type: "heading",
      },
      { children: [{ text: "", type: "text" }], tag: "h2", type: "heading" },
      {
        children: [
          { text: "See ", type: "text" },
          {
            children: [{ text: "click here", type: "text" }],
            type: "link",
            url: "https://example.com",
          },
          { text: " for details.", type: "text" },
        ],
        type: "paragraph",
      },
    ],
  },
};

/**
 * Document health (docs/027 §9.5/§9.6): Accessibility lint and Broken references, both
 * recommendation-only renderers over derived state. Open Review → Accessibility on this
 * deliberately-unhealthy document and it flags the heading-level skip, the empty
 * heading, and the vague "click here" link — each links to its node, and nothing is
 * auto-fixed (§6.4). Broken references lists any reference block whose resolve failed.
 */
export const DockHealth: Story = () => {
  const store = useMemo(() => createEditorStoreFromCompat(HEALTH_SAMPLE), []);
  return (
    <div style={{ height: 520, maxWidth: 980 }}>
      <OwnedModelEditor store={store} viewportHeight={460} />
      <p style={{ font: "12px ui-sans-serif", marginTop: 12, opacity: 0.7 }}>
        Document health (docs/027 §9.5/§9.6):{" "}
        <strong>Review → Accessibility</strong> flags the heading skip, the
        empty heading, and the vague link — click a finding to jump to it.
        Recommendation-only: it never rewrites the prose.
      </p>
    </div>
  );
};

export const DockComments: Story = () => {
  useInMemoryCommentSource();
  const store = useOutlineStore();
  return (
    <div style={{ height: 520, maxWidth: 980 }}>
      <OwnedModelEditor store={store} viewportHeight={460} />
      <p style={{ font: "12px ui-sans-serif", marginTop: 12, opacity: 0.7 }}>
        Comments (docs/027 §7): a fake in-memory comment source is registered,
        so the <strong>Comments</strong> pane and the flyout <em>Comment</em>{" "}
        action appear (§7.7). Select text, choose Comment, and write one — the
        host creates the thread, a mark anchors it, and it shows in Review →
        Comments (reply, resolve, delete, jump). Unregister the source and it
        all vanishes.
      </p>
    </div>
  );
};
