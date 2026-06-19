// @vitest-environment jsdom
/**
 * Editor chrome (docs/010 Phase 8 AC2 toolbar, AC1 find).
 *
 * Proves the @idco/ui toolbar and find bar operate on the engine's *model*
 * selection through commands/queries, not the DOM: clicking Bold toggles a bold
 * mark on the selected model range; the link editor sets a link mark; find
 * intercepts the query and selects a model match (including offscreen, since it
 * reads the model). Menu-driven commands (block type, insert) are proven at the
 * command layer in engine-commands-phase8; here we drive the toolbar buttons.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import {
  createEditorStore,
  createEngineScheduler,
  createIdAllocator,
  makeTextNode,
  type EditorStore,
  type NodeId,
} from "../../packages/editor/src/core";
import {
  OwnedModelEditor,
  type OwnedModelEditorHandle,
} from "../../packages/editor/src/view";

function build(texts: readonly string[]): {
  store: EditorStore;
  ids: NodeId[];
} {
  const allocator = createIdAllocator("idco_client_chrome");
  const nodes = texts.map((text) =>
    makeTextNode({
      content: allocator.createTextSlice(text),
      id: allocator.createNodeId(),
    }),
  );
  const store = createEditorStore({
    allocator,
    snapshot: {
      body: {
        blocks: Object.fromEntries(nodes.map((n) => [n.id, n])),
        order: nodes.map((n) => n.id),
      },
      settings: {},
      version: 1,
    },
  });
  return { ids: nodes.map((n) => n.id), store };
}

describe("editor chrome (Phase 8)", () => {
  it("toggles bold on the model selection from the toolbar", async () => {
    const { store, ids } = build(["hello world"]);
    const ref = createRef<OwnedModelEditorHandle>();
    render(
      <OwnedModelEditor
        forcePolyfill
        ref={ref}
        scheduler={createEngineScheduler({ publishDashboard: false })}
        store={store}
        virtualize={false}
      />,
    );
    act(() => {
      ref.current!.selectText(ids[0]!, 0, ids[0]!, 5);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    });
    await waitFor(() =>
      expect(
        store.requireTextNode(ids[0]!).marks.some((m) => m.kind === "bold"),
      ).toBe(true),
    );
  });

  it("sets a link on the model selection through the link editor", async () => {
    const { store, ids } = build(["see docs"]);
    const ref = createRef<OwnedModelEditorHandle>();
    render(
      <OwnedModelEditor
        forcePolyfill
        ref={ref}
        scheduler={createEngineScheduler({ publishDashboard: false })}
        store={store}
        virtualize={false}
      />,
    );
    act(() => {
      ref.current!.selectText(ids[0]!, 4, ids[0]!, 8);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Link" }));
    });
    const input = await screen.findByRole("textbox", { name: "Link URL" });
    await act(async () => {
      fireEvent.change(input, { target: { value: "https://idco.test" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply link" }));
    });
    await waitFor(() => {
      const link = store
        .requireTextNode(ids[0]!)
        .marks.find((m) => m.kind === "link");
      expect(link?.attrs?.href).toBe("https://idco.test");
    });
  });

  it("opens find and selects a model match", async () => {
    const { store, ids } = build(["alpha bravo", "charlie bravo"]);
    const ref = createRef<OwnedModelEditorHandle>();
    render(
      <OwnedModelEditor
        forcePolyfill
        ref={ref}
        scheduler={createEngineScheduler({ publishDashboard: false })}
        store={store}
        virtualize={false}
      />,
    );
    act(() => ref.current!.openFind());
    const input = await screen.findByRole("textbox", { name: "Find" });
    await act(async () => {
      fireEvent.change(input, { target: { value: "bravo" } });
    });
    await waitFor(() => {
      expect(store.selection?.type).toBe("text");
    });
    // First match is in the first block "alpha bravo".
    const sel = store.selection;
    expect(sel?.type === "text" && sel.focus.node).toBe(ids[0]);
  });
});
