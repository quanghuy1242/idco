/**
 * Markdown export (docs/030 §7.2 D2, MIO-2).
 *
 * `snapshotToMarkdown` is a *lossy one-way* projection. These tests pin one expected emission
 * per node type and inline mark, the `:::` directive grammar for objects, and the documented
 * lossy set (underline/sub/sup/comment/glossary drop to bare text; an unbaked object emits a
 * placeholder, never a guess). Objects export from their baked fields only.
 */
import { describe, expect, it } from "vitest";
import {
  boundaryAtOffset,
  createIdAllocator,
  makeObjectNode,
  makeStructuralNode,
  makeTextNode,
  type BakedSnapshot,
  type EditorDocumentSnapshot,
  type EditorNode,
  type JsonObject,
  type NodeId,
  type TextLeafNode,
  type TextLeafType,
  type TextMark,
  type TextMarkKind,
} from "../../packages/editor/src/core";
import { snapshotToMarkdown } from "../../packages/editor/src/view/markdown/to-markdown";
import { MARKDOWN_LOSSY_MARK_KINDS } from "../../packages/editor/src/view/markdown/transformers";

const alloc = createIdAllocator("idco_client_md_export");

function leaf(
  type: TextLeafType,
  text: string,
  attrs?: JsonObject,
  marks: readonly TextMark[] = [],
): TextLeafNode {
  return makeTextNode({
    ...(attrs ? { attrs } : {}),
    content: alloc.createTextSlice(text),
    id: alloc.createNodeId(),
    marks,
    type,
  });
}

function mark(
  node: TextLeafNode,
  kind: TextMarkKind,
  from: number,
  to: number,
  attrs?: JsonObject,
): TextMark {
  return {
    ...(attrs ? { attrs } : {}),
    from: boundaryAtOffset(node.content, from, "before"),
    id: `m_${kind}_${from}_${to}`,
    kind,
    to: boundaryAtOffset(node.content, to, "after"),
  };
}

function objectNode(type: string, baked: BakedSnapshot): EditorNode {
  return makeObjectNode({
    baked,
    data: {},
    id: alloc.createNodeId(),
    status: "ready",
    type,
  });
}

function doc(
  order: readonly EditorNode[],
  all?: readonly EditorNode[],
): EditorDocumentSnapshot {
  const nodes = all ?? order;
  return {
    body: {
      blocks: Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<
        NodeId,
        EditorNode
      >,
      order: order.map((n) => n.id),
    },
    settings: {},
    version: 1,
  };
}

describe("markdown export — leaves", () => {
  it("emits headings h1–h6", () => {
    const nodes = [1, 2, 3, 4, 5, 6].map((n) =>
      leaf("heading", `H${n}`, { tag: `h${n}` }),
    );
    expect(snapshotToMarkdown(doc(nodes)).trim()).toBe(
      "# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6",
    );
  });

  it("emits a paragraph and a quote", () => {
    expect(snapshotToMarkdown(doc([leaf("paragraph", "Hello")])).trim()).toBe(
      "Hello",
    );
    expect(snapshotToMarkdown(doc([leaf("quote", "A quote")])).trim()).toBe(
      "> A quote",
    );
  });
});

describe("markdown export — inline marks", () => {
  it("wraps each format mark with its marker", () => {
    const cases: ReadonlyArray<[TextMarkKind, string]> = [
      ["bold", "**word**"],
      ["italic", "*word*"],
      ["strikethrough", "~~word~~"],
      ["highlight", "==word=="],
      ["code", "`word`"],
    ];
    for (const [kind, expected] of cases) {
      const node = leaf("paragraph", "word");
      const withMark = makeTextNode({
        ...node,
        marks: [mark(node, kind, 0, 4)],
      });
      expect(snapshotToMarkdown(doc([withMark])).trim()).toBe(expected);
    }
  });

  it("emits a link as [text](href) with a sanitized href", () => {
    const node = leaf("paragraph", "site");
    const linked = makeTextNode({
      ...node,
      marks: [mark(node, "link", 0, 4, { href: "https://x.test" })],
    });
    expect(snapshotToMarkdown(doc([linked])).trim()).toBe(
      "[site](https://x.test)",
    );
  });

  it("drops the lossy marks to bare text (documented set)", () => {
    expect(MARKDOWN_LOSSY_MARK_KINDS).toEqual([
      "underline",
      "subscript",
      "superscript",
      "comment",
      "glossary",
    ]);
    for (const kind of MARKDOWN_LOSSY_MARK_KINDS) {
      const node = leaf("paragraph", "word");
      const withMark = makeTextNode({
        ...node,
        marks: [
          mark(node, kind, 0, 4, kind === "glossary" ? { term: "g" } : {}),
        ],
      });
      // No marker is emitted — the text survives, the mark is dropped.
      expect(snapshotToMarkdown(doc([withMark])).trim()).toBe("word");
    }
  });
});

