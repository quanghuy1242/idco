/**
 * Focus-reclaim seam (docs/029 §7.1, R1-B). The core `suspendReclaim`/`resumeReclaim`/
 * `isReclaimSuspended` gate the view auto-refocus paths consult before grabbing DOM focus.
 * Proves the counter semantics (nesting-safe; clamped at zero), which is what lets a
 * drill-in over a drill-in each balance its own suspend/resume without a premature resume
 * re-enabling the editor's reclaim.
 */
import { describe, expect, it } from "vitest";
import {
  createEditorStore,
  createIdAllocator,
  makeTextNode,
} from "../../packages/editor/src/core";

function freshStore() {
  const allocator = createIdAllocator("idco_client_reclaim");
  const node = makeTextNode({
    content: allocator.createTextSlice("hello"),
    id: allocator.createNodeId(),
    type: "paragraph",
  });
  return createEditorStore({
    allocator,
    snapshot: {
      body: { blocks: { [node.id]: node }, order: [node.id] },
      settings: {},
      version: 1,
    },
  });
}

describe("focus-reclaim seam (docs/029 §7.1)", () => {
  it("is not suspended by default, so normal focus-follows-caret is unchanged", () => {
    const store = freshStore();
    expect(store.isReclaimSuspended()).toBe(false);
  });

  it("suspends and resumes, nesting-safe via a counter", () => {
    const store = freshStore();
    store.suspendReclaim();
    expect(store.isReclaimSuspended()).toBe(true);

    store.suspendReclaim(); // a drill-in over a drill-in
    expect(store.isReclaimSuspended()).toBe(true);

    store.resumeReclaim(); // inner resume must NOT re-enable the reclaim
    expect(store.isReclaimSuspended()).toBe(true);

    store.resumeReclaim(); // outer resume balances the first suspend
    expect(store.isReclaimSuspended()).toBe(false);
  });

  it("clamps at zero so an unbalanced resume is a no-op, never extra-on", () => {
    const store = freshStore();
    store.resumeReclaim();
    store.resumeReclaim();
    expect(store.isReclaimSuspended()).toBe(false);
    store.suspendReclaim();
    expect(store.isReclaimSuspended()).toBe(true);
  });
});
