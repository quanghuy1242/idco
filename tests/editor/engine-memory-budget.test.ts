/**
 * Memory budget arbiter + history pool (docs/030 §7.6 Stage three, SLP-4).
 *
 * The full skeleton/body viewport paging and lazy load are the deferred "larger, later"
 * memory project (§7.6 / §1). What ships here and is tested:
 *
 * - the **history pool** caps the undo stacks by depth/bytes — `overflow: "drop"` stops
 *   undo cleanly at the cap (lossy by design), `overflow: "cold-store"` pages the deepest
 *   undo out and faults it back so a deep undo still applies;
 * - the **memory arbiter** caps the summed bytes of its pools and rebalances under
 *   pressure by evicting the *heaviest* pool first (a scroll-heavy vs edit-heavy workload),
 *   leaving idle pools alone;
 * - the store wires both together: under a finite `memoryBudget`, a long edit session keeps
 *   history bounded automatically.
 */
import { describe, expect, it } from "vitest";
import {
  HistoryPool,
  MemoryArbiter,
  createEditorStore,
  createIdAllocator,
  makeTextNode,
  type CommittedTransaction,
  type EditorDocumentSnapshot,
  type EditorNode,
  type MemoryPool,
  type NodeId,
} from "../../packages/editor/src/core";

const CLIENT = "idco_client_membudget";

function singleNodeStore(text: string) {
  const allocator = createIdAllocator(CLIENT);
  const node = makeTextNode({
    content: allocator.createTextSlice(text),
    id: allocator.createNodeId(),
  });
  const snap: EditorDocumentSnapshot = {
    body: {
      blocks: { [node.id]: node } as Record<NodeId, EditorNode>,
      order: [node.id],
    },
    settings: {},
    version: 1,
  };
  return { node, snap };
}

function structuralEntry(id: string): CommittedTransaction {
  // A non-text step never coalesces, so each `record` pushes a distinct entry.
  return {
    inverse: [],
    origin: "local",
    selectionAfter: null,
    selectionBefore: null,
    settingsChanged: false,
    steps: [
      {
        from: "paragraph",
        node: id as NodeId,
        to: "heading",
        type: "set-node-type",
      },
    ],
    structureChanged: false,
    touched: new Set<NodeId>([id as NodeId]),
  };
}

function fakePool(name: string, initial: number) {
  let bytes = initial;
  const pool: MemoryPool = {
    name,
    estimateBytes: () => bytes,
    evict: (target) => {
      const before = bytes;
      bytes = Math.min(bytes, Math.max(0, target));
      return before - bytes;
    },
  };
  return { grow: (n: number) => (bytes += n), pool };
}

describe("history pool (SLP-4)", () => {
  it("drops the deepest undo past maxDepth and stops undo cleanly at the cap", () => {
    const pool = new HistoryPool({ maxDepth: 2, overflow: "drop" });
    for (let i = 0; i < 4; i += 1) pool.record(structuralEntry(`n${i}`));
    expect(pool.undoDepth).toBe(2);
    expect(pool.coldDepth).toBe(0);

    expect(pool.takeUndo()).not.toBeNull();
    expect(pool.takeUndo()).not.toBeNull();
    // The two oldest were dropped, so undo stops cleanly — no error, just null.
    expect(pool.takeUndo()).toBeNull();
    expect(pool.canUndo).toBe(false);
  });

  it("cold-stores the deepest undo and faults it back on a deep undo", () => {
    const pool = new HistoryPool({ maxDepth: 2, overflow: "cold-store" });
    for (let i = 0; i < 4; i += 1) pool.record(structuralEntry(`n${i}`));
    expect(pool.undoDepth).toBe(2);
    expect(pool.coldDepth).toBe(2);
    expect(pool.canUndo).toBe(true);

    // All four remain reachable: two resident, two faulted back from the cold tier.
    let reached = 0;
    while (pool.takeUndo()) reached += 1;
    expect(reached).toBe(4);
  });

  it("redoes correctly after a deep cold-store undo (re-enforces the budget)", () => {
    const pool = new HistoryPool({ maxDepth: 2, overflow: "cold-store" });
    for (let i = 0; i < 4; i += 1) pool.record(structuralEntry(`n${i}`));

    // Undo all four (faulting two back from cold), then redo all four. pushDone re-enforces
    // the depth cap, so the cold tier refills as redo pushes past it — every step reachable.
    let undone = 0;
    let entry = pool.takeUndo();
    while (entry) {
      undone += 1;
      pool.pushUndone(entry);
      entry = pool.takeUndo();
    }
    expect(undone).toBe(4);

    let redone = 0;
    let redo = pool.takeRedo();
    while (redo) {
      pool.pushDone(redo);
      redone += 1;
      redo = pool.takeRedo();
    }
    expect(redone).toBe(4);
    // After redoing everything the full undo history is reachable again.
    let reachable = 0;
    while (pool.takeUndo()) reachable += 1;
    expect(reachable).toBe(4);
  });

  it("accounts resident bytes and evicts toward a target (MemoryPool)", () => {
    const pool = new HistoryPool();
    for (let i = 0; i < 5; i += 1) pool.record(structuralEntry(`n${i}`));
    const total = pool.estimateBytes();
    expect(total).toBeGreaterThan(0);

    const freed = pool.evict(0);
    expect(freed).toBe(total);
    expect(pool.estimateBytes()).toBe(0);
  });
});

