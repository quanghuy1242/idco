// @vitest-environment jsdom
/**
 * Input affordances (docs/010 Phase 8 AC8): markdown shortcuts and rich HTML
 * paste through the single sanitization boundary.
 */
import { describe, expect, it } from "vitest";
import {
  bakeObjectData,
  compatFromSnapshot,
  createDefaultBlockRegistry,
  createEditorStore,
  createIdAllocator,
  detectMarkdownShortcut,
  editorSnapshotFromCompat,
  makeObjectNode,
  makeTextNode,
  pointAtOffset,
  type EditorStore,
  type NodeId,
} from "../../packages/editor/src/core";
import { sanitizeHtmlToCompat } from "../../packages/editor/src/view/paste-html";
import { activateInsertedObject } from "../../packages/editor/src/view/spi";
import { registerBuiltInNodeViews } from "../../packages/editor/src/view/nodes";

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

describe("markdown hardening (docs/030 §4.1)", () => {
  it("detects h4–h6 heading prefixes", () => {
    expect(detectMarkdownShortcut("#### ", 5, "paragraph")).toMatchObject({
      blockType: "heading",
      kind: "block",
      tag: "h4",
    });
    expect(detectMarkdownShortcut("##### ", 6, "paragraph")).toMatchObject({
      tag: "h5",
    });
    expect(detectMarkdownShortcut("###### ", 7, "paragraph")).toMatchObject({
      tag: "h6",
    });
  });

  it("applies an h4 heading, stripping the prefix", () => {
    const { store, id } = single("#### ");
    store.command({
      shortcut: detectMarkdownShortcut("#### ", 5, "paragraph")!,
      type: "apply-markdown",
    });
    const node = store.requireTextNode(id);
    expect(node.type).toBe("heading");
    expect(node.attrs?.tag).toBe("h4");
    expect(node.content.text).toBe("");
  });

  it("detects task-list prefixes and marks the item checked/unchecked", () => {
    expect(detectMarkdownShortcut("[ ] ", 4, "paragraph")).toMatchObject({
      blockType: "listitem",
      checked: false,
      kind: "block",
      listType: "bullet",
    });
    expect(detectMarkdownShortcut("[x] ", 4, "paragraph")).toMatchObject({
      checked: true,
      kind: "block",
    });
  });

  it("applies a checklist prefix, setting the checked flag", () => {
    const { store, id } = single("[x] ");
    store.command({
      shortcut: detectMarkdownShortcut("[x] ", 4, "paragraph")!,
      type: "apply-markdown",
    });
    const node = store.requireTextNode(id);
    expect(node.type).toBe("listitem");
    expect(node.attrs?.checked).toBe(true);
    expect(node.attrs?.listType).toBe("bullet");
    expect(node.content.text).toBe("");
  });

  it("toggles a checklist item on and off via set-block-type, clearing the flag", () => {
    const { store, id } = single("task");
    store.command({
      blockType: "listitem",
      checked: false,
      listType: "bullet",
      type: "set-block-type",
    });
    expect(store.requireTextNode(id).attrs?.checked).toBe(false);
    store.command({ blockType: "paragraph", type: "set-block-type" });
    expect(store.requireTextNode(id).attrs?.checked).toBeUndefined();
  });

  it("round-trips a checklist item's checked flag through compat", () => {
    const compat = {
      root: {
        children: [
          {
            checked: true,
            children: [{ text: "done", type: "text" }],
            listType: "bullet",
            type: "listitem",
          },
        ],
      },
    };
    const out = compatFromSnapshot(editorSnapshotFromCompat(compat));
    expect(out.root.children[0]).toMatchObject({
      checked: true,
      type: "listitem",
    });
  });

  it("does NOT auto-pair a `[` at the start of a block (task-marker reserve)", () => {
    expect(detectMarkdownShortcut("[", 1, "paragraph", "[")).toBeNull();
    // A `[` mid-text still auto-pairs.
    expect(detectMarkdownShortcut("a[", 2, "paragraph", "[")).toMatchObject({
      close: "]",
      kind: "wrap-pair",
    });
  });

  it("detects paired inline marks and disambiguates ** from *", () => {
    expect(
      detectMarkdownShortcut("**bold**", 8, "paragraph", "*"),
    ).toMatchObject({ kind: "mark-pair", markKind: "bold", markerLength: 2 });
    expect(detectMarkdownShortcut("*it*", 4, "paragraph", "*")).toMatchObject({
      kind: "mark-pair",
      markKind: "italic",
      markerLength: 1,
    });
    expect(detectMarkdownShortcut("~~no~~", 6, "paragraph", "~")).toMatchObject(
      {
        markKind: "strikethrough",
      },
    );
    expect(detectMarkdownShortcut("==hi==", 6, "paragraph", "=")).toMatchObject(
      {
        markKind: "highlight",
      },
    );
    // A bold run does not also fire italic.
    expect(detectMarkdownShortcut("**b**", 5, "paragraph", "*")).toMatchObject({
      markKind: "bold",
    });
  });

  it("applies a bold paired marker, removing both markers and marking the run", () => {
    const { store, id } = single("**bold**");
    store.command({
      shortcut: detectMarkdownShortcut("**bold**", 8, "paragraph", "*")!,
      type: "apply-markdown",
    });
    const node = store.requireTextNode(id);
    expect(node.content.text).toBe("bold");
    const bold = node.marks.find((mark) => mark.kind === "bold");
    expect(bold?.from.offset).toBe(0);
    expect(bold?.to.offset).toBe(4);
  });

  it("applies an inline link `[text](url)` with a sanitized href", () => {
    const { store, id } = single("[hi](https://x.test)");
    store.command({
      shortcut: detectMarkdownShortcut(
        "[hi](https://x.test)",
        20,
        "paragraph",
        ")",
      )!,
      type: "apply-markdown",
    });
    const node = store.requireTextNode(id);
    expect(node.content.text).toBe("hi");
    const link = node.marks.find((mark) => mark.kind === "link");
    expect(link?.attrs?.href).toBe("https://x.test");
  });

  it("autolinks a bare URL on the trailing space without changing the text", () => {
    const { store, id } = single("https://x.test ");
    store.command({
      shortcut: detectMarkdownShortcut(
        "https://x.test ",
        15,
        "paragraph",
        " ",
      )!,
      type: "apply-markdown",
    });
    const node = store.requireTextNode(id);
    expect(node.content.text).toBe("https://x.test ");
    const link = node.marks.find((mark) => mark.kind === "link");
    expect(link?.attrs?.href).toBe("https://x.test");
    expect(link?.to.offset).toBe(14);
  });

  it("trims trailing sentence punctuation off an autolinked URL (GFM rule)", () => {
    // `see https://x.test. ` — the period is prose, not part of the link.
    const shortcut = detectMarkdownShortcut(
      "see https://x.test. ",
      20,
      "paragraph",
      " ",
    );
    expect(shortcut).toMatchObject({ kind: "autolink", url: "https://x.test" });
    const { store, id } = single("see https://x.test. ");
    store.command({ shortcut: shortcut!, type: "apply-markdown" });
    const node = store.requireTextNode(id);
    const link = node.marks.find((mark) => mark.kind === "link");
    expect(link?.attrs?.href).toBe("https://x.test");
    // The mark ends before the trailing `.` (offset 18), which stays plain text.
    expect(link?.to.offset).toBe(18);
  });

  it("keeps a balanced `)` in the URL path but drops an unbalanced trailing one", () => {
    // Wikipedia-style path paren is balanced, so it stays in the link…
    expect(
      detectMarkdownShortcut("https://x.test/a_(b) ", 21, "paragraph", " "),
    ).toMatchObject({ url: "https://x.test/a_(b)" });
    // …while a trailing `)` with no matching opener inside the URL is trimmed
    // (the opener here is prose: `(see …)`).
    expect(
      detectMarkdownShortcut("(see https://x.test) ", 21, "paragraph", " "),
    ).toMatchObject({ url: "https://x.test" });
  });

  it("converts a `---` line into a divider object plus a trailing paragraph", () => {
    expect(detectMarkdownShortcut("---", 3, "paragraph", "-")).toMatchObject({
      kind: "block-object",
      objectType: "divider",
    });
    const { store, id } = single("---");
    store.command({
      shortcut: detectMarkdownShortcut("---", 3, "paragraph", "-")!,
      type: "apply-markdown",
    });
    expect(store.getNode(id)).toBeUndefined();
    const first = store.getNode(store.order[0]!);
    expect(first?.kind === "object" && first.type).toBe("divider");
    const second = store.getNode(store.order[1]!);
    expect(second?.kind === "text" && second.type).toBe("paragraph");
  });

  it("converts a ``` fence into a code-block object", () => {
    expect(detectMarkdownShortcut("```", 3, "paragraph", "`")).toMatchObject({
      kind: "block-object",
      objectType: "code-block",
    });
    const { store, id } = single("```");
    store.command({
      shortcut: detectMarkdownShortcut("```", 3, "paragraph", "`")!,
      type: "apply-markdown",
    });
    expect(store.getNode(id)).toBeUndefined();
    const first = store.getNode(store.order[0]!);
    expect(first?.kind === "object" && first.type).toBe("code-block");
  });
});

