import { describe, expect, it } from "vitest";
import {
  buildRichTextDocumentIndexes,
  searchRichTextIndexes,
} from "@idco/editor";
import { normalizeDocument } from "../../packages/editor/src/model/normalize";

describe("large document JSON indexes", () => {
  it("indexes headings, text runs, comments, and offscreen search results", () => {
    const indexes = buildRichTextDocumentIndexes(
      normalizeDocument({
        root: {
          children: [
            heading("First"),
            paragraph("alpha"),
            heading("Second"),
            {
              type: "paragraph",
              children: [
                {
                  type: "mark",
                  ids: ["comment-1"],
                  children: [{ type: "text", text: "needle in a comment" }],
                },
              ],
            },
          ],
        },
      }),
      { fallbackBlocksPerSection: 2 },
    );

    expect(indexes.headings.map((entry) => entry.text)).toEqual([
      "First",
      "Second",
    ]);
    expect(indexes.comments[0]).toMatchObject({ ids: ["comment-1"] });
    expect(searchRichTextIndexes(indexes, "needle")[0]).toMatchObject({
      preview: "needle in a comment",
      sectionId: indexes.sections[1]?.id,
    });
  });
});

function paragraph(text: string) {
  return { type: "paragraph", children: [{ type: "text", text }] };
}

function heading(text: string) {
  return { type: "heading", tag: "h2", children: [{ type: "text", text }] };
}
