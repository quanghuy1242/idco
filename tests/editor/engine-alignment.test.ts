// @vitest-environment jsdom
/**
 * Alignment control (note.md item 1).
 *
 * The owned engine already round-trips element alignment as `attrs.format` (the legacy
 * field the reader's `elementAlign` maps to align); it simply never exposed a control to
 * set it. These tests prove the new Home dropdown writes that existing field through the
 * generic `set-block-attr` (no new command verb), the `current-align` query reads it
 * back, `left` clears it (the reader's default), and the value reaches the compat wire as
 * `format` so the reader paints it. The toolbar slice is asserted via the registered
 * command + its Home slot.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  compatFromEditorStore,
  createEditorStore,
  createIdAllocator,
  makeTextNode,
  pointAtOffset,
  type EditorStore,
  type NodeId,
} from "../../packages/editor/src/core";
import {
  getCommand,
  registerBuiltInBlockTypes,
} from "../../packages/editor/src/view/spi";
import { registerBuiltInMarks } from "../../packages/editor/src/view/render";
import { registerBuiltInNodeViews } from "../../packages/editor/src/view/nodes";
import { registerBuiltInCommands } from "../../packages/editor/src/view/chrome";
import { blockStyleFor } from "../../packages/editor/src/view/styles";

beforeAll(() => {
  registerBuiltInMarks();
  registerBuiltInBlockTypes();
  registerBuiltInNodeViews();
  registerBuiltInCommands();
});

function paragraphStore(text: string): { store: EditorStore; id: NodeId } {
  const allocator = createIdAllocator("idco_client_align");
  const node = makeTextNode({
    content: allocator.createTextSlice(text),
    id: allocator.createNodeId(),
    type: "paragraph",
  });
  const store = createEditorStore({
    allocator,
    snapshot: {
      body: { blocks: { [node.id]: node }, order: [node.id] },
      settings: {},
      version: 1,
    },
  });
  return { id: node.id, store };
}

function caretAt(store: EditorStore, id: NodeId, offset: number): void {
  const node = store.requireTextNode(id);
  store.dispatch({
    origin: "local",
    selectionAfter: {
      anchor: pointAtOffset(id, node.content, offset),
      focus: pointAtOffset(id, node.content, offset),
      type: "text",
    },
    steps: [],
  });
}

describe("alignment — set-block-attr on `format` + current-align query", () => {
  it("defaults to left and reports the value after setting", () => {
    const { store, id } = paragraphStore("hello");
    caretAt(store, id, 0);
    expect(store.query({ type: "current-align" })).toBe("left");

    store.command({ key: "format", type: "set-block-attr", value: "center" });
    expect(store.requireTextNode(id).attrs?.format).toBe("center");
    expect(store.query({ type: "current-align" })).toBe("center");
  });

  it("clears the attr for the left default (kept off the wire)", () => {
    const { store, id } = paragraphStore("hello");
    caretAt(store, id, 0);
    store.command({ key: "format", type: "set-block-attr", value: "right" });
    expect(store.requireTextNode(id).attrs?.format).toBe("right");

    // The Align body passes `undefined` for left, which clears the attr.
    store.command({ key: "format", type: "set-block-attr", value: undefined });
    expect(store.requireTextNode(id).attrs?.format).toBeUndefined();
    expect(store.query({ type: "current-align" })).toBe("left");
  });

  it("current-align returns null off a text leaf (no selection)", () => {
    const { store } = paragraphStore("hello");
    expect(store.query({ type: "current-align" })).toBeNull();
  });
});

describe("alignment — compat round-trip (the reader paints it)", () => {
  it("a centered paragraph exports its `format` to the legacy wire shape", () => {
    const { store, id } = paragraphStore("centered");
    caretAt(store, id, 0);
    store.command({ key: "format", type: "set-block-attr", value: "center" });

    const doc = compatFromEditorStore(store);
    const paragraph = doc.root.children.find((n) => n.type === "paragraph");
    // `format: "center"` is exactly what `content-renderer`'s `elementAlign` maps to a
    // centered paragraph, so the reader is already wired with no compat change.
    expect(paragraph?.format).toBe("center");
  });
});

describe("alignment — the live editor paints it (blockStyleFor)", () => {
  it("emits text-align for center/right/justify, none for left/absent", () => {
    // The bug: the live editor never painted `attrs.format`, so the control was a
    // model-only no-op. blockStyleFor must produce a `textAlign` for a real alignment.
    expect(
      blockStyleFor({ attrs: { format: "center" }, type: "paragraph" }),
    ).toMatchObject({ textAlign: "center" });
    expect(
      blockStyleFor({ attrs: { format: "right" }, type: "heading" }),
    ).toMatchObject({ textAlign: "right" });
    expect(
      blockStyleFor({ attrs: { format: "justify" }, type: "paragraph" }),
    ).toMatchObject({ textAlign: "justify" });
    // Left/absent stays the default (no textAlign), so the shared fast-path applies.
    expect(
      blockStyleFor({ attrs: { format: "left" }, type: "paragraph" }).textAlign,
    ).toBeUndefined();
    expect(blockStyleFor({ type: "paragraph" }).textAlign).toBeUndefined();
  });
});

describe("alignment — the Home toolbar control (note.md item 1)", () => {
  it("registers an `align` popover in the home.paragraph slot, ribbon-only", () => {
    const align = getCommand("align");
    expect(align).toBeDefined();
    expect(align?.kind).toBe("popover");
    expect(align?.slot).toBe("home.paragraph");
    expect(align?.surfaces.ribbon).toBe("primary");
    // Block-layout control, not a flat-surface selection action.
    expect(align?.surfaces.flyout).toBeUndefined();
    expect(align?.surfaces.contextMenu).toBeUndefined();
  });
});
