// @vitest-environment jsdom
/**
 * docs/018 Phase 9 typing-loop work:
 *  - §2.0 collapsed-caret pending format (toggle then type)
 *  - §2.1 inline-code wrap, smart-quote substitution, bracket auto-pairing
 *  - §2.2 typing-run undo coalescing with hard boundaries + selection restore
 */
import { describe, expect, it } from "vitest";
import {
  createEditorStore,
  createIdAllocator,
  detectMarkdownShortcut,
  makeTextNode,
  pointAtOffset,
  type EditorStore,
  type NodeId,
} from "../../packages/editor/src/core";
import { applyEditContextText } from "../../packages/editor/src/view/overlays";

function single(text: string): { store: EditorStore; id: NodeId } {
  const allocator = createIdAllocator("idco_client_p9");
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
  return { id: node.id, store };
}

/** Place a collapsed caret at `offset` of the single leaf. */
function caretAt(store: EditorStore, id: NodeId, offset: number): void {
  const node = store.requireTextNode(id);
  const point = pointAtOffset(node.id, node.content, offset);
  store.dispatch({
    origin: "local",
    selectionAfter: { anchor: point, focus: point, type: "text" },
    steps: [],
  });
}

/** Simulate one typed character at the caret through the input path. */
function type(store: EditorStore, id: NodeId, char: string): void {
  const node = store.requireTextNode(id);
  const sel = store.selection;
  const at = sel?.type === "text" ? sel.focus.offset : node.content.text.length;
  const before = node.content.text;
  const after = before.slice(0, at) + char + before.slice(at);
  applyEditContextText(store, id, after, at + char.length, at + char.length);
}

function marksOf(store: EditorStore, id: NodeId) {
  return store.requireTextNode(id).marks.map((mark) => ({
    from: mark.from.offset,
    kind: mark.kind,
    to: mark.to.offset,
  }));
}

/** Whether a `bold` mark strictly covers `offset` on the leaf. */
function boldKinds(store: EditorStore, id: NodeId, offset: number): boolean {
  return store
    .requireTextNode(id)
    .marks.some(
      (mark) =>
        mark.kind === "bold" &&
        mark.from.offset <= offset &&
        mark.to.offset > offset,
    );
}

