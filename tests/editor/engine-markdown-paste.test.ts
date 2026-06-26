/**
 * Markdown paste / import (docs/030 §7.1 D1, MIO-1) + native clipboard fragment (§7.2).
 *
 * `markdownToNodes` builds a native fragment from a markdown-it token stream — never compat,
 * never HTML. These tests pin one parse per node type and inline mark, the task-list and
 * directive grammar, the security edges (javascript: link neutralized, raw HTML escaped), the
 * documented table drop, the descendant-aware fragment insert, the native-clipboard round
 * trip, and the export↔import round-trip for the representable set.
 */
import { describe, expect, it } from "vitest";
import { markdownToNodes } from "../../packages/editor/src/view/markdown/from-markdown";
import {
  IDCO_SNAPSHOT_MIME,
  collectSelectionFragment,
  parseFragment,
  serializeFragment,
} from "../../packages/editor/src/view/markdown/native-clipboard";
import { snapshotToMarkdown } from "../../packages/editor/src/view/markdown/to-markdown";
import {
  compileInsertFragment,
  createDefaultBlockRegistry,
  createEditorStore,
  createIdAllocator,
  pointAtOffset,
  resolveBoundaryOffset,
  type EditorNode,
  type ObjectNode,
  type StructuralNode,
  type TextLeafNode,
} from "../../packages/editor/src/core";

function parse(src: string) {
  const allocator = createIdAllocator("idco_client_md_paste");
  const registry = createDefaultBlockRegistry();
  return markdownToNodes(src, allocator, registry);
}

/** The top-level nodes of a fragment, in order. */
function tops(fragment: ReturnType<typeof parse>): EditorNode[] {
  return fragment.order.map((id) => fragment.blocks[id]!);
}

function textOf(node: EditorNode | undefined): string {
  return node && node.kind === "text" ? node.content.text : "";
}

function pt(node: TextLeafNode, offset: number) {
  return pointAtOffset(node.id, node.content, offset);
}

describe("markdown paste — block types", () => {
  it("parses headings h1–h6", () => {
    const fragment = parse("# A\n\n## B\n\n###### F");
    const nodes = tops(fragment) as TextLeafNode[];
    expect(nodes.map((n) => [n.type, n.attrs?.tag, n.content.text])).toEqual([
      ["heading", "h1", "A"],
      ["heading", "h2", "B"],
      ["heading", "h6", "F"],
    ]);
  });

  it("parses paragraphs and a blockquote into quote leaves", () => {
    const fragment = parse("Hello\n\n> Quoted");
    const nodes = tops(fragment);
    expect([nodes[0]!.type, textOf(nodes[0])]).toEqual(["paragraph", "Hello"]);
    expect([nodes[1]!.type, textOf(nodes[1])]).toEqual(["quote", "Quoted"]);
  });

  it("parses bullet, ordered, and task lists", () => {
    const bullet = tops(parse("- a\n- b")) as TextLeafNode[];
    expect(
      bullet.map((n) => [n.type, n.attrs?.listType, n.content.text]),
    ).toEqual([
      ["listitem", "bullet", "a"],
      ["listitem", "bullet", "b"],
    ]);
    const ordered = tops(parse("1. one\n2. two")) as TextLeafNode[];
    expect(ordered.every((n) => n.attrs?.listType === "number")).toBe(true);
    const tasks = tops(parse("- [ ] todo\n- [x] done")) as TextLeafNode[];
    expect(tasks.map((n) => [n.attrs?.checked, n.content.text])).toEqual([
      [false, "todo"],
      [true, "done"],
    ]);
  });

  it("parses a fenced code block with its language", () => {
    const fragment = parse("```ts\nconst a = 1\n```");
    const node = tops(fragment)[0] as ObjectNode;
    expect(node.kind).toBe("object");
    expect(node.type).toBe("code-block");
    expect(node.baked?.kind).toBe("code");
    const payload = node.baked?.payload as { code: string; language: string };
    expect(payload.language).toBe("ts");
    expect(payload.code).toBe("const a = 1");
  });

  it("parses a horizontal rule as a divider", () => {
    const node = tops(parse("---"))[0] as ObjectNode;
    expect([node.kind, node.type]).toEqual(["object", "divider"]);
  });

  it("parses a :::tone callout directive into a structural callout", () => {
    const fragment = parse(":::warning\nBe careful\n:::");
    const callout = tops(fragment)[0] as StructuralNode;
    expect([callout.kind, callout.type, callout.attrs?.tone]).toEqual([
      "structural",
      "callout",
      "warning",
    ]);
    const child = fragment.blocks[callout.children[0]!];
    expect(textOf(child)).toBe("Be careful");
  });

  it("parses a :::toc directive into a table-of-contents object", () => {
    const node = tops(parse(":::toc\n:::"))[0] as ObjectNode;
    expect([node.kind, node.type]).toEqual(["object", "table-of-contents"]);
  });

  it("promotes a list item with a code block to a structural listitem", () => {
    const fragment = parse("- item\n\n  ```js\n  go()\n  ```");
    const container = tops(fragment).find(
      (n) => n.kind === "structural" && n.type === "listitem",
    ) as StructuralNode | undefined;
    expect(container).toBeTruthy();
    const kids = container!.children.map((id) => fragment.blocks[id]!);
    expect(kids[0]!.type).toBe("listitem");
    expect(
      kids.some((k) => k.kind === "object" && k.type === "code-block"),
    ).toBe(true);
  });
});