describe("markdown export — lists", () => {
  it("emits bullet, ordered, and checklist runs", () => {
    const bullets = [
      leaf("listitem", "a", { listType: "bullet" }),
      leaf("listitem", "b", { listType: "bullet" }),
    ];
    expect(snapshotToMarkdown(doc(bullets)).trim()).toBe("- a\n- b");

    const ordered = [
      leaf("listitem", "one", { listType: "number" }),
      leaf("listitem", "two", { listType: "number" }),
    ];
    expect(snapshotToMarkdown(doc(ordered)).trim()).toBe("1. one\n2. two");

    const checks = [
      leaf("listitem", "done", { checked: true, listType: "bullet" }),
      leaf("listitem", "todo", { checked: false, listType: "bullet" }),
    ];
    expect(snapshotToMarkdown(doc(checks)).trim()).toBe(
      "- [x] done\n- [ ] todo",
    );
  });

  it("indents nested flat items by depth", () => {
    const nodes = [
      leaf("listitem", "top", { listType: "bullet" }),
      leaf("listitem", "child", { indent: 1, listType: "bullet" }),
    ];
    expect(snapshotToMarkdown(doc(nodes)).trim()).toBe("- top\n  - child");
  });

  it("emits a structural list item with a nested code block", () => {
    const inner = leaf("listitem", "item", { listType: "bullet" });
    const code = objectNode("code-block", {
      kind: "code",
      payload: { code: "x = 1", language: "py", lineCount: 1 },
    });
    const container = makeStructuralNode({
      children: [inner.id, code.id],
      id: alloc.createNodeId(),
      type: "listitem",
    });
    const md = snapshotToMarkdown(doc([container], [container, inner, code]));
    expect(md).toContain("- item");
    expect(md).toContain("```py");
    expect(md).toContain("x = 1");
  });
});

describe("markdown export — objects", () => {
  it("emits each object kind from its baked fields", () => {
    expect(
      snapshotToMarkdown(
        doc([objectNode("divider", { kind: "divider", payload: {} })]),
      ).trim(),
    ).toBe("---");

    expect(
      snapshotToMarkdown(
        doc([
          objectNode("code-block", {
            kind: "code",
            payload: { code: "const a = 1", language: "ts", lineCount: 1 },
          }),
        ]),
      ).trim(),
    ).toBe("```ts\nconst a = 1\n```");

    expect(
      snapshotToMarkdown(
        doc([
          objectNode("media", {
            kind: "media",
            payload: {
              alt: "Cat",
              caption: "",
              mediaId: "",
              src: "https://x.test/c.png",
            },
          }),
        ]),
      ).trim(),
    ).toBe("![Cat](https://x.test/c.png)");

    expect(
      snapshotToMarkdown(
        doc([
          objectNode("embed", {
            kind: "embed",
            payload: { title: "Vid", url: "https://x.test/v" },
          }),
        ]),
      ).trim(),
    ).toBe("[Vid](https://x.test/v)");

    expect(
      snapshotToMarkdown(
        doc([
          objectNode("post-ref", {
            kind: "post-ref",
            payload: { postId: "p1", title: "Post", url: "https://x.test/p" },
          }),
        ]),
      ).trim(),
    ).toBe("[Post](https://x.test/p)");

    expect(
      snapshotToMarkdown(
        doc([objectNode("table-of-contents", { kind: "toc", payload: {} })]),
      ).trim(),
    ).toBe(":::toc\n:::");
  });

  it("bakes an unbaked object on demand (divider → ---), not the placeholder", () => {
    // A divider loaded from import/compat has no `baked` field (store baking is lazy). Export
    // must bake it on demand and emit `---`, never `<!-- divider (unbaked) -->`.
    const divider = makeObjectNode({
      data: {},
      id: alloc.createNodeId(),
      status: "ready",
      type: "divider",
    });
    expect(divider.baked).toBeUndefined();
    expect(snapshotToMarkdown(doc([divider])).trim()).toBe("---");
  });

  it("emits a placeholder only for a genuinely unbakeable object", () => {
    // An unknown type has no registry baker, so the bake fails (null) and the placeholder is
    // the honest lossy output — never a guess.
    const unbakeable = makeObjectNode({
      data: {},
      id: alloc.createNodeId(),
      status: "invalid",
      type: "mystery",
    });
    expect(snapshotToMarkdown(doc([unbakeable])).trim()).toBe(
      "<!-- mystery (unbaked) -->",
    );
  });
});

