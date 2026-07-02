import type { Story, StoryDefault } from "@ladle/react";
import { useEffect, useRef, useState } from "react";
import {
  createEditorStore,
  createIdAllocator,
  makeTextNode,
  OwnedModelEditor,
  registerSuggestionSource,
  unregisterSuggestionSource,
  type EditorDocumentSnapshot,
  type EditorStore,
  type OwnedModelEditorHandle,
  type Proposal,
  type ProposalAuthor,
  type Step,
  type SuggestionSource,
} from "../packages/editor/src";
// The Changes pane ships as internal dock chrome (registered via `registerSidePanel`, so a real
// consumer reaches it through Review → Changes). The story renders it DIRECTLY beside the editor — a
// harness, the same way the J4 story renders `ReviewCursorSurface` directly — so the e2e can assert
// the pane's rendering + routing reliably without driving the ribbon dock. Registering the source
// below also lights up the real Review → Changes tab, proving the registration path.
import { ChangesPane } from "../packages/editor/src/view/chrome/panes/changes-pane";
import { createInMemorySuggestionSource } from "./_fake-suggestion-source";

/**
 * The Changes pane + Suggestion Source SPI — docs/036 §7.3, docs/038 §17, R6-J **J5**.
 *
 * What it PROVES, live, against the real editor + engine:
 *   1. HOST-OWNED PROPOSALS — a registered `SuggestionSource` (here in-memory) drives the pane; no
 *      pending markup lives in the document, only the op-log the source holds (§7.3).
 *   2. THE ANCHORLESS SPLIT (docs/038 §17) — the pane computes each proposal's review from the LIVE
 *      snapshot (`applyProposal` → `diffSnapshots`) and routes the changes with no block to weave onto
 *      to itself: a CONFLICT (an op whose target the reviewer already deleted) and a COLLECTION change
 *      (a glossary term) both surface in the pane's "Reviewed here" section, because the woven overlay
 *      has nowhere to put them. The block-anchored edit (paragraph 2) shows as a jump-to row instead.
 *   3. LIFECYCLE — Accept/Reject record the outcome in the host and move the proposal to Resolved
 *      (the pending buttons clear). The optimistic in-store apply / moving-baseline / save-gate that
 *      make resolution mutate the document are J6; J5 is the SPI + the pane + the routing.
 *
 * The proposal is authored the way docs/037's agent would — real steps captured from a store — and it
 * deliberately targets one block the live document no longer has, so a genuine conflict routes here.
 */
export default {
  title: "Engine / Review Changes",
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
      blocks: Object.fromEntries(nodes.map((n) => [n.id, n])),
      order: nodes.map((n) => n.id),
    },
    settings: {},
    version: 1,
  };
}

/** The live store plus an in-memory source holding one proposal against it. */
function buildScenario(): { store: EditorStore; source: SuggestionSource } {
  const a = createIdAllocator("idco_client_j5");
  const heading = makeTextNode({
    content: a.createTextSlice("Reviewing an agent proposal"),
    id: a.createNodeId(),
    type: "heading",
  });
  const para = (t: string) =>
    makeTextNode({ content: a.createTextSlice(t), id: a.createNodeId() });
  const body = [
    para("Paragraph 1. The introduction the agent left untouched."),
    para("Paragraph 2. The agent rewrote the opening of this paragraph."),
    para("Paragraph 3. More untouched body text for realistic height."),
    para("Paragraph 4. Still more untouched body for scrolling room."),
    para("Paragraph 5. The closing paragraph, also left as it was."),
  ];
  // A paragraph that exists only in the AUTHORING document — the reviewer has since deleted it — so an
  // op the proposal makes against it can no longer anchor and routes to the pane as a conflict (§17).
  const ghost = para(
    "A paragraph the reviewer already deleted from the live document.",
  );

  const liveNodes = [heading, ...body];
  const live = docOf(liveNodes);
  const authored = docOf([...liveNodes, ghost]);

  // Author the proposal against the authoring doc: edit paragraph 2 (block-anchored), edit the ghost
  // (will conflict), and add a glossary term (anchorless collection). Capture the real committed steps.
  const authoring = createEditorStore({
    allocator: createIdAllocator("idco_client_j5author"),
    snapshot: authored,
  });
  const ops: Step[] = [];
  const off = authoring.subscribeCommit((c) => ops.push(...c.steps));
  authoring.dispatch(
    authoring.transaction().replaceText({
      at: 0,
      inserted: "[EDITED] ",
      node: body[1]!.id,
      removed: "",
    }),
  );
  authoring.dispatch(
    authoring
      .transaction()
      .replaceText({ at: 0, inserted: "[GONE] ", node: ghost.id, removed: "" }),
  );
  authoring.dispatch(
    authoring.transaction().setCollection("glossary", [
      {
        definition: "The node graph the editor owns.",
        id: "g1",
        term: "Owned model",
      },
    ]),
  );
  off();

  const proposal: Proposal = {
    author: AGENT,
    baseVersion: live.revision ?? 0,
    createdAt: "just now",
    id: "p1",
    ops,
    status: "pending",
  };

  const store = createEditorStore({
    allocator: createIdAllocator("idco_client_j5store"),
    snapshot: live,
  });
  return { source: createInMemorySuggestionSource([proposal]), store };
}

export const ChangesReview: Story = () => {
  // Build the scenario AND register the source on first render (before the editor gates its Review
  // tab); tear the source down on unmount so it does not leak into other stories (the registry is a
  // module singleton).
  const [scenario] = useState(() => {
    const built = buildScenario();
    registerSuggestionSource(built.source);
    return built;
  });
  useEffect(() => () => unregisterSuggestionSource("changes"), []);
  const editorRef = useRef<OwnedModelEditorHandle>(null);

  return (
    <div>
      {/* Explicit column widths + top alignment: the editor is heavy chrome whose ribbon reflows if
          it is starved of width, so it gets a fixed column rather than competing via flex:1. */}
      <div style={{ alignItems: "flex-start", display: "flex", gap: 16 }}>
        <div style={{ height: 520, position: "relative", width: 560 }}>
          <OwnedModelEditor
            ref={editorRef}
            store={scenario.store}
            viewportHeight={460}
          />
        </div>
        <div
          data-engine-changes-host=""
          style={{
            border: "1px solid var(--fallback-b3,#e5e7eb)",
            borderRadius: 12,
            maxHeight: 520,
            overflow: "auto",
            position: "relative",
            width: 340,
          }}
        >
          <ChangesPane
            reveal={(id) => editorRef.current?.scrollToBlock(id)}
            store={scenario.store}
          />
        </div>
      </div>
      <p
        style={{
          font: "12px ui-sans-serif",
          marginTop: 12,
          maxWidth: 920,
          opacity: 0.7,
        }}
      >
        docs/038 J5 — the Changes pane over a host <code>SuggestionSource</code>
        . The block edit (paragraph 2) is a jump-to row; the{" "}
        <strong>conflict</strong> and the <strong>glossary</strong> change route
        to the pane because they have no block to weave onto (§17).
        Accept/Reject record the outcome and resolve the proposal; J6 adds the
        in-store apply.
      </p>
    </div>
  );
};