describe("markdown paste — inline marks", () => {
  it("parses bold/italic/strike/highlight/code/link as native marks", () => {
    const node = tops(
      parse("**b** *i* ~~s~~ ==h== `c` [t](https://x.test)"),
    )[0] as TextLeafNode;
    const kinds = node.marks.map((m) => m.kind).sort();
    expect(kinds).toEqual(
      ["bold", "code", "highlight", "italic", "link", "strikethrough"].sort(),
    );
    const link = node.marks.find((m) => m.kind === "link");
    expect(link?.attrs?.href).toBe("https://x.test");
  });

  it("anchors mark ranges to the right offsets", () => {
    const node = tops(parse("a **bold** c"))[0] as TextLeafNode;
    const bold = node.marks.find((m) => m.kind === "bold")!;
    const from = resolveBoundaryOffset(node.content, bold.from);
    const to = resolveBoundaryOffset(node.content, bold.to);
    expect(node.content.text.slice(from, to)).toBe("bold");
  });

  it("neutralizes a javascript: link href", () => {
    const node = tops(parse("[x](javascript:alert(1))"))[0] as TextLeafNode;
    const link = node.marks.find((m) => m.kind === "link");
    // safeHref clears the unsafe href, so no link mark (or no href) survives.
    expect(link?.attrs?.href ?? "").toBe("");
  });
});

