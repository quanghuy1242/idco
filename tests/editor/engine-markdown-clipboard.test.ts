/**
 * Clipboard controller wiring (docs/030 §7.1/§7.2): the copy/cut/paste priority chain, the
 * three copy flavours, the lossless native round-trip, the async markdown-heuristic paste,
 * and the focus/caret re-sync. These exercise the actual `useClipboard` handler — the seam
 * the reviewer flagged for careful paste review — over a fake clipboard event.
 */
import { renderHook } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { useClipboard } from "../../packages/editor/src/view/controllers/use-clipboard";
import { IDCO_SNAPSHOT_MIME } from "../../packages/editor/src/view/markdown/native-clipboard";
import {
  createEditorStore,
  createIdAllocator,
  makeTextNode,
  pointAtOffset,
  type EditorDocumentSnapshot,
  type EditorNode,
  type EditorStore,
  type NodeId,
  type TextLeafNode,
} from "../../packages/editor/src/core";

function makeStore(...texts: readonly string[]) {
  const allocator = createIdAllocator("idco_client_clip");
  const nodes = texts.map((t) =>
    makeTextNode({
      content: allocator.createTextSlice(t),
      id: allocator.createNodeId(),
      type: "paragraph",
    }),
  );
  const snapshot: EditorDocumentSnapshot = {
    body: {
      blocks: Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<
        NodeId,
        EditorNode
      >,
      order: nodes.map((n) => n.id),
    },
    settings: {},
    version: 1,
  };
  return { nodes, store: createEditorStore({ allocator, snapshot }) };
}

/** A fake clipboard event with an in-memory DataTransfer and a non-native target. */
function fakeEvent(initial: Record<string, string> = {}) {
  const bag: Record<string, string> = { ...initial };
  let prevented = false;
  const event = {
    clipboardData: {
      getData: (mime: string) => bag[mime] ?? "",
      setData: (mime: string, value: string) => {
        bag[mime] = value;
      },
    },
    preventDefault: () => {
      prevented = true;
    },
    target: document.createElement("div"),
  };
  return {
    bag,
    event: event as unknown as React.ClipboardEvent<HTMLDivElement>,
    get prevented() {
      return prevented;
    },
  };
}

function controller(store: EditorStore) {
  const sync = vi.fn<() => void>();
  const { result } = renderHook(() =>
    useClipboard({ store, syncFocusToSelection: sync }),
  );
  return { result, sync };
}

function selectAcross(store: EditorStore, a: TextLeafNode, b: TextLeafNode) {
  store.dispatch({
    origin: "local",
    selectionAfter: {
      anchor: pointAtOffset(a.id, a.content, 0),
      focus: pointAtOffset(b.id, b.content, b.content.text.length),
      type: "text",
    },
    steps: [],
  });
}

function caretAt(store: EditorStore, node: TextLeafNode, offset: number) {
  const point = pointAtOffset(node.id, node.content, offset);
  store.dispatch({
    origin: "local",
    selectionAfter: { anchor: point, focus: point, type: "text" },
    steps: [],
  });
}

describe("clipboard controller (MIO)", () => {
  it("copy writes native + markdown + plain for a block selection", () => {
    const { nodes, store } = makeStore("first", "second");
    selectAcross(store, nodes[0]!, nodes[1]!);
    const { result } = controller(store);
    const fe = fakeEvent();
    result.current.onClipboardCopy(fe.event);
    expect(fe.prevented).toBe(true);
    expect(fe.bag[IDCO_SNAPSHOT_MIME]).toBeTruthy();
    expect(fe.bag["text/markdown"]).toContain("first");
    expect(fe.bag["text/plain"]).toContain("first");
  });

  it("cut writes the clipboard then deletes the selection", () => {
    const { nodes, store } = makeStore("alpha", "beta");
    selectAcross(store, nodes[0]!, nodes[1]!);
    const { result } = controller(store);
    const { event, bag } = fakeEvent();
    result.current.onClipboardCut(event);
    expect(bag[IDCO_SNAPSHOT_MIME]).toBeTruthy();
    // The cross-block selection was deleted (the document shrank).
    expect(store.order.length).toBeLessThan(2);
  });

  it("paste prefers the native fragment (lossless) and re-syncs focus", () => {
    const { nodes, store } = makeStore("target");
    caretAt(store, nodes[0]!, nodes[0]!.content.text.length);
    const { result, sync } = controller(store);
    // A native fragment carrying a heading.
    const fragment = JSON.stringify({
      blocks: {
        h1: {
          content: { runs: [], text: "Pasted" },
          id: "h1",
          kind: "text",
          marks: [],
          type: "heading",
          attrs: { tag: "h1" },
        },
      },
      order: ["h1"],
      version: 1,
    });
    const { event } = fakeEvent({ [IDCO_SNAPSHOT_MIME]: fragment });
    result.current.onClipboardPaste(event);
    // The heading was inserted as a real node and focus was re-synced.
    const inserted = store.order
      .map((id) => store.getNode(id))
      .find((n) => n?.kind === "text" && n.type === "heading");
    expect(inserted).toBeTruthy();
    expect(sync).toHaveBeenCalled();
  });

  it("paste parses markdown-looking plain text (heuristic, async)", async () => {
    const { nodes, store } = makeStore("seed");
    caretAt(store, nodes[0]!, nodes[0]!.content.text.length);
    const { result, sync } = controller(store);
    const { event } = fakeEvent({ "text/plain": "# A heading\n\n- a\n- b" });
    result.current.onClipboardPaste(event);
    // The markdown parser is lazy-imported; let the dynamic import + insert settle.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const heading = store.order
      .map((id) => store.getNode(id))
      .find((n) => n?.kind === "text" && n.type === "heading");
    expect(heading).toBeTruthy();
    expect(sync).toHaveBeenCalled();
  });

  it("paste inserts literal plain text when it is not markdown", async () => {
    const { nodes, store } = makeStore("");
    caretAt(store, nodes[0]!, 0);
    const { result } = controller(store);
    const { event } = fakeEvent({ "text/plain": "just words" });
    result.current.onClipboardPaste(event);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(
      (store.getNode(nodes[0]!.id) as TextLeafNode).content.text,
    ).toContain("just words");
  });
});
