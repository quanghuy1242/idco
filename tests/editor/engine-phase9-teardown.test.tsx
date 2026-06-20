// @vitest-environment jsdom
/**
 * docs/018 §2.9 — memory / teardown of unmounted blocks (docs/010 §10.5, Phase 5).
 *
 * Unmounting an offscreen block must release its subscriptions, so a long
 * top→bottom→top scroll of a large document leaves the live mounted window — and
 * the live per-node subscriber count — bounded, never grown toward the full
 * document. A leak (a block that fails to release its `subscribeNode`
 * registration on unmount) shows up here as unbounded growth.
 *
 * jsdom has no layout engine, so the sweep is driven through `scrollToBlock`
 * (which updates the window synchronously) rather than pixel scrolling; the
 * mount/unmount churn it exercises is the same one a real scroll produces.
 */
import { act, render } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import {
  OwnedModelEditorView,
  createEditorStore,
  createEngineScheduler,
  createIdAllocator,
  makeTextNode,
  type EditorDocumentSnapshot,
  type NodeId,
  type TextLeafNode,
  type OwnedModelEditorViewHandle,
} from "../../packages/editor/src";

const VIEWPORT = 480;
const OVERSCAN = 4;
const BLOCKS = 5000;

function createLargeStore(blockCount: number) {
  const allocator = createIdAllocator("idco_client_teardown");
  const nodes: TextLeafNode[] = Array.from({ length: blockCount }, (_v, i) =>
    makeTextNode({
      content: allocator.createTextSlice(`block-${i}`),
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

describe("§2.9 no unbounded growth over a long top→bottom→top scroll", () => {
  it("keeps the mounted window + live subscribers bounded across a 5,000-block sweep", () => {
    const { nodes, store } = createLargeStore(BLOCKS);
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

    const baselineMounted = ref.current!.diagnostics().mountedCount;
    const baselineSubs = store.debugNodeSubscriberCount();
    // Only the viewport window mounts to begin with — a fraction of 5,000.
    expect(baselineMounted).toBeLessThan(40);
    expect(baselineSubs).toBeLessThan(60);

    // Sweep the whole document top→bottom→top in coarse steps. Each jump mounts a
    // fresh window and must unmount the previous one.
    const sweep: number[] = [];
    for (let i = 0; i < BLOCKS; i += 200) sweep.push(i);
    for (let i = BLOCKS - 1; i >= 0; i -= 200) sweep.push(i);
    sweep.push(0);

    let peakMounted = baselineMounted;
    let peakSubs = baselineSubs;
    for (const index of sweep) {
      act(() => {
        ref.current!.scrollToBlock(nodes[index]!.id);
      });
      peakMounted = Math.max(
        peakMounted,
        ref.current!.diagnostics().mountedCount,
      );
      peakSubs = Math.max(peakSubs, store.debugNodeSubscriberCount());
    }

    // The window never balloons toward the full document during the sweep…
    expect(peakMounted).toBeLessThan(40);
    expect(peakSubs).toBeLessThan(80);

    // …and after returning to the top, both are back to ~baseline — nothing leaked.
    const finalMounted = ref.current!.diagnostics().mountedCount;
    const finalSubs = store.debugNodeSubscriberCount();
    expect(finalMounted).toBeLessThanOrEqual(baselineMounted + OVERSCAN);
    expect(finalSubs).toBeLessThanOrEqual(baselineSubs + OVERSCAN);
  });
});
