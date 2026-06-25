// @vitest-environment jsdom
/**
 * The server-native read tier (docs/015, docs/028) — `<Reader>` over the **native**
 * `EditorDocumentSnapshot` (never the Lexical-compat projection, docs/028 §4.4), the L1
 * primitives, content-visibility virtualization, and the opt-in island seam. This replaces
 * the compat-walk test: it builds native snapshots directly and asserts the four bugs the
 * forked walk had (divider, image caption, table-cell attrs, block spacing) are fixed, plus
 * the `.rt-*` contract, static-by-default islands, and degenerate input.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Reader,
  RichTextParagraph,
  RICH_TEXT_TYPOGRAPHY_CSS,
  type ReaderBlockNode,
  type ReaderSnapshot,
} from "@quanghuy1242/idco-reader";
import {
  createIslandRenderer,
  listReaderIslands,
} from "@quanghuy1242/idco-reader/islands";

// --- native snapshot builders (no compat anywhere) ---------------------------

let counter = 0;
const nextId = () => `idco_node_test_${++counter}`;

type Built =
  | {
      kind: "text";
      id: string;
      type: string;
      content: { text: string; runs: [] };
      marks: [];
      attrs?: Record<string, unknown>;
    }
  | {
      kind: "object";
      id: string;
      type: string;
      data: Record<string, unknown>;
      baked?: { kind: string; payload: unknown };
      status: string;
    }
  | {
      kind: "structural";
      id: string;
      type: string;
      kids: Built[];
      attrs?: Record<string, unknown>;
    };

function text(
  type: string,
  value: string,
  attrs?: Record<string, unknown>,
): Built {
  return {
    attrs,
    content: { runs: [], text: value },
    id: nextId(),
    kind: "text",
    marks: [],
    type,
  };
}
function obj(type: string, payload: unknown, kind = type): Built {
  return {
    baked: { kind, payload },
    data: {},
    id: nextId(),
    kind: "object",
    status: "ready",
    type,
  };
}
function structural(
  type: string,
  children: Built[],
  attrs?: Record<string, unknown>,
): Built {
  return { kids: children, attrs, id: nextId(), kind: "structural", type };
}

/** A mark boundary at a literal offset (the char anchor never matches an empty `runs`, so the
 *  resolver falls back to `offset`), for building marked leaves in tests. */
function boundaryAt(offset: number, stickiness: "before" | "after") {
  return {
    anchor: { id: { client: "x", clock: 0 }, kind: "char" as const },
    offset,
    stickiness,
  };
}

function flatten(node: Built, blocks: Record<string, ReaderBlockNode>): void {
  if (node.kind === "structural") {
    const children = node.kids.map((child) => {
      flatten(child, blocks);
      return child.id;
    });
    blocks[node.id] = {
      attrs: node.attrs,
      children,
      id: node.id,
      kind: "structural",
      type: node.type,
    };
    return;
  }
  blocks[node.id] = node as unknown as ReaderBlockNode;
}

function snap(...nodes: Built[]): ReaderSnapshot {
  const blocks: Record<string, ReaderBlockNode> = {};
  const order = nodes.map((node) => {
    flatten(node, blocks);
    return node.id;
  });
  return {
    body: { blocks, order },
    collections: {},
    settings: {},
    version: 1,
  } as ReaderSnapshot;
}

const basicDoc = snap(
  text("heading", "Title", { tag: "h1" }),
  text("paragraph", "Centered", { format: "center" }),
  obj("code-block", { code: "const answer = 42;", language: "js" }, "code"),
);

