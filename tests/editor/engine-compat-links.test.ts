/**
 * Inline-link mark recovery on compat import (docs/017 §3.3, 011 §2.3).
 *
 * Before the fix, `marksFromInlineChildren` flattened inline `link` /
 * `epub-internal-link` elements to bare text and dropped the href. These assert
 * the link span now becomes a `link` range mark with its href preserved, and
 * that formatting inside the link is still recovered.
 */
import { describe, expect, it } from "vitest";
import {
  createEditorStoreFromCompat,
  type RichTextCompatDocument,
} from "../../packages/editor/src/core";

function firstTextLeaf(store: ReturnType<typeof createEditorStoreFromCompat>) {
  for (const id of store.order) {
    const node = store.getNode(id);
    if (node?.kind === "text") return node;
  }
  throw new Error("no text leaf");
}

describe("compat import — inline link recovery", () => {
  it("recovers a link span as a link mark with its href", () => {
    const doc: RichTextCompatDocument = {
      root: {
        children: [
          {
            children: [
              { format: 0, text: "see ", type: "text" },
              {
                children: [{ format: 0, text: "the docs", type: "text" }],
                type: "link",
                url: "https://example.com/docs",
              },
            ],
            type: "paragraph",
          },
        ],
      },
    };
    const leaf = firstTextLeaf(createEditorStoreFromCompat(doc));
    expect(leaf.content.text).toBe("see the docs");
    const link = leaf.marks.find((mark) => mark.kind === "link");
    expect(link).toBeDefined();
    expect(link?.attrs?.href).toBe("https://example.com/docs");
  });

  it("recovers formatting nested inside a link", () => {
    const doc: RichTextCompatDocument = {
      root: {
        children: [
          {
            children: [
              {
                children: [{ format: 1, text: "bold link", type: "text" }],
                type: "link",
                url: "https://example.com",
              },
            ],
            type: "paragraph",
          },
        ],
      },
    };
    const leaf = firstTextLeaf(createEditorStoreFromCompat(doc));
    expect(leaf.content.text).toBe("bold link");
    expect(leaf.marks.some((mark) => mark.kind === "link")).toBe(true);
    expect(leaf.marks.some((mark) => mark.kind === "bold")).toBe(true);
  });

  it("recovers an epub-internal-link span as a link mark", () => {
    const doc: RichTextCompatDocument = {
      root: {
        children: [
          {
            children: [
              {
                children: [{ format: 0, text: "chapter 2", type: "text" }],
                type: "epub-internal-link",
                url: "#ch2",
              },
            ],
            type: "paragraph",
          },
        ],
      },
    };
    const leaf = firstTextLeaf(createEditorStoreFromCompat(doc));
    const link = leaf.marks.find((mark) => mark.kind === "link");
    expect(link?.attrs?.href).toBe("#ch2");
  });
});
