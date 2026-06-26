/**
 * Incremental save (docs/030 §7.4 D4, SLP-1).
 *
 * `toSnapshot()` no longer rebuilds the whole block map every save; it maintains
 * `body.blocks` incrementally from the per-dispatch `touched` set (plus insert/remove
 * subtree descendants). These tests pin the two properties that make that safe:
 *
 * - **Parity**: the maintained map is byte-for-byte the full rebuild across inserts,
 *   removes, moves, undo, and redo (`assertIncrementalSnapshotParity` throws on any drift).
 * - **Copy-on-write**: a snapshot already handed to a caller is never mutated by a later
 *   edit, and a single text edit re-emits only the touched key while every sibling keeps
 *   referential identity (the structural-sharing the incremental map promises).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  createEditorStore,
  createIdAllocator,
  createTextMark,
  makeStructuralNode,
  makeTextNode,
  resetDevInvariants,
  setDevInvariants,
  type EditorDocumentSnapshot,
  type EditorNode,
  type NodeId,
} from "../../packages/editor/src/core";

const CLIENT = "idco_client_incremental";

function snapshot(nodes: readonly EditorNode[]): EditorDocumentSnapshot {
  return {
    body: {
      blocks: Object.fromEntries(
        nodes.map((node) => [node.id, node]),
      ) as Record<NodeId, EditorNode>,
      order: nodes.map((node) => node.id),
    },
    settings: {},
    version: 1,
  };
}

describe("incremental save (SLP-1)", () => {
  afterEach(() => {
    resetDevInvariants();
  });

  it("returns the maintained map directly on the production path (no parity rebuild)", () => {
    // With invariants off, `toSnapshot()` skips the dev parity-check/repair branch and
    // returns the maintained `#snapshotBlocks` straight. Prove it is still byte-identical to
    // a fresh full rebuild after a real edit — the production return wiring, not just the
    // dev oracle. Build the input unfrozen so identity comparisons are meaningful.
    setDevInvariants(false);
    const allocator = createIdAllocator(`${CLIENT}_prod`);
    const a = makeTextNode({
      content: allocator.createTextSlice("alpha"),
      id: allocator.createNodeId(),
    });
    const b = makeTextNode({
      content: allocator.createTextSlice("beta"),
      id: allocator.createNodeId(),
    });
    const store = createEditorStore({ allocator, snapshot: snapshot([a, b]) });
    store.dispatch(
      store
        .transaction()
        .replaceText({ at: 0, inserted: "Z", node: a.id, removed: "" }),
    );

    const blocks = store.toSnapshot().body.blocks;
    // The maintained map holds the exact same node references the store holds (identity),
    // which is the parity invariant the dev oracle checks — here proven on the prod path.
    expect(blocks[a.id]).toBe(store.getNode(a.id));
    expect(blocks[b.id]).toBe(store.getNode(b.id));
    expect(Object.keys(blocks).sort()).toEqual([a.id, b.id].sort());
  });

  it("stays byte-identical to a full rebuild across edits, structure, and undo/redo", () => {
    const allocator = createIdAllocator(CLIENT);
    const a = makeTextNode({
      content: allocator.createTextSlice("alpha"),
      id: allocator.createNodeId(),
    });
    const b = makeTextNode({
      content: allocator.createTextSlice("beta"),
      id: allocator.createNodeId(),
    });
    const store = createEditorStore({ allocator, snapshot: snapshot([a, b]) });
    store.assertIncrementalSnapshotParity();

    // Text edit.
    store.dispatch(
      store
        .transaction()
        .replaceText({ at: 1, inserted: "!", node: a.id, removed: "" }),
    );
    store.assertIncrementalSnapshotParity();

    // Mark add.
    const liveA = store.requireTextNode(a.id);
    store.dispatch(
      store.transaction().addMark(
        a.id,
        createTextMark({
          from: 0,
          id: "m-1",
          kind: "bold",
          node: liveA,
          to: 2,
        }),
      ),
    );
    store.assertIncrementalSnapshotParity();

    // Type change.
    store.dispatch({
      origin: "local",
      steps: [
        { from: "paragraph", node: b.id, to: "heading", type: "set-node-type" },
      ],
    });
    store.assertIncrementalSnapshotParity();

    // Subtree insert: a structural list holding an inner text leaf (descendant).
    const childId = allocator.createNodeId();
    const child = makeTextNode({
      content: allocator.createTextSlice("inner"),
      id: childId,
      type: "listitem",
    });
    const containerId = allocator.createNodeId();
    const container = makeStructuralNode({
      children: [childId],
      id: containerId,
      type: "list",
    });
    store.dispatch({
      origin: "local",
      steps: [
        {
          descendants: [child],
          index: store.order.length,
          node: container,
          parent: store.bodyId,
          type: "insert-node",
        },
      ],
    });
    store.assertIncrementalSnapshotParity();
    expect(store.toSnapshot().body.blocks[childId]).toBeDefined();

    // Move the container to the front.
    store.dispatch({
      origin: "local",
      steps: [
        {
          from: {
            index: store.order.indexOf(containerId),
            parent: store.bodyId,
          },
          node: containerId,
          to: { index: 0, parent: store.bodyId },
          type: "move-node",
        },
      ],
    });
    store.assertIncrementalSnapshotParity();

    // Subtree remove: the whole list + its descendant leave the snapshot.
    const liveContainer = store.requireNode(containerId);
    store.dispatch({
      origin: "local",
      steps: [
        {
          index: store.order.indexOf(containerId),
          node: liveContainer,
          parent: store.bodyId,
          type: "remove-node",
        },
      ],
    });
    store.assertIncrementalSnapshotParity();
    expect(store.toSnapshot().body.blocks[childId]).toBeUndefined();

    // Undo everything, then redo everything; parity holds at every step.
    while (store.canUndo) {
      store.undo();
      store.assertIncrementalSnapshotParity();
    }
    while (store.canRedo) {
      store.redo();
      store.assertIncrementalSnapshotParity();
    }
    store.assertIncrementalSnapshotParity();
  });

  it("never mutates a snapshot it already returned (copy-on-write)", () => {
    const allocator = createIdAllocator(`${CLIENT}_cow`);
    const node = makeTextNode({
      content: allocator.createTextSlice("hello"),
      id: allocator.createNodeId(),
    });
    const store = createEditorStore({ allocator, snapshot: snapshot([node]) });

    const before = store.toSnapshot();
    const beforeClone = JSON.parse(
      JSON.stringify(before),
    ) as EditorDocumentSnapshot;

    store.dispatch(
      store
        .transaction()
        .replaceText({ at: 5, inserted: " world", node: node.id, removed: "" }),
    );

    // The previously returned object is unchanged despite the later edit.
    expect(before).toEqual(beforeClone);
    // The new snapshot reflects the edit.
    expect(store.toSnapshot().body.blocks[node.id]).not.toEqual(
      before.body.blocks[node.id],
    );
  });

  it("re-emits only the touched key and structurally shares the rest", () => {
    const allocator = createIdAllocator(`${CLIENT}_share`);
    const a = makeTextNode({
      content: allocator.createTextSlice("one"),
      id: allocator.createNodeId(),
    });
    const b = makeTextNode({
      content: allocator.createTextSlice("two"),
      id: allocator.createNodeId(),
    });
    const store = createEditorStore({ allocator, snapshot: snapshot([a, b]) });

    const before = store.toSnapshot();
    store.dispatch(
      store
        .transaction()
        .replaceText({ at: 0, inserted: "X", node: a.id, removed: "" }),
    );
    const after = store.toSnapshot();

    // The edited node is a fresh object; the untouched sibling keeps its identity.
    expect(after.body.blocks[a.id]).not.toBe(before.body.blocks[a.id]);
    expect(after.body.blocks[b.id]).toBe(before.body.blocks[b.id]);
  });
});