describe("§2.0 collapsed-caret pending format", () => {
  it("toggling a mark at a collapsed caret records a pending format, not a no-op", () => {
    const { store, id } = single("hi");
    caretAt(store, id, 2);
    expect(store.command({ mark: "bold", type: "toggle-mark" })).toBeNull();
    expect(store.pendingFormat?.marks.has("bold")).toBe(true);
    // The toolbar query reflects the pending state at the caret.
    expect(store.query({ mark: "bold", type: "is-mark-active" })).toBe(true);
    // No document change yet.
    expect(marksOf(store, id)).toEqual([]);
  });

  it("stays sticky: every typed character (incl. spaces) keeps the format", () => {
    const { store, id } = single("");
    caretAt(store, id, 0);
    store.command({ mark: "bold", type: "toggle-mark" });
    store.command({ mark: "italic", type: "toggle-mark" });
    // Type a whole phrase including a space — all of it inherits the format.
    for (const ch of "ab cd") type(store, id, ch);
    expect(store.requireTextNode(id).content.text).toBe("ab cd");
    const boldCovers = (offset: number) =>
      store
        .requireTextNode(id)
        .marks.some(
          (m) =>
            m.kind === "bold" &&
            m.from.offset <= offset &&
            m.to.offset > offset,
        );
    // Every character offset, including the space at index 2, is bold.
    for (let i = 0; i < 5; i += 1) expect(boldCovers(i)).toBe(true);
    // Pending survives typing (it is sticky, not consume-once).
    expect(store.pendingFormat).not.toBeNull();
  });

  it("stops the sticky format once the caret moves by navigation", () => {
    const { store, id } = single("hello");
    caretAt(store, id, 2);
    store.command({ mark: "bold", type: "toggle-mark" });
    type(store, id, "X"); // "heXllo": "X" bold at offset 2; caret now at 3
    // A real navigation move (offset 3 → 5) ends the run; later typing is plain.
    caretAt(store, id, 5);
    expect(store.pendingFormat).toBeNull();
    type(store, id, "Z"); // inserted mid-plain-text, away from the bold run
    expect(boldKinds(store, id, 5)).toBe(false);
  });

  it("marks a whole multi-character insert (an IME-committed word)", () => {
    const { store, id } = single("");
    caretAt(store, id, 0);
    store.command({ mark: "bold", type: "toggle-mark" });
    // An IME commit lands several characters in one update.
    applyEditContextText(store, id, "nhé", 3, 3);
    expect(store.requireTextNode(id).content.text).toBe("nhé");
    for (let i = 0; i < 3; i += 1) expect(boldKinds(store, id, i)).toBe(true);
  });

  it("survives a Telex composition that replaces its preedit on a tone key", () => {
    const { store, id } = single("");
    caretAt(store, id, 0);
    store.command({ mark: "bold", type: "toggle-mark" });
    // Telex: n, h, e, then a tone key replaces "e" with "é".
    applyEditContextText(store, id, "n", 1, 1);
    applyEditContextText(store, id, "nh", 2, 2);
    applyEditContextText(store, id, "nhe", 3, 3);
    applyEditContextText(store, id, "nhé", 3, 3); // removed "e", inserted "é"
    expect(store.requireTextNode(id).content.text).toBe("nhé");
    // Pending did not drop on the tone keystroke, and the word is fully bold.
    expect(store.pendingFormat).not.toBeNull();
    for (let i = 0; i < 3; i += 1) expect(boldKinds(store, id, i)).toBe(true);
  });

  it("carries the sticky format into a new block on Enter (split)", () => {
    const { store, id } = single("");
    caretAt(store, id, 0);
    store.command({ mark: "bold", type: "toggle-mark" });
    type(store, id, "a"); // "a" bold in the first block
    store.command({ type: "split-block" }); // Enter → new block, caret at start
    const sel = store.selection;
    const newId = sel?.type === "text" ? sel.focus.node : id;
    expect(newId).not.toBe(id);
    // Pending followed the caret into the brand-new block.
    expect(store.pendingFormat?.node).toBe(newId);
    type(store, newId, "b");
    expect(store.requireTextNode(newId).content.text).toBe("b");
    expect(boldKinds(store, newId, 0)).toBe(true);
  });

  it("keeps the format across a Backspace delete (re-anchors to the caret)", () => {
    const { store, id } = single("");
    caretAt(store, id, 0);
    store.command({ mark: "bold", type: "toggle-mark" });
    type(store, id, "a");
    type(store, id, "b"); // "ab" bold, caret at 2
    store.command({ type: "delete-backward" }); // delete "b", caret at 1
    expect(store.pendingFormat).not.toBeNull();
    type(store, id, "c"); // still bold
    expect(boldKinds(store, id, 1)).toBe(true);
  });

  it("toggling a covering mark off types unformatted text inside a run", () => {
    const { store, id } = single("ab");
    // Bold the whole leaf, then drop a caret inside the bold run.
    store.dispatch({
      origin: "local",
      selectionAfter: {
        anchor: pointAtOffset(id, store.requireTextNode(id).content, 0),
        focus: pointAtOffset(id, store.requireTextNode(id).content, 2),
        type: "text",
      },
      steps: [],
    });
    store.command({ mark: "bold", type: "toggle-mark" });
    expect(marksOf(store, id)).toHaveLength(1);
    caretAt(store, id, 1);
    // Caret sits inside bold → query shows it active → toggle turns it off.
    expect(store.query({ mark: "bold", type: "is-mark-active" })).toBe(true);
    store.command({ mark: "bold", type: "toggle-mark" });
    type(store, id, "X");
    expect(store.requireTextNode(id).content.text).toBe("aXb");
    // The inserted "X" at offset 1 is not covered by any bold mark.
    const boldOverX = store
      .requireTextNode(id)
      .marks.some(
        (m) => m.kind === "bold" && m.from.offset <= 1 && m.to.offset > 1,
      );
    expect(boldOverX).toBe(false);
  });

  it("drops a pending format when the caret moves without typing", () => {
    const { store, id } = single("hello");
    caretAt(store, id, 5);
    store.command({ mark: "bold", type: "toggle-mark" });
    expect(store.pendingFormat).not.toBeNull();
    caretAt(store, id, 0);
    expect(store.pendingFormat).toBeNull();
  });

  it("applies a pending link to the next typed run", () => {
    const { store, id } = single("");
    caretAt(store, id, 0);
    store.command({ href: "https://example.com", type: "set-link" });
    const href = store.query({ type: "active-link-href" });
    expect(href).toBe("https://example.com");
    type(store, id, "k");
    const link = store.requireTextNode(id).marks.find((m) => m.kind === "link");
    expect(link?.attrs?.href).toBe("https://example.com");
  });
});

