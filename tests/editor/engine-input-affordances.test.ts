// @vitest-environment jsdom
/**
 * Input affordances (docs/010 Phase 8 AC8): markdown shortcuts and rich HTML
 * paste through the single sanitization boundary.
 */
import { describe, expect, it } from "vitest";
import {
  createEditorStore,
  createIdAllocator,
  detectMarkdownShortcut,
  editorSnapshotFromCompat,
  makeTextNode,
  pointAtOffset,
  type EditorStore,
  type NodeId,
} from "../../packages/editor/src/core";
import { sanitizeHtmlToCompat } from "../../packages/editor/src/view/paste-html";

function single(text: string): { store: EditorStore; id: NodeId } {
  const allocator = createIdAllocator("idco_client_md");
  const node = makeTextNode({
    content: allocator.createTextSlice(text),
    id: allocator.createNodeId(),
  });
  const store = createEditorStore({
    allocator,
    snapshot: {
      body: { blocks: { [node.id]: node }, order: [node.id] },
      settings: {},
      version: 1,
    },
  });
  const point = pointAtOffset(node.id, node.content, text.length);
  store.dispatch({
    origin: "local",
    selectionAfter: { anchor: point, focus: point, type: "text" },
    steps: [],
  });
  return { id: node.id, store };
}

describe("markdown shortcuts (AC8)", () => {
  it("detects block prefixes and inline code", () => {
    expect(detectMarkdownShortcut("# ", 2, "paragraph")).toMatchObject({
      blockType: "heading",
      kind: "block",
      tag: "h1",
    });
    expect(detectMarkdownShortcut("- ", 2, "paragraph")).toMatchObject({
      blockType: "listitem",
      kind: "block",
    });
    expect(detectMarkdownShortcut("> ", 2, "paragraph")).toMatchObject({
      blockType: "quote",
      kind: "block",
    });
    expect(detectMarkdownShortcut("`code`", 6, "paragraph")).toMatchObject({
      kind: "inline-code",
    });
    expect(detectMarkdownShortcut("plain text", 5, "paragraph")).toBeNull();
  });

  it("applies a heading block shortcut, stripping the prefix", () => {
    const { store, id } = single("## ");
    const shortcut = detectMarkdownShortcut("## ", 3, "paragraph")!;
    store.command({ shortcut, type: "apply-markdown" });
    const node = store.requireTextNode(id);
    expect(node.type).toBe("heading");
    expect(node.attrs?.tag).toBe("h2");
    expect(node.content.text).toBe("");
  });

  it("converts a list prefix and inverts on undo", () => {
    const { store, id } = single("- ");
    store.command({
      shortcut: detectMarkdownShortcut("- ", 2, "paragraph")!,
      type: "apply-markdown",
    });
    expect(store.requireTextNode(id).type).toBe("listitem");
    store.undo();
    const node = store.requireTextNode(id);
    expect(node.type).toBe("paragraph");
    expect(node.content.text).toBe("- ");
  });
});

describe("HTML paste sanitization boundary (AC8)", () => {
  it("parses block + inline structure into compat nodes", () => {
    const nodes = sanitizeHtmlToCompat(
      "<h2>Title</h2><p>Some <strong>bold</strong> and <a href='https://x.test'>link</a>.</p><ul><li>one</li><li>two</li></ul>",
    );
    expect(nodes.map((n) => n.type)).toEqual([
      "heading",
      "paragraph",
      "listitem",
      "listitem",
    ]);
    const paragraph = nodes[1]!;
    const link = paragraph.children?.find((c) => c.type === "link");
    expect(link?.url).toBe("https://x.test");
  });

  it("strips scripts, event handlers, and javascript: links", () => {
    const nodes = sanitizeHtmlToCompat(
      "<p onclick='evil()'>safe<script>steal()</script></p><a href='javascript:evil()'>x</a>",
    );
    const serialized = JSON.stringify(nodes);
    expect(serialized).not.toContain("evil");
    expect(serialized).not.toContain("javascript:");
    expect(serialized).not.toContain("steal");
    // The safe text survives.
    expect(serialized).toContain("safe");
  });

  it("round-trips a paste into the model through the importer", () => {
    const nodes = sanitizeHtmlToCompat("<p>Hello <em>world</em></p>");
    const snapshot = editorSnapshotFromCompat({ root: { children: nodes } });
    const firstId = snapshot.body.order[0]!;
    const leaf = snapshot.body.blocks[firstId]!;
    expect(leaf.kind === "text" && leaf.content.text).toBe("Hello world");
    expect(
      leaf.kind === "text" && leaf.marks.some((m) => m.kind === "italic"),
    ).toBe(true);
  });
});