// Build a store holding one object node of `type`, selected as a node-selection
// (what every insert path — slash/palette or the markdown ` ``` ` affordance —
// leaves behind). The default registry knows the built-in object types.
function singleObject(type: string): { store: EditorStore; id: NodeId } {
  const allocator = createIdAllocator("idco_client_obj");
  const registry = createDefaultBlockRegistry();
  const normalized = registry.normalizeSnapshotObject(type, {});
  const baked = bakeObjectData(registry, type, normalized.data);
  const node = makeObjectNode({
    baked: baked.baked ?? undefined,
    data: normalized.data,
    id: allocator.createNodeId(),
    status: baked.status,
    type,
  });
  const store = createEditorStore({
    allocator,
    registry,
    snapshot: {
      body: { blocks: { [node.id]: node }, order: [node.id] },
      settings: {},
      version: 1,
    },
  });
  store.dispatch({
    origin: "local",
    selectionAfter: { node: node.id, type: "node" },
    steps: [],
  });
  return { id: node.id, store };
}

describe("inserted-object activation (docs/030 §4.1)", () => {
  // Populate the view registry so `getNodeView` resolves the real built-in views
  // and their `activateOnInsert` flags (code-block opts in; divider does not).
  registerBuiltInNodeViews();

  it("drills into a code-block (activateOnInsert) so the caret is ready", () => {
    const { store, id } = singleObject("code-block");
    expect(store.activeObjectId).toBeNull();
    activateInsertedObject(store);
    expect(store.activeObjectId).toBe(id);
  });

  it("leaves a divider as a bare node-selection (no live surface)", () => {
    const { store } = singleObject("divider");
    activateInsertedObject(store);
    expect(store.activeObjectId).toBeNull();
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
