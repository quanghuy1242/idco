// @vitest-environment jsdom

/**
 * docs/010 Phase 5 — block virtualization, jsdom slice.
 *
 * jsdom has no layout engine, so pixel ACs (drift, scroll-to-block, first
 * paint) live in the Playwright spec. What is provable headlessly is the
 * windowing contract and that the model-backed clipboard serialization spans
 * blocks the window never mounts at once.
 */
import { act, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import {
  OwnedModelEditorView,
  createEditorStore,
  createEngineScheduler,
  createIdAllocator,
  makeObjectNode,
  makeStructuralNode,
  makeTextNode,
  type EditorDocumentSnapshot,
  type EditorNode,
  type NodeId,
  type OwnedModelEditorViewHandle,
  type TextLeafNode,
} from "../../packages/editor/src";

const VIEWPORT = 480;
const OVERSCAN = 4;
const ESTIMATE = 40;

function createStore(blockCount: number) {
  const allocator = createIdAllocator("idco_client_virt_test");
  const nodes: TextLeafNode[] = Array.from(
    { length: blockCount },
    (_v, index) =>
      makeTextNode({
        content: allocator.createTextSlice(`block-${index}`),
        id: allocator.createNodeId(),
      }),
  );
  const snapshot: EditorDocumentSnapshot = {
    body: {
      blocks: Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<
        NodeId,
        TextLeafNode
      >,
      order: nodes.map((n) => n.id),
    },
    settings: {},
    version: 1,
  };
  return { nodes, store: createEditorStore({ allocator, snapshot }) };
}

describe("owned-model block virtualization", () => {
  it("mounts only the viewport window plus overscan, not the whole document", () => {
    const { store } = createStore(400);
    const scheduler = createEngineScheduler({ publishDashboard: false });
    const ref = createRef<OwnedModelEditorViewHandle>();
    act(() => {
      render(
        <OwnedModelEditorView
          forcePolyfill
          overscan={OVERSCAN}
          ref={ref}
          scheduler={scheduler}
          store={store}
          viewportHeight={VIEWPORT}
        />,
      );
    });
    const diag = ref.current!.diagnostics();
    // With the estimate fallback (jsdom cannot measure), the window is
    // ceil(viewport / estimate) visible blocks plus 2 * overscan.
    const maxMounted = Math.ceil(VIEWPORT / ESTIMATE) + 2 * OVERSCAN;
    expect(diag.virtualized).toBe(true);
    expect(diag.mountedCount).toBeGreaterThan(0);
    expect(diag.mountedCount).toBeLessThanOrEqual(maxMounted);
    expect(diag.mountedCount).toBeLessThan(400);
    expect(diag.order).toHaveLength(400);
  });

  it("serializes a selection that spans unmounted blocks", () => {
    const { nodes, store } = createStore(400);
    const scheduler = createEngineScheduler({ publishDashboard: false });
    const ref = createRef<OwnedModelEditorViewHandle>();
    act(() => {
      render(
        <OwnedModelEditorView
          forcePolyfill
          overscan={OVERSCAN}
          ref={ref}
          scheduler={scheduler}
          store={store}
          viewportHeight={VIEWPORT}
        />,
      );
    });

    const start = nodes[2]!;
    const end = nodes[300]!;
    act(() => {
      ref.current!.selectText(start.id, 0, end.id, end.content.text.length);
    });

    const diag = ref.current!.diagnostics();
    // block-300 is far outside the mounted window.
    expect(diag.windowEnd).toBeLessThan(300);
    const serialized = ref.current!.serializeSelection();
    expect(serialized.startsWith("block-2")).toBe(true);
    expect(serialized.endsWith("block-300")).toBe(true);
    expect(serialized).toContain("block-150");
  });

  it("does not crash painting a selection whose span crosses non-text blocks", () => {
    // docs/011 §8.5: the overlay clips to mounted text leaves. A selection
    // spanning a structural or object top-level block must skip it, not throw.
    const allocator = createIdAllocator("idco_client_mixed");
    const first = makeTextNode({
      content: allocator.createTextSlice("first"),
      id: allocator.createNodeId(),
    });
    const list = makeStructuralNode({
      children: [],
      id: allocator.createNodeId(),
      type: "list",
    });
    const object = makeObjectNode({
      data: { code: "x" },
      id: allocator.createNodeId(),
      status: "ready",
      type: "code-block",
    });
    const last = makeTextNode({
      content: allocator.createTextSlice("last"),
      id: allocator.createNodeId(),
    });
    const nodes: EditorNode[] = [first, list, object, last];
    const snapshot: EditorDocumentSnapshot = {
      body: {
        blocks: Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<
          NodeId,
          EditorNode
        >,
        order: nodes.map((n) => n.id),
      },
      settings: {},
      version: 1,
    };
    const store = createEditorStore({ allocator, snapshot });
    const scheduler = createEngineScheduler({ publishDashboard: false });
    const ref = createRef<OwnedModelEditorViewHandle>();
    act(() => {
      render(
        <OwnedModelEditorView
          forcePolyfill
          ref={ref}
          scheduler={scheduler}
          store={store}
          virtualize={false}
        />,
      );
    });
    expect(() => {
      act(() => {
        ref.current!.selectText(first.id, 0, last.id, 4);
      });
    }).not.toThrow();
    expect(ref.current!.serializeSelection()).toBe("first\nlast");
  });

  it("re-measures the selection overlay on a virtualized scroll without looping (backlog §3, defect 2)", async () => {
    // The overlay now measures its rects in a POST-COMMIT layout effect, not the
    // render phase, so a scroll-driven window shift repaints the caret against the
    // just-committed geometry instead of the previous frame's. jsdom has no layout
    // (pixel-gluing lives in the Playwright spec), but this proves the wiring: the
    // caret still paints under virtualization, a scroll re-runs the measurement,
    // and the no-dependency layout effect converges instead of spinning.
    const { nodes, store } = createStore(400);
    const scheduler = createEngineScheduler({ publishDashboard: false });
    const ref = createRef<OwnedModelEditorViewHandle>();
    act(() => {
      render(
        <OwnedModelEditorView
          forcePolyfill
          overscan={OVERSCAN}
          ref={ref}
          scheduler={scheduler}
          store={store}
          viewportHeight={VIEWPORT}
        />,
      );
    });

    const target = nodes[1]!;
    store.activateTextLeaf(target.id);
    await act(async () => {
      (
        document.querySelector(
          `[data-engine-block-id="${target.id}"]`,
        ) as HTMLElement | null
      )?.focus();
    });
    // The post-commit layout effect paints the caret rect for the focused leaf.
    await waitFor(() => {
      expect(ref.current!.diagnostics().selectionRectCount).toBeGreaterThan(0);
    });

    const before = ref.current!.diagnostics().selectionOverlayRenderCount;
    const root = document.querySelector(
      "[data-engine-view-root]",
    ) as HTMLElement;
    await act(async () => {
      root.scrollTop = 120;
      root.dispatchEvent(new Event("scroll"));
    });
    // The overlay re-measured on the scroll frame (its render count advanced) and
    // the test reaches here — the layout effect settled rather than looping.
    await waitFor(() => {
      expect(
        ref.current!.diagnostics().selectionOverlayRenderCount,
      ).toBeGreaterThan(before);
    });
  });

  it("keeps mounting every block when virtualization is disabled", () => {
    const { store } = createStore(120);
    const scheduler = createEngineScheduler({ publishDashboard: false });
    const ref = createRef<OwnedModelEditorViewHandle>();
    act(() => {
      render(
        <OwnedModelEditorView
          forcePolyfill
          ref={ref}
          scheduler={scheduler}
          store={store}
          virtualize={false}
        />,
      );
    });
    const diag = ref.current!.diagnostics();
    expect(diag.virtualized).toBe(false);
    expect(diag.mountedCount).toBe(120);
  });
});
