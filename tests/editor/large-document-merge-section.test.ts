import { describe, expect, it } from "vitest";
import {
  replaceDocumentSection,
  sectionizeDocument,
  type RichTextEditorDocument,
} from "@idco/editor";
import { normalizeDocument } from "../../packages/editor/src/model/normalize";

describe("large document section merge", () => {
  it("replaces one section without reordering siblings", () => {
    const document = normalizeDocument(sampleDocument());
    const sections = sectionizeDocument(document);
    const target = sections[1]!;
    const result = replaceDocumentSection(
      document,
      target.id,
      {
        root: {
          children: [
            target.document.root.children[0]!,
            {
              type: "paragraph",
              children: [{ type: "text", text: "Changed" }],
            },
          ],
        },
      },
      { expectedBlockIds: target.blockIds },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.root.children.map((node) => node.type)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "paragraph",
      "heading",
      "paragraph",
    ]);
    expect(result.document.root.children[3]).toMatchObject({
      children: [{ text: "Changed", type: "text" }],
      type: "paragraph",
    });
  });

  it("refuses stale section replacements", () => {
    const document = normalizeDocument(sampleDocument());
    const target = sectionizeDocument(document)[1]!;
    const result = replaceDocumentSection(
      document,
      target.id,
      target.document,
      { expectedBlockIds: ["rt_not_the_same"] },
    );

    expect(result).toEqual({ ok: false, reason: "stale-section" });
  });
});

function sampleDocument(): RichTextEditorDocument {
  return {
    root: {
      children: [
        heading("One"),
        paragraph("A"),
        heading("Two"),
        paragraph("B"),
        heading("Three"),
        paragraph("C"),
      ],
    },
  };
}

function paragraph(text: string) {
  return { type: "paragraph", children: [{ type: "text", text }] };
}

function heading(text: string) {
  return { type: "heading", tag: "h2", children: [{ type: "text", text }] };
}