describe("§2.1 typing-loop affordances", () => {
  it("wraps inline code and removes both backticks", () => {
    const { store, id } = single("`x`");
    caretAt(store, id, 3);
    const shortcut = detectMarkdownShortcut("`x`", 3, "paragraph", "`")!;
    expect(shortcut.kind).toBe("inline-code");
    store.command({ shortcut, type: "apply-markdown" });
    const node = store.requireTextNode(id);
    expect(node.content.text).toBe("x");
    expect(node.marks.map((m) => m.kind)).toEqual(["code"]);
  });

  it("substitutes straight quotes with curly quotes by context", () => {
    const open = detectMarkdownShortcut('"', 1, "paragraph", '"');
    expect(open).toMatchObject({ kind: "substitute", to: "“" });
    const close = detectMarkdownShortcut('hi"', 3, "paragraph", '"');
    expect(close).toMatchObject({ kind: "substitute", to: "”" });

    const { store, id } = single('say "');
    caretAt(store, id, 5);
    const shortcut = detectMarkdownShortcut('say "', 5, "paragraph", '"')!;
    store.command({ shortcut, type: "apply-markdown" });
    expect(store.requireTextNode(id).content.text).toBe("say “");
  });

  it("auto-pairs an opening bracket and leaves the caret inside", () => {
    const shortcut = detectMarkdownShortcut("(", 1, "paragraph", "(");
    expect(shortcut).toMatchObject({
      close: ")",
      kind: "wrap-pair",
      open: "(",
    });
    const { store, id } = single("(");
    caretAt(store, id, 1);
    store.command({ shortcut: shortcut!, type: "apply-markdown" });
    expect(store.requireTextNode(id).content.text).toBe("()");
    expect(store.selection).toMatchObject({ focus: { offset: 1 } });
  });

  it("does not auto-pair on a deletion or a multi-char paste", () => {
    // No inserted text (a deletion that left the caret after `(`).
    expect(detectMarkdownShortcut("(", 1, "paragraph", "")).toBeNull();
    // A multi-char insert (paste) is not a single typed bracket.
    expect(detectMarkdownShortcut("(x", 2, "paragraph", "(x")).toBeNull();
  });
});

describe("§2.2 typing-run undo coalescing", () => {
  it("coalesces a run of typed characters into one undo entry", () => {
    const { store, id } = single("");
    caretAt(store, id, 0);
    type(store, id, "a");
    type(store, id, "b");
    type(store, id, "c");
    expect(store.requireTextNode(id).content.text).toBe("abc");
    store.undo();
    // One undo reverts the whole run and restores the run-start caret.
    expect(store.requireTextNode(id).content.text).toBe("");
    expect(store.canUndo).toBe(false);
    expect(store.selection).toMatchObject({ focus: { offset: 0 } });
  });

  it("breaks the run at a caret move", () => {
    const { store, id } = single("");
    caretAt(store, id, 0);
    type(store, id, "a");
    type(store, id, "b");
    caretAt(store, id, 0); // caret move = boundary
    type(store, id, "Z");
    expect(store.requireTextNode(id).content.text).toBe("Zab");
    store.undo();
    expect(store.requireTextNode(id).content.text).toBe("ab");
    store.undo();
    expect(store.requireTextNode(id).content.text).toBe("");
  });

  it("breaks the run at a format toggle", () => {
    const { store, id } = single("");
    caretAt(store, id, 0);
    type(store, id, "a");
    type(store, id, "b");
    // Select and bold — a hard boundary.
    store.dispatch({
      origin: "local",
      selectionAfter: {
        anchor: pointAtOffset(id, store.requireTextNode(id).content, 0),
        focus: pointAtOffset(id, store.requireTextNode(id).content, 2),
        type: "text",
      },
      steps: [],
    });
    store.command({ mark: "bold", type: "toggle-mark" });
    store.undo(); // undoes only the bold
    expect(store.requireTextNode(id).marks).toHaveLength(0);
    expect(store.requireTextNode(id).content.text).toBe("ab");
  });

  it("separates a typing run from a following deletion run", () => {
    const { store, id } = single("");
    caretAt(store, id, 0);
    type(store, id, "a");
    type(store, id, "b");
    // Delete back twice through the input path.
    applyEditContextText(store, id, "a", 1, 1);
    applyEditContextText(store, id, "", 0, 0);
    expect(store.requireTextNode(id).content.text).toBe("");
    store.undo(); // restores the deleted run
    expect(store.requireTextNode(id).content.text).toBe("ab");
    store.undo(); // reverts the typing run
    expect(store.requireTextNode(id).content.text).toBe("");
  });

  it("redo replays a coalesced run and restores its end selection", () => {
    const { store, id } = single("");
    caretAt(store, id, 0);
    type(store, id, "h");
    type(store, id, "i");
    store.undo();
    store.redo();
    expect(store.requireTextNode(id).content.text).toBe("hi");
    expect(store.selection).toMatchObject({ focus: { offset: 2 } });
  });
});
