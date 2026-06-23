// @vitest-environment jsdom

/**
 * docs/026 §6.2 / §14.2 / RB-2 — the resource config field in the default popover.
 *
 * Proves the gated surface end to end at the view layer: a `resource` field
 * renders the standardized `@idco/ui` ComboBox (not a hand-rolled list), and
 * picking an option projects it through `toData` and commits `{ ref, snapshot }`
 * to the node (docs/026 §7.1). Also proves provenance at the field level: an
 * unregistered source renders an inert note rather than a broken control (§9).
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ResourceSource } from "@idco/ui";
import {
  bakeObjectData,
  createDefaultBlockRegistry,
  createEditorStore,
  createIdAllocator,
  makeObjectNode,
  type EditorDocumentSnapshot,
  type EditorNode,
  type NodeId,
} from "../../packages/editor/src/core";
import { ObjectConfigPanel } from "../../packages/editor/src/view/render/object-config";
import { registerBuiltInNodeViews } from "../../packages/editor/src/view/nodes";
import {
  listDataSources,
  registerDataSource,
  unregisterDataSource,
} from "../../packages/editor/src/view/spi/data-source-registry";

// post-ref's NodeView (with its resource configField) must be registered for the
// panel to read its fields.
registerBuiltInNodeViews();

const postsSource: ResourceSource = {
  items: [
    {
      id: "post-1",
      label: "Referenced post",
      sublabel: "/posts/referenced-post",
    },
  ],
  mode: "sync",
};

function postRefStore() {
  const allocator = createIdAllocator("idco_client_p1_objcfg_test");
  const registry = createDefaultBlockRegistry();
  const data = registry.normalizeSnapshotObject("post-ref", {
    ref: "",
    snapshot: {},
  }).data;
  const baked = bakeObjectData(registry, "post-ref", data);
  const node = makeObjectNode({
    baked: baked.baked ?? undefined,
    data,
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
  return { node, store: createEditorStore({ allocator, registry, snapshot }) };
}

afterEach(() => {
  for (const source of listDataSources()) unregisterDataSource(source.id);
});

describe("ObjectConfigPanel resource field (docs/026 §6.2)", () => {
  it("renders the ComboBox and commits { ref, snapshot } on pick", async () => {
    registerDataSource({ id: "posts", load: postsSource });
    const { node, store } = postRefStore();
    render(
      <ObjectConfigPanel
        node={node}
        registerObjectEditor={() => {}}
        store={store}
      />,
    );

    const input = screen.getByRole("combobox", { name: /post/i });
    await act(async () => {
      input.focus();
      fireEvent.focus(input);
    });
    fireEvent.click(await screen.findByText("Referenced post"));

    await waitFor(() => {
      const updated = store.getNode(node.id);
      if (updated?.kind !== "object") throw new Error("expected object");
      const data = updated.data as {
        ref: string;
        snapshot: Record<string, unknown>;
      };
      expect(data.ref).toBe("post-1");
      expect(data.snapshot).toEqual({
        postId: "post-1",
        title: "Referenced post",
        url: "/posts/referenced-post",
      });
    });
  });

  it("renders an inert note when the source is not registered (provenance)", () => {
    const { node, store } = postRefStore();
    render(
      <ObjectConfigPanel
        node={node}
        registerObjectEditor={() => {}}
        store={store}
      />,
    );
    expect(
      screen.getByText(/not available in this deployment/i),
    ).toBeInTheDocument();
  });
});