describe("Reader — L1 render + .rt-* contract", () => {
  it("renders headings/paragraphs through the .rt-* typography classes", () => {
    const { container } = render(<Reader value={basicDoc} />);
    expect(container.querySelector("h1")).toHaveClass("rt-h1");
    const p = container.querySelector("p");
    expect(p).toHaveClass("rt-p");
    // Alignment rides the align utility on top of the prose class (note.md item 1).
    expect(p).toHaveClass("text-center");
  });

  it("applies block indent (attrs.indent) as a left margin, like the editor", () => {
    const { container } = render(
      <Reader value={snap(text("paragraph", "Indented", { indent: 2 }))} />,
    );
    // 2 levels × 1.6em = 3.2em, matching the editor's INDENT_STEP_EM (docs/018 §2.8).
    expect(container.querySelector("p")?.style.marginLeft).toBe("3.2em");
  });

  it("ships its typography stylesheet inline (self-sufficient, zero extra import)", () => {
    const { container } = render(<Reader value={basicDoc} />);
    expect(container.querySelector("style")?.textContent).toBe(
      RICH_TEXT_TYPOGRAPHY_CSS,
    );
  });

  it("keeps a glossary run's text when it also carries a format mark", () => {
    // Regression: the Preview rendered "with , ," for bold/italic glossary terms because the
    // glossary render substituted a resolved `term` string and discarded its child — so a
    // glossary-over-bold run (whose child is a `<strong>` element, not a string) rendered an
    // EMPTY `<abbr>` and the word vanished. The run text must survive, nested
    // `<abbr title=def><strong>…</strong></abbr>`. Both marks span [0,4) ("bold"); with no runs
    // the char anchors fall back to their stored offsets.
    const leaf: ReaderBlockNode = {
      content: { runs: [], text: "bold" },
      id: "leaf-gloss",
      kind: "text",
      marks: [
        {
          from: boundaryAt(0, "after"),
          id: "m-b",
          kind: "bold",
          to: boundaryAt(4, "before"),
        },
        {
          attrs: { term: "t1" },
          from: boundaryAt(0, "after"),
          id: "m-g",
          kind: "glossary",
          to: boundaryAt(4, "before"),
        },
      ],
      type: "paragraph",
    };
    const doc = {
      body: { blocks: { "leaf-gloss": leaf }, order: ["leaf-gloss"] },
      collections: {
        glossary: [{ definition: "weighty", id: "t1", term: "bold" }],
      },
      settings: {},
      version: 1,
    } as ReaderSnapshot;
    const { container } = render(<Reader value={doc} />);
    const abbr = container.querySelector("abbr");
    expect(abbr?.getAttribute("title")).toBe("weighty");
    expect(abbr?.textContent).toBe("bold"); // the word is not dropped
    expect(abbr?.querySelector("strong")?.textContent).toBe("bold"); // still bold
  });

  it("wraps top-level units in a content-visibility container (CSS virtualization)", () => {
    const { container } = render(<Reader value={basicDoc} />);
    const block = container.querySelector(
      "[data-rt-block]",
    ) as HTMLElement | null;
    expect(block).not.toBeNull();
    expect(block?.style.contentVisibility).toBe("auto");
    expect(block?.style.containIntrinsicHeight).not.toBe("");
  });

  it("renders a code block as a static <pre> with the source visible", () => {
    render(<Reader value={basicDoc} />);
    expect(
      screen.getByText("const answer = 42;").closest("pre"),
    ).not.toBeNull();
  });

  it("renders pre-highlighted baked HTML for a code block when present", () => {
    const { container } = render(
      <Reader
        value={snap(
          obj(
            "code-block",
            {
              code: "const x = 1;",
              html: '<span class="tok-kw">const</span> x = 1;',
              language: "js",
            },
            "code",
          ),
        )}
      />,
    );
    expect(container.querySelector("pre code .tok-kw")?.textContent).toBe(
      "const",
    );
  });

  // --- the four bugs the forked compat-walk had (docs/028 §3.1) ---

  it("renders a divider (was silently dropped by the fork)", () => {
    const { container } = render(
      <Reader value={snap(obj("divider", {}, "divider"))} />,
    );
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders an image caption (was dropped — read from the nested model)", () => {
    const { container } = render(
      <Reader
        value={snap(
          obj(
            "media",
            {
              alt: "Diagram",
              caption: "Figure 1: the flow",
              src: "https://idco.test/m.png",
            },
            "media",
          ),
        )}
      />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://idco.test/m.png",
    );
    expect(container.querySelector("figcaption")?.textContent).toBe(
      "Figure 1: the flow",
    );
  });

  it("renders table-cell attributes — colSpan / background / header (all dropped by the fork)", () => {
    const { container } = render(
      <Reader
        value={snap(
          structural("table", [
            structural("tablerow", [
              structural("tablecell", [text("paragraph", "Planning")], {
                backgroundColor: "#ff0000",
                colSpan: 2,
              }),
              structural("tablecell", [text("paragraph", "Header")], {
                headerState: 1,
              }),
            ]),
          ]),
        )}
      />,
    );
    const td = container.querySelector("td");
    expect(td?.getAttribute("colspan")).toBe("2");
    expect(td?.style.background).not.toBe("");
    expect(container.querySelector("th")?.textContent).toBe("Header");
  });

  it("resolves media through resolveMedia when supplied", () => {
    const { container } = render(
      <Reader
        resolveMedia={() => ({
          alt: "Override",
          src: "https://idco.test/o.png",
        })}
        value={snap(
          obj("media", { src: "https://idco.test/orig.png" }, "media"),
        )}
      />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://idco.test/o.png",
    );
    expect(container.querySelector("img")?.getAttribute("alt")).toBe(
      "Override",
    );
  });
});

describe("Reader — islands are opt-in", () => {
  it("emits NO island markup when renderIsland is omitted (static by default)", () => {
    const { container } = render(<Reader value={basicDoc} />);
    expect(container.querySelector("[data-rt-island]")).toBeNull();
  });

  it("wraps island-eligible nodes when renderIsland is supplied", () => {
    const { container } = render(
      <Reader renderIsland={createIslandRenderer()} value={basicDoc} />,
    );
    const islands = container.querySelectorAll("[data-rt-island]");
    expect(islands.length).toBeGreaterThanOrEqual(1);
    const codeIsland = [...islands].find((el) =>
      within(el as HTMLElement).queryByText("const answer = 42;"),
    );
    expect(codeIsland).toBeDefined();
  });

  it("registers the three built-in islands", () => {
    const kinds = listReaderIslands().map((island) => island.kind);
    expect(kinds).toContain("code-block");
    expect(kinds).toContain("checklist");
    expect(kinds).toContain("table-of-contents");
  });
});

describe("Reader — degenerate input", () => {
  it("returns null for a value with no body", () => {
    const { container } = render(
      <Reader value={{ not: "a doc" } as unknown as ReaderSnapshot} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("L1 primitives are pure (render without a client runtime)", () => {
    const { container } = render(<RichTextParagraph>hello</RichTextParagraph>);
    expect(container.querySelector("p")).toHaveClass("rt-p");
  });
});
