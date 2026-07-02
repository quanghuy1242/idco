/**
 * Review-mode plumbing (docs/038 §13–§15, R6-J J6).
 *
 * These tests keep the load-bearing behavior in the core where it belongs: optimistic proposal apply
 * is programmatic and non-historic, reviewer edits route into a separate review-local history segment,
 * reject restores the pre-review state by replaying that segment then the proposal inverse, and public
 * saves stay gated while the proposal is live.
 */
import { describe, expect, it } from "vitest";
import {
  applyProposalToStore,
  createEditorStore,
  createIdAllocator,
  createOwnedEditorHandle,
  diffSnapshots,
  pointAtOffset,
  revertLiveProposalApplication,
  type EditorStore,
  type NodeId,
  type Proposal,
  type ProposalAuthor,
  type Step,
} from "../../packages/editor/src/core";
import { leaf, snap } from "./diff-fixtures";

const AGENT: ProposalAuthor = {
  id: "agent-1",
  kind: "agent",
  label: "Assistant",
};

function text(store: EditorStore, id: NodeId): string {
  const node = store.requireTextNode(id);
  return node.content.text;
}

describe("EditorStore review mode", () => {
  it("routes reviewer edits to a review-local segment and rejects back to the pre-review document", () => {
    const a = createIdAllocator("idco_client_j6base");
    const keep = leaf(a, "Keep this paragraph.");
    const removed = leaf(a, "The proposal removes this focused block.");
    const base = snap([keep, removed]);
    const authoring = createEditorStore({
      allocator: createIdAllocator("idco_client_j6author"),
      snapshot: base,
    });
    const ops: Step[] = [];
    const off = authoring.subscribeCommit((committed) =>
      ops.push(...committed.steps),
    );
    authoring.dispatch(
      authoring.transaction().replaceText({
        at: 0,
        inserted: "[agent] ",
        node: keep.id,
        removed: "",
      }),
    );
    authoring.dispatch(
      authoring
        .transaction()
        .removeNode(authoring.bodyId, 1, authoring.requireTextNode(removed.id)),
    );
    off();
    const proposal: Proposal = {
      author: AGENT,
      baseVersion: base.revision ?? 0,
      createdAt: "2026-07-02T00:00:00Z",
      id: "p1",
      ops,
      status: "pending",
    };
    const store = createEditorStore({
      allocator: createIdAllocator("idco_client_j6reviewer"),
      snapshot: base,
    });
    const focus = pointAtOffset(removed.id, removed.content, 4);
    store.dispatch({
      origin: "local",
      selectionAfter: { anchor: focus, focus, type: "text" },
      steps: [],
    });

    store.beginReviewMode({
      pendingOps: proposal.ops.length,
      proposalId: proposal.id,
    });
    const applied = applyProposalToStore(store, proposal);

    expect(applied.conflicts).toEqual([]);
    expect(applied.focusProtection).toMatchObject({
      from: removed.id,
      relocated: true,
      to: keep.id,
    });
    expect(store.reviewMode).toMatchObject({
      pendingOps: proposal.ops.length,
      proposalId: proposal.id,
    });
    expect(store.canSaveSnapshot).toBe(false);
    expect(text(store, keep.id)).toBe("[agent] Keep this paragraph.");
    expect(store.getNode(removed.id)).toBeUndefined();

    const reviewerEdit = store.dispatch(
      store.transaction().replaceText({
        at: 8,
        inserted: "[reviewer] ",
        node: keep.id,
        removed: "",
      }),
    );
    expect(reviewerEdit?.origin).toBe("suggested");
    expect(reviewerEdit?.interactive).toBe(true);
    expect(store.canUndo).toBe(true);
    expect(text(store, keep.id)).toBe(
      "[agent] [reviewer] Keep this paragraph.",
    );

    store.undo();
    expect(text(store, keep.id)).toBe("[agent] Keep this paragraph.");
    store.redo();
    expect(text(store, keep.id)).toBe(
      "[agent] [reviewer] Keep this paragraph.",
    );

    store.revertReviewEdits();
    revertLiveProposalApplication(store, applied);
    store.endReviewMode();

    expect(diffSnapshots(base, store.toSnapshot()).stats).toEqual({
      added: 0,
      changed: 0,
      moved: 0,
      removed: 0,
    });
    expect(store.canSaveSnapshot).toBe(true);
  });

  it("blocks public handle saves while review mode is active", () => {
    const a = createIdAllocator("idco_client_j6save");
    const node = leaf(a, "Save gate");
    const store = createEditorStore({
      allocator: createIdAllocator("idco_client_j6save_store"),
      snapshot: snap([node]),
    });
    const handle = createOwnedEditorHandle(store);

    expect(handle.canSave()).toBe(true);
    store.beginReviewMode({ pendingOps: 1, proposalId: "p-save" });

    expect(handle.canSave()).toBe(false);
    expect(() => handle.getEditorSnapshot()).toThrow(/Cannot save/);

    store.endReviewMode();
    expect(handle.canSave()).toBe(true);
    expect(handle.getEditorSnapshot().body.order).toEqual([node.id]);
  });
});
