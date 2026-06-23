// @vitest-environment jsdom

/**
 * docs/026 §7.2 / §14.5 / RB-5 — the reference-block resolve controller.
 *
 * `useResolveReference` is the stale-while-revalidate half: on mount it refreshes
 * a reference block's snapshot from its ref and patches the projected keys, drives
 * the status lifecycle (empty→unresolved, success→ready, failure→invalid), keeps
 * `local` untouched, and aborts a write when the block unmounts mid-fetch. The
 * probe re-derives the live node from the store exactly as the dispatcher does
 * (`useEditorNode`), so the controller sees fresh data after each resolve.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ResourceOption } from "@idco/ui";
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
import { registerBuiltInNodeViews } from "../../packages/editor/src/view/nodes";
import { useEditorNode } from "../../packages/editor/src/view/store-hooks";
import { useResolveReference } from "../../packages/editor/src/view/controllers/use-resolve";
import {
  listDataSources,
  registerDataSource,
  unregisterDataSource,
} from "../../packages/editor/src/view/spi/data-source-registry";

registerBuiltInNodeViews();

function makeStore(data: JsonValue): { store: EditorStore; id: NodeId } {
  const allocator = createIdAllocator("idco_client_p2_swr_test");
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

function ResolveProbe(props: {
  readonly store: EditorStore;
  readonly id: NodeId;
}) {
  const node = useEditorNode(props.store, props.id) as ObjectNode;
  useResolveReference(node, props.store);
  return <span data-testid="status">{node?.status ?? "gone"}</span>;
}

function objectData(store: EditorStore, id: NodeId) {
  const node = store.getNode(id);
  if (node?.kind !== "object") throw new Error("expected an object node");
  return node.data as {
    snapshot: Record<string, unknown>;
    local?: Record<string, unknown>;
  };
}

afterEach(() => {
  for (const source of listDataSources()) unregisterDataSource(source.id);
});

describe("resolve controller (docs/026 §7.2)", () => {
  it("marks an empty reference unresolved on mount", async () => {
    const { store, id } = makeStore({ ref: "", snapshot: {} });
    render(<ResolveProbe id={id} store={store} />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("unresolved"),
    );
  });

  it("revalidates the snapshot and marks ready, preserving local", async () => {
    registerDataSource({
      id: "posts",
      resolve: async (ref) => ({ id: ref, label: "Fresh", sublabel: "/fresh" }),
    });
    const { store, id } = makeStore({
      local: { caption: "Keep" },
      ref: "post-1",
      snapshot: { postId: "post-1", title: "Old", url: "/old" },
    });
    render(<ResolveProbe id={id} store={store} />);
    await waitFor(() => {
      expect(
        store.getNode(id)?.kind === "object" && store.getNode(id),
      ).toBeTruthy();
      const data = objectData(store, id);
      expect(data.snapshot.title).toBe("Fresh");
      expect(data.snapshot.url).toBe("/fresh");
      expect(data.local?.caption).toBe("Keep");
    });
    expect(screen.getByTestId("status").textContent).toBe("ready");
  });

  it("keeps the stale snapshot and marks invalid when resolve returns null", async () => {
    registerDataSource({ id: "posts", resolve: async () => null });
    const { store, id } = makeStore({
      ref: "post-1",
      snapshot: { postId: "post-1", title: "Stale", url: "/s" },
    });
    render(<ResolveProbe id={id} store={store} />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("invalid"),
    );
    expect(objectData(store, id).snapshot.title).toBe("Stale");
  });

  it("does not write the result after the block unmounts mid-resolve (abort)", async () => {
    // Assigned synchronously by the Promise executor when `resolve` is called
    // during the controller's mount effect, before the test settles it.
    let release!: (option: ResourceOption | null) => void;
    registerDataSource({
      id: "posts",
      resolve: () =>
        new Promise<ResourceOption | null>((resolve) => {
          release = resolve;
        }),
    });
    const { store, id } = makeStore({
      ref: "post-1",
      snapshot: { postId: "post-1", title: "Stale", url: "/s" },
    });
    const view = render(<ResolveProbe id={id} store={store} />);
    // Unmount before the resolve settles, then settle it: the aborted result must
    // be dropped, leaving the stale snapshot intact.
    view.unmount();
    await act(async () => {
      release({ id: "post-1", label: "Fresh", sublabel: "/fresh" });
    });
    expect(objectData(store, id).snapshot.title).toBe("Stale");
  });

  it("keeps a ref-bearing block ready when its source has no resolve", async () => {
    // The drag-drop / upload path produces a node with a ref + a populated snapshot
    // but a source that only uploads/browses (no resolve). It must read `ready`, not
    // flip to `unresolved` (which would paint the empty-state "Pick" badge over a
    // valid image).
    registerDataSource({ id: "posts", load: { items: [], mode: "sync" } });
    const { store, id } = makeStore({
      ref: "post-1",
      snapshot: { title: "Has content" },
    });
    render(<ResolveProbe id={id} store={store} />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("ready"),
    );
  });

  it("dedupes concurrent resolves for the same ref (docs/026 §14.5)", async () => {
    let calls = 0;
    registerDataSource({
      id: "posts",
      resolve: async (refId) => {
        calls += 1;
        return { id: refId, label: "Fresh" };
      },
    });
    const a = makeStore({ ref: "post-1", snapshot: {} });
    const b = makeStore({ ref: "post-1", snapshot: {} });
    // Both mount in the same commit, so the second sees the first's in-flight entry
    // and shares its fetch rather than firing a second.
    render(
      <>
        <ResolveProbe id={a.id} store={a.store} />
        <ResolveProbe id={b.id} store={b.store} />
      </>,
    );
    await waitFor(() => {
      const an = a.store.getNode(a.id);
      const bn = b.store.getNode(b.id);
      expect(an?.kind === "object" && an.status).toBe("ready");
      expect(bn?.kind === "object" && bn.status).toBe("ready");
    });
    expect(calls).toBe(1);
  });
});
