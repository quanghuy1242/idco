import { describe, expect, it } from "vitest";
import { sectionizeDocument } from "@idco/editor";
import { normalizeDocument } from "../../packages/editor/src/model/normalize";

describe("large document sectionization", () => {
  it("splits heading-structured documents at configured heading levels", () => {
    const sections = sectionizeDocument(
      normalizeDocument({
        root: {
          children: [
            paragraph("Intro"),
            heading("h1", "Chapter 1"),
            paragraph("A"),
            heading("h2", "Part 1"),
            paragraph("B"),
            heading("h3", "Nested detail"),
            paragraph("C"),
          ],
        },
      }),
    );

    expect(sections.map((section) => section.title)).toEqual([
      "Introduction",
      "Chapter 1",
      "Part 1",
    ]);
    expect(sections[1]?.blockIds).toHaveLength(2);
    expect(sections[2]?.blockIds).toHaveLength(4);
  });

  it("falls back to deterministic block-count sections without headings", () => {
    const sections = sectionizeDocument(
      normalizeDocument({
        root: {
          children: Array.from({ length: 12 }, (_, i) => paragraph(`${i}`)),
        },
      }),
      { fallbackBlocksPerSection: 5 },
    );

    expect(sections.map((section) => section.blockIds.length)).toEqual([
      5, 5, 2,
    ]);
    expect(sectionizeDocument(sections[0]!.document)[0]?.id).toBe(
      sections[0]?.id,
    );
  });

  it("caps oversized heading sections with deterministic sub-sections", () => {
    const sections = sectionizeDocument(
      normalizeDocument({
        root: {
          children: [
            heading("h1", "Very long chapter"),
            ...Array.from({ length: 12 }, (_, i) => paragraph(`Body ${i}`)),
          ],
        },
      }),
      { fallbackBlocksPerSection: 5 },
    );

    expect(sections).toHaveLength(3);
    expect(sections.every((section) => section.blockIds.length <= 5)).toBe(
      true,
    );
    expect(sections.map((section) => section.headingAnchorId)).toEqual([
      "very-long-chapter",
      "very-long-chapter",
      "very-long-chapter",
    ]);
  });
});

function paragraph(text: string) {
  return { type: "paragraph", children: [{ type: "text", text }] };
}

function heading(tag: string, text: string) {
  return { type: "heading", tag, children: [{ type: "text", text }] };
}
