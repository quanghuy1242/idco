// @vitest-environment jsdom

/**
 * docs/026 §4.4 / §8.2 / §14.11 / RB-14 — embed rebuilt as a resolve-only reference.
 *
 * embed is the degenerate resolve-only source: the pasted URL is the `ref` (no
 * collection to browse), the title is author-local, and the embed source's
 * `resolve` validates the URL against an allowlist. This proves the bake reads the
 * nested {ref, local} shape (and the legacy flat fallback), and that an off-allowlist
 * URL resolves to `invalid` while an allowed one resolves to `ready`.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  bakeObjectData,
  createDefaultBlockRegistry,
  createEditorStore,
  createIdAllocator,
  makeObjectNode,
  type EditorDocumentSnapshot,
  type EditorNode,
  type EditorStore,
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

const registry = createDefaultBlockRegistry();

function embedStore(data: Record<string, unknown>): {
  store: EditorStore;
  id: NodeId;
} {
  const allocator = createIdAllocator("idco_client_p6_embed_test");
  const normalized = registry.normalizeSnapshotObject("embed", data);
  const baked = bakeObjectData(registry, "embed", normalized.data);
  const node = makeObjectNode({
    baked: baked.baked ?? undefined,
    data: normalized.data,
    id: allocator.createNodeId(),
    status: baked.status,
    type: "embed",
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

// An allowlist-guarded embed source, exactly the shape the editor registers.
const allowlistEmbedSource = (allowed: readonly string[]) => ({
  id: "embed",
  resolve: async (refUrl: string) => {
    if (!/^https?:\/\//i.test(refUrl)) return null;
    try {
      if (!allowed.includes(new URL(refUrl).hostname)) return null;
    } catch {
      return null;
    }
    return { id: refUrl, label: "" };
  },
});

afterEach(() => {
  for (const source of listDataSources()) unregisterDataSource(source.id);
});

describe("embed reference block (docs/026 §4.4)", () => {
  it("bakes the nested {ref, local} shape into the resting payload", () => {
    const baked = bakeObjectData(registry, "embed", {
      local: { title: "Clip" },
      ref: "https://youtu.be/abc123",
      snapshot: {},
    });
    expect(baked.baked).toEqual({
      kind: "embed",
      payload: { title: "Clip", url: "https://youtu.be/abc123" },
    });
  });

  it("bakes the legacy flat {url, title} shape via the fallback", () => {
    const baked = bakeObjectData(registry, "embed", {
      title: "Old",
      url: "https://x.test/v",
    });
    expect(baked.baked?.payload).toMatchObject({
      title: "Old",
      url: "https://x.test/v",
    });
  });

  it("marks an off-allowlist URL invalid (the resolve guard)", async () => {
    registerDataSource(allowlistEmbedSource(["good.test"]));
    const { store, id } = embedStore({
      local: { title: "Bad" },
      ref: "https://evil.test/v",
      snapshot: {},
    });
    render(<ResolveProbe id={id} store={store} />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("invalid"),
    );
  });

  it("marks an allowed URL ready", async () => {
    registerDataSource(allowlistEmbedSource(["good.test"]));
    const { store, id } = embedStore({
      local: { title: "Good" },
      ref: "https://good.test/v",
      snapshot: {},
    });
    render(<ResolveProbe id={id} store={store} />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("ready"),
    );
  });
});
