import { describe, expect, it } from "vitest";
import { ensureDocumentNodeIds } from "@idco/editor";
import { normalizeDocument } from "../../packages/editor/src/model/normalize";
import { lexicalEditorState } from "../../packages/editor/src/model/serialize";
import type { RichTextEditorDocument } from "@idco/editor";

describe("large document stable node ids", () => {
  it("adds unique stable ids to top-level blocks", () => {
    const document = normalizeDocument(paragraphs(5000));
    const ids = document.root.children.map((node) => node.id);

    expect(ids).toHaveLength(5000);
    expect(new Set(ids).size).toBe(5000);
    expect(ids.every((id) => id?.startsWith("rt_"))).toBe(true);
    expect(
      normalizeDocument(document).root.children.map((node) => node.id),
    ).toEqual(ids);
  });

  it("preserves previous ids when Lexical drops unknown built-in-node fields", () => {
    const document = normalizeDocument({
      root: {
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", text: "First" }],
          },
          {
            type: "heading",
            tag: "h2",
            children: [{ type: "text", text: "Second" }],
          },
        ],
      },
    });

    const roundTrip = normalizeDocument(lexicalEditorState(document), {
      previousDocument: document,
    });

    expect(roundTrip.root.children.map((node) => node.id)).toEqual(
      document.root.children.map((node) => node.id),
    );
  });

  it("does not shift ids when a same-type block is inserted before an existing block", () => {
    const previous = normalizeDocument({
      root: {
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", text: "First" }],
          },
          {
            type: "paragraph",
            children: [{ type: "text", text: "Second" }],
          },
        ],
      },
    });
    const lexical = lexicalEditorState(previous);
    lexical.root.children.splice(1, 0, {
      children: [
        {
          detail: 0,
          format: 0,
          mode: "normal",
          style: "",
          text: "Inserted",
          type: "text",
          version: 1,
        },
      ],
      direction: null,
      format: "",
      indent: 0,
      textFormat: 0,
      textStyle: "",
      type: "editor-paragraph",
      version: 1,
    });

    const roundTrip = normalizeDocument(lexical, {
      previousDocument: previous,
    });
    const ids = roundTrip.root.children.map((node) => node.id);

    expect(ids[0]).toBe(previous.root.children[0]?.id);
    expect(ids[2]).toBe(previous.root.children[1]?.id);
    expect(ids[1]).toMatch(/^rt_/);
    expect(ids[1]).not.toBe(previous.root.children[1]?.id);
  });

  it("repairs duplicate ids while preserving the first occurrence", () => {
    const repaired = ensureDocumentNodeIds({
      root: {
        children: [
          { id: "rt_keep", type: "paragraph", children: [] },
          { id: "rt_keep", type: "paragraph", children: [] },
        ],
      },
    });

    expect(repaired.root.children[0]?.id).toBe("rt_keep");
    expect(repaired.root.children[1]?.id).not.toBe("rt_keep");
    expect(repaired.root.children[1]?.id).toMatch(/^rt_/);
  });
});

function paragraphs(count: number): RichTextEditorDocument {
  return {
    root: {
      children: Array.from({ length: count }, (_, index) => ({
        type: "paragraph",
        children: [{ type: "text", text: `Paragraph ${index + 1}` }],
      })),
    },
  };
}
