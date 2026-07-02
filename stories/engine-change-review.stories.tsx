import type { Story, StoryDefault } from "@ladle/react";
import { useMemo, useRef, useState } from "react";
import {
  applyProposalToStore,
  blockDiffIndex,
  createDefaultBlockRegistry,
  createEditorStore,
  createIdAllocator,
  diffSnapshots,
  makeObjectNode,
  makeStructuralNode,
  makeTextNode,
  nodeDiffRendererResolver,
  OwnedModelEditor,
  proposalAttribution,
  revertLiveProposalApplication,
  revertLiveProposalBlock,
  REVIEW_INDICATOR_CSS,
  ReviewCursorSurface,
  ReviewElementDetail,
  useReviewCursor,
  useReviewChangeIndicator,
  useReviewModel,
  useReviewSnapshot,
  type EditorDocumentSnapshot,
  type EditorNode,
  type NodeId,
  type OwnedModelEditorHandle,
  type Proposal,
  type ProposalAuthor,
  type SnapshotDiff,
  type Step,
} from "../packages/editor/src";
import {
  DiffView,
  RICH_TEXT_DIFF_CSS,
  RICH_TEXT_TYPOGRAPHY_CSS,
} from "@quanghuy1242/idco-reader";

/**
 * The ONE end-to-end change-review story (docs/039, P6) — the front door that replaces the seven
 * scattered per-J-phase demos. A mocked docs/037 agent proposes edits; you review them in place, in the
 * live editing surface, and every disclosure tier and marker is exercised on one document:
 *
 *   - T1 WOVEN TEXT (R-T1): the intro paragraph's edit shows inline red/green track-changes — inserted
 *     text washed + underlined (editable), deleted text struck (inert). Not a "9 chars" count.
 *   - GHOST (R-RO): a removed paragraph renders struck + read-only with the ONE red gutter bar (no card,
 *     no badge, no tick — the vestigial deletion tick is gone).
 *   - RING → CHIP (R-RG/D5): a re-colored table cell rings; click it for the `Fill: … → …` chip.
 *   - RING → BAND (R-EX): the callout's code block rings; click it for its real LINE diff (the per-node
 *     `renderDiff` SPI), not a truncated string.
 *   - ONE INDICATOR (R-GI) + NO STATUS WORD (R-NL): every changed block wears the same status-hued gutter
 *     bar; the cursor surface names the change by color + detail, never a "REMOVED"/"EDITED" word.
 *   - DRILL-IN: the cursor's "View diff" opens the shared reader `<DiffView>` of the whole change, with
 *     the same node-diff resolver — proving the diff view and the woven overlay render from one library.
 */
export default {
  title: "Engine / Change Review",
} satisfies StoryDefault;

const AGENT: ProposalAuthor = {
  id: "agent-1",
  kind: "agent",
  label: "Assistant",
};
const CODE_BEFORE = "function total(items) {\n  return items.length;\n}";
const CODE_AFTER =
  "function total(items) {\n  return items.reduce((a, b) => a + b, 0);\n}";

const codeDef = createDefaultBlockRegistry().require("code-block");
const codeData = (source: string) =>
  codeDef.normalizeData({ code: source, language: "ts" }).data;

/** Project the diff down to the one block under the cursor (docs/039 §6 T3) — a scoped drill-in. */
function scopedTo(diff: SnapshotDiff, id: NodeId): SnapshotDiff {
  const block = blockDiffIndex(diff).get(id);
  if (!block) return diff;
  const stats = { added: 0, changed: 0, moved: 0, removed: 0 };
  if (block.status === "added") stats.added = 1;
  else if (block.status === "removed") stats.removed = 1;
  else if (block.status === "moved") stats.moved = 1;
  else stats.changed = 1;
  return {
    base: diff.base,
    blocks: [block],
    collections: [],
    settingsChanged: false,
    stats,
    target: diff.target,
  };
}

