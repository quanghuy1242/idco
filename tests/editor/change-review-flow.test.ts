/**
 * End-to-end proposal → apply → diff flow (docs/039 P6) — the engine pipeline the canonical
 * `engine-change-review` story renders. Proves the four proposal op kinds it uses (a text edit, a
 * structural cell attr, a code-block data swap, a block removal) author, apply into the review store,
 * and surface in the diff the woven overlay reads — so the story's data path is sound.
 */
import { describe, expect, it } from "vitest";
import {
  applyProposalToStore,
  buildReviewModel,
  createDefaultBlockRegistry,
  createEditorStore,
  createIdAllocator,
  diffSnapshots,
  makeObjectNode,
  makeStructuralNode,
  makeTextNode,
  type EditorDocumentSnapshot,
  type EditorNode,
  type NodeId,
  type Proposal,
  type Step,
} from "../../packages/editor/src";

const codeDef = createDefaultBlockRegistry().require("code-block");
const codeData = (source: string) =>
  codeDef.normalizeData({ code: source, language: "ts" }).data;

function buildBaseline() {
  const a = createIdAllocator("idco_client_flowtest");
  const nid = (): NodeId => a.createNodeId();
  const introId = nid();
  const intro = makeTextNode({
    content: a.createTextSlice("Intro text."),
    id: introId,
  });
  const removedId = nid();
  const removed = makeTextNode({
    content: a.createTextSlice("Remove me."),
    id: removedId,
  });
  const cellTextId = nid();
  const cellText = makeTextNode({
    content: a.createTextSlice("Status"),
    id: cellTextId,
  });
  const cellId = nid();
  const cell = makeStructuralNode({
    attrs: { backgroundColor: "red" },
    children: [cellTextId],
    id: cellId,
    type: "tablecell",
  });
  const rowId = nid();
  const row = makeStructuralNode({
    children: [cellId],
    id: rowId,
    type: "tablerow",
  });
  const tableId = nid();
  const table = makeStructuralNode({
    children: [rowId],
    id: tableId,
    type: "table",
  });
  const codeId = nid();
  const code = makeObjectNode({
    data: codeData("const a = 1;"),
    id: codeId,
    status: "ready",
    type: "code-block",
  });
  const nodes: EditorNode[] = [
    intro,
    removed,
    cellText,
    cell,
    row,
    table,
    code,
  ];
  const snapshot: EditorDocumentSnapshot = {
    body: {
      blocks: Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<
        NodeId,
        EditorNode
      >,
      order: [introId, removedId, tableId, codeId],
    },
    settings: {},
    version: 1,
  };
  return { cellId, codeId, introId, removedId, snapshot };
}

function authorProposal(
  base: EditorDocumentSnapshot,
  ids: { introId: NodeId; removedId: NodeId; cellId: NodeId; codeId: NodeId },
): Proposal {
  const authoring = createEditorStore({
    allocator: createIdAllocator("idco_client_flowtest_author"),
    snapshot: base,
  });
  const ops: Step[] = [];
  const off = authoring.subscribeCommit((c) => ops.push(...c.steps));
  authoring.dispatch(
    authoring.transaction().replaceText({
      at: 0,
      inserted: "[agent] ",
      node: ids.introId,
      removed: "",
    }),
  );
  authoring.command({
    key: "backgroundColor",
    node: ids.cellId,
    type: "set-block-attr",
    value: "green",
  });
  authoring.command({
    data: codeData("const a = 2;"),
    node: ids.codeId,
    type: "set-object-data",
  });
  const removedNode = authoring.getNode(ids.removedId);
  if (removedNode) {
    authoring.dispatch(
      authoring.transaction().removeNode(authoring.bodyId, 1, removedNode),
    );
  }
  off();
  return {
    author: { id: "agent", kind: "agent", label: "Assistant" },
    baseVersion: base.revision ?? 0,
    createdAt: "now",
    id: "p1",
    ops,
    status: "pending",
  };
}

describe("change-review end-to-end flow (docs/039 P6)", () => {
  it("applies all four op kinds and surfaces them in the review diff", () => {
    const { snapshot, introId, removedId, cellId, codeId } = buildBaseline();
    const proposal = authorProposal(snapshot, {
      cellId,
      codeId,
      introId,
      removedId,
    });
    expect(proposal.ops.length).toBeGreaterThan(0);

    const store = createEditorStore({
      allocator: createIdAllocator("idco_client_flowtest_reviewer"),
      snapshot,
    });
    store.beginReviewMode({
      pendingOps: proposal.ops.length,
      proposalId: proposal.id,
    });
    const result = applyProposalToStore(store, proposal);
    // The apply is total and did not conflict on any of the four ops.
    expect(result.conflicts).toHaveLength(0);

    const diff = diffSnapshots(snapshot, store.toSnapshot());
    const byId = new Map(diff.blocks.map((b) => [b.id, b]));

    // 1. The intro leaf reads as an id-anchored text edit (an insert run → woven track-changes).
    const intro = byId.get(introId);
    expect(intro?.text?.runs.some((r) => r.op === "insert")).toBe(true);
    // 2. The removed paragraph is a ghost in the review model.
    expect(buildReviewModel(diff).ghosts.has(removedId)).toBe(true);
    // 3. The code block changed (its object diff fires).
    const code = byId.get(codeId);
    expect(code?.status).toBe("changed");
    expect(code?.object).toBeDefined();
    // 4. The cell's fill attr changed (a nested attr change → a ring).
    const cell = diff.blocks
      .flatMap((b) => b.children ?? [])
      .flatMap((r) => r.children ?? [])
      .find((c) => c.id === cellId);
    expect(cell?.attrs).toBeDefined();
  });
});
