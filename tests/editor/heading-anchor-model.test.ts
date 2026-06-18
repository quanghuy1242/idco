import { describe, expect, it } from "vitest";
import { normalizeDocument } from "../../packages/editor/src/legacy/model/normalize";
import { lexicalEditorState } from "../../packages/editor/src/legacy/model/serialize";

type LexNode = {
  readonly type: string;
  readonly anchorId?: string;
  readonly children?: readonly LexNode[];
};

describe("editor heading anchor model", () => {
  it("normalizes legacy/editor heading nodes to canonical anchored headings", () => {
    const doc = normalizeDocument({
      root: {
        children: [
          {
            type: "heading",
            tag: "h2",
            children: [{ type: "text", text: "Overview" }],
          },
          {
            type: "editor-heading",
            tag: "h3",
            anchorId: "Overview",
            children: [{ type: "text", text: "Details" }],
          },
        ],
      },
    });

    expect(doc.root.children).toEqual([
      expect.objectContaining({
        anchorId: "overview",
        type: "heading",
      }),
      expect.objectContaining({
        anchorId: "overview-2",
        type: "heading",
      }),
    ]);
  });

  it("serializes canonical heading documents to the editor heading runtime type", () => {
    const state = lexicalEditorState({
      root: {
        children: [
          {
            type: "heading",
            tag: "h2",
            anchorId: "overview",
            children: [{ type: "text", text: "Overview" }],
          },
        ],
      },
    }) as { root: { children: readonly LexNode[] } };

    expect(state.root.children[0]).toEqual(
      expect.objectContaining({
        anchorId: "overview",
        type: "editor-heading",
      }),
    );
  });
});