/** Build the reviewed document as a snapshot (the pre-proposal baseline). */
function buildBaseline(): {
  readonly snapshot: EditorDocumentSnapshot;
  readonly ids: {
    readonly intro: NodeId;
    readonly removed: NodeId;
    readonly cell: NodeId;
    readonly code: NodeId;
  };
} {
  const a = createIdAllocator("idco_client_change_review");
  const nid = (): NodeId => a.createNodeId();
  const text = (t: string, id: NodeId, type?: "heading") =>
    makeTextNode({ content: a.createTextSlice(t), id, type });

  const heading = text("Reviewing an agent proposal", nid(), "heading");
  const introId = nid();
  const intro = text(
    "This document is reviewed in place. The agent suggests small edits here.",
    introId,
  );
  const removedId = nid();
  const removed = text(
    "This paragraph is proposed for removal — it renders as a struck ghost.",
    removedId,
  );

  // A one-row table with a cell whose fill the proposal re-colors (→ ring → chip).
  const cellTextId = nid();
  const cellText = text("Status", cellTextId);
  const cellId = nid();
  const cell = makeStructuralNode({
    attrs: { backgroundColor: "oklch(0.9 0.05 20)" },
    children: [cellTextId],
    id: cellId,
    type: "tablecell",
  });
  const cell2TextId = nid();
  const cell2Text = text("On track", cell2TextId);
  const cell2 = makeStructuralNode({
    children: [cell2TextId],
    id: nid(),
    type: "tablecell",
  });
  const rowId = nid();
  const row = makeStructuralNode({
    children: [cellId, cell2.id],
    id: rowId,
    type: "tablerow",
  });
  const tableId = nid();
  const table = makeStructuralNode({
    children: [rowId],
    id: tableId,
    type: "table",
  });

  // A callout wrapping a code block whose source the proposal rewrites (nested object → ring → band).
  const calloutIntroId = nid();
  const calloutIntro = text(
    "The agent also rewrites this helper:",
    calloutIntroId,
  );
  const codeId = nid();
  const code = makeObjectNode({
    baked: codeDef.bake?.(codeData(CODE_BEFORE)) ?? undefined,
    data: codeData(CODE_BEFORE),
    id: codeId,
    status: "ready",
    type: "code-block",
  });
  const calloutId = nid();
  const callout = makeStructuralNode({
    children: [calloutIntroId, codeId],
    id: calloutId,
    type: "callout",
  });

  const nodes: EditorNode[] = [
    heading,
    intro,
    removed,
    cellText,
    cell2Text,
    cell,
    cell2,
    row,
    table,
    calloutIntro,
    code,
    callout,
  ];
  return {
    ids: { cell: cellId, code: codeId, intro: introId, removed: removedId },
    snapshot: {
      body: {
        blocks: Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<
          NodeId,
          EditorNode
        >,
        order: [heading.id, introId, removedId, tableId, calloutId],
      },
      settings: {},
      version: 1,
    },
  };
}

