/**
 * Load in-place optimization (docs/030 §7.5 D5, SLP-2).
 *
 * The load path carried two whole-document dev-only tripwires paid in production: the
 * `freezeNode` deep-walk and the `assertParentInvariant` tree walk (the latter also fired
 * on every structural edit). Both are now gated behind the dev-invariant flag. These tests
 * prove the production path runs neither walk, while dev/test keeps both firing, and that
 * structural edits no longer re-run the invariant walk in production.
 *
 * This is the "pass-count" assertion §7.5 asks for: not a flaky wall-clock number, but
 * direct evidence that the O(n) passes are skipped when the flag is off.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ROOT_NODE_ID,
  createEditorStore,
  createIdAllocator,
  createTextMark,
  makeTextNode,
  resetDevInvariants,
  setDevInvariants,
  type EditorDocumentSnapshot,
  type EditorNode,
  type NodeId,
} from "../../packages/editor/src/core";
import { EditorStore } from "../../packages/editor/src/core/store";

const CLIENT = "idco_client_loadperf";

function bigSnapshot(
  allocator: ReturnType<typeof createIdAllocator>,
  count: number,
): {
  readonly snap: EditorDocumentSnapshot;
  readonly firstId: NodeId;
} {
  const nodes: EditorNode[] = [];
  for (let index = 0; index < count; index += 1) {
    nodes.push(
      makeTextNode({
        content: allocator.createTextSlice(`para ${index}`),
        id: allocator.createNodeId(),
      }),
    );
  }
  return {
    firstId: nodes[0]!.id,
    snap: {
      body: {
        blocks: Object.fromEntries(
          nodes.map((node) => [node.id, node]),
        ) as Record<NodeId, EditorNode>,
        order: nodes.map((node) => node.id),
      },
      settings: {},
      version: 1,
    },
  };
}

afterEach(() => {
  resetDevInvariants();
});

describe("load in-place optimization (SLP-2)", () => {
  it("skips the parent-invariant walk on load in production but runs it in dev", () => {
    const walk = vi.spyOn(EditorStore.prototype, "assertParentInvariant");

    // Build the input while invariants are off so the nodes are not pre-frozen.
    setDevInvariants(false);
    const { snap } = bigSnapshot(createIdAllocator(`${CLIENT}_prod`), 200);
    createEditorStore({
      allocator: createIdAllocator(`${CLIENT}_p2`),
      snapshot: snap,
    });
    expect(walk).not.toHaveBeenCalled();

    setDevInvariants(true);
    createEditorStore({
      allocator: createIdAllocator(`${CLIENT}_d2`),
      snapshot: snap,
    });
    expect(walk).toHaveBeenCalledTimes(1);

    walk.mockRestore();
  });

  it("freezes ingested nodes only when invariants are enabled", () => {
    // Inputs built unfrozen (invariants off) so the assertion measures what the *store*
    // does on ingest, not what `makeTextNode` did when the node was created.
    setDevInvariants(false);
    const allocator = createIdAllocator(`${CLIENT}_freeze`);
    const { snap, firstId } = bigSnapshot(allocator, 8);

    const prodStore = createEditorStore({
      allocator: createIdAllocator(`${CLIENT}_fp`),
      snapshot: snap,
    });
    expect(Object.isFrozen(prodStore.getNode(firstId))).toBe(false);

    setDevInvariants(true);
    const devStore = createEditorStore({
      allocator: createIdAllocator(`${CLIENT}_fd`),
      snapshot: snap,
    });
    expect(Object.isFrozen(devStore.getNode(firstId))).toBe(true);
  });

  it("does not re-run the invariant walk on structural edits in production", () => {
    setDevInvariants(false);
    const allocator = createIdAllocator(`${CLIENT}_edit`);
    const { snap } = bigSnapshot(allocator, 4);
    const store = createEditorStore({ allocator, snapshot: snap });
    const walk = vi.spyOn(store, "assertParentInvariant");

    const inserted = makeTextNode({
      content: allocator.createTextSlice("new"),
      id: allocator.createNodeId(),
    });
    store.dispatch({
      origin: "local",
      steps: [
        { index: 0, node: inserted, parent: ROOT_NODE_ID, type: "insert-node" },
      ],
    });
    expect(walk).not.toHaveBeenCalled();

    walk.mockRestore();
  });

  it("still re-runs the invariant walk on structural edits in dev", () => {
    setDevInvariants(true);
    const allocator = createIdAllocator(`${CLIENT}_editdev`);
    const { snap } = bigSnapshot(allocator, 4);
    const store = createEditorStore({ allocator, snapshot: snap });
    const walk = vi.spyOn(store, "assertParentInvariant");

    const inserted = makeTextNode({
      content: allocator.createTextSlice("new"),
      id: allocator.createNodeId(),
    });
    store.dispatch({
      origin: "local",
      steps: [
        { index: 0, node: inserted, parent: ROOT_NODE_ID, type: "insert-node" },
      ],
    });
    expect(walk).toHaveBeenCalledTimes(1);

    walk.mockRestore();
  });

  it("records a synthetic large-snapshot load benchmark (production vs dev)", () => {
    // docs/030 §7.5 / DoD: record load time on a synthetic 20k-node snapshot with marks
    // and decide whether async load is warranted. Build the input once with invariants
    // off so the nodes are unfrozen, then time the construction (the ingest + folded
    // parent-index pass) with the production gate off vs the dev gate on. Median of 3 runs
    // smooths jitter; the assertion proves the gating actually pays — production never
    // slower than dev — and the printed numbers are the recorded benchmark.
    const COUNT = 20_000;
    setDevInvariants(false);
    const builder = createIdAllocator(`${CLIENT}_bench_build`);
    const nodes: EditorNode[] = [];
    for (let index = 0; index < COUNT; index += 1) {
      const node = makeTextNode({
        content: builder.createTextSlice(
          `paragraph number ${index} with some body text`,
        ),
        id: builder.createNodeId(),
      });
      // One mark per node so the freeze deep-walk has marks/runs to traverse.
      nodes.push(
        makeTextNode({
          ...node,
          marks: [
            createTextMark({
              from: 0,
              id: `m_${index}`,
              kind: "bold",
              node,
              to: 5,
            }),
          ],
        }),
      );
    }
    const snap: EditorDocumentSnapshot = {
      body: {
        blocks: Object.fromEntries(
          nodes.map((node) => [node.id, node]),
        ) as Record<NodeId, EditorNode>,
        order: nodes.map((node) => node.id),
      },
      settings: {},
      version: 1,
    };

    const median = (enabled: boolean): number => {
      const samples: number[] = [];
      for (let run = 0; run < 3; run += 1) {
        // Rebuild from the same (unfrozen) input each run; dev runs will freeze the shared
        // node objects in place, which is fine — only construction time is measured.
        setDevInvariants(enabled);
        const start = performance.now();
        createEditorStore({
          allocator: createIdAllocator(`${CLIENT}_bench_${enabled}_${run}`),
          snapshot: snap,
        });
        samples.push(performance.now() - start);
      }
      return samples.sort((a, b) => a - b)[1]!;
    };

    // Measure production first so the dev freeze does not mutate the input before the prod
    // pass reads it unfrozen.
    const prodMs = median(false);
    const devMs = median(true);
    // eslint-disable-next-line no-console
    console.info(
      `[SLP-2 load benchmark] ${COUNT} nodes — production ${prodMs.toFixed(1)}ms, dev ${devMs.toFixed(1)}ms`,
    );
    // Gating the tripwires out makes the production load no slower than dev (a small margin
    // absorbs timer noise). The win is the recorded justification for not building async
    // load yet (§7.5: "if it builds inside a frame budget, the load conversation is over").
    expect(prodMs).toBeLessThanOrEqual(devMs * 1.1);
  });
});
