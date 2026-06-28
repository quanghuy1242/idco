// @vitest-environment jsdom

/**
 * R-backlog (note.md §5.7–5.10) engine-side coverage:
 *  - R2 (§5.8): the empty-document placeholder paints in a single empty block,
 *    is gated on the placeholder prop, disappears on the first character, and
 *    never shows once the document has more than one block.
 *  - R3 (§5.9): `resolveViewStyle` folds `chromeless`/`fillHeight` into one typed
 *    surface style across both render paths, with the caller's `style` winning.
 *
 * The click-empty→caret-at-end half of R3 is geometry-driven and covered by the
 * Playwright spec (tests/e2e/engine-r-backlog.spec.ts), where real layout exists.
 */
import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  OwnedModelEditorView,
  createEditorStore,
  createEngineScheduler,
  createIdAllocator,
  emptyDocument,
  makeTextNode,
  pointAtOffset,
  type EditorDocumentSnapshot,
  type EditorNode,
  type NodeId,
} from "../../packages/editor/src";
import { resolveViewStyle } from "../../packages/editor/src/view/styles";

// A no-dashboard scheduler so these view renders add no background dashboard
// timer work to the shared (single jsdom context) suite — the same isolation
// engine-view.test.tsx uses so the legacy real-timer perf test stays unraced.
const quietScheduler = () => createEngineScheduler({ publishDashboard: false });

function emptyStore() {
  return createEditorStore({
    allocator: createIdAllocator("idco_client_test_r2_empty"),
    snapshot: emptyDocument(),
  });
}

function twoBlockStore() {
  const allocator = createIdAllocator("idco_client_test_r2_two");
  const a = makeTextNode({
    content: allocator.createTextSlice(""),
    id: allocator.createNodeId(),
    type: "paragraph",
  });
  const b = makeTextNode({
    content: allocator.createTextSlice(""),
    id: allocator.createNodeId(),
    type: "paragraph",
  });
  const snapshot: EditorDocumentSnapshot = {
    body: {
      blocks: { [a.id]: a, [b.id]: b } as Record<NodeId, EditorNode>,
      order: [a.id, b.id],
    },
    settings: {},
    version: 1,
  };
  return createEditorStore({ allocator, snapshot });
}

const HINT = "Type here…";

describe("R2 empty-document placeholder", () => {
  it("paints the hint in a single empty block when the prop is set", () => {
    render(
      <OwnedModelEditorView
        forcePolyfill
        scheduler={quietScheduler()}
        placeholder={HINT}
        store={emptyStore()}
        virtualize={false}
      />,
    );
    const hint = document.querySelector("[data-engine-placeholder-text]");
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toBe(HINT);
  });

  it("does not paint without the placeholder prop", () => {
    render(
      <OwnedModelEditorView
        forcePolyfill
        scheduler={quietScheduler()}
        store={emptyStore()}
        virtualize={false}
      />,
    );
    expect(document.querySelector("[data-engine-placeholder-text]")).toBeNull();
  });

  it("does not paint once the document has more than one block", () => {
    render(
      <OwnedModelEditorView
        forcePolyfill
        scheduler={quietScheduler()}
        placeholder={HINT}
        store={twoBlockStore()}
        virtualize={false}
      />,
    );
    expect(document.querySelector("[data-engine-placeholder-text]")).toBeNull();
  });

  it("disappears on the first character and returns when emptied", () => {
    const store = emptyStore();
    render(
      <OwnedModelEditorView
        forcePolyfill
        scheduler={quietScheduler()}
        placeholder={HINT}
        store={store}
        virtualize={false}
      />,
    );
    expect(
      document.querySelector("[data-engine-placeholder-text]"),
    ).not.toBeNull();

    const id = store.order[0]!;
    const node = store.requireTextNode(id);
    const caret = pointAtOffset(id, node.content, 0);
    act(() => {
      store.dispatch({
        origin: "local",
        selectionAfter: { anchor: caret, focus: caret, type: "text" },
        steps: [],
      });
      store.command({ type: "insert-text", text: "x" });
    });
    expect(document.querySelector("[data-engine-placeholder-text]")).toBeNull();

    act(() => {
      store.command({ type: "delete-backward" });
    });
    expect(
      document.querySelector("[data-engine-placeholder-text]"),
    ).not.toBeNull();
  });

  it("clears when a split makes the document multi-block (still empty blocks)", () => {
    const store = emptyStore();
    render(
      <OwnedModelEditorView
        forcePolyfill
        scheduler={quietScheduler()}
        placeholder={HINT}
        store={store}
        virtualize={false}
      />,
    );
    const id = store.order[0]!;
    const node = store.requireTextNode(id);
    const caret = pointAtOffset(id, node.content, 0);
    act(() => {
      store.dispatch({
        origin: "local",
        selectionAfter: { anchor: caret, focus: caret, type: "text" },
        steps: [],
      });
      store.command({ type: "split-block" });
    });
    expect(store.order.length).toBeGreaterThan(1);
    // Two empty paragraphs is no longer "an empty document" — no hint.
    expect(document.querySelector("[data-engine-placeholder-text]")).toBeNull();
  });
});

describe("R3 resolveViewStyle", () => {
  it("keeps the card chrome by default (non-chromeless)", () => {
    const style = resolveViewStyle({
      chromeless: false,
      fillHeight: false,
      viewportHeight: 480,
      virtualize: false,
    });
    expect(style.border).toBeTruthy();
    expect(style.borderRadius).toBeTruthy();
    expect(style.maxWidth).toBeTruthy();
  });

  it("strips border/radius/max-width cap when chromeless", () => {
    const style = resolveViewStyle({
      chromeless: true,
      fillHeight: false,
      viewportHeight: 480,
      virtualize: false,
    });
    expect(style.border).toBeUndefined();
    expect(style.borderRadius).toBeUndefined();
    expect(style.maxWidth).toBeUndefined();
    // Prose essentials still present.
    expect(style.fontFamily).toBeTruthy();
    expect(style.lineHeight).toBeTruthy();
  });

  it("uses a fixed scroller height on the virtualized path", () => {
    const style = resolveViewStyle({
      chromeless: false,
      fillHeight: false,
      viewportHeight: 320,
      virtualize: true,
    });
    expect(style.height).toBe(320);
    expect(style.overflowAnchor).toBe("none");
    expect(style.overflowY).toBe("auto");
  });

  it("fills height: 100% on the virtualized path when fillHeight", () => {
    const style = resolveViewStyle({
      chromeless: true,
      fillHeight: true,
      viewportHeight: 320,
      virtualize: true,
    });
    expect(style.height).toBe("100%");
  });

  it("fills minHeight: 100% on the non-virtualized path when fillHeight", () => {
    const style = resolveViewStyle({
      chromeless: true,
      fillHeight: true,
      viewportHeight: 480,
      virtualize: false,
    });
    expect(style.minHeight).toBe("100%");
    expect(style.height).toBeUndefined();
  });

  it("lets the caller's explicit style win (the back-compat escape hatch)", () => {
    const style = resolveViewStyle({
      chromeless: false,
      fillHeight: false,
      style: { border: "none", maxWidth: "none" },
      viewportHeight: 480,
      virtualize: false,
    });
    expect(style.border).toBe("none");
    expect(style.maxWidth).toBe("none");
  });
});