/** Author the agent's proposal by recording the steps an editing pass produces on a scratch store. */
function authorProposal(
  base: EditorDocumentSnapshot,
  ids: ReturnType<typeof buildBaseline>["ids"],
): Proposal {
  const authoring = createEditorStore({
    allocator: createIdAllocator("idco_client_change_review_author"),
    snapshot: base,
  });
  const ops: Step[] = [];
  const off = authoring.subscribeCommit((committed) =>
    ops.push(...committed.steps),
  );

  // 1. A text edit with BOTH an insert and an inline DELETE (id-anchored → inline track-changes): a
  //    prepended insert, then a substitution so R-T1's insert-wash AND struck delete-ghost both render
  //    (a pure insert would never exercise the inline delete-ghost + geometry-skip path). The second
  //    op reads the CURRENT (post-prepend) text to locate the word, so the offsets stay correct.
  authoring.dispatch(
    authoring.transaction().replaceText({
      at: 0,
      inserted: "[agent] ",
      node: ids.intro,
      removed: "",
    }),
  );
  const introText = authoring.requireTextNode(ids.intro).content.text;
  const subAt = introText.indexOf("small edits");
  if (subAt >= 0) {
    authoring.dispatch(
      authoring.transaction().replaceText({
        at: subAt,
        inserted: "targeted revisions",
        node: ids.intro,
        removed: "small edits",
      }),
    );
  }
  // 2. Re-color the table cell's fill (→ ring → chip).
  authoring.command({
    key: "backgroundColor",
    node: ids.cell,
    type: "set-block-attr",
    value: "oklch(0.85 0.12 150)",
  });
  // 3. Rewrite the code block's source (→ ring → band with a line diff).
  authoring.command({
    data: codeData(CODE_AFTER),
    node: ids.code,
    type: "set-object-data",
  });
  // 4. Remove a paragraph (→ ghost).
  const removedNode = authoring.getNode(ids.removed);
  if (removedNode) {
    authoring.dispatch(
      authoring.transaction().removeNode(authoring.bodyId, 2, removedNode),
    );
  }
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

export const ReviewAnAgentProposal: Story = () => {
  const [{ application, baseline, proposal, store }] = useState(() => {
    const built = buildBaseline();
    const prop = authorProposal(built.snapshot, built.ids);
    const reviewer = createEditorStore({
      allocator: createIdAllocator("idco_client_change_review_reviewer"),
      snapshot: built.snapshot,
    });
    reviewer.beginReviewMode({
      pendingOps: prop.ops.length,
      proposalId: prop.id,
    });
    // The optimistic apply's result — the per-op inverses reject replays (docs/039 §16, J6). Kept so
    // "Reject all" / "Reject block" actually REVERT the proposal, not just end the mode.
    const app = applyProposalToStore(reviewer, prop);
    return {
      application: app,
      baseline: built.snapshot,
      proposal: prop,
      store: reviewer,
    };
  });

  const [reviewing, setReviewing] = useState(true);
  const [viewDiffId, setViewDiffId] = useState<NodeId | null>(null);
  const [resolved, setResolved] = useState<ReadonlySet<NodeId>>(
    () => new Set(),
  );
  const editorRef = useRef<OwnedModelEditorHandle>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const getNodeDiff = useMemo(() => nodeDiffRendererResolver(), []);

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
  // Accept-all keeps the optimistically-applied content and exits (§16). Reject-all REVERTS it: replay
  // the reviewer's in-review edits, then invert the proposal's optimistic apply, then exit — so the doc
  // returns to the baseline, visibly different from accept (the finding: reject was a no-op).
  const acceptAll = finish;
  const rejectAll = () => {
    store.revertReviewEdits();
    revertLiveProposalApplication(store, application);
    finish();
  };
  // Per-block resolution (§16, the DoD's "accept/reject WHOLE AND per block"): reject-block inverts just
  // that block's ops in place (a hard segment boundary); accept-block keeps its content. Both clear the
  // block from the pending set so its marker resolves.
  const resolveBlock = (id: NodeId, revert: boolean) => {
    if (resolved.has(id)) return;
    store.markReviewResolutionBoundary();
    if (revert) revertLiveProposalBlock(store, application, id);
    const next = new Set(resolved).add(id);
    setResolved(next);
    store.setReviewPendingOps(Math.max(0, proposal.ops.length - next.size));
  };

  return (
    <div style={{ maxWidth: 960 }}>
      <style>{RICH_TEXT_TYPOGRAPHY_CSS}</style>
      <style>{RICH_TEXT_DIFF_CSS}</style>
      <style>{REVIEW_INDICATOR_CSS}</style>
      <div ref={rootRef}>
        <OwnedModelEditor
          ref={editorRef}
          review={reviewModel ?? undefined}
          store={store}
          viewportHeight={520}
        />
      </div>
      {reviewing && cursor.current ? (
        <>
          <ReviewCursorSurface
            attribution={attribution}
            cursor={cursor}
            focusEditor={() => editorRef.current?.getEditorHandle().focus()}
            onAcceptAll={acceptAll}
            onAcceptBlock={(id) => resolveBlock(id, false)}
            onExit={finish}
            onRejectAll={rejectAll}
            onRejectBlock={(id) => resolveBlock(id, true)}
            onViewDiff={(id) => setViewDiffId(id)}
            rootRef={rootRef}
          />
          {/* The ring affordance: click a re-colored cell or the code block's ring for its detail. */}
          <ReviewElementDetail
            diff={diff}
            getNodeDiffRenderer={getNodeDiff}
            rootRef={rootRef}
          />
        </>
      ) : null}
      {viewDiffId && diff ? (
        <div
          style={{
            background: "var(--color-base-100, #fff)",
            border: "1px solid var(--color-base-300, #d4d4d4)",
            borderRadius: 8,
            marginTop: 16,
            padding: 16,
          }}
        >
          <button onClick={() => setViewDiffId(null)} type="button">
            Close diff
          </button>
          {/* The T3 drill-in, SCOPED to the change under the cursor (docs/039 §6 T3, R-EX): the same reader
              `<DiffView>` renders just that block's before/after (a top-level code block gets its own line
              diff here even though it took the bar, not a ring). One block, projected — no second diff. */}
          <DiffView
            context="focused"
            diff={scopedTo(diff, viewDiffId)}
            embedStyles={false}
            getNodeDiffRenderer={getNodeDiff}
          />
        </div>
      ) : null}
      <p style={{ font: "12px ui-sans-serif", marginTop: 12, opacity: 0.7 }}>
        docs/039 — one end-to-end review. The intro shows inline{" "}
        <strong>red/green track-changes</strong> (an insert AND a struck
        delete); the removed paragraph is a struck <strong>ghost</strong> with a
        red gutter bar (no card, no tick). The change under the cursor gets an{" "}
        <strong>active halo</strong> so &ldquo;Change N of M&rdquo; maps to a
        block. Click the re-colored cell&rsquo;s ring for its{" "}
        <strong>fill chip</strong> or the code block&rsquo;s ring for its{" "}
        <strong>line-diff band</strong>; <strong>View diff</strong> opens the
        same reader <code>&lt;DiffView&gt;</code> scoped to that change.{" "}
        <strong>Accept</strong> keeps a change; <strong>Reject</strong> reverts
        it (whole or per block). {resolved.size} resolved; save is{" "}
        <strong>{store.canSaveSnapshot ? "open" : "blocked"}</strong> while
        reviewing; author <strong>{attribution.label}</strong>.
      </p>
    </div>
  );
};
