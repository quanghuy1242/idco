// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import {
  OwnedModelEditorView,
  createEditorStore,
  createEngineScheduler,
  createIdAllocator,
  makeTextNode,
  pointAtOffset,
  replaceTextContent,
  sliceTextContent,
  type EditorDocumentSnapshot,
  type NodeId,
  type OwnedModelEditorViewHandle,
  type TextLeafNode,
} from "../../packages/editor/src";

describe("owned-model React view", () => {
  it("renders the store through useSyncExternalStore and isolates text edits to one block plus the overlay", async () => {
    const { store, nodes } = createStore(["alpha", "bravo", "charlie"]);
    const scheduler = createEngineScheduler({ publishDashboard: false });
    const ref = createRef<OwnedModelEditorViewHandle>();
    render(
      <OwnedModelEditorView
        forcePolyfill
        ref={ref}
        scheduler={scheduler}
        store={store}
        virtualize={false}
      />,
    );
    const before = ref.current!.diagnostics();
    expect(before.mountedCount).toBe(3);

    const target = nodes[1]!;
    store.activateTextLeaf(target.id);
    const inserted = store.allocator.createTextSlice("!");
    const nextContent = replaceTextContent(target.content, 2, 0, inserted);
    await act(async () => {
      // Model the input controller's fast path: it patches the leaf's DOM text
      // itself, then signals the store that the commit may skip re-rendering it.
      store.markActiveLeafDomSynced();
      store.dispatch({
        origin: "local",
        selectionAfter: {
          anchor: pointAtOffset(target.id, nextContent, 3),
          focus: pointAtOffset(target.id, nextContent, 3),
          type: "text",
        },
        steps: [
          {
            at: 2,
            inserted,
            node: target.id,
            removed: sliceTextContent(target.content, 2, 2),
            type: "replace-text",
          },
        ],
      });
    });

    await waitFor(() => {
      expect(
        ref.current!.diagnostics().selectionOverlayRenderCount,
      ).toBeGreaterThan(before.selectionOverlayRenderCount);
    });
    const after = ref.current!.diagnostics();
    expect(after.blockTexts[target.id]).toBe("br!avo");
    expect(after.renderCounts[nodes[0]!.id]).toBe(
      before.renderCounts[nodes[0]!.id],
    );
    expect(after.renderCounts[target.id]).toBe(before.renderCounts[target.id]);
    expect(after.renderCounts[nodes[2]!.id]).toBe(
      before.renderCounts[nodes[2]!.id],
    );
    expect(after.selectionRectCount).toBeGreaterThan(0);
    expect(after.scheduler.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "engine-selection-overlay",
          lane: "frame",
          runs: expect.any(Number),
        }),
      ]),
    );

    await act(async () => {
      store.deactivateTextLeaf(target.id);
    });
    await waitFor(() => {
      expect(screen.getByText("br!avo")).toBeInTheDocument();
    });
  });

  it("coalesces engine frame work and reports it through the perf dashboard", () => {
    const scheduler = createEngineScheduler({ publishDashboard: false });
    const seen: number[] = [];
    const task = scheduler.createTask<{ readonly value: number }>(
      {
        cost: "test task",
        frequency: "test",
        label: "engine-test-frame-task",
        lane: "frame",
        priority: "normal",
      },
      (payload) => {
        seen.push(payload.value);
      },
    );

    task.schedule({ value: 1 });
    task.schedule({ value: 2 });
    scheduler.flushAll();

    expect(seen).toEqual([2]);
    expect(scheduler.snapshot().tasks).toContainEqual(
      expect.objectContaining({
        coalescedUpdates: 1,
        label: "engine-test-frame-task",
        lane: "frame",
        runs: 1,
      }),
    );
  });
});

function createStore(texts: readonly string[]) {
  const allocator = createIdAllocator("idco_client_engine_view_test");
  const nodes = texts.map((text) =>
    makeTextNode({
      content: allocator.createTextSlice(text),
      id: allocator.createNodeId(),
    }),
  );
  const snapshot: EditorDocumentSnapshot = {
    body: {
      blocks: Object.fromEntries(
        nodes.map((node) => [node.id, node]),
      ) as Record<NodeId, TextLeafNode>,
      order: nodes.map((node) => node.id),
    },
    settings: {},
    version: 1,
  };
  return { nodes, store: createEditorStore({ allocator, snapshot }) };
}
