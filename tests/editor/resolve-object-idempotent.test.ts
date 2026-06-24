/**
 * note.md §7 P3 — `EditorStore.resolveObject` is a genuine no-op on the
 * per-remount idempotent call.
 *
 * The reference-block resolve controller (`use-resolve.ts`) calls `resolveObject`
 * on *every* virtualization remount, and its hot paths (unpicked ref, browse-only
 * source) pass the node's own `data` object back by reference with an unchanged
 * status. That call must cost nothing: no committed transaction, no re-bake, no
 * stringify. These tests pin the fast-path (reference-identical) and the slow-path
 * (structurally-equal but a fresh object) both as no-ops, and confirm a real
 * status/data change still commits exactly once.
 */
import { describe, expect, it } from "vitest";
import {
  bakeObjectData,
  createDefaultBlockRegistry,
  createEditorStore,
  createIdAllocator,
  makeObjectNode,
  type EditorDocumentSnapshot,
  type EditorNode,
  type EditorStore,
  type JsonValue,
  type NodeId,
  type ObjectNode,
} from "../../packages/editor/src/core";

function makeStore(data: JsonValue): { store: EditorStore; id: NodeId } {
  const allocator = createIdAllocator("idco_client_resolve_idem");
  const registry = createDefaultBlockRegistry();
  const normalized = registry.normalizeSnapshotObject("post-ref", data);
  const baked = bakeObjectData(registry, "post-ref", normalized.data);
  const node = makeObjectNode({
    baked: baked.baked ?? undefined,
    data: normalized.data,
    id: allocator.createNodeId(),
    status: baked.status,
    type: "post-ref",
  });
  const snapshot: EditorDocumentSnapshot = {
    body: {
      blocks: { [node.id]: node } as Record<NodeId, EditorNode>,
      order: [node.id],
    },
    settings: {},
    version: 1,
  };
  return {
    id: node.id,
    store: createEditorStore({ allocator, registry, snapshot }),
  };
}

function objectNode(store: EditorStore, id: NodeId): ObjectNode {
  const node = store.getNode(id);
  if (node?.kind !== "object") throw new Error("expected an object node");
  return node;
}

describe("resolveObject idempotency (note.md §7 P3)", () => {
  it("does not commit when called with the node's own data and the same status", () => {
    const { store, id } = makeStore({
      ref: "post-1",
      snapshot: { postId: "post-1", title: "T", url: "/t" },
    });
    const node = objectNode(store, id);
    let commits = 0;
    const off = store.subscribeCommit(() => (commits += 1));
    // The exact shape the resolve controller's browse-only / ready path passes:
    // the node's own `data` reference, unchanged status. Must be a pure no-op.
    store.resolveObject(id, node.data, node.status);
    store.resolveObject(id, node.data, node.status);
    off();
    expect(commits).toBe(0);
    // The node object is untouched (same reference), so nothing re-rendered.
    expect(store.getNode(id)).toBe(node);
  });

  it("does not commit when called with a structurally-equal but fresh data object", () => {
    const { store, id } = makeStore({
      ref: "post-1",
      snapshot: { postId: "post-1", title: "T", url: "/t" },
    });
    const node = objectNode(store, id);
    let commits = 0;
    const off = store.subscribeCommit(() => (commits += 1));
    // A different object reference with identical contents falls through the
    // Object.is fast-path to the structural guard, which must still no-op.
    const clone = JSON.parse(JSON.stringify(node.data)) as JsonValue;
    store.resolveObject(id, clone, node.status);
    off();
    expect(commits).toBe(0);
  });

  it("commits exactly once when the status actually changes", () => {
    const { store, id } = makeStore({
      ref: "post-1",
      snapshot: { postId: "post-1", title: "T", url: "/t" },
    });
    const node = objectNode(store, id);
    expect(node.status).toBe("ready");
    let commits = 0;
    const off = store.subscribeCommit(() => (commits += 1));
    store.resolveObject(id, node.data, "invalid");
    off();
    expect(commits).toBe(1);
    expect(objectNode(store, id).status).toBe("invalid");
  });
});
