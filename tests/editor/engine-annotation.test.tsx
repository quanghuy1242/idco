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
import { registerBuiltInBlockTypes } from "../../packages/editor/src/view/spi";
import { registerBuiltInNodeViews } from "../../packages/editor/src/view/nodes";
import { registerBuiltInMarks } from "../../packages/editor/src/view/render";
import {
  AnnotationPopover,
  caretCommentHit,
  CommentAffordance,
  GlossaryPane,
  registerBuiltInCommands,
  useAnnotationInteraction,
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

function glossaryStore(): EditorStore {
  const allocator = createIdAllocator("idco_client_anno");
  const node = makeTextNode({
    content: allocator.createTextSlice("SPI here"),
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
  store.command({
    collection: "glossary",
    items: [
      { definition: "Service Provider Interface", id: "t1", term: "SPI" },
    ],
    type: "set-collection",
  });
  return store;
}

/** A harness that wires the hook to clickable mark elements + the popover. */
function Harness(props: {
  readonly store: EditorStore;
  readonly panelHost: PanelHost;
}) {
  const interaction = useAnnotationInteraction();
  return (
    <div>
      <span data-engine-mark="comment" data-engine-comment-thread="c1">
        <abbr
          data-engine-glossary-term="t1"
          data-engine-mark="glossary"
          data-testid="nested"
          onClick={(event) => interaction.openAt(event.currentTarget)}
        >
          SPI
        </abbr>
      </span>
      <AnnotationPopover
        interaction={interaction}
        panelHost={props.panelHost}
        store={props.store}
      />
    </div>
  );
}

describe("useAnnotationInteraction + AnnotationPopover (docs/027 §16 P6)", () => {
  it("reads a glossary definition and routes to the Glossary pane with a focusId", () => {
    const host = fakePanelHost();
    const { getByTestId, getByText } = render(
      <Harness panelHost={host} store={glossaryStore()} />,
    );
    // Clicking the nested abbr: glossary (innermost) wins over the enclosing comment.
    fireEvent.click(getByTestId("nested"));
    expect(getByText("Service Provider Interface")).toBeTruthy();
    fireEvent.click(getByText("Open in Glossary"));
    expect(host.calls).toEqual(["open:glossary:t1"]);
  });

  it("opens nothing for a click off any annotation mark", () => {
    const interactionResult = { value: true };
    function Probe() {
      const interaction = useAnnotationInteraction();
      return (
        <button
          onClick={(event) => {
            interactionResult.value = interaction.openAt(event.currentTarget);
          }}
          type="button"
        >
          plain
        </button>
      );
    }
    const { getByText } = render(<Probe />);
    fireEvent.click(getByText("plain"));
    expect(interactionResult.value).toBe(false);
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
