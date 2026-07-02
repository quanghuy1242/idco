import type { Story, StoryDefault } from "@ladle/react";
import { useMemo, useRef, useState } from "react";
import {
  applyProposalToStore,
  createEditorStore,
  createIdAllocator,
  diffSnapshots,
  makeTextNode,
  proposalAttribution,
  revertLiveProposalApplication,
  revertLiveProposalBlock,
  REVIEW_INDICATOR_CSS,
  ReviewCursorSurface,
  useReviewChangeIndicator,
  useReviewCursor,
  useReviewModel,
  useReviewSnapshot,
  type EditorDocumentSnapshot,
  type EditorStore,
  type LiveProposalApplication,
  type NodeId,
  type OwnedModelEditorHandle,
  type Proposal,
  type ProposalAuthor,
  type Step,
} from "../packages/editor/src";
import { OwnedModelEditor } from "../packages/editor/src";

/**
 * Review-mode plumbing + attribution — docs/038 §13–§18, R6-J **J6 + J7**.
 *
 * This story uses the real live-store path, not the J4 consumer rebuild: the proposal is
 * optimistically applied into the store as `origin:"suggested"`, the save gate closes while review is
 * active, the author chip comes from J7 attribution, edits you type into the proposed text record in
 * the review-local history segment, and reject replays that segment before reverting the proposal.
 */
export default {
  title: "Engine / Review Mode",
} satisfies StoryDefault;

const AGENT: ProposalAuthor = {
  id: "agent-1",
  kind: "agent",
  label: "Assistant",
};

function docOf(
  nodes: readonly ReturnType<typeof makeTextNode>[],
): EditorDocumentSnapshot {
  return {
    body: {
      blocks: Object.fromEntries(nodes.map((node) => [node.id, node])),
      order: nodes.map((node) => node.id),
    },
    settings: {},
    version: 1,
  };
}

function proposalFrom(
  base: EditorDocumentSnapshot,
  edit: (store: EditorStore) => void,
): Proposal {
  const authoring = createEditorStore({
    allocator: createIdAllocator("idco_client_j6_story_author"),
    snapshot: base,
  });
  const ops: Step[] = [];
  const off = authoring.subscribeCommit((committed) =>
    ops.push(...committed.steps),
  );
  edit(authoring);
  off();
  return {
    author: AGENT,
    baseVersion: base.revision ?? 0,
    createdAt: "just now",
    id: "p1",
    ops,
    status: "pending",
  };
}

function buildScenario(): {
  readonly application: LiveProposalApplication;
  readonly baseline: EditorDocumentSnapshot;
  readonly proposal: Proposal;
  readonly store: EditorStore;
} {
  const a = createIdAllocator("idco_client_j6_story_base");
  const heading = makeTextNode({
    content: a.createTextSlice("Review mode over a live proposal"),
    id: a.createNodeId(),
    type: "heading",
  });
  const para = (text: string) =>
    makeTextNode({ content: a.createTextSlice(text), id: a.createNodeId() });
  const p1 = para("Paragraph 1. The agent leaves this block untouched.");
  const p2 = para(
    "Paragraph 2. Type in this proposed line, then use Undo to prove the review segment is local.",
  );
  const p3 = para("Paragraph 3. The proposal removes this block as a ghost.");
  const p4 = para("Paragraph 4. A survivor after the deleted paragraph.");
  const baseline = docOf([heading, p1, p2, p3, p4]);
  const proposal = proposalFrom(baseline, (store) => {
    store.dispatch(
      store.transaction().replaceText({
        at: 0,
        inserted: "[agent rewrite] ",
        node: p2.id,
        removed: "",
      }),
    );
    store.dispatch(store.transaction().removeNode(store.bodyId, 3, p3));
  });
  const store = createEditorStore({
    allocator: createIdAllocator("idco_client_j6_story_reviewer"),
    snapshot: baseline,
  });
  store.beginReviewMode({
    pendingOps: proposal.ops.length,
    proposalId: proposal.id,
  });
  const application = applyProposalToStore(store, proposal);
  return { application, baseline, proposal, store };
}

export const LiveReviewMode: Story = () => {
  const [{ application, baseline, proposal, store }] = useState(buildScenario);
  const [reviewing, setReviewing] = useState(true);
  const [resolvedBlocks, setResolvedBlocks] = useState<ReadonlySet<NodeId>>(
    () => new Set(),
  );
  const editorRef = useRef<OwnedModelEditorHandle>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const live = useReviewSnapshot(store);
  const diff = useMemo(
    () => (reviewing ? diffSnapshots(baseline, live) : null),
    [baseline, live, reviewing],
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
  const attribution = useMemo(() => proposalAttribution(proposal), [proposal]);

  const finish = () => {
    store.setReviewPendingOps(0);
    store.endReviewMode();
    setReviewing(false);
  };
  const rejectAll = () => {
    store.revertReviewEdits();
    revertLiveProposalApplication(store, application);
    finish();
  };
  const acceptAll = () => finish();
  const rejectBlock = (id: NodeId) => {
    if (resolvedBlocks.has(id)) return;
    store.markReviewResolutionBoundary();
    revertLiveProposalBlock(store, application, id);
    setResolvedBlocks((old) => new Set(old).add(id));
    store.setReviewPendingOps(
      Math.max(0, proposal.ops.length - resolvedBlocks.size - 1),
    );
  };

  return (
    <div style={{ maxWidth: 900 }}>
      <style>{REVIEW_INDICATOR_CSS}</style>
      <div ref={rootRef}>
        <OwnedModelEditor
          ref={editorRef}
          review={reviewModel ?? undefined}
          store={store}
          viewportHeight={460}
        />
      </div>
      {reviewing && cursor.current ? (
        <ReviewCursorSurface
          attribution={attribution}
          cursor={cursor}
          focusEditor={() => editorRef.current?.getEditorHandle().focus()}
          onAcceptAll={acceptAll}
          onExit={finish}
          onRejectAll={rejectAll}
          onRejectBlock={rejectBlock}
          rootRef={rootRef}
        />
      ) : null}
      <p style={{ font: "12px ui-sans-serif", marginTop: 12, opacity: 0.7 }}>
        docs/038 J6/J7 — live proposal review. Save is{" "}
        <strong>{store.canSaveSnapshot ? "open" : "blocked"}</strong> while
        review mode is active. Type into the proposed paragraph and press{" "}
        <strong>Undo</strong>: only review-local edits undo. The author chip is
        J7 attribution for <strong>{attribution.label}</strong>.
      </p>
    </div>
  );
};
