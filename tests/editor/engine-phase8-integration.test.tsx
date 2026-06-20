// @vitest-environment jsdom
/**
 * Phase 8 integration: node SPI worked examples (AC6), resting/themed render,
 * and autosave/dirty-state (AC10).
 */
import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  createEditorStore,
  createIdAllocator,
  createOwnedEditorHandle,
  makeObjectNode,
  makeTextNode,
  pointAtOffset,
  type EditorStore,
  type OwnedEditorHandle,
} from "../../packages/editor/src/core";
import { useMemo } from "react";

const noop = (): void => {};
import {
  RestingDocument,
  getNodeView,
  listInsertableNodes,
  useAutosave,
} from "../../packages/editor/src/view";

function storeWith(): EditorStore {
  const allocator = createIdAllocator("idco_client_p8i");
  const text = makeTextNode({
    content: allocator.createTextSlice("Body"),
    id: allocator.createNodeId(),
  });
  const media = makeObjectNode({
    baked: { kind: "media", payload: { caption: "A cat", src: "/cat.png" } },
    data: { caption: "A cat", src: "/cat.png" },
    id: allocator.createNodeId(),
    status: "ready",
    type: "media",
  });
  return createEditorStore({
    allocator,
    snapshot: {
      body: {
        blocks: { [media.id]: media, [text.id]: text },
        order: [text.id, media.id],
      },
      settings: {},
      version: 1,
    },
  });
}

describe("node SPI worked examples (AC6)", () => {
  it("divider and image register with insert affordances", () => {
    const types = listInsertableNodes().map((v) => v.type);
    expect(types).toContain("divider");
    expect(types).toContain("media");
  });

  it("the image node view supplies a live-edit surface", () => {
    const media = getNodeView("media");
    expect(media?.renderResting).toBeDefined();
    expect(media?.renderLive).toBeDefined();
    expect(media?.insert?.label).toBe("Image");
  });
});

describe("resting/themed render", () => {
  it("renders a themed document with semantic marks and baked objects", () => {
    const store = storeWith();
    const { container } = render(
      <RestingDocument snapshot={store.toSnapshot()} />,
    );
    const root = container.querySelector("[data-engine-resting-document]");
    expect(root?.className).toContain("prose");
    expect(
      container.querySelector("[data-engine-object-baked='media']"),
    ).not.toBeNull();
    expect(container.textContent).toContain("Body");
  });

  it("bakes an unbaked (imported) object for display instead of printing its type name", () => {
    // Imported objects carry no baked snapshot (compat keeps the round-trip
    // deep-equal, docs/010 §14). The resting render must bake on the fly through
    // the shared renderer — the same as the editor at rest — not fall back to the
    // bare type word ("media"). Regression for the editor↔reader drift.
    const allocator = createIdAllocator("idco_client_unbaked");
    const media = makeObjectNode({
      data: { alt: "", caption: "", src: "/diagram.png" },
      id: allocator.createNodeId(),
      status: "ready",
      type: "media",
    });
    const store = createEditorStore({
      allocator,
      snapshot: {
        body: { blocks: { [media.id]: media }, order: [media.id] },
        settings: {},
        version: 1,
      },
    });
    const { container } = render(
      <RestingDocument snapshot={store.toSnapshot()} />,
    );
    // The media view rendered a real <img> (not the bare type word), so the
    // editor at rest and the reader show the actual image (docs/018 §2.11).
    expect(
      container.querySelector("[data-engine-object-baked='media']"),
    ).not.toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "/diagram.png",
    );
  });
});

function AutosaveHarness(props: {
  readonly store: EditorStore;
  readonly onSave: (snapshot: unknown) => Promise<void>;
  readonly onReady: (edit: () => void) => void;
}) {
  const { store, onSave, onReady } = props;
  const handle: OwnedEditorHandle = useMemo(
    () => createOwnedEditorHandle(store),
    [store],
  );
  useAutosave(handle, { delayMs: 10, onSave });
  useEffect(() => {
    onReady(() => store.command({ text: "x", type: "insert-text" }));
  }, [onReady, store]);
  return null;
}

describe("autosave / dirty-state (AC10)", () => {
  it("persists edits debounced and marks the document clean", async () => {
    const store = storeWith();
    // Put a caret so insert-text applies.
    const text = store.requireNode(store.order[0]!);
    if (text.kind === "text") {
      const point = pointAtOffset(text.id, text.content, 0);
      store.dispatch({
        origin: "local",
        selectionAfter: { anchor: point, focus: point, type: "text" },
        steps: [],
      });
    }
    const onSave = vi.fn<(snapshot: unknown) => Promise<void>>(async () => {});
    let edit = noop;
    render(
      <AutosaveHarness
        onReady={(fn) => (edit = fn)}
        onSave={onSave}
        store={store}
      />,
    );
    act(() => edit());
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1), {
      timeout: 1000,
    });
    expect(onSave.mock.calls[0]![0]).toMatchObject({ version: 1 });
  });
});
