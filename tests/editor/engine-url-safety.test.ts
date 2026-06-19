/**
 * Link href sanitization boundary (docs/010 §10.5, review BUG #1).
 *
 * A link href can reach a navigable `<a href>` in the reader render from the
 * toolbar, compat/Payload import, and HTML paste. `safeHref` is the one shared
 * gate; these assert it rejects script-bearing and obfuscated URLs and that the
 * model edit path (set-link) and the import path both run hrefs through it.
 */
import { describe, expect, it } from "vitest";
import {
  createEditorStore,
  createEditorStoreFromCompat,
  createIdAllocator,
  makeTextNode,
  pointAtOffset,
  safeHref,
  type EditorStore,
  type NodeId,
} from "../../packages/editor/src/core";

describe("safeHref", () => {
  it("allows http(s), mailto, tel, fragment, and relative URLs", () => {
    for (const url of [
      "https://idco.dev",
      "http://x.test/a?b=1",
      "mailto:a@b.com",
      "tel:+123",
      "#anchor",
      "/relative/path",
    ]) {
      expect(safeHref(url)).toBe(url);
    }
  });

  it("rejects javascript:, data:, vbscript:, and obfuscated schemes", () => {
    expect(safeHref("javascript:alert(1)")).toBe("");
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBe("");
    expect(safeHref("vbscript:msgbox(1)")).toBe("");
    // Tab/newline-spliced scheme must not slip past the allowlist.
    expect(safeHref("java\tscript:alert(1)")).toBe("");
    expect(safeHref("  javascript:alert(1)")).toBe("");
    expect(safeHref(null)).toBe("");
    expect(safeHref(42)).toBe("");
  });
});

function single(text: string): { store: EditorStore; id: NodeId } {
  const allocator = createIdAllocator("idco_client_url");
  const node = makeTextNode({
    content: allocator.createTextSlice(text),
    id: allocator.createNodeId(),
  });
  const store = createEditorStore({
    allocator,
    snapshot: {
      body: { blocks: { [node.id]: node }, order: [node.id] },
      settings: {},
      version: 1,
    },
  });
  const point = pointAtOffset(node.id, node.content, 0);
  store.dispatch({
    origin: "local",
    selectionAfter: {
      anchor: point,
      focus: pointAtOffset(node.id, node.content, text.length),
      type: "text",
    },
    steps: [],
  });
  return { id: node.id, store };
}

describe("href sanitization at the model boundary", () => {
  it("set-link drops a javascript: URL instead of storing it", () => {
    const { store, id } = single("danger");
    store.command({ href: "javascript:alert(1)", type: "set-link" });
    expect(store.requireTextNode(id).marks.some((m) => m.kind === "link")).toBe(
      false,
    );
  });

  it("compat import sanitizes a dangerous link href to inert", () => {
    const store = createEditorStoreFromCompat({
      root: {
        children: [
          {
            children: [
              {
                children: [{ text: "click", type: "text" }],
                type: "link",
                url: "javascript:evil()",
              },
            ],
            type: "paragraph",
          },
        ],
      },
    });
    const leaf = store.requireTextNode(store.order[0]!);
    const link = leaf.marks.find((m) => m.kind === "link");
    // Either no live link, or a recovered link whose href was sanitized to empty
    // — never the dangerous URL.
    expect(link?.attrs?.href ?? "").toBe("");
    expect(leaf.content.text).toBe("click");
  });
});
