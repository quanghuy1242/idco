// @vitest-environment jsdom
/**
 * Selection surface migration (docs/029 R1-D, P2). Proves the merged selection bar renders
 * through the overlay authority + layer: a non-collapsed selection raises one
 * `[data-engine-flyout]` bar carrying the merged clipboard (Copy) + format (Bold) commands,
 * a plain command is sticky (runs + keeps the bar), and the bar drops when the selection
 * collapses. The full mouse/keyboard/drill-in behavior is covered by the e2e flyout specs;
 * this is the fast jsdom regression for the projection + stickiness.
 */
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createEditorStore,
  createIdAllocator,
  makeTextNode,
  pointAtOffset,
  type EditorStore,
  type NodeId,
} from "../../packages/editor/src/core";
import {
  useOverlayAuthority,
  type OverlayAuthority,
  type ToolbarCapabilities,
} from "../../packages/editor/src/view/spi";
import {
  OverlayLayer,
  registerBuiltInCommands,
  registerBuiltInOverlays,
} from "../../packages/editor/src/view/chrome";
import { registerBuiltInMarks } from "../../packages/editor/src/view/render";
import { registerBuiltInBlockTypes } from "../../packages/editor/src/view/spi";
import { registerBuiltInNodeViews } from "../../packages/editor/src/view/nodes";

const CAPS: ToolbarCapabilities = {
  ai: false,
  insertTable: true,
  media: false,
  review: false,
};

function paragraphStore(text: string): { store: EditorStore; id: NodeId } {
  const allocator = createIdAllocator("idco_client_overlay_sel");
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

function selectRange(store: EditorStore, id: NodeId, from: number, to: number) {
  const node = store.requireTextNode(id);
  store.dispatch({
    origin: "local",
    selectionAfter: {
      anchor: pointAtOffset(id, node.content, from),
      focus: pointAtOffset(id, node.content, to),
      type: "text",
    },
    steps: [],
  });
}

function Harness(props: {
  readonly store: EditorStore;
  readonly blockId: NodeId;
  readonly authorityRef: { current: OverlayAuthority | null };
}) {
  const authority = useOverlayAuthority(props.store, CAPS, {
    focusEditor: () => {},
  });
  props.authorityRef.current = authority;
  return (
    <>
      {/* A stub block element so the `selection` anchor resolves to a (degenerate, jsdom
          zero) rect; in the real editor this is the mounted text block. */}
      <div data-engine-block-id={props.blockId} />
      <OverlayLayer authority={authority} store={props.store} />
    </>
  );
}

describe("selection surface merge (docs/029 R1-D)", () => {
  // Re-register every test: a sibling overlay suite clears the shared registry in its own
  // teardown, so registering here (not once globally) keeps these tests order-independent.
  beforeEach(() => {
    registerBuiltInMarks();
    registerBuiltInBlockTypes();
    registerBuiltInNodeViews();
    registerBuiltInCommands();
    registerBuiltInOverlays();
  });

  it("raises one merged selection bar (clipboard + format) on a selection, sticky on apply", async () => {
    const { store, id } = paragraphStore("hello world");
    const authorityRef: { current: OverlayAuthority | null } = {
      current: null,
    };
    render(<Harness authorityRef={authorityRef} blockId={id} store={store} />);

    act(() => selectRange(store, id, 0, 5));

    const flyout = await waitFor(() => {
      const el = document.querySelector("[data-engine-flyout]");
      if (!el) throw new Error("no flyout yet");
      return el as HTMLElement;
    });

    // The merge: the one bar carries clipboard (Copy) AND format (Bold).
    const bold = flyout.querySelector<HTMLElement>('[aria-label="Bold"]');
    const copy = flyout.querySelector<HTMLElement>('[aria-label="Copy"]');
    expect(bold).not.toBeNull();
    expect(copy).not.toBeNull();

    // Apply Bold — sticky: the bar stays and the mark is applied to the model range.
    act(() => bold!.click());
    expect(store.query({ mark: "bold", type: "is-mark-active" })).toBe(true);
    expect(document.querySelector("[data-engine-flyout]")).not.toBeNull();
  });

  it("drops the selection bar when the selection collapses", async () => {
    const { store, id } = paragraphStore("hello world");
    const authorityRef: { current: OverlayAuthority | null } = {
      current: null,
    };
    render(<Harness authorityRef={authorityRef} blockId={id} store={store} />);

    act(() => selectRange(store, id, 0, 5));
    await waitFor(() =>
      expect(document.querySelector("[data-engine-flyout]")).not.toBeNull(),
    );

    // Collapse the selection (caret): the transparent surface drops via reconcile.
    act(() => selectRange(store, id, 2, 2));
    await waitFor(() =>
      expect(document.querySelector("[data-engine-flyout]")).toBeNull(),
    );
  });
});
