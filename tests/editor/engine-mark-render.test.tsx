// @vitest-environment jsdom
/**
 * Mark rendering and multi-text-node geometry (docs/010 Phase 8 AC3).
 *
 * Marks are modeled as overlapping ranges (011 §4) and must render to the DOM as
 * nested semantic elements while the offset↔DOM geometry stays correct across the
 * resulting many-text-node block. jsdom has no layout (so pixel rects are not
 * asserted here — the engine e2e covers caret/selection across a formatted run on
 * real browsers), but the DOM-traversal half of the mapping is exact and tested.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  boundaryAtOffset,
  createIdAllocator,
  makeTextNode,
  resolveLeafMarks,
  segmentText,
  type TextContent,
  type TextLeafNode,
  type TextMark,
  type TextMarkKind,
} from "../../packages/editor/src/core";
import { renderLeafMarks } from "../../packages/editor/src/view/render";
import {
  hostTextLength,
  modelOffsetFromDom,
  resolveOffsetToDom,
  textNodesOf,
} from "../../packages/editor/src/view/overlays";
import {
  getMark,
  listMarks,
  registerMark,
} from "../../packages/editor/src/view/spi";

let markSeq = 0;
function mark(
  content: TextContent,
  kind: TextMarkKind,
  from: number,
  to: number,
  attrs?: TextMark["attrs"],
): TextMark {
  markSeq += 1;
  return {
    ...(attrs ? { attrs } : {}),
    from: boundaryAtOffset(content, from, "before"),
    id: `m${markSeq}`,
    kind,
    to: boundaryAtOffset(content, to, "after"),
  };
}

const allocator = createIdAllocator();
function leaf(
  text: string,
  build: (content: TextContent) => readonly TextMark[] = () => [],
): TextLeafNode {
  const content: TextContent = allocator.createTextSlice(text);
  return makeTextNode({
    content,
    id: "idco_node_x_1" as TextLeafNode["id"],
    marks: build(content),
  });
}

describe("mark segmentation (core)", () => {
  it("splits overlapping marks into non-overlapping segments that tile the text", () => {
    const node = leaf("abcdef", (c) => [
      mark(c, "bold", 0, 4),
      mark(c, "italic", 2, 6),
    ]);
    const segments = segmentText(node.content.text, resolveLeafMarks(node));
    // boundaries: 0,2,4,6 -> [0,2) bold, [2,4) bold+italic, [4,6) italic
    expect(segments.map((s) => [s.from, s.to])).toEqual([
      [0, 2],
      [2, 4],
      [4, 6],
    ]);
    expect(segments.map((s) => s.text).join("")).toBe("abcdef");
    expect(segments[0]!.marks.map((m) => m.kind)).toEqual(["bold"]);
    expect(segments[1]!.marks.map((m) => m.kind).sort()).toEqual([
      "bold",
      "italic",
    ]);
    expect(segments[2]!.marks.map((m) => m.kind)).toEqual(["italic"]);
  });

  it("returns one bare segment for unmarked text and nothing for empty text", () => {
    expect(segmentText("hello", [])).toEqual([
      { from: 0, marks: [], text: "hello", to: 5 },
    ]);
    expect(segmentText("", [])).toEqual([]);
  });
});

describe("mark rendering (view)", () => {
  it("renders an unmarked leaf as a bare text node (fast-path compatible)", () => {
    const { container } = render(<div>{renderLeafMarks(leaf("plain"))}</div>);
    const host = container.firstChild as HTMLElement;
    expect(host.childNodes).toHaveLength(1);
    expect(host.firstChild?.nodeType).toBe(host.firstChild!.TEXT_NODE);
    expect(host.textContent).toBe("plain");
  });

  it("renders marks as semantic elements whose text concatenation equals the model text", () => {
    const node = leaf("link bold", (c) => [
      mark(c, "link", 0, 4, { href: "https://example.com" }),
      mark(c, "bold", 5, 9),
    ]);
    const { container } = render(<div>{renderLeafMarks(node)}</div>);
    const host = container.firstChild as HTMLElement;
    expect(host.textContent).toBe("link bold");
    expect(host.querySelector("a[data-engine-mark='link']")?.textContent).toBe(
      "link",
    );
    expect(
      host
        .querySelector("a[data-engine-mark='link']")
        ?.getAttribute("data-engine-mark-href"),
    ).toBe("https://example.com");
    expect(
      host.querySelector("strong[data-engine-mark='bold']")?.textContent,
    ).toBe("bold");
  });

  it("nests overlapping marks deterministically", () => {
    const node = leaf("abcdef", (c) => [
      mark(c, "bold", 0, 4),
      mark(c, "italic", 2, 6),
    ]);
    const { container } = render(<div>{renderLeafMarks(node)}</div>);
    const host = container.firstChild as HTMLElement;
    // The overlap segment carries both bold and italic.
    const strongInside = host.querySelector("strong em, em strong");
    expect(strongInside).not.toBeNull();
    expect(host.textContent).toBe("abcdef");
  });
});

describe("multi-text-node geometry (view)", () => {
  it("maps model offsets to DOM positions and back across mark elements", () => {
    const node = leaf("abcdef", (c) => [
      mark(c, "bold", 0, 4),
      mark(c, "italic", 2, 6),
    ]);
    const { container } = render(<div>{renderLeafMarks(node)}</div>);
    const host = container.firstChild as HTMLElement;
    expect(hostTextLength(host)).toBe(6);
    expect(textNodesOf(host).length).toBeGreaterThan(1);
    for (let offset = 0; offset <= 6; offset += 1) {
      const dom = resolveOffsetToDom(host, offset);
      expect(dom).not.toBeNull();
      const back = modelOffsetFromDom(host, dom!.node, dom!.offset);
      expect(back).toBe(offset);
    }
  });
});

describe("mark registry (view SPI, note.md W4)", () => {
  it("exposes the six togglable formats with toolbar meta in toolbar order", () => {
    const toolbar = listMarks().filter((def) => def.toolbar);
    expect(toolbar.map((def) => def.kind)).toEqual([
      "bold",
      "italic",
      "underline",
      "strikethrough",
      "code",
      "highlight",
    ]);
    expect(toolbar.map((def) => def.toolbar!.label)).toEqual([
      "Bold",
      "Italic",
      "Underline",
      "Strikethrough",
      "Code",
      "Highlight",
    ]);
  });

  it("registers attr/annotation marks as render-only (no toolbar)", () => {
    for (const kind of [
      "link",
      "comment",
      "glossary",
      "subscript",
      "superscript",
    ] as const) {
      expect(getMark(kind)?.toolbar).toBeUndefined();
      expect(typeof getMark(kind)?.render).toBe("function");
    }
  });

  it("ranks nesting deterministically (link outermost, code innermost)", () => {
    expect(getMark("link")!.nestingRank).toBeLessThan(
      getMark("bold")!.nestingRank,
    );
    expect(getMark("bold")!.nestingRank).toBeLessThan(
      getMark("code")!.nestingRank,
    );
  });

  it("renders a host-registered mark and falls back to a neutral span otherwise", () => {
    // A host can register a brand-new mark kind. `TextMarkKind` is the persisted
    // union (compat needs the literals), so a synthetic view-only kind is cast.
    registerMark({
      kind: "test-custom" as TextMarkKind,
      nestingRank: 50,
      render: ({ child, key }) => (
        <ins key={key} data-engine-mark="test-custom">
          {child}
        </ins>
      ),
    });
    const custom = leaf("hi", (c) => [
      mark(c, "test-custom" as TextMarkKind, 0, 2),
    ]);
    const { container: registered } = render(
      <div>{renderLeafMarks(custom)}</div>,
    );
    expect(
      registered.querySelector("ins[data-engine-mark='test-custom']"),
    ).not.toBeNull();
    expect(registered.textContent).toBe("hi");

    // An unregistered kind renders the neutral fallback span (text never dropped).
    const unknown = leaf("yo", (c) => [
      mark(c, "totally-unknown" as TextMarkKind, 0, 2),
    ]);
    const { container: fallback } = render(
      <div>{renderLeafMarks(unknown)}</div>,
    );
    expect(
      fallback.querySelector("span[data-engine-mark='totally-unknown']"),
    ).not.toBeNull();
    expect(fallback.textContent).toBe("yo");
  });
});