describe("markdown export — structural containers", () => {
  it("emits a callout as a :::tone directive", () => {
    const para = leaf("paragraph", "Note body");
    const callout = makeStructuralNode({
      attrs: { tone: "warning" },
      children: [para.id],
      id: alloc.createNodeId(),
      type: "callout",
    });
    expect(snapshotToMarkdown(doc([callout], [callout, para])).trim()).toBe(
      ":::warning\nNote body\n:::",
    );
  });

  it("emits a structural table as GFM", () => {
    const cell = (text: string) => {
      const p = leaf("paragraph", text);
      const c = makeStructuralNode({
        children: [p.id],
        id: alloc.createNodeId(),
        type: "tablecell",
      });
      return { cell: c, para: p };
    };
    const h1 = cell("A");
    const h2 = cell("B");
    const d1 = cell("1");
    const d2 = cell("2");
    const row1 = makeStructuralNode({
      children: [h1.cell.id, h2.cell.id],
      id: alloc.createNodeId(),
      type: "tablerow",
    });
    const row2 = makeStructuralNode({
      children: [d1.cell.id, d2.cell.id],
      id: alloc.createNodeId(),
      type: "tablerow",
    });
    const table = makeStructuralNode({
      children: [row1.id, row2.id],
      id: alloc.createNodeId(),
      type: "table",
    });
    const md = snapshotToMarkdown(
      doc(
        [table],
        [
          table,
          row1,
          row2,
          h1.cell,
          h2.cell,
          d1.cell,
          d2.cell,
          h1.para,
          h2.para,
          d1.para,
          d2.para,
        ],
      ),
    ).trim();
    expect(md).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |");
  });

  it("keeps columns aligned when a cell is horizontally merged (colSpan)", () => {
    const cell = (text: string, colSpan?: number) => {
      const p = leaf("paragraph", text);
      const c = makeStructuralNode({
        ...(colSpan ? { attrs: { colSpan } } : {}),
        children: [p.id],
        id: alloc.createNodeId(),
        type: "tablecell",
      });
      return { cell: c, para: p };
    };
    const h1 = cell("A");
    const h2 = cell("B");
    const h3 = cell("C");
    // A 3-column header, then a row whose first cell spans 2 columns. The merge is dropped,
    // but the trailing "Z" must stay in the THIRD column, not shift into the second.
    const merged = cell("Wide", 2);
    const z = cell("Z");
    const row1 = makeStructuralNode({
      children: [h1.cell.id, h2.cell.id, h3.cell.id],
      id: alloc.createNodeId(),
      type: "tablerow",
    });
    const row2 = makeStructuralNode({
      children: [merged.cell.id, z.cell.id],
      id: alloc.createNodeId(),
      type: "tablerow",
    });
    const table = makeStructuralNode({
      children: [row1.id, row2.id],
      id: alloc.createNodeId(),
      type: "table",
    });
    const md = snapshotToMarkdown(
      doc(
        [table],
        [
          table,
          row1,
          row2,
          h1.cell,
          h2.cell,
          h3.cell,
          merged.cell,
          z.cell,
          h1.para,
          h2.para,
          h3.para,
          merged.para,
          z.para,
        ],
      ),
    ).trim();
    expect(md).toBe("| A | B | C |\n| --- | --- | --- |\n| Wide |  | Z |");
  });
});
