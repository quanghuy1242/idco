import type { Story, StoryDefault } from "@ladle/react";
import { useMemo, useRef, useState } from "react";
import {
  applyProposal,
  createEditorStore,
  createIdAllocator,
  diffSnapshots,
  groupProposalOps,
  makeTextNode,
  OwnedModelEditor,
  REVIEW_INDICATOR_CSS,
  ReviewCursorSurface,
  useReviewChangeIndicator,
  useReviewCursor,
  useReviewModel,
  useReviewSnapshot,
  type EditorDocumentSnapshot,
  type EditorStore,
  type NodeId,
  type OwnedModelEditorHandle,
  type Proposal,
  type ProposalAuthor,
  type Step,
} from "../packages/editor/src";

/**
 * The active review surface + review cursor — docs/038 §7/§16, R6-J **J4**.
 *
 * What it PROVES, live, functionally end to end:
 *   1. ONE SURFACE (docs/038 §4 L3) — exactly one anchored control at a time, on the block under the
 *      review cursor. It is one BY CONSTRUCTION (a single cursor), so it needs no overlay-authority.
 *   2. CURSOR NAV (§7) — Next/Prev step through the proposal's changed blocks; each landing REVEALS
 *      the change (the editor's `scrollToBlock`), so an off-screen change scrolls into view and the
 *      surface re-anchors to it. "Change i of n" tracks the position.
 *   3. FOCUS NOT TORN (§7, §13) — a `taking`-focus surface that RECLAIMS: a terminal action reclaims
 *      editor focus via `focusEditor` (the editor handle's `getEditorHandle().focus()`), and the model
 *      selection survives throughout, so the caret returns to the document.
 *   4. ACCEPT / REJECT (§16), FUNCTIONAL over the pure `applyProposal` (J1):
 *      - Accept this change → its ops fold into the BASELINE, so the change resolves (its marker
 *        clears, the cursor advances) while the live document keeps it.
 *      - Reject this change → its ops drop from the proposed document, so the block reverts live.
 *      - Accept all / Reject all resolve the whole proposal.
 *   This story does the baseline-moves-forward bookkeeping in consumer code; J6 moves exactly that
 *   into the editor as review-mode plumbing (optimistic tag, review-local undo, the save gate,
 *   the focused-block handshake) — the surface here is the pure affordance, unchanged by that.
 *
 * The proposal is authored the way `docs/037`'s agent would: an edit made through the store's own
 * command path, its committed `Step[]` captured (the same `proposalFrom` the J1 tests use).
 */
export default {
  title: "Engine / Review Cursor",
} satisfies StoryDefault;

const AGENT: ProposalAuthor = {
  id: "agent-1",
  kind: "agent",
  label: "Assistant",
};

/** Remove a top-level block by id (re-resolving its current index) — the ghost story's helper. */
function removeById(store: EditorStore, id: NodeId): void {
  const node = store.getNode(id);
  if (!node) return;
  const top = store.order.indexOf(id);
  if (top !== -1)
    store.dispatch(store.transaction().removeNode(store.bodyId, top, node));
}

/** Build the `current` document and an agent `proposal` against it (two text edits + one removal). */
function buildScenario(): {
  current: EditorDocumentSnapshot;
  proposal: Proposal;
  edited: NodeId;
  edited2: NodeId;
  removed: NodeId;
} {
  const a = createIdAllocator("idco_client_j4current");
  const nodes = [
    makeTextNode({
      content: a.createTextSlice("Reviewing an agent proposal"),
      id: a.createNodeId(),
      type: "heading",
    }),
  ];
  const para = (t: string) =>
    makeTextNode({ content: a.createTextSlice(t), id: a.createNodeId() });
  for (let i = 1; i <= 16; i += 1) {
    nodes.push(
      para(
        `Paragraph ${i}. Body text with enough length to give each block a realistic height so navigating between changes scrolls the document and the surface re-anchors to the change it lands on.`,
      ),
    );
  }
  const current: EditorDocumentSnapshot = {
    body: {
      blocks: Object.fromEntries(nodes.map((n) => [n.id, n])),
      order: nodes.map((n) => n.id),
    },
    settings: {},
    version: 1,
  };
  // Three changes spread across the scroll: edit paragraph 2, edit paragraph 9, remove paragraph 14.
  const edited = nodes[2]!.id;
  const edited2 = nodes[9]!.id;
  const removed = nodes[14]!.id;

  const authoring = createEditorStore({
    allocator: createIdAllocator("idco_client_j4author"),
    snapshot: current,
  });
  const ops: Step[] = [];
  const off = authoring.subscribeCommit((c) => ops.push(...c.steps));
  authoring.dispatch(
    authoring
      .transaction()
      .replaceText({ at: 0, inserted: "[EDITED] ", node: edited, removed: "" }),
  );
  authoring.dispatch(
    authoring.transaction().replaceText({
      at: 0,
      inserted: "[REVISED] ",
      node: edited2,
      removed: "",
    }),
  );
  removeById(authoring, removed);
  off();

  const proposal: Proposal = {
    author: AGENT,
    baseVersion: current.revision ?? 0,
    createdAt: "2026-07-02T00:00:00Z",
    id: "p1",
    ops,
    status: "pending",
  };
  return { current, edited, edited2, proposal, removed };
}

