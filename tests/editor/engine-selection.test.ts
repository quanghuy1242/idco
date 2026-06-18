/**
 * docs/010 Phase 5 / docs/011 §13.9: clipboard reads the model, not the DOM.
 *
 * These headless tests prove the selection serializer walks the full model
 * range in document order, including blocks that virtualization would unmount,
 * so cross-virtual copy is structural rather than limited to the on-screen DOM.
 */
import { describe, expect, it } from "vitest";
import {
  collectSelectionText,
  createEditorStore,
  createIdAllocator,
  makeStructuralNode,
  makeTextNode,
  pointAtOffset,
  type EditorDocumentSnapshot,
  type EditorNode,
  type NodeId,
  type TextLeafNode,
} from "../../packages/editor/src/core";

const CLIENT = "idco_client_selection";

function snapshot(
  order: readonly NodeId[],
  nodes: readonly EditorNode[],
): EditorDocumentSnapshot {
  return {
    body: {
      blocks: Object.fromEntries(
        nodes.map((node) => [node.id, node]),
      ) as Record<NodeId, EditorNode>,
      order,
    },
    settings: {},
    version: 1,
  };
}

function paragraph(
  allocator: ReturnType<typeof createIdAllocator>,
  text: string,
) {
  return makeTextNode({
    content: allocator.createTextSlice(text),
    id: allocator.createNodeId(),
  });
}

describe("engine selection serialization", () => {
  it("serializes the full model range across many blocks, including offscreen middles", () => {
    const allocator = createIdAllocator(CLIENT);
    const blocks: TextLeafNode[] = Array.from(
      { length: 100 },
      (_value, index) => paragraph(allocator, `block-${index}`),
    );
    const store = createEditorStore({
      allocator,
      snapshot: snapshot(
        blocks.map((node) => node.id),
        blocks,
      ),
    });
    const start = blocks[3]!;
    const end = blocks[90]!;
    const text = collectSelectionText(store, {
      anchor: pointAtOffset(start.id, start.content, 0),
      focus: pointAtOffset(end.id, end.content, end.content.text.length),
      type: "text",
    });

    const lines = text.split("\n");
    expect(lines).toHaveLength(88);
    expect(lines[0]).toBe("block-3");
    expect(lines.at(-1)).toBe("block-90");
    // The middle blocks are present even though a virtualized view would never
    // mount them at once.
    expect(text).toContain("block-50");
  });

  it("walks nested structural children in reading order", () => {
    const allocator = createIdAllocator(CLIENT);
    const outer = paragraph(allocator, "intro");
    const itemA = makeTextNode({
      content: allocator.createTextSlice("first"),
      id: allocator.createNodeId(),
      type: "listitem",
    });
    const itemB = makeTextNode({
      content: allocator.createTextSlice("second"),
      id: allocator.createNodeId(),
      type: "listitem",
    });
    const list = makeStructuralNode({
      children: [itemA.id, itemB.id],
      id: allocator.createNodeId(),
      type: "list",
    });
    const store = createEditorStore({
      allocator,
      snapshot: snapshot([outer.id, list.id], [outer, list, itemA, itemB]),
    });

    const text = collectSelectionText(store, {
      anchor: pointAtOffset(outer.id, outer.content, 0),
      focus: pointAtOffset(itemB.id, itemB.content, itemB.content.text.length),
      type: "text",
    });
    expect(text).toBe("intro\nfirst\nsecond");
  });

  it("returns an empty string for a collapsed caret or a non-text selection", () => {
    const allocator = createIdAllocator(CLIENT);
    const block = paragraph(allocator, "solo");
    const store = createEditorStore({
      allocator,
      snapshot: snapshot([block.id], [block]),
    });
    const caret = pointAtOffset(block.id, block.content, 2);
    expect(
      collectSelectionText(store, {
        anchor: caret,
        focus: caret,
        type: "text",
      }),
    ).toBe("");
    expect(collectSelectionText(store, { node: block.id, type: "node" })).toBe(
      "",
    );
  });
});
