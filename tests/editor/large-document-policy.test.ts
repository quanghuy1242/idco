import { describe, expect, it } from "vitest";
import { documentScale, selectEditorMode } from "@idco/editor";

describe("large document policy", () => {
  it("selects standard mode below thresholds and large-document mode above them", () => {
    expect(selectEditorMode(paragraphs(3), { mode: "auto" })).toBe("standard");
    expect(
      selectEditorMode(paragraphs(301), {
        maxStandardBlocks: 300,
        mode: "auto",
      }),
    ).toBe("large-document");
  });

  it("counts decorator-heavy blocks separately from plain paragraphs", () => {
    const scale = documentScale({
      root: {
        children: [
          ...Array.from({ length: 3 }, () => ({
            type: "code-block",
            text: "x",
          })),
          {
            type: "table",
            children: [
              {
                type: "tablerow",
                children: [{ type: "tablecell", children: [] }],
              },
            ],
          },
        ],
      },
    });

    expect(scale.decoratorBlocks).toBe(4);
    expect(scale.tableCells).toBe(1);
  });
});

function paragraphs(count: number) {
  return {
    root: {
      children: Array.from({ length: count }, (_, index) => ({
        type: "paragraph",
        children: [{ type: "text", text: `P ${index}` }],
      })),
    },
  };
}
