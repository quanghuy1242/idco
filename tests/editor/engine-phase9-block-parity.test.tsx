// @vitest-environment jsdom
/**
 * docs/018 §2.8 editor block-type + object-surface parity gaps (do-now slice):
 *
 * - Block `indent` persists through the compat round-trip and is applied by the
 *   resting render (it was editor-session-only before).
 * - `callout` is authorable from the block-type command and renders as a styled
 *   `<aside role="note">` at rest, with its `tone` carried onto a data attribute.
 *
 * The code-block highlighting + language work is verified by the object lifecycle
 * e2e (tests/e2e/engine-objects.spec.ts), which owns the resting↔live no-shift
 * contract those changes had to preserve.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  RestingDocument,
  compatFromSnapshot,
  createIdAllocator,
  createEditorStore,
  editorSnapshotFromCompat,
  makeTextNode,
  pointAtOffset,
  segmentText,
  type EditorDocumentSnapshot,
  type ResolvedMark,
  type RichTextCompatNode,
} from "../../packages/editor/src";

function findChild(
  doc: { root: { children: readonly RichTextCompatNode[] } },
  type: string,
): RichTextCompatNode | undefined {
  return doc.root.children.find((child) => child.type === type);
}

describe("§2.8 block indent persists through the compat round-trip", () => {
  it("keeps an indent level on paragraph / heading / quote / listitem / callout", () => {
    const compat = {
      root: {
        children: [
          {
            children: [{ text: "p", type: "text" }],
            indent: 2,
            type: "paragraph",
          },
          {
            children: [{ text: "h", type: "text" }],
            indent: 1,
            tag: "h2",
            type: "heading",
          },
          { children: [{ text: "q", type: "text" }], indent: 3, type: "quote" },
          {
            children: [{ text: "li", type: "text" }],
            indent: 1,
            type: "listitem",
          },
          {
            children: [{ text: "c", type: "text" }],
            indent: 2,
            type: "callout",
          },
        ],
      },
    };
    const snapshot = editorSnapshotFromCompat(compat);
    const out = compatFromSnapshot(snapshot);
    expect(findChild(out, "paragraph")?.indent).toBe(2);
    expect(findChild(out, "heading")?.indent).toBe(1);
    expect(findChild(out, "quote")?.indent).toBe(3);
    expect(findChild(out, "listitem")?.indent).toBe(1);
    expect(findChild(out, "callout")?.indent).toBe(2);
  });

  it("does not invent an indent attr when none was set", () => {
    const compat = {
      root: {
        children: [
          { children: [{ text: "p", type: "text" }], type: "paragraph" },
        ],
      },
    };
    const out = compatFromSnapshot(editorSnapshotFromCompat(compat));
    expect(findChild(out, "paragraph")?.indent).toBeUndefined();
  });
});

describe("§2.8 indent + callout in the resting render", () => {
  it("applies the indent margin and the callout tone at rest", () => {
    const allocator = createIdAllocator("idco_client_rest");
    const para = makeTextNode({
      attrs: { indent: 2 },
      content: allocator.createTextSlice("indented"),
      id: allocator.createNodeId(),
      type: "paragraph",
    });
    const callout = makeTextNode({
      attrs: { tone: "warning" },
      content: allocator.createTextSlice("heads up"),
      id: allocator.createNodeId(),
      type: "callout",
    });
    const snapshot: EditorDocumentSnapshot = {
      body: {
        blocks: { [para.id]: para, [callout.id]: callout },
        order: [para.id, callout.id],
      },
      settings: {},
      version: 1,
    };
    const { container } = render(<RestingDocument snapshot={snapshot} />);

    const paragraph = container.querySelector<HTMLElement>("p");
    expect(paragraph?.style.marginLeft).toBe("3.2em"); // indent 2 × 1.6em

    const aside = container.querySelector<HTMLElement>("aside");
    expect(aside?.getAttribute("role")).toBe("note");
    expect(aside?.getAttribute("data-engine-callout-tone")).toBe("warning");
    expect(aside?.textContent).toContain("heads up");
  });
});

describe("§2.8 callout is authorable from the block-type command", () => {
  it("turns a paragraph into a callout leaf via set-block-type", () => {
    const allocator = createIdAllocator("idco_client_callout");
    const para = makeTextNode({
      content: allocator.createTextSlice("note me"),
      id: allocator.createNodeId(),
      type: "paragraph",
    });
    const store = createEditorStore({
      allocator,
      snapshot: {
        body: { blocks: { [para.id]: para }, order: [para.id] },
        settings: {},
        version: 1,
      },
    });
    const caret = pointAtOffset(
      para.id,
      store.requireTextNode(para.id).content,
      0,
    );
    store.dispatch({
      origin: "local",
      selectionAfter: { anchor: caret, focus: caret, type: "text" },
      steps: [],
    });

    store.command({ blockType: "callout", type: "set-block-type" });
    expect(store.requireTextNode(para.id).type).toBe("callout");
    expect(store.query({ type: "current-block-type" })).toBe("callout");

    // The tone is configurable through `set-block-attr` (the floating chrome).
    store.command({ key: "tone", type: "set-block-attr", value: "warning" });
    expect(store.requireTextNode(para.id).attrs?.tone).toBe("warning");
  });
});

function twoBlockStore() {
  const allocator = createIdAllocator("idco_client_chrome");
  const a = makeTextNode({
    content: allocator.createTextSlice("first"),
    id: allocator.createNodeId(),
    type: "callout",
  });
  const b = makeTextNode({
    content: allocator.createTextSlice("second"),
    id: allocator.createNodeId(),
    type: "paragraph",
  });
  const store = createEditorStore({
    allocator,
    snapshot: {
      body: { blocks: { [a.id]: a, [b.id]: b }, order: [a.id, b.id] },
      settings: {},
      version: 1,
    },
  });
  return { a, b, store };
}

describe("§2.8 standardized block-chrome commands", () => {
  it("remove-block deletes a specific block from the body", () => {
    const { a, b, store } = twoBlockStore();
    store.command({ node: a.id, type: "remove-block" });
    expect(store.getNode(a.id)).toBeUndefined();
    expect(store.toSnapshot().body.order).toEqual([b.id]);
  });

  it("set-block-attr targets a specific node regardless of the caret", () => {
    const { a, b, store } = twoBlockStore();
    // Caret in b; the chrome sets the tone on a (its own block) via node target.
    const caret = pointAtOffset(b.id, store.requireTextNode(b.id).content, 0);
    store.dispatch({
      origin: "local",
      selectionAfter: { anchor: caret, focus: caret, type: "text" },
      steps: [],
    });
    store.command({
      key: "tone",
      node: a.id,
      type: "set-block-attr",
      value: "error",
    });
    expect(store.requireTextNode(a.id).attrs?.tone).toBe("error");
    expect(store.requireTextNode(b.id).attrs?.tone).toBeUndefined();
  });
});

const codeMark = (id: string, from: number, to: number): ResolvedMark => ({
  from,
  id,
  kind: "code",
  to,
});

describe("§2.8 inline-format runs render as one segment, not per-character chips", () => {
  it("merges adjacent same-kind format marks into one run", () => {
    // Sticky typing under inline code mints one mark per character; the renderer
    // must coalesce them so the run is one `<code>`, not a chip per letter.
    const segments = segmentText("abc", [
      codeMark("a", 0, 1),
      codeMark("b", 1, 2),
      codeMark("c", 2, 3),
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toBe("abc");
    expect(segments[0]!.marks.map((m) => m.kind)).toEqual(["code"]);
  });

  it("keeps distinct kinds and distinct links separate", () => {
    const mixed = segmentText("ab", [
      { from: 0, id: "x", kind: "bold", to: 1 },
      { from: 1, id: "y", kind: "italic", to: 2 },
    ]);
    expect(mixed).toHaveLength(2);

    const links = segmentText("ab", [
      {
        attrs: { href: "https://a.example" },
        from: 0,
        id: "l1",
        kind: "link",
        to: 1,
      },
      {
        attrs: { href: "https://b.example" },
        from: 1,
        id: "l2",
        kind: "link",
        to: 2,
      },
    ]);
    expect(links).toHaveLength(2);
  });
});
