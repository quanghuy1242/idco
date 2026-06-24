// @vitest-environment jsdom
/**
 * Comment Source SPI + comment model (docs/027 §7): the host-owned thread registry,
 * provenance gating, the host-first add flow that anchors a mark, the live highlight
 * mark, and the pane (load + group + snapshot fallback).
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  boundaryAtOffset,
  createEditorStore,
  createIdAllocator,
  makeTextNode,
  pointAtOffset,
  renderLeafMarks,
  type EditorStore,
  type NodeId,
  type TextContent,
  type TextLeafNode,
  type TextMark,
} from "../../packages/editor/src";
import {
  activeCommentSource,
  buildCommandContext,
  computeToolbarLayout,
  getSidePanel,
  listCommentSources,
  registerBuiltInBlockTypes,
  registerCommentSource,
  unregisterCommentSource,
  type CommentSource,
  type Thread,
  type ToolbarCapabilities,
} from "../../packages/editor/src/view/spi";
import { registerBuiltInNodeViews } from "../../packages/editor/src/view/nodes";
import { registerBuiltInCommands } from "../../packages/editor/src/view/chrome";
import {
  addCommentOverSelection,
  commentMarkEntries,
  CommentsPane,
  nodeForThread,
} from "../../packages/editor/src/view/chrome/panes";

beforeAll(() => {
  registerBuiltInBlockTypes();
  registerBuiltInNodeViews();
  registerBuiltInCommands();
});

const CAPS: ToolbarCapabilities = {
  ai: false,
  insertTable: true,
  media: false,
  review: false,
};

function thread(id: string, resolved = false): Thread {
  return {
    author: { id: "u1", name: "Reviewer" },
    body: `body of ${id}`,
    createdAt: "2026-06-24",
    excerpt: `excerpt ${id}`,
    id,
    replies: [],
    resolved,
    updatedAt: "2026-06-24",
  };
}

/** An in-memory comment source; `failLoad` simulates an unreachable host. */
function fakeSource(seed: Thread[], failLoad = false): CommentSource {
  let threads = [...seed];
  return {
    create: async (anchor, body) => {
      const created: Thread = {
        author: { id: "me", name: "Me" },
        body,
        createdAt: "now",
        excerpt: anchor.excerpt,
        id: `t${threads.length + 1}`,
        replies: [],
        resolved: false,
        updatedAt: "now",
      };
      threads.push(created);
      return created;
    },
    id: "comments",
    load: async () => {
      if (failLoad) throw new Error("offline");
      return threads;
    },
    remove: async (id) => {
      threads = threads.filter((t) => t.id !== id);
    },
    reply: async (id) => threads.find((t) => t.id === id)!,
    resolve: async (id) => threads.find((t) => t.id === id) ?? null,
    setResolved: async (id, resolved) => {
      threads = threads.map((t) => (t.id === id ? { ...t, resolved } : t));
    },
    update: async () => {},
  };
}

function leafStore(text: string): { store: EditorStore; id: NodeId } {
  const allocator = createIdAllocator("idco_client_comments");
  const node = makeTextNode({
    content: allocator.createTextSlice(text),
    id: allocator.createNodeId(),
    type: "paragraph",
  });
  const store = createEditorStore({
    allocator,
    snapshot: {
      body: { blocks: { [node.id]: node }, order: [node.id] },
      settings: {},
      version: 1,
    },
  });
  return { id: node.id, store };
}

afterEach(() => unregisterCommentSource("comments"));

describe("comment source registry + gating (docs/027 §7.1/§7.7)", () => {
  it("registers and exposes the active source", () => {
    expect(activeCommentSource()).toBeUndefined();
    registerCommentSource(fakeSource([]));
    expect(activeCommentSource()?.id).toBe("comments");
    expect(listCommentSources()).toHaveLength(1);
  });

  it("gates the Comments pane + commands on a registered source", () => {
    const { store } = leafStore("hello");
    const reviewIds = () =>
      computeToolbarLayout(buildCommandContext(store, CAPS))
        .tabs.find((t) => t.id === "review")!
        .slots.flatMap((s) => s.items.map((i) => i.id));

    // Off: no source → no comment surfaces (but Review still shows for Insights).
    expect(
      getSidePanel("comments")?.isAvailable?.(buildCommandContext(store, CAPS)),
    ).toBe(false);
    expect(reviewIds()).not.toContain("review.comments");
    expect(reviewIds()).not.toContain("comment.add");

    registerCommentSource(fakeSource([]));
    expect(
      getSidePanel("comments")?.isAvailable?.(buildCommandContext(store, CAPS)),
    ).toBe(true);
    expect(reviewIds()).toContain("review.comments");
    expect(reviewIds()).toContain("comment.add");
  });
});

