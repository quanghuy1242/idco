/**
 * The mirror guard (docs/028 §4.1, §9). The reader carries its own copy of the mark
 * resolution + segmentation algorithm (`@idco/reader` `model.ts`) because it sits below the
 * editor in the package graph and cannot import the editor's core. This test feeds a corpus
 * of real text leaves (built through the editor's compat import, so they carry genuine
 * character ids and anchored marks) through BOTH the editor's canonical `segmentLeaf`/
 * `resolveLeafMarks` and the reader's mirror, and asserts byte-identical output — so the two
 * cannot silently drift even though they are separate modules.
 */
import { describe, expect, it } from "vitest";
import {
  createEditorStoreFromCompat,
  resolveLeafMarks as editorResolveLeafMarks,
  segmentLeaf as editorSegmentLeaf,
} from "@quanghuy1242/idco-editor";
import {
  resolveLeafMarks as readerResolveLeafMarks,
  segmentLeaf as readerSegmentLeaf,
} from "@quanghuy1242/idco-reader";

/** A compat doc exercising plain, bold, overlapping bold+italic, inline code, and a link. */
const corpus = {
  root: {
    children: [
      { children: [{ text: "plain text", type: "text" }], type: "paragraph" },
      {
        children: [
          { text: "a ", type: "text" },
          { format: 1, text: "bold", type: "text" },
          { text: " and ", type: "text" },
          { format: 3, text: "boldItalic", type: "text" },
          { text: " run", type: "text" },
        ],
        type: "paragraph",
      },
      {
        children: [
          { text: "call ", type: "text" },
          { format: 16, text: "fn()", type: "text" },
          { text: " now", type: "text" },
        ],
        type: "paragraph",
      },
      {
        children: [
          { text: "see ", type: "text" },
          {
            children: [{ text: "the docs", type: "text" }],
            type: "link",
            url: "https://example.test/docs",
          },
          { text: " here", type: "text" },
        ],
        type: "paragraph",
      },
    ],
  },
};

describe("reader resolution mirror ↔ editor core (docs/028 §9)", () => {
  const snapshot = createEditorStoreFromCompat(corpus).toSnapshot();
  const leaves = snapshot.body.order
    .map((id) => snapshot.body.blocks[id])
    .filter(
      (node): node is typeof node & { kind: "text" } => node?.kind === "text",
    );

  it("has text leaves to compare", () => {
    expect(leaves.length).toBeGreaterThanOrEqual(4);
  });

  it("resolveLeafMarks matches the editor's canonical implementation", () => {
    for (const leaf of leaves) {
      expect(JSON.stringify(readerResolveLeafMarks(leaf))).toBe(
        JSON.stringify(editorResolveLeafMarks(leaf)),
      );
    }
  });

  it("segmentLeaf matches the editor's canonical implementation", () => {
    for (const leaf of leaves) {
      expect(JSON.stringify(readerSegmentLeaf(leaf))).toBe(
        JSON.stringify(editorSegmentLeaf(leaf)),
      );
    }
  });
});
