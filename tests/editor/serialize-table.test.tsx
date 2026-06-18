import { describe, expect, it } from "vitest";
import { normalizeDocument } from "../../packages/editor/src/legacy/model/normalize";
import { lexicalEditorState } from "../../packages/editor/src/legacy/model/serialize";

type LexNode = {
  type?: string;
  indent?: number;
  colWidths?: readonly number[];
  children?: LexNode[];
};

function collect(node: LexNode, type: string, out: LexNode[]): LexNode[] {
  if (node.type === type) out.push(node);
  for (const child of node.children ?? []) collect(child, type, out);
  return out;
}

describe("table serialization", () => {
  it("gives table element nodes indent: 0 so Lexical clears padding-inline-start", () => {
    const doc = normalizeDocument({
      root: {
        children: [
          {
            type: "table",
            children: [
              {
                type: "tablerow",
                children: [
                  {
                    type: "tablecell",
                    headerState: 0,
                    children: [
                      {
                        type: "paragraph",
                        children: [{ type: "text", text: "Tables" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    const state = lexicalEditorState(doc) as { root: LexNode };
    // Missing indent makes Lexical write `padding-inline-start: calc(undefined
    // * …)`, which overrides cell padding. Every table element node must be 0.
    for (const type of ["editor-table", "tablerow", "tablecell"]) {
      const nodes = collect(state.root, type, []);
      expect(nodes.length).toBeGreaterThan(0);
      for (const node of nodes) expect(node.indent).toBe(0);
    }
  });

  it("round-trips colWidths so a resized table keeps its column widths", () => {
    // The resize handles persist widths via TableNode.setColWidths, which lands
    // in the document as `colWidths`. If this were stripped, every edit would
    // drop the widths and the table would re-seed/jitter.
    const doc = normalizeDocument({
      root: {
        children: [
          {
            type: "table",
            colWidths: [220, 140],
            children: [
              {
                type: "tablerow",
                children: [
                  {
                    type: "tablecell",
                    headerState: 0,
                    children: [
                      {
                        type: "paragraph",
                        children: [{ type: "text", text: "A" }],
                      },
                    ],
                  },
                  {
                    type: "tablecell",
                    headerState: 0,
                    children: [
                      {
                        type: "paragraph",
                        children: [{ type: "text", text: "B" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    const state = lexicalEditorState(doc) as { root: LexNode };
    const [table] = collect(state.root, "editor-table", []);
    expect(table?.colWidths).toEqual([220, 140]);
  });
});
