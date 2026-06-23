/**
 * docs/026 §8.2 / §14.11 / RB-4 — post-ref rebuilt as a reference block.
 *
 * post-ref now stores `{ ref, snapshot }` (docs/026 §4.3) instead of three flat
 * fields. This proves the rebuild keeps the engine contract: the baker flattens
 * the projected snapshot into the resting payload (so `renderResting` is
 * unchanged, §7.4), an empty (unpicked) reference still bakes, and the ref +
 * snapshot round-trip through the compat boundary.
 */
import { describe, expect, it } from "vitest";
import {
  bakeObjectData,
  compatFromEditorStore,
  createDefaultBlockRegistry,
  createEditorStore,
  createEditorStoreFromCompat,
  createIdAllocator,
  makeObjectNode,
  type EditorDocumentSnapshot,
  type EditorNode,
  type NodeId,
} from "../../packages/editor/src/core";

const registry = createDefaultBlockRegistry();

function storeWithPostRef(data: Record<string, unknown>) {
  const allocator = createIdAllocator("idco_client_p1_post_ref_test");
  const normalized = registry.normalizeSnapshotObject("post-ref", data);
  const baked = bakeObjectData(registry, "post-ref", normalized.data);
  const node = makeObjectNode({
    baked: baked.baked ?? undefined,
    data: normalized.data,
    id: allocator.createNodeId(),
    status: baked.status,
    type: "post-ref",
  });
  const order: EditorNode[] = [node];
  const snapshot: EditorDocumentSnapshot = {
    body: {
      blocks: Object.fromEntries(order.map((n) => [n.id, n])) as Record<
        NodeId,
        EditorNode
      >,
      order: order.map((n) => n.id),
    },
    settings: {},
    version: 1,
  };
  return { node, store: createEditorStore({ allocator, registry, snapshot }) };
}

describe("post-ref reference block (docs/026 §8.2)", () => {
  it("bakes the projected snapshot into the resting payload", () => {
    const data = registry.normalizeSnapshotObject("post-ref", {
      ref: "post-1",
      snapshot: { postId: "post-1", title: "Hello", url: "/posts/hello" },
    }).data;
    const baked = bakeObjectData(registry, "post-ref", data);
    expect(baked.status).toBe("ready");
    expect(baked.baked).toEqual({
      kind: "post-ref",
      payload: { postId: "post-1", title: "Hello", url: "/posts/hello" },
    });
  });

  it("bakes an empty (unpicked) reference without throwing", () => {
    const data = registry.normalizeSnapshotObject("post-ref", {
      ref: "",
      snapshot: {},
    }).data;
    const baked = bakeObjectData(registry, "post-ref", data);
    expect(baked.status).toBe("ready");
    expect(baked.baked?.payload).toEqual({ postId: "", title: "", url: "" });
  });

  it("round-trips ref + snapshot through the compat boundary", () => {
    const { store } = storeWithPostRef({
      ref: "post-1",
      snapshot: { postId: "post-1", title: "Hello", url: "/posts/hello" },
    });

    const compat = compatFromEditorStore(store);
    const child = compat.root.children.find((c) => c.type === "post-ref") as
      | (Record<string, unknown> & { type: string })
      | undefined;
    expect(child?.ref).toBe("post-1");
    expect(child?.snapshot).toEqual({
      postId: "post-1",
      title: "Hello",
      url: "/posts/hello",
    });

    const reloaded = createEditorStoreFromCompat(compat);
    const reloadedNode = reloaded.order
      .map((id) => reloaded.getNode(id))
      .find((node) => node?.kind === "object" && node.type === "post-ref");
    if (reloadedNode?.kind !== "object") throw new Error("expected post-ref");
    const reloadedData = reloadedNode.data as {
      ref: string;
      snapshot: Record<string, unknown>;
    };
    expect(reloadedData.ref).toBe("post-1");
    expect(reloadedData.snapshot).toEqual({
      postId: "post-1",
      title: "Hello",
      url: "/posts/hello",
    });
  });
});
