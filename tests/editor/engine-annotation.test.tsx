// @vitest-environment jsdom
/**
 * Annotation interaction (docs/027 §16 P6): click a glossary/comment mark to read a
 * popover, innermost-wins precedence, and "Open in …" routing to the dock with a
 * focusId that the pane rings.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import {
  boundaryAtOffset,
  createEditorStore,
  createIdAllocator,
  makeTextNode,
  pointAtOffset,
  type DocumentIndex,
  type EditorStore,
  type PanelHost,
} from "../../packages/editor/src";
import {
  buildCommandContext,
  registerBuiltInBlockTypes,
  type OverlaySurfaceContext,
  type ToolbarCapabilities,
} from "../../packages/editor/src/view/spi";
import { registerBuiltInNodeViews } from "../../packages/editor/src/view/nodes";
import { registerBuiltInMarks } from "../../packages/editor/src/view/render";
import {
  caretCommentHit,
  CommentAffordance,
  GlossaryPane,
  GlossaryReadCard,
  probeAnnotationMark,
  registerBuiltInCommands,
} from "../../packages/editor/src/view/chrome";
import { createDocumentIndexStore } from "../../packages/editor/src/view/controllers/document-index-store";
import { DocumentIndexProvider } from "../../packages/editor/src/view/document-index";

beforeAll(() => {
  registerBuiltInMarks();
  registerBuiltInBlockTypes();
  registerBuiltInNodeViews();
  registerBuiltInCommands();
});

function fakePanelHost(): PanelHost & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    close: () => calls.push("close"),
    open: (id, focusId) => calls.push(`open:${id}:${focusId ?? ""}`),
    toggle: (id, focusId) => calls.push(`toggle:${id}:${focusId ?? ""}`),
  };
}

const CAPS: ToolbarCapabilities = {
  ai: false,
  insertTable: true,
  media: false,
  review: false,
};

/** A store whose single block carries a glossary mark `gm1` referencing term `t1`. */
function glossaryMarkStore(): { store: EditorStore; nodeId: string } {
  const allocator = createIdAllocator("idco_client_anno");
  const content = allocator.createTextSlice("SPI here");
  const node = makeTextNode({
    content,
    id: allocator.createNodeId(),
    marks: [
      {
        attrs: { term: "t1" },
        from: boundaryAtOffset(content, 0, "before"),
        id: "gm1",
        kind: "glossary",
        to: boundaryAtOffset(content, 3, "after"),
      },
    ],
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
  store.command({
    collection: "glossary",
    items: [
      { definition: "Service Provider Interface", id: "t1", term: "SPI" },
    ],
    type: "set-collection",
  });
  return { nodeId: node.id, store };
}

/** Build the surface context the `mark.glossary` card receives, anchored at `gm1`. */
function cardContext(
  store: EditorStore,
  nodeId: string,
  panelHost: PanelHost,
  onDismiss: () => void,
): OverlaySurfaceContext {
  return {
    ...buildCommandContext(store, CAPS, panelHost),
    anchor: { kind: "mark", markId: "gm1", nodeId: nodeId as never },
    dismiss: onDismiss,
    focusEditor: () => {},
    pop: () => {},
    push: () => {},
  };
}

describe("probeAnnotationMark + GlossaryReadCard (docs/029 R1-G)", () => {
  it("probes a clicked glossary mark into its { kind, markId, nodeId }", () => {
    // The `<abbr>` carries the mark id + term and sits under a text-leaf, exactly as
    // mark-render paints it; comments are not claimed here (caret affordance owns them).
    const leaf = document.createElement("span");
    leaf.setAttribute("data-engine-text-id", "n1");
    const abbr = document.createElement("abbr");
    abbr.setAttribute("data-engine-mark", "glossary");
    abbr.setAttribute("data-engine-mark-id", "gm1");
    abbr.setAttribute("data-engine-glossary-term", "t1");
    leaf.appendChild(abbr);
    expect(probeAnnotationMark(abbr)).toEqual({
      kind: "glossary",
      markId: "gm1",
      nodeId: "n1",
    });
  });

  it("returns null for a click off any glossary mark", () => {
    const plain = document.createElement("button");
    expect(probeAnnotationMark(plain)).toBeNull();
  });

  it("reads the definition off the anchored mark and routes to the Glossary pane", () => {
    const host = fakePanelHost();
    const { store, nodeId } = glossaryMarkStore();
    const dismissed: string[] = [];
    const ctx = cardContext(store, nodeId, host, () => dismissed.push("x"));
    const { getByText } = render(<GlossaryReadCard ctx={ctx} />);
    expect(getByText("Service Provider Interface")).toBeTruthy();
    fireEvent.click(getByText("Open in Glossary"));
    expect(host.calls).toEqual(["open:glossary:t1"]);
    expect(dismissed).toEqual(["x"]);
  });
});

/** A store whose only block has a comment mark over [0,5) on the thread "c1". */
function commentStore(caret: number): EditorStore {
  const allocator = createIdAllocator("idco_client_comment_aff");
  const content = allocator.createTextSlice("alpha beta");
  const node = makeTextNode({
    content,
    id: allocator.createNodeId(),
    marks: [
      {
        attrs: {
          snapshot: { author: "R", excerpt: "alpha", resolved: false },
          thread: "c1",
        },
        from: boundaryAtOffset(content, 0, "before"),
        id: "cm1",
        kind: "comment",
        to: boundaryAtOffset(content, 5, "after"),
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
  store.dispatch({
    origin: "local",
    selectionAfter: {
      anchor: pointAtOffset(node.id, content, caret),
      focus: pointAtOffset(node.id, content, caret),
      type: "text",
    },
    steps: [],
  });
  return store;
}

describe("comment caret affordance (docs/027 §16 P6)", () => {
  it("detects a comment under a collapsed caret, not outside it", () => {
    expect(caretCommentHit(commentStore(2))).toEqual({
      markId: "cm1",
      threadId: "c1",
    });
    expect(caretCommentHit(commentStore(8))).toBeNull();
  });

  it("routes straight to the dock when the chip is clicked (no popover)", () => {
    const host = fakePanelHost();
    const store = commentStore(2);
    // The affordance anchors to the comment's highlight span; render one so the DOM
    // lookup resolves (jsdom returns a zero rect, which still renders the chip). In
    // the real editor the span pre-exists and `useStoreVersion` re-renders the
    // affordance over it; here a second render makes the sibling span present first.
    const tree = () => (
      <div>
        <span data-engine-mark="comment" data-engine-mark-id="cm1">
          alpha
        </span>
        <CommentAffordance panelHost={host} store={store} />
      </div>
    );
    // A fresh element each render so React does not bail out on identical-element
    // identity; the second pass sees the now-committed sibling span.
    const { container, rerender } = render(tree());
    rerender(tree());
    const chip = container.querySelector<HTMLElement>(
      "[data-engine-comment-affordance] button",
    );
    expect(chip).not.toBeNull();
    fireEvent.click(chip!);
    expect(host.calls).toEqual(["open:comments:c1"]);
  });
});

describe("pane focus reveal (docs/027 §16 P6)", () => {
  it("rings the routed-to glossary term row", () => {
    const index: DocumentIndex = {
      collections: {
        glossary: [{ definition: "d", id: "t1", term: "Alpha" }],
      },
      comments: [],
      text: [],
      toc: [],
    };
    const allocator = createIdAllocator("idco_client_anno_pane");
    const node = makeTextNode({
      content: allocator.createTextSlice("x"),
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
    const { container } = render(
      <DocumentIndexProvider store={createDocumentIndexStore(index)}>
        <GlossaryPane focusId="t1" reveal={() => {}} store={store} />
      </DocumentIndexProvider>,
    );
    const row = container.querySelector('[data-focus-key="t1"]');
    expect(row).not.toBeNull();
    expect(row!.className).toContain("ring-primary");
  });
});
