// @vitest-environment jsdom
/**
 * The owned-model table-of-contents node + the read-side document-index SPI
 * (docs/016 §10, note.md read-side SPI).
 *
 * The TOC node is scoped — it cannot read the document from its own node — so it
 * consumes the whole-document heading rollup through `useDocumentIndex`, which the
 * reader (`RestingDocument`) builds synchronously from its snapshot and provides.
 * These tests prove the wiring at rest: the heading renders the anchor the TOC
 * links to, the list projects by the node's level/numbering settings, and an aside
 * TOC falls back to an inline list in the reader (which has no floating rail).
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  RestingDocument,
  bakeObjectData,
  createDefaultBlockRegistry,
  createIdAllocator,
  makeObjectNode,
  makeTextNode,
  type BlockRegistry,
  type EditorDocumentSnapshot,
  type EditorNode,
  type IdAllocator,
  type JsonValue,
  type NodeId,
  type ObjectNode,
} from "../../packages/editor/src";

function tocNode(
  allocator: IdAllocator,
  registry: BlockRegistry,
  settings: JsonValue,
): ObjectNode {
  const normalized = registry.normalizeSnapshotObject(
    "table-of-contents",
    settings,
  );
  const baked = bakeObjectData(registry, "table-of-contents", normalized.data);
  return makeObjectNode({
    baked: baked.baked ?? undefined,
    data: normalized.data,
    id: allocator.createNodeId(),
    status: baked.status,
    type: "table-of-contents",
  });
}

function snapshotOf(order: readonly EditorNode[]): EditorDocumentSnapshot {
  return {
    body: {
      blocks: Object.fromEntries(order.map((n) => [n.id, n])) as Record<
        NodeId,
        EditorNode
      >,
      order: order.map((n) => n.id),
    },
    settings: {},
    version: 1,
  };
}

describe("table-of-contents node — resting render via the read-side index", () => {
  it("links each entry to the heading's anchor and renders the title", () => {
    const allocator = createIdAllocator("idco_client_toc_render");
    const registry = createDefaultBlockRegistry();
    const heading = makeTextNode({
      attrs: { tag: "h2" },
      content: allocator.createTextSlice("Install"),
      id: allocator.createNodeId(),
      type: "heading",
    });
    const toc = tocNode(allocator, registry, {
      maxLevel: 6,
      minLevel: 1,
      placement: "inline",
      style: "panel",
      title: "On this page",
    });
    const { container } = render(
      <RestingDocument snapshot={snapshotOf([heading, toc])} />,
    );

    // The heading element renders the same anchor the entry links to (NodeId here).
    expect(container.querySelector("h2")?.id).toBe(heading.id);
    const link = container.querySelector<HTMLAnchorElement>("nav a");
    expect(link?.getAttribute("href")).toBe(`#${heading.id}`);
    expect(link?.textContent).toContain("Install");
    expect(container.querySelector("nav")?.textContent).toContain(
      "On this page",
    );
  });

  it("filters by level window and applies decimal numbering", () => {
    const allocator = createIdAllocator("idco_client_toc_levels");
    const registry = createDefaultBlockRegistry();
    const h2 = makeTextNode({
      attrs: { tag: "h2" },
      content: allocator.createTextSlice("Top"),
      id: allocator.createNodeId(),
      type: "heading",
    });
    const h3 = makeTextNode({
      attrs: { tag: "h3" },
      content: allocator.createTextSlice("Nested"),
      id: allocator.createNodeId(),
      type: "heading",
    });
    const h4 = makeTextNode({
      attrs: { tag: "h4" },
      content: allocator.createTextSlice("TooDeep"),
      id: allocator.createNodeId(),
      type: "heading",
    });
    const toc = tocNode(allocator, registry, {
      maxLevel: 3,
      minLevel: 2,
      numbering: "decimal",
      placement: "inline",
      title: "",
    });
    const { container } = render(
      <RestingDocument snapshot={snapshotOf([h2, h3, h4, toc])} />,
    );

    const links = [...container.querySelectorAll<HTMLAnchorElement>("nav a")];
    // h4 is outside the level window; the remaining two are numbered 1, 1.1.
    expect(links).toHaveLength(2);
    expect(links[0]?.textContent).toContain("1");
    expect(links[0]?.textContent).toContain("Top");
    expect(links[1]?.textContent).toContain("1.1");
    expect(links[1]?.textContent).toContain("Nested");
  });

  it("renders an aside TOC inline in the reader (no rail exists there)", () => {
    const allocator = createIdAllocator("idco_client_toc_aside");
    const registry = createDefaultBlockRegistry();
    const heading = makeTextNode({
      attrs: { tag: "h2" },
      content: allocator.createTextSlice("Aside heading"),
      id: allocator.createNodeId(),
      type: "heading",
    });
    const toc = tocNode(allocator, registry, {
      maxLevel: 6,
      minLevel: 1,
      placement: "aside",
      side: "right",
      title: "Contents",
    });
    const { container } = render(
      <RestingDocument snapshot={snapshotOf([heading, toc])} />,
    );

    // The reader has no floating rail, so an aside TOC still shows its list inline.
    const link = container.querySelector<HTMLAnchorElement>("nav a");
    expect(link?.getAttribute("href")).toBe(`#${heading.id}`);
    expect(link?.textContent).toContain("Aside heading");
  });
});
