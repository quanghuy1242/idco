// @vitest-environment jsdom

/**
 * docs/026 §8.2 / §14.11 / RB-8 + RB-9 — media rebuilt as a reference block.
 *
 * media now stores `{ ref, snapshot:{src,alt}, local:{caption} }` and edits through
 * the default config popover (a `resource` field bound to the `media` source + a
 * caption text field). This proves the bake reads the nested shape AND the legacy
 * flat fallback (the payload corpus, §15), that picking commits `{ ref, snapshot }`,
 * that the caption is author-local (`data.local`, never clobbered by a refresh,
 * §7.2), and that the source's `upload` capability creates-then-references (§7.1).
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
} from "../../packages/editor/src/core";
import { ObjectConfigPanel } from "../../packages/editor/src/view/render/object-config";
import { registerBuiltInNodeViews } from "../../packages/editor/src/view/nodes";
import {
  listDataSources,
  registerDataSource,
  unregisterDataSource,
  type DataSource,
} from "../../packages/editor/src/view/spi/data-source-registry";

registerBuiltInNodeViews();

const mediaSource: DataSource = {
  id: "media",
  load: {
    items: [{ id: "asset-1", image: "/cat.png", label: "A cat" }],
    mode: "sync",
  },
  upload: async (file) => ({
    id: "asset-up",
    image: "/uploaded.png",
    label: file.name,
  }),
};

const registry = createDefaultBlockRegistry();

function mediaStore(data: Record<string, unknown>): {
  store: EditorStore;
  id: NodeId;
} {
  const allocator = createIdAllocator("idco_client_p3_media_test");
  const normalized = registry.normalizeSnapshotObject("media", data);
  const baked = bakeObjectData(registry, "media", normalized.data);
  const node = makeObjectNode({
    baked: baked.baked ?? undefined,
    data: normalized.data,
    id: allocator.createNodeId(),
    status: baked.status,
    type: "media",
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

function mediaData(store: EditorStore, id: NodeId) {
  const node = store.getNode(id);
  if (node?.kind !== "object") throw new Error("expected an object node");
  return node.data as {
    ref: string;
    snapshot: Record<string, unknown>;
    local?: Record<string, unknown>;
  };
}

afterEach(() => {
  for (const source of listDataSources()) unregisterDataSource(source.id);
});

describe("media reference block (docs/026 §8.2)", () => {
  it("bakes the nested {ref, snapshot, local} shape into the resting payload", () => {
    const baked = bakeObjectData(registry, "media", {
      local: { caption: "My cat" },
      ref: "asset-1",
      snapshot: { alt: "A cat", src: "/cat.png" },
    });
    expect(baked.status).toBe("ready");
    expect(baked.baked).toEqual({
      kind: "media",
      payload: {
        alt: "A cat",
        caption: "My cat",
        mediaId: "asset-1",
        src: "/cat.png",
      },
    });
  });

  it("bakes the legacy flat shape via the back-compat fallback (the payload corpus)", () => {
    const baked = bakeObjectData(registry, "media", {
      alt: "Old",
      caption: "Legacy",
      src: "/old.png",
    });
    expect(baked.status).toBe("ready");
    expect(baked.baked?.payload).toMatchObject({
      alt: "Old",
      caption: "Legacy",
      src: "/old.png",
    });
  });

  it("commits { ref, snapshot } when an asset is picked", async () => {
    registerDataSource(mediaSource);
    const { store, id } = mediaStore({ local: {}, ref: "", snapshot: {} });
    render(
      <ObjectConfigPanel
        node={store.getNode(id) as never}
        registerObjectEditor={() => {}}
        store={store}
      />,
    );
    const input = screen.getByRole("combobox", { name: /image/i });
    await act(async () => {
      input.focus();
      fireEvent.focus(input);
    });
    fireEvent.click(await screen.findByText("A cat"));
    await waitFor(() => {
      const data = mediaData(store, id);
      expect(data.ref).toBe("asset-1");
      expect(data.snapshot).toEqual({ alt: "A cat", src: "/cat.png" });
    });
  });

  it("writes the caption to data.local (author-local, survives a refresh)", () => {
    registerDataSource(mediaSource);
    const { store, id } = mediaStore({
      local: {},
      ref: "asset-1",
      snapshot: { alt: "A cat", src: "/cat.png" },
    });
    render(
      <ObjectConfigPanel
        node={store.getNode(id) as never}
        registerObjectEditor={() => {}}
        store={store}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: /caption/i }), {
      target: { value: "My cat" },
    });
    const data = mediaData(store, id);
    expect(data.local?.caption).toBe("My cat");
    // The caption is NOT in the projected snapshot, so a resolve cannot clobber it.
    expect(data.snapshot.caption).toBeUndefined();
  });

  it("creates and references an asset through the source's upload capability", async () => {
    registerDataSource(mediaSource);
    const { store, id } = mediaStore({ local: {}, ref: "", snapshot: {} });
    const view = render(
      <ObjectConfigPanel
        node={store.getNode(id) as never}
        registerObjectEditor={() => {}}
        store={store}
      />,
    );
    const fileInput = view.container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["x"], "kitten.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });
    await waitFor(() => {
      const data = mediaData(store, id);
      expect(data.ref).toBe("asset-up");
      expect(data.snapshot.src).toBe("/uploaded.png");
    });
  });
});
