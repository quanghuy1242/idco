// @vitest-environment jsdom
/**
 * The drift guard (docs/028 §9). The editor's at-rest preview (`RestingDocument`) and the
 * published server reader (`<Reader>`) render the SAME native snapshot; this test feeds one
 * snapshot through both and asserts the load-bearing structure matches — a divider, an image
 * caption, and a table cell's `colspan`/background appear in BOTH. The forked compat-walk had
 * no such test and silently dropped exactly these (docs/028 §2/§3.1); this fails the build the
 * moment either path drops one again.
 *
 * It asserts *semantic* parity (both contain the element), not byte parity: `RestingDocument`
 * and `<Reader>` legitimately differ in some wrapper markup, but the content that the fork
 * lost must be present in each.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RestingDocument } from "@quanghuy1242/idco-editor";
import { Reader } from "@quanghuy1242/idco-reader";

let counter = 0;
const nextId = () => `idco_node_test_${++counter}`;

type Built = Record<string, unknown> & { id: string; kind: string };

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
  return {
    kids: children,
    attrs,
    id: nextId(),
    kind: "structural",
    type,
  } as Built;
}

function flatten(node: Built, blocks: Record<string, unknown>): void {
  if (node.kind === "structural") {
    const children = (node.kids as Built[]).map((child) => {
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
  blocks[node.id] = node;
}

function snap(...nodes: Built[]): never {
  const blocks: Record<string, unknown> = {};
  const order = nodes.map((node) => {
    flatten(node, blocks);
    return node.id;
  });
  return {
    body: { blocks, order },
    collections: {},
    settings: {},
    version: 1,
  } as never;
}

const sample = snap(
  text("heading", "Section", { tag: "h2" }),
  text("paragraph", "Body copy."),
  obj("divider", {}, "divider"),
  obj(
    "media",
    { alt: "Diagram", caption: "Figure 1", src: "https://idco.test/m.png" },
    "media",
  ),
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
);

describe("reader ↔ RestingDocument parity (docs/028 §9)", () => {
  it("renders the divider in BOTH the editor preview and the published reader", () => {
    const editor = render(<RestingDocument snapshot={sample} />).container;
    const reader = render(<Reader value={sample} />).container;
    expect(editor.querySelector("hr")).not.toBeNull();
    expect(reader.querySelector("hr")).not.toBeNull();
  });

  it("renders the image caption in BOTH", () => {
    const editor = render(<RestingDocument snapshot={sample} />).container;
    const reader = render(<Reader value={sample} />).container;
    expect(editor.querySelector("figcaption")?.textContent).toBe("Figure 1");
    expect(reader.querySelector("figcaption")?.textContent).toBe("Figure 1");
  });

  it("renders the merged + colored table cell (colspan/background) in BOTH", () => {
    const editor = render(<RestingDocument snapshot={sample} />).container;
    const reader = render(<Reader value={sample} />).container;
    for (const container of [editor, reader]) {
      const td = container.querySelector("td");
      expect(td?.getAttribute("colspan")).toBe("2");
      expect(td?.style.background).not.toBe("");
      expect(container.querySelector("th")?.textContent).toBe("Header");
    }
  });
});