/** The ops of a proposal that belong to the given block ids, in original order. */
function opsForBlocks(proposal: Proposal, ids: ReadonlySet<NodeId>): Step[] {
  if (ids.size === 0) return [];
  const groups = groupProposalOps(proposal.ops).byBlock;
  const keep = new Set<Step>();
  for (const id of ids) for (const op of groups.get(id) ?? []) keep.add(op);
  return proposal.ops.filter((op) => keep.has(op));
}

export const ActiveReviewSurface: Story = () => {
  const { current, proposal } = useMemo(buildScenario, []);
  const allBlockIds = useMemo(
    () => new Set<NodeId>(groupProposalOps(proposal.ops).byBlock.keys()),
    [proposal],
  );

  // Per-block decisions. `accepted` folds a block's ops into the BASELINE (it resolves, keeping the
  // live change); `rejected` drops a block's ops from the PROPOSED doc (it reverts live).
  const [accepted, setAccepted] = useState<ReadonlySet<NodeId>>(
    () => new Set(),
  );
  const [rejected, setRejected] = useState<ReadonlySet<NodeId>>(
    () => new Set(),
  );
  const [reviewing, setReviewing] = useState(true);

  // The baseline = current + the accepted blocks' ops (applied to `current`, so an id-less text op
  // trusts its exact offset — an unmoved base, no conflict). The proposed doc = current + every
  // NON-rejected block's ops. Their diff is exactly the pending (unresolved) changes.
  const baseline = useMemo(
    () =>
      applyProposal(current, {
        ...proposal,
        ops: opsForBlocks(proposal, accepted),
      }).snapshot,
    [current, proposal, accepted],
  );
  const proposed = useMemo(() => {
    const kept = new Set<NodeId>();
    for (const id of allBlockIds) if (!rejected.has(id)) kept.add(id);
    return applyProposal(current, {
      ...proposal,
      ops: opsForBlocks(proposal, kept),
    }).snapshot;
  }, [current, proposal, allBlockIds, rejected]);

  // The store shows the proposed doc; it is rebuilt when `proposed` changes (a reject reverts a block
  // live), keyed so the editor remounts cleanly. Accept only moves the baseline, so it does NOT rebuild.
  const store = useMemo(
    () =>
      createEditorStore({
        allocator: createIdAllocator("idco_client_j4store"),
        snapshot: proposed,
      }),
    [proposed],
  );

  const editorRef = useRef<OwnedModelEditorHandle>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const live = useReviewSnapshot(store);
  const diff = useMemo(
    () => (reviewing ? diffSnapshots(baseline, live) : null),
    [reviewing, baseline, live],
  );
  const reviewModel = useReviewModel(store, reviewing ? baseline : null);
  useReviewChangeIndicator({
    baseline: reviewing ? baseline : null,
    rootRef,
    store,
  });
  const cursor = useReviewCursor(diff, {
    onReveal: (id) => editorRef.current?.scrollToBlock(id),
  });

  const acceptBlock = (id: NodeId) => setAccepted((s) => new Set(s).add(id));
  const rejectBlock = (id: NodeId) => setRejected((s) => new Set(s).add(id));
  const acceptAll = () => {
    setAccepted(new Set([...allBlockIds].filter((id) => !rejected.has(id))));
    setReviewing(false);
  };
  const rejectAll = () => {
    setRejected(new Set(allBlockIds));
    setReviewing(false);
  };

  return (
    <div style={{ maxWidth: 900 }}>
      <style>{REVIEW_INDICATOR_CSS}</style>
      <div ref={rootRef}>
        <OwnedModelEditor
          key={proposed === current ? "current" : rejected.size}
          ref={editorRef}
          review={reviewModel ?? undefined}
          store={store}
          viewportHeight={460}
        />
      </div>
      {reviewing && cursor.current ? (
        <ReviewCursorSurface
          cursor={cursor}
          focusEditor={() => editorRef.current?.getEditorHandle().focus()}
          onAcceptAll={acceptAll}
          onAcceptBlock={acceptBlock}
          onExit={() => setReviewing(false)}
          onRejectAll={rejectAll}
          onRejectBlock={rejectBlock}
          rootRef={rootRef}
        />
      ) : null}
      <p style={{ font: "12px ui-sans-serif", marginTop: 12, opacity: 0.7 }}>
        docs/038 J4 — the active review surface + cursor. One anchored control
        on the change under the cursor. <strong>Next/Prev</strong> scroll each
        change into view; <strong>Accept</strong> folds it into the baseline
        (resolves, keeps the change), <strong>Reject</strong> reverts it live.{" "}
        {reviewing
          ? `${cursor.count} change${cursor.count === 1 ? "" : "s"} pending.`
          : "Review finished."}{" "}
        Per-block accept moves the baseline in consumer code here; J6 moves that
        into the editor with review-mode undo + the save gate.
      </p>
    </div>
  );
};
