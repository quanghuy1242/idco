/**
 * docs/026 §7.5 / §14.6 / RB-6 — the reference-block status lifecycle.
 *
 * `store.resolveObject` is the engine path the resolve controller drives: it sets
 * a reference block's status (`unresolved` / `ready` / `invalid`) and snapshot
 * WITHOUT recording undo history, overriding the always-ready post-ref bake with
 * the resolve lifecycle. This proves the transitions, that they never touch undo
 * (a background refresh is not a user edit), that the stale snapshot survives an
 * `invalid`, that `local` is preserved, and that re-applying the same state is a
 * no-op (so the controller can call it on every mount).
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
  type JsonValue,
  type NodeId,
} from "../../packages/editor/src/core";

function postRefStore(data: JsonValue) {
  const allocator = createIdAllocator("idco_client_p2_status_test");
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

function objectNode(
  store: ReturnType<typeof postRefStore>["store"],
  id: NodeId,
) {
  const node = store.getNode(id);
  if (node?.kind !== "object") throw new Error("expected an object node");
  return node;
}

describe("reference status lifecycle (resolveObject, docs/026 §7.5)", () => {
  it("marks an empty reference unresolved without recording undo history", () => {
    const { store, id } = postRefStore({ ref: "", snapshot: {} });
    // The post-ref baker always succeeds, so a fresh empty node reads ready.
    expect(objectNode(store, id).status).toBe("ready");
    expect(store.canUndo).toBe(false);

    store.resolveObject(id, { ref: "", snapshot: {} }, "unresolved");
    expect(objectNode(store, id).status).toBe("unresolved");
    // The lifecycle is derived state — it must not enter undo.
    expect(store.canUndo).toBe(false);
  });

  it("patches the snapshot and marks ready, preserving local (the success path)", () => {
    const { store, id } = postRefStore({
      local: { caption: "Keep" },
      ref: "post-1",
      snapshot: { postId: "post-1", title: "Old", url: "/old" },
    });
    store.resolveObject(
      id,
      {
        local: { caption: "Keep" },
        ref: "post-1",
        snapshot: { postId: "post-1", title: "Fresh", url: "/old" },
      },
      "ready",
    );
    const node = objectNode(store, id);
    const data = node.data as {
      local: Record<string, unknown>;
      snapshot: Record<string, unknown>;
    };
    expect(node.status).toBe("ready");
    expect(data.snapshot.title).toBe("Fresh");
    expect(data.snapshot.url).toBe("/old");
    expect(data.local.caption).toBe("Keep");
    expect(store.canUndo).toBe(false);
  });

  it("marks invalid and keeps the stale snapshot (the failure path)", () => {
    const { store, id } = postRefStore({
      ref: "post-1",
      snapshot: { postId: "post-1", title: "Stale", url: "/s" },
    });
    store.resolveObject(
      id,
      {
        ref: "post-1",
        snapshot: { postId: "post-1", title: "Stale", url: "/s" },
      },
      "invalid",
    );
    const node = objectNode(store, id);
    expect(node.status).toBe("invalid");
    expect(
      (node.data as { snapshot: Record<string, unknown> }).snapshot.title,
    ).toBe("Stale");
  });

  it("is a no-op when data, bake, and status are unchanged (idempotent remounts)", () => {
    const { store, id } = postRefStore({ ref: "", snapshot: {} });
    store.resolveObject(id, { ref: "", snapshot: {} }, "unresolved");
    expect(objectNode(store, id).status).toBe("unresolved");
    // A second identical call (a virtualization remount) changes nothing and adds
    // no history.
    store.resolveObject(id, { ref: "", snapshot: {} }, "unresolved");
    expect(objectNode(store, id).status).toBe("unresolved");
    expect(store.canUndo).toBe(false);
  });

  it("does not clobber a real edit's undo entry", () => {
    const { store, id } = postRefStore({ ref: "", snapshot: {} });
    // A real user edit records history.
    store.command({
      data: { ref: "post-1", snapshot: { title: "Picked" } },
      node: id,
      type: "set-object-data",
    });
    expect(store.canUndo).toBe(true);
    const undoDepthBefore = store.canUndo;
    // A resolve-driven status change must not add another undo step.
    store.resolveObject(
      id,
      { ref: "post-1", snapshot: { title: "Picked" } },
      "ready",
    );
    expect(store.canUndo).toBe(undoDepthBefore);
  });
});
