/**
 * Payload-Lexical import adapter (docs/010 Phase 8 AC7, docs/017 §3.4).
 *
 * The corpus speaks a third dialect the runtime compat layer throws on. These
 * assert the adapter maps the real node types into the engine and drops-with-
 * report what it cannot map, never crashing on real-shaped data.
 */
import { afterAll, describe, expect, it } from "vitest";
import {
  createEditorStoreFromCompat,
  importPayloadLexical,
  registerGlobalNodeDefinition,
  unregisterGlobalNodeDefinition,
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
    // The mapped media node carries the upload's resolved source. media is a
    // reference block now (docs/026 §8.2), so the URL lands in the projected
    // snapshot; the flat `upload` node imports through the media reader's
    // nested-or-flat fallback (§15).
    const media = store.order
      .map((id) => store.requireNode(id))
      .find((n) => n.kind === "object" && n.type === "media");
    expect(
      media?.kind === "object" &&
        (media.data as { snapshot?: { src?: string } }).snapshot?.src,
    ).toBe("/cat.png");
    // The youtube node imports to a resolve-only embed reference: the watch URL is
    // the ref (docs/026 §4.4, §15).
    const embed = store.order
      .map((id) => store.requireNode(id))
      .find((n) => n.kind === "object" && n.type === "embed");
    expect(
      embed?.kind === "object" && (embed.data as { ref?: string }).ref,
    ).toBe("https://www.youtube.com/watch?v=abc123");
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
    // embed is a resolve-only reference block now (docs/026 §4.4): the watch URL is
    // the ref, not a flat `url` field.
    expect(
      embed?.kind === "object" &&
        typeof embed.data === "object" &&
        embed.data !== null &&
        (embed.data as { ref?: string }).ref,
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

  // The hook test registers a global definition; clean it up so it does not leak
  // into the shared module-level registry for the rest of the run.
  afterAll(() => unregisterGlobalNodeDefinition("spi-payload-widget"));

  it("maps a registered custom node's Payload type via its fromPayload hook (W8)", () => {
    // A host registers a node that knows how to read its own dialect type, so the
    // importer maps it instead of dropping it — no edit to payload-import.ts.
    registerGlobalNodeDefinition({
      fromPayload: (node) =>
        node.type === "payload-widget" ? { type: "spi-payload-widget" } : null,
      normalizeData: () => ({ data: {}, status: "ready" }),
      type: "spi-payload-widget",
    });
    const { document, report } = importPayloadLexical({
      root: { children: [{ id: "w1", type: "payload-widget" }] },
    });
    expect(report.mapped["payload-widget"]).toBe(1);
    expect(report.dropped["payload-widget"]).toBeUndefined();
    expect(document.root.children[0]?.type).toBe("spi-payload-widget");
  });
});