describe("memory arbiter (SLP-4)", () => {
  it("is inert when unbounded", () => {
    const arbiter = new MemoryArbiter();
    const big = fakePool("bodies", 10_000);
    arbiter.register(big.pool);
    expect(arbiter.rebalance()).toBe(0);
    expect(arbiter.totalBytes()).toBe(10_000);
  });

  it("evicts the heaviest pool first, leaving idle pools alone", () => {
    const arbiter = new MemoryArbiter({
      budgetBytes: 1000,
      highWater: 1,
      lowWater: 0.8,
    });
    const bodies = fakePool("bodies", 900);
    const history = fakePool("history", 50);
    arbiter.register(bodies.pool);
    arbiter.register(history.pool);
    // Under budget → no eviction.
    expect(arbiter.rebalance()).toBe(0);

    // Scroll-heavy: bodies overshoots. The arbiter sheds bodies down to the low-water
    // target and never touches the small, idle history pool.
    bodies.grow(300);
    arbiter.rebalance();
    expect(arbiter.totalBytes()).toBeLessThanOrEqual(800);
    expect(history.pool.estimateBytes()).toBe(50);
  });

  it("shifts eviction to history under an edit-heavy workload", () => {
    const arbiter = new MemoryArbiter({
      budgetBytes: 1000,
      highWater: 1,
      lowWater: 0.8,
    });
    const bodies = fakePool("bodies", 50);
    const history = fakePool("history", 900);
    arbiter.register(bodies.pool);
    arbiter.register(history.pool);

    history.grow(300);
    arbiter.rebalance();
    expect(arbiter.totalBytes()).toBeLessThanOrEqual(800);
    expect(bodies.pool.estimateBytes()).toBe(50);
  });
});

describe("store-integrated history budget (SLP-4)", () => {
  it("stops undo at the configured depth with overflow drop", () => {
    const { node, snap } = singleNodeStore("");
    const store = createEditorStore({
      allocator: createIdAllocator(`${CLIENT}_drop`),
      history: { maxDepth: 3, overflow: "drop" },
      snapshot: snap,
    });

    let length = 0;
    for (const ch of ["a", "b", "c", "d", "e"]) {
      store.breakUndoCoalescing();
      store.dispatch(
        store.transaction().replaceText({
          at: length,
          inserted: ch,
          node: node.id,
          removed: "",
        }),
      );
      length += 1;
    }
    expect(store.requireTextNode(node.id).content.text).toBe("abcde");

    let undos = 0;
    while (store.canUndo) {
      store.undo();
      undos += 1;
    }
    // Only the 3 most-recent edits are reachable; the oldest 2 were dropped, so the
    // document does not return all the way to its seed.
    expect(undos).toBe(3);
    expect(store.requireTextNode(node.id).content.text).toBe("ab");
  });

  it("keeps deep undo with overflow cold-store", () => {
    const { node, snap } = singleNodeStore("");
    const store = createEditorStore({
      allocator: createIdAllocator(`${CLIENT}_cold`),
      history: { maxDepth: 3, overflow: "cold-store" },
      snapshot: snap,
    });

    let length = 0;
    for (const ch of ["a", "b", "c", "d", "e"]) {
      store.breakUndoCoalescing();
      store.dispatch(
        store.transaction().replaceText({
          at: length,
          inserted: ch,
          node: node.id,
          removed: "",
        }),
      );
      length += 1;
    }

    let undos = 0;
    while (store.canUndo) {
      store.undo();
      undos += 1;
    }
    expect(undos).toBe(5);
    expect(store.requireTextNode(node.id).content.text).toBe("");
  });

  it("keeps history bounded under a finite memoryBudget", () => {
    const { node, snap } = singleNodeStore("");
    const store = createEditorStore({
      allocator: createIdAllocator(`${CLIENT}_budget`),
      memoryBudget: { budgetBytes: 200, highWater: 1, lowWater: 0.8 },
      snapshot: snap,
    });

    let length = 0;
    for (let i = 0; i < 40; i += 1) {
      store.breakUndoCoalescing();
      store.dispatch(
        store.transaction().replaceText({
          at: length,
          inserted: "x",
          node: node.id,
          removed: "",
        }),
      );
      length += 1;
    }
    // The arbiter rebalances after every commit, so resident history never runs away.
    expect(store.memoryArbiter.totalBytes()).toBeLessThanOrEqual(200);
  });
});
