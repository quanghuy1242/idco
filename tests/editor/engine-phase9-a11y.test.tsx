// @vitest-environment jsdom
/**
 * docs/018 §2.3 accessibility depth: atomic objects expose role + accessible
 * name + a stable id, and the editing surface reflects a selected object through
 * `aria-activedescendant` (docs/011 §8.7). Text blocks keep real element focus.
 */
import { act, render } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import {
  OwnedModelEditorView,
  createEditorStore,
  createEngineScheduler,
  createIdAllocator,
  makeObjectNode,
  makeTextNode,
  pointAtOffset,
  type OwnedModelEditorViewHandle,
} from "../../packages/editor/src";

function renderWithObject() {
  const allocator = createIdAllocator("idco_client_a11y");
  const text = makeTextNode({
    content: allocator.createTextSlice("intro"),
    id: allocator.createNodeId(),
  });
  const object = makeObjectNode({
    data: {},
    id: allocator.createNodeId(),
    status: "ready",
    type: "divider",
  });
  const store = createEditorStore({
    allocator,
    snapshot: {
      body: {
        blocks: { [object.id]: object, [text.id]: text },
        order: [text.id, object.id],
      },
      settings: {},
      version: 1,
    },
  });
  const ref = createRef<OwnedModelEditorViewHandle>();
  const result = render(
    <OwnedModelEditorView
      forcePolyfill
      ref={ref}
      scheduler={createEngineScheduler({ publishDashboard: false })}
      store={store}
      virtualize={false}
    />,
  );
  return { object, ref, result, store, text };
}

describe("§2.3 atomic object accessibility", () => {
  it("gives an object block a role, an accessible name, and a stable id", () => {
    const { object } = renderWithObject();
    const element = document.getElementById(object.id);
    expect(element).not.toBeNull();
    expect(element!.getAttribute("role")).toBe("separator");
    expect(element!.getAttribute("aria-label")).toBe("Divider");
  });

  it("reflects a selected object through aria-activedescendant on the surface", async () => {
    const { object, store, text } = renderWithObject();
    const root = document.querySelector("[data-engine-view-root]")!;
    // No object selected yet.
    expect(root.getAttribute("aria-activedescendant")).toBeNull();

    await act(async () => {
      store.dispatch({
        origin: "local",
        selectionAfter: { node: object.id, type: "node" },
        steps: [],
      });
    });
    expect(root.getAttribute("aria-activedescendant")).toBe(object.id);

    // Moving the caret back into text clears the descendant (text uses real focus).
    await act(async () => {
      const point = pointAtOffset(text.id, text.content, 0);
      store.dispatch({
        origin: "local",
        selectionAfter: { anchor: point, focus: point, type: "text" },
        steps: [],
      });
    });
    expect(root.getAttribute("aria-activedescendant")).toBeNull();
  });
});