describe("markdown paste — security + lossy edges", () => {
  it("escapes raw HTML to text, never into nodes", () => {
    const node = tops(parse("a <script>evil()</script> b"))[0] as TextLeafNode;
    expect(node.kind).toBe("text");
    // The angle-bracket markup is inert text; no script node, no object.
    expect(node.content.text).toContain("script");
  });

  it("drops a table with a logged note rather than mangling it", () => {
    const fragment = parse("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(fragment.dropped).toContain("table");
    expect(fragment.order.length).toBe(0);
  });
});

describe("fragment insert (descendant-aware)", () => {
  it("inserts a structural callout subtree as one undoable transaction", () => {
    const allocator = createIdAllocator("idco_client_insert");
    const store = createEditorStore({
      allocator,
      snapshot: {
        body: {
          blocks: {},
          order: [],
        },
        settings: {},
        version: 1,
      },
    });
    const fragment = markdownToNodes(
      ":::info\nHi\n:::",
      store.allocator,
      store.registry,
    );
    const tr = compileInsertFragment(store, fragment);
    expect(tr).not.toBeNull();
    store.dispatch(tr!);
    const order = store.order;
    const callout = store.getNode(order[order.length - 1]!) as StructuralNode;
    expect(callout.type).toBe("callout");
    // The descendant paragraph is resolvable in the store (inserted with the subtree).
    expect(store.getNode(callout.children[0]!)).toBeTruthy();
    store.assertParentInvariant();
    // One transaction → one undo removes the whole subtree.
    store.undo();
    expect(store.getNode(callout.id)).toBeUndefined();
  });
});

describe("native clipboard fragment", () => {
  it("round-trips a fragment through serialize/parse byte-identically", () => {
    const fragment = parse("# Title\n\n- a\n- b");
    const serialized = serializeFragment({
      blocks: fragment.blocks,
      order: fragment.order,
    });
    const parsed = parseFragment(serialized);
    expect(parsed).not.toBeNull();
    expect(parsed!.order).toEqual(fragment.order);
    expect(parsed!.blocks).toEqual(fragment.blocks);
    expect(IDCO_SNAPSHOT_MIME).toBe("application/x-idco-snapshot");
  });

  it("rejects a malformed fragment", () => {
    expect(parseFragment("not json")).toBeNull();
    expect(parseFragment(JSON.stringify({ version: 99 }))).toBeNull();
    expect(
      parseFragment(
        JSON.stringify({ blocks: {}, order: ["missing"], version: 1 }),
      ),
    ).toBeNull();
  });

  it("collects a block-level selection but not a single partial one", () => {
    const allocator = createIdAllocator("idco_client_copy");
    const fragment = parse("para one\n\npara two");
    const store = createEditorStore({
      allocator: createIdAllocator("idco_client_copy_store"),
      snapshot: { body: fragment, settings: {}, version: 1 },
    });
    const order = store.order;
    const first = store.getNode(order[0]!) as TextLeafNode;
    const second = store.getNode(order[1]!) as TextLeafNode;
    // A selection spanning two blocks → a native fragment.
    store.dispatch({
      origin: "local",
      selectionAfter: {
        anchor: pt(first, 0),
        focus: pt(second, 3),
        type: "text",
      },
      steps: [],
    });
    const multi = collectSelectionFragment(store);
    expect(multi?.order).toEqual([first.id, second.id]);
    // A selection inside one block → null (inline copy stays markdown/plain).
    store.dispatch({
      origin: "local",
      selectionAfter: {
        anchor: pt(first, 0),
        focus: pt(first, 3),
        type: "text",
      },
      steps: [],
    });
    expect(collectSelectionFragment(store)).toBeNull();
    void allocator;
  });
});

describe("round-trip (representable set)", () => {
  const stableMd = (src: string): string => {
    const first = parse(src);
    const md1 = snapshotToMarkdown({
      body: { blocks: first.blocks, order: first.order },
      settings: {},
      version: 1,
    });
    const second = parse(md1);
    const md2 = snapshotToMarkdown({
      body: { blocks: second.blocks, order: second.order },
      settings: {},
      version: 1,
    });
    expect(md2).toBe(md1);
    return md1;
  };

  it("md → nodes → md is stable", () => {
    const md = stableMd(
      "# Heading\n\nA **bold** and *italic* line.\n\n- one\n- two\n\n```ts\nx\n```\n\n---",
    );
    expect(md).toContain("# Heading");
  });

  it("preserves a hard line break (no collapse to a space)", () => {
    const md = stableMd("line one  \nline two");
    // The hard break survives as the two-trailing-space form, not a collapsed space.
    expect(md).toContain("line one  \nline two");
  });

  it("preserves nested marks", () => {
    const md = stableMd("**bold *and italic* end**");
    expect(md).toContain("italic");
  });

  it("keeps literal == / ~~ from re-importing as marks", () => {
    // A leaf whose literal text is `==x==` exports escaped and must NOT round-trip into a
    // highlight mark.
    const allocator = createIdAllocator("idco_client_escape");
    const node = makeTextNodeLiteral(allocator, "a ==x== b");
    const md = snapshotToMarkdown({
      body: { blocks: { [node.id]: node }, order: [node.id] },
      settings: {},
      version: 1,
    });
    const reparsed = parse(md);
    const leaf = reparsed.blocks[reparsed.order[0]!] as TextLeafNode;
    expect(leaf.content.text).toBe("a ==x== b");
    expect(leaf.marks.some((m) => m.kind === "highlight")).toBe(false);
  });
});

describe("native fragment paste into the SAME document (id remap)", () => {
  it("pastes a copied block back into its own store without an id collision", () => {
    const fragment = parse("# Original\n\nbody");
    const store = createEditorStore({
      allocator: createIdAllocator("idco_client_same"),
      snapshot: { body: fragment, settings: {}, version: 1 },
    });
    const before = store.order.length;
    // Re-insert the SAME fragment (its ids already live in the store) — the remap must mint
    // fresh ids so this does not throw "Node exists".
    const tr = compileInsertFragment(store, {
      blocks: fragment.blocks,
      order: fragment.order,
    });
    expect(tr).not.toBeNull();
    expect(() => store.dispatch(tr!)).not.toThrow();
    expect(store.order.length).toBe(before + fragment.order.length);
    store.assertParentInvariant();
    // The inserted heading is a distinct node from the original (fresh id).
    const headings = store.order
      .map((id) => store.getNode(id))
      .filter((n) => n?.kind === "text" && n.type === "heading");
    expect(headings.length).toBe(2);
    expect(headings[0]!.id).not.toBe(headings[1]!.id);
  });
});

/** A literal text leaf with no marks (for the escaping round-trip test). */
function makeTextNodeLiteral(
  allocator: ReturnType<typeof createIdAllocator>,
  text: string,
): TextLeafNode {
  // Reuse the engine's own leaf constructor via a tiny parse-free path: build through the
  // store-free maker by importing it lazily is overkill — instead parse a paragraph and swap
  // its text is fragile, so construct directly with the allocator's slice.
  return {
    content: allocator.createTextSlice(text),
    id: allocator.createNodeId(),
    kind: "text",
    marks: [],
    type: "paragraph",
  };
}
