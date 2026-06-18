import { describe, expect, it } from "vitest";
import { lexicalEditorState } from "../../packages/editor/src/legacy/model/serialize";

type LexNode = {
  type?: string;
  children?: readonly LexNode[];
};

describe("editor serialization", () => {
  it("uses the editor paragraph runtime node for an empty document", () => {
    const state = lexicalEditorState({ root: { children: [] } }) as {
      root: LexNode;
    };

    expect(state.root.children?.[0]?.type).toBe("editor-paragraph");
  });
});