describe("comment add anchors a host thread (docs/027 §7.1/§7.3)", () => {
  it("creates the thread first, then marks the selection with thread + snapshot", async () => {
    const { store, id } = leafStore("alpha beta");
    const node = store.requireNode(id) as TextLeafNode;
    store.dispatch({
      origin: "local",
      selectionAfter: {
        anchor: pointAtOffset(id, node.content, 0),
        focus: pointAtOffset(id, node.content, 5),
        type: "text",
      },
      steps: [],
    });
    const source = fakeSource([]);
    const threadId = await addCommentOverSelection(store, source, "looks off");
    expect(threadId).toBe("t1");

    const mark = (store.requireNode(id) as TextLeafNode).marks.find(
      (m) => m.kind === "comment",
    );
    expect(mark).toBeDefined();
    expect(mark!.attrs?.thread).toBe("t1");
    const snapshot = mark!.attrs?.snapshot as { excerpt: string };
    expect(snapshot.excerpt).toBe("alpha");

    // The document carries only the anchor + snapshot — no body/author/resolved.
    const entries = commentMarkEntries(store);
    expect(entries).toHaveLength(1);
    expect(nodeForThread(store, "t1")).toBe(id);
  });
});

describe("comment mark renders a live highlight (docs/027 §7.5)", () => {
  it("renders a highlighted span carrying the thread id, not an inert span", () => {
    const allocator = createIdAllocator("idco_client_comment_render");
    const content: TextContent = allocator.createTextSlice("note here");
    const mark: TextMark = {
      attrs: {
        snapshot: { author: "A", excerpt: "note", resolved: false },
        thread: "th-9",
      },
      from: boundaryAtOffset(content, 0, "before"),
      id: "cm1",
      kind: "comment",
      to: boundaryAtOffset(content, 4, "after"),
    };
    const node = makeTextNode({
      content,
      id: "idco_node_c_1" as NodeId,
      marks: [mark],
    });
    const { container } = render(<div>{renderLeafMarks(node)}</div>);
    const span = container.querySelector("span[data-engine-mark='comment']");
    expect(span?.getAttribute("data-engine-comment-thread")).toBe("th-9");
  });
});

describe("CommentsPane (docs/027 §7.4)", () => {
  it("loads threads and groups them by unresolved/resolved", async () => {
    registerCommentSource(fakeSource([thread("t1"), thread("t2", true)]));
    const { store } = leafStore("hello");
    const { findByText, getByText } = render(
      <CommentsPane reveal={() => {}} store={store} />,
    );
    await findByText("body of t1");
    expect(getByText("Unresolved")).toBeTruthy();
    expect(getByText("Resolved")).toBeTruthy();
  });

  it("falls back to per-mark snapshots when the host is unreachable", async () => {
    registerCommentSource(fakeSource([thread("t1")], true));
    // A document with a comment mark carrying a snapshot.
    const allocator = createIdAllocator("idco_client_fallback");
    const content = allocator.createTextSlice("anchored text");
    const node = makeTextNode({
      content,
      id: allocator.createNodeId(),
      marks: [
        {
          attrs: {
            snapshot: { author: "Saved", excerpt: "anchored", resolved: false },
            thread: "t1",
          },
          from: boundaryAtOffset(content, 0, "before"),
          id: "cm1",
          kind: "comment",
          to: boundaryAtOffset(content, 8, "after"),
        },
      ],
    });
    const store = createEditorStore({
      allocator,
      snapshot: {
        body: { blocks: { [node.id]: node }, order: [node.id] },
        settings: {},
        version: 1,
      },
    });
    const { findByText } = render(
      <CommentsPane reveal={() => {}} store={store} />,
    );
    expect(await findByText(/Couldn.t reach the comment host/)).toBeTruthy();
    expect(await findByText(/Saved/)).toBeTruthy();
  });
});
