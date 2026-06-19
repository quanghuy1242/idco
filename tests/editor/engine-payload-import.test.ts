/**
 * Payload-Lexical import adapter (docs/010 Phase 8 AC7, docs/017 §3.4).
 *
 * The corpus speaks a third dialect the runtime compat layer throws on. These
 * assert the adapter maps the real node types into the engine and drops-with-
 * report what it cannot map, never crashing on real-shaped data.
 */
import { describe, expect, it } from "vitest";
import {
  createEditorStoreFromCompat,
  importPayloadLexical,
  type EditorStore,
} from "../../packages/editor/src/core";

function objectsOf(store: EditorStore): { type: string; baked?: string }[] {
  return store.order
    .map((id) => store.requireNode(id))
    .filter((n) => n.kind === "object")
    .map((n) =>
      n.kind === "object"
        ? { baked: n.baked?.kind, type: n.type }
        : { type: "" },
    );
}

const corpus = {
  root: {
    children: [
      {
        children: [
          { text: "Intro with a ", type: "text" },
          {
            children: [{ text: "link", type: "text" }],
            type: "link",
            url: "https://example.com",
          },
        ],
        type: "paragraph",
      },
      { fields: { videoID: "abc123" }, type: "youtube" },
      {
        relationTo: "media",
        type: "upload",
        value: { alt: "A cat", url: "/cat.png" },
      },
      { type: "horizontalrule" },
      {
        children: [
          { children: [{ text: "one", type: "text" }], type: "listitem" },
          { children: [{ text: "two", type: "text" }], type: "listitem" },
        ],
        type: "list",
      },
      { blockType: "callToAction", fields: {}, type: "block" },
    ],
  },
};

describe("Payload-Lexical import adapter", () => {
  it("maps the corpus node types and drops unknown blocks with a report", () => {
    const { document, report } = importPayloadLexical(corpus);
    // `block` (Payload Blocks) is dropped and reported, not crashed on.
    expect(report.dropped.block).toBe(1);
    expect(report.mapped.upload).toBe(1);
    expect(report.mapped.youtube).toBe(1);
    expect(report.mapped.horizontalrule).toBe(1);

    const store = createEditorStoreFromCompat(document);
    const objects = objectsOf(store);
    expect(objects.map((o) => o.type)).toEqual(["embed", "media", "divider"]);
    // The mapped media node carries the upload's resolved source.
    const media = store.order
      .map((id) => store.requireNode(id))
      .find((n) => n.kind === "object" && n.type === "media");
    expect(
      media?.kind === "object" && (media.data as { src?: string }).src,
    ).toBe("/cat.png");
  });

  it("recovers an inline link as a link mark and youtube as a watch URL", () => {
    const { document } = importPayloadLexical(corpus);
    const store = createEditorStoreFromCompat(document);
    const firstText = store.order
      .map((id) => store.requireNode(id))
      .find((n) => n.kind === "text");
    expect(firstText?.kind === "text" && firstText.content.text).toBe(
      "Intro with a link",
    );
    expect(
      firstText?.kind === "text" &&
        firstText.marks.some((m) => m.kind === "link"),
    ).toBe(true);
    const embed = store.order
      .map((id) => store.requireNode(id))
      .find((n) => n.kind === "object" && n.type === "embed");
    expect(
      embed?.kind === "object" &&
        typeof embed.data === "object" &&
        embed.data !== null &&
        (embed.data as { url?: string }).url,
    ).toBe("https://www.youtube.com/watch?v=abc123");
  });

  it("flattens lists to listitem leaves", () => {
    const { document } = importPayloadLexical(corpus);
    const store = createEditorStoreFromCompat(document);
    const items = store.order
      .map((id) => store.requireNode(id))
      .filter((n) => n.kind === "text" && n.type === "listitem");
    expect(items.map((n) => (n.kind === "text" ? n.content.text : ""))).toEqual(
      ["one", "two"],
    );
  });

  it("never throws on an empty or malformed document", () => {
    expect(() => importPayloadLexical({})).not.toThrow();
    expect(importPayloadLexical({}).document.root.children).toEqual([]);
  });
});
