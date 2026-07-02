/**
 * The persisted document revision (docs/036 D15, §3.3, R6-J J1).
 *
 * `revision` is a monotonic counter bumped once per committed step-bearing transaction — the
 * `baseVersion` a proposal names to label staleness. It is additive: omitted from `toSnapshot()` when
 * 0 (so a document that never bumped serializes byte-identically to before the field existed), read
 * as 0 on a legacy snapshot that lacks it, and deliberately excluded from `diffSnapshots` (so a bump
 * alone is never a reported change and never lights up the change indicator or the woven overlay).
 */
import { describe, expect, it } from "vitest";
import {
  createEditorStore,
  createIdAllocator,
  diffSnapshots,
  type EditorStore,
  type NodeId,
} from "../../packages/editor/src/core";
import { leaf, snap } from "./diff-fixtures";

function storeWith(text: string): { store: EditorStore; id: NodeId } {
  const a = createIdAllocator("idco_client_rev");
  const L = leaf(a, text);
  const store = createEditorStore({ allocator: a, snapshot: snap([L]) });
  return { id: L.id, store };
}

function typeInto(
  store: EditorStore,
  id: NodeId,
  at: number,
  text: string,
): void {
  store.dispatch(
    store
      .transaction()
      .replaceText({ at, inserted: text, node: id, removed: "" }),
  );
}

describe("EditorDocumentSnapshot.revision (R6-J J1)", () => {
  it("omits revision from a fresh, unedited document (byte-identical to before the field)", () => {
    const { store } = storeWith("x");
    expect(store.toSnapshot().revision).toBeUndefined();
    expect("revision" in store.toSnapshot()).toBe(false);
  });

  it("bumps once per step-bearing commit and is monotonic", () => {
    const { store, id } = storeWith("x");
    typeInto(store, id, 1, "y");
    expect(store.toSnapshot().revision).toBe(1);
    typeInto(store, id, 2, "z");
    expect(store.toSnapshot().revision).toBe(2);
  });

  it("does not bump on a stepless (caret-only) commit", () => {
    const { store, id } = storeWith("x");
    typeInto(store, id, 1, "y"); // revision -> 1
    // A selection-only transaction commits but carries no steps; it is navigation, not an edit.
    store.dispatch({
      origin: "local",
      selectionAfter: { index: 0, scope: store.bodyId, type: "gap" },
      steps: [],
    });
    expect(store.toSnapshot().revision).toBe(1);
  });

  it("continues a loaded document's revision line and stays monotonic", () => {
    const a = createIdAllocator("idco_client_rev2");
    const L = leaf(a, "x");
    const loaded = { ...snap([L]), revision: 5 };
    const store = createEditorStore({ allocator: a, snapshot: loaded });
    expect(store.toSnapshot().revision).toBe(5); // preserved before any edit
    typeInto(store, L.id, 1, "y");
    expect(store.toSnapshot().revision).toBe(6); // one past the loaded value
  });

  it("reads a legacy snapshot without the field as revision 0 (omitted on save)", () => {
    const a = createIdAllocator("idco_client_rev3");
    const legacy = snap([leaf(a, "x")]); // no revision key at all
    const store = createEditorStore({ allocator: a, snapshot: legacy });
    expect(store.toSnapshot().revision).toBeUndefined(); // 0 -> omitted, round-trips to legacy shape
  });

  it("is diff-invisible: two snapshots differing only in revision report no change", () => {
    const a = createIdAllocator("idco_client_rev4");
    const L = leaf(a, "x");
    const base = { ...snap([L]), revision: 1 };
    const target = { ...snap([L]), revision: 9 };
    const diff = diffSnapshots(base, target);
    expect(diff.stats).toEqual({ added: 0, changed: 0, moved: 0, removed: 0 });
    expect(diff.settingsChanged).toBe(false);
    expect(diff.blocks.every((b) => b.status === "unchanged")).toBe(true);
  });
});
