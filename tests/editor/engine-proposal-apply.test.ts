/**
 * Identity-anchored proposal apply + op grouping (docs/036 §7.2/§7.3/§7.5, docs/038 §10, R6-J J1).
 *
 * The proposals here are authored the way a real producer authors them: an edit is made through the
 * store's own command/step path against a base document and its committed `steps` are captured as the
 * proposal's ops (so they carry real node-id and character-id lineage from the base). Applying such a
 * proposal to a *moved* document then exercises the load-bearing claim (docs/036 D15): apply is a
 * merge by identity — a non-overlapping intervening edit does not disturb it, a shifted text anchor
 * still resolves, and only a genuine overlap (a deleted target, a clobbered text run) conflicts,
 * surfaced rather than mis-applied. `applyProposal` is also total: it never throws.
 */
import { describe, expect, it } from "vitest";
import {
  applyProposal,
  applyProposalBlock,
  createEditorStore,
  createIdAllocator,
  diffSnapshots,
  type EditorDocumentSnapshot,
  type EditorStore,
  groupProposalOps,
  type NodeId,
  type Proposal,
  type ProposalAuthor,
  sliceTextContent,
  type Step,
  targetBlockOf,
} from "../../packages/editor/src/core";
import { leaf, snap } from "./diff-fixtures";

const AGENT: ProposalAuthor = {
  id: "agent-1",
  kind: "agent",
  label: "Assistant",
};

/** Author a proposal by capturing the committed steps of an edit made against `base`. */
function proposalFrom(
  base: EditorDocumentSnapshot,
  edit: (store: EditorStore) => void,
): Proposal {
  const store = createEditorStore({
    allocator: createIdAllocator("idco_client_author"),
    snapshot: base,
  });
  const ops: Step[] = [];
  const off = store.subscribeCommit((committed) =>
    ops.push(...committed.steps),
  );
  edit(store);
  off();
  return {
    author: AGENT,
    baseVersion: base.revision ?? 0,
    createdAt: "2026-07-02T00:00:00Z",
    id: "p1",
    ops,
    status: "pending",
  };
}

/** Produce a mutated version of `base` (the reviewer's intervening edits) as a fresh snapshot. */
function edited(
  base: EditorDocumentSnapshot,
  edit: (store: EditorStore) => void,
): EditorDocumentSnapshot {
  const store = createEditorStore({
    allocator: createIdAllocator("idco_client_reviewer"),
    snapshot: base,
  });
  edit(store);
  return store.toSnapshot();
}

function text(
  snapshot: EditorDocumentSnapshot,
  id: NodeId,
): string | undefined {
  const node = snapshot.body.blocks[id];
  return node && node.kind === "text" ? node.content.text : undefined;
}

describe("applyProposal — clean apply against the base it was made against (R6-J J1)", () => {
  it("folds the whole proposal in; accept-whole equals applying every op", () => {
    const a = createIdAllocator("idco_client_base");
    const L = leaf(a, "hello");
    const base = snap([L]);
    const proposal = proposalFrom(base, (store) => {
      store.dispatch(
        store
          .transaction()
          .replaceText({ at: 5, inserted: " world", node: L.id, removed: "" }),
      );
    });

    const result = applyProposal(base, proposal);

    expect(result.conflicts).toEqual([]);
    expect(result.applied).toHaveLength(proposal.ops.length);
    expect(text(result.snapshot, L.id)).toBe("hello world");
  });

  it("reproduces the authored document (diffs back to all-unchanged)", () => {
    const a = createIdAllocator("idco_client_base2");
    const L = leaf(a, "alpha");
    const base = snap([L]);
    // Author the change AND keep the authored snapshot to compare against.
    const authorStore = createEditorStore({
      allocator: createIdAllocator("idco_client_author"),
      snapshot: base,
    });
    const ops: Step[] = [];
    const off = authorStore.subscribeCommit((c) => ops.push(...c.steps));
    authorStore.dispatch(
      authorStore
        .transaction()
        .replaceText({ at: 0, inserted: "A-", node: L.id, removed: "" }),
    );
    off();
    const authored = authorStore.toSnapshot();
    const proposal: Proposal = {
      author: AGENT,
      baseVersion: 0,
      createdAt: "2026-07-02T00:00:00Z",
      id: "p1",
      ops,
      status: "pending",
    };

    const result = applyProposal(base, proposal);

    // Same steps applied to the same base => identical nodes and character ids (revision differs but
    // is diff-invisible), so the authored and applied documents diff to nothing.
    expect(diffSnapshots(authored, result.snapshot).stats).toEqual({
      added: 0,
      changed: 0,
      moved: 0,
      removed: 0,
    });
  });
});

describe("groupProposalOps — accept granularity by target block id (R6-J J1)", () => {
  it("keys each op to the block it produces or edits; document-level ops collect apart", () => {
    // Grouping is a pure function of the ops, so build them directly (no lineage needed): a text edit
    // on A, an insert creating D, and a document-level settings change.
    const A = "idco_node_a" as NodeId;
    const D = "idco_node_d" as NodeId;
    const ops: Step[] = [
      {
        at: 3,
        inserted: { runs: [], text: "!" },
        node: A,
        removed: { runs: [], text: "" },
        type: "replace-text",
      },
      {
        index: 1,
        node: {
          content: { runs: [], text: "new" },
          id: D,
          kind: "text",
          marks: [],
          type: "paragraph",
        },
        parent: "idco_node_root" as NodeId,
        type: "insert-node",
      },
      { from: {}, to: { theme: "dark" }, type: "set-settings" },
    ];

    const groups = groupProposalOps(ops);

    expect([...groups.byBlock.keys()].sort()).toEqual([A, D].sort());
    expect(groups.byBlock.get(A)!.map((o) => o.type)).toEqual(["replace-text"]);
    expect(groups.byBlock.get(D)!.map((o) => o.type)).toEqual(["insert-node"]);
    expect(groups.document.map((o) => o.type)).toEqual(["set-settings"]);
  });

  it("targetBlockOf maps every op kind to its block (or null for document-level)", () => {
    const insertNode: Step = {
      index: 0,
      node: {
        content: { runs: [], text: "" },
        id: "idco_node_x_1" as NodeId,
        kind: "text",
        marks: [],
        type: "paragraph",
      },
      parent: "idco_node_root" as NodeId,
      type: "insert-node",
    };
    const move: Step = {
      from: { index: 0, parent: "idco_node_root" as NodeId },
      node: "idco_node_x_2" as NodeId,
      to: { index: 1, parent: "idco_node_root" as NodeId },
      type: "move-node",
    };
    const settings: Step = {
      from: {},
      to: { theme: "dark" },
      type: "set-settings",
    };
    expect(targetBlockOf(insertNode)).toBe("idco_node_x_1");
    expect(targetBlockOf(move)).toBe("idco_node_x_2");
    expect(targetBlockOf(settings)).toBeNull();
  });
});

describe("applyProposalBlock — per-block accept (R6-J J1)", () => {
  it("applies only the named block's ops, leaving the rest of the proposal pending", () => {
    const a = createIdAllocator("idco_client_perblock");
    const A = leaf(a, "aaa");
    const B = leaf(a, "bbb");
    const base = snap([A, B]);
    const proposal = proposalFrom(base, (store) => {
      store.dispatch(
        store
          .transaction()
          .replaceText({ at: 3, inserted: "!", node: A.id, removed: "" }),
      );
      store.dispatch(
        store
          .transaction()
          .replaceText({ at: 3, inserted: "?", node: B.id, removed: "" }),
      );
    });

    const onlyA = applyProposalBlock(base, proposal, A.id);

    expect(text(onlyA.snapshot, A.id)).toBe("aaa!");
    expect(text(onlyA.snapshot, B.id)).toBe("bbb"); // B's op was not in this block's group
    expect(onlyA.conflicts).toEqual([]);
  });

  it("CAVEAT: accepting a child alone conflicts when parent+child are SEPARATE insert ops", () => {
    const a = createIdAllocator("idco_client_xblock");
    const A = leaf(a, "seed");
    const base = snap([A]);
    // A producer that emits the container and its child as two separate insert ops (the canonical
    // builder would use one insert-node with `descendants`). The child groups under its own id, the
    // parent under the parent's — so the child's group depends on an op outside it.
    const ins = createIdAllocator("idco_client_ins");
    const container: Step = {
      index: 1,
      node: {
        children: [],
        id: ins.createNodeId(),
        kind: "structural",
        type: "quote",
      },
      parent: "idco_node_root" as NodeId,
      type: "insert-node",
    };
    const containerId = (container as { node: { id: NodeId } }).node.id;
    const child = ins.createNodeId();
    const childInsert: Step = {
      index: 0,
      node: {
        content: { runs: [], text: "child" },
        id: child,
        kind: "text",
        marks: [],
        type: "paragraph",
      },
      parent: containerId,
      type: "insert-node",
    };
    const proposal: Proposal = {
      author: AGENT,
      baseVersion: 0,
      createdAt: "2026-07-02T00:00:00Z",
      id: "p1",
      ops: [container, childInsert],
      status: "pending",
    };

    // Whole proposal applies cleanly...
    expect(applyProposal(base, proposal).conflicts).toEqual([]);
    // ...but accepting the child's block alone has no parent to insert into (documented, and TOTAL —
    // a surfaced conflict, never a crash).
    const childOnly = applyProposalBlock(base, proposal, child);
    expect(childOnly.applied).toEqual([]);
    expect(childOnly.conflicts).toHaveLength(1);
    expect(childOnly.conflicts[0]!.reason).toBe("target-deleted");
  });
});

describe("applyProposal — identity anchoring across a moved base (R6-J J1)", () => {
  it("MOVED-BASE CONFLICT: a deleted target is a conflict; the rest still applies", () => {
    const a = createIdAllocator("idco_client_conflict");
    const A = leaf(a, "a");
    const B = leaf(a, "b");
    const C = leaf(a, "c");
    const base = snap([A, B, C]);
    // Proposal edits both B and C.
    const proposal = proposalFrom(base, (store) => {
      store.dispatch(
        store
          .transaction()
          .replaceText({ at: 1, inserted: "-edit", node: B.id, removed: "" }),
      );
      store.dispatch(
        store
          .transaction()
          .replaceText({ at: 1, inserted: "-edit", node: C.id, removed: "" }),
      );
    });
    // Meanwhile the reviewer deleted B entirely (the base moved).
    const current = edited(base, (store) => {
      store.dispatch(
        store.transaction().removeNode(store.bodyId, 1, store.getNode(B.id)!),
      );
    });

    const result = applyProposal(current, proposal);

    // B's op conflicts (its target is gone); C's op still applies.
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.reason).toBe("target-deleted");
    expect(result.conflicts[0]!.node).toBe(B.id);
    expect(text(result.snapshot, C.id)).toBe("c-edit");
    expect(B.id in result.snapshot.body.blocks).toBe(false);
    expect(text(result.snapshot, A.id)).toBe("a");
  });

  it("a non-overlapping intervening edit (a reorder) does not disturb the proposal", () => {
    const a = createIdAllocator("idco_client_reorder");
    const A = leaf(a, "a");
    const B = leaf(a, "b");
    const C = leaf(a, "c");
    const base = snap([A, B, C]);
    const proposal = proposalFrom(base, (store) => {
      store.dispatch(
        store
          .transaction()
          .replaceText({ at: 1, inserted: "!", node: C.id, removed: "" }),
      );
    });
    // The reviewer moved C to the front; C's id and text are untouched.
    const current = edited(base, (store) => {
      store.dispatch({
        origin: "local",
        steps: [
          {
            from: { index: 2, parent: store.bodyId },
            node: C.id,
            to: { index: 0, parent: store.bodyId },
            type: "move-node",
          },
        ],
      });
    });

    const result = applyProposal(current, proposal);

    expect(result.conflicts).toEqual([]);
    expect(text(result.snapshot, C.id)).toBe("c!");
    // The reviewer's reorder is preserved (C first).
    expect(result.snapshot.body.order[0]).toBe(C.id);
  });

  it("re-resolves a shifted text anchor when the op carries character ids (id-bearing removed)", () => {
    const a = createIdAllocator("idco_client_shift");
    const W = leaf(a, "world");
    const base = snap([W]);
    // An id-BEARING replace op: `removed` is sliced from the base leaf, so it carries the base's "wor"
    // character ids (the durable anchor a producer captures via `sliceTextContent`). Replaces
    // "wor" -> "W".
    const proposal: Proposal = {
      author: AGENT,
      baseVersion: 0,
      createdAt: "2026-07-02T00:00:00Z",
      id: "p1",
      ops: [
        {
          at: 0,
          inserted:
            createIdAllocator("idco_client_author").createTextSlice("W"),
          node: W.id,
          removed: sliceTextContent(W.content, 0, 3),
          type: "replace-text",
        },
      ],
      status: "pending",
    };
    // The reviewer prepended "hello " (offset 0), so "wor" now lives at offset 6, not 0.
    const current = edited(base, (store) => {
      store.dispatch(
        store
          .transaction()
          .replaceText({ at: 0, inserted: "hello ", node: W.id, removed: "" }),
      );
    });
    expect(text(current, W.id)).toBe("hello world");

    const result = applyProposal(current, proposal);

    // Character-id resolution finds "wor" at its shifted offset and edits there — the raw offset 0
    // would have clobbered "hel".
    expect(result.conflicts).toEqual([]);
    expect(text(result.snapshot, W.id)).toBe("hello Wld");
  });

  it("an id-less op on a moved base relocates by its UNIQUE occurrence (no char anchor needed)", () => {
    const a = createIdAllocator("idco_client_idless");
    const W = leaf(a, "world");
    const base = snap([W]);
    // The canonical builder produces an id-less `removed` slice. The base moved (a prepend), so the
    // raw offset 0 is stale — but "wor" occurs exactly once in the live leaf, so it is unambiguous.
    const proposal = proposalFrom(base, (store) => {
      store.dispatch(
        store
          .transaction()
          .replaceText({ at: 0, inserted: "W", node: W.id, removed: "wor" }),
      );
    });
    const current = edited(base, (store) => {
      store.dispatch(
        store
          .transaction()
          .replaceText({ at: 0, inserted: "hello ", node: W.id, removed: "" }),
      );
    });

    const result = applyProposal(current, proposal);

    // Relocated to the unique "wor" at offset 6 — NOT applied at the stale offset 0 (which would have
    // clobbered "hel").
    expect(result.conflicts).toEqual([]);
    expect(text(result.snapshot, W.id)).toBe("hello Wld");
  });

  it("an id-less op on a moved base with an AMBIGUOUS match conflicts (never a coincidental mis-apply)", () => {
    const a = createIdAllocator("idco_client_ambiguous");
    const W = leaf(a, "aaaa");
    const base = snap([W]);
    // Delete the last two a's (offset 2). Id-less `removed:"aa"`.
    const proposal = proposalFrom(base, (store) => {
      store.dispatch(
        store
          .transaction()
          .replaceText({ at: 2, inserted: "", node: W.id, removed: "aa" }),
      );
    });
    // The reviewer prepended "bb" → "bbaaaa": the raw offset 2 still reads "aa" (a COINCIDENTAL
    // match), and "aa" now occurs at several overlapping offsets — ambiguous.
    const current = edited(base, (store) => {
      store.dispatch(
        store
          .transaction()
          .replaceText({ at: 0, inserted: "bb", node: W.id, removed: "" }),
      );
    });
    expect(text(current, W.id)).toBe("bbaaaa");

    const result = applyProposal(current, proposal);

    // The ambiguity is surfaced, not resolved by trusting the stale offset — so the wrong characters
    // are never deleted. (An id-BEARING op would resolve this exactly; that is the producer contract.)
    expect(result.applied).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.reason).toBe("text-anchor-lost");
    expect(text(result.snapshot, W.id)).toBe("bbaaaa");
  });

  it("an id-less op on an UNMOVED base trusts its exact offset even when the removed text repeats", () => {
    const a = createIdAllocator("idco_client_unmoved");
    const W = leaf(a, "the cat and the dog");
    const base = snap([W]);
    // Delete the SECOND "the " (offset 12). "the " also appears at offset 0, so a unique-occurrence
    // rule would wrongly conflict — but the base has not moved, so the exact offset is authoritative.
    const proposal = proposalFrom(base, (store) => {
      store.dispatch(
        store
          .transaction()
          .replaceText({ at: 12, inserted: "", node: W.id, removed: "the " }),
      );
    });

    const result = applyProposal(base, proposal); // current === base ⇒ unmoved

    expect(result.conflicts).toEqual([]);
    expect(text(result.snapshot, W.id)).toBe("the cat and dog");
  });

  it("SAFETY TRADE: an id-less REPEATED-substring removal on an UNTOUCHED leaf false-conflicts once the doc moved elsewhere", () => {
    // The deliberate, documented cost of preferring a visible conflict over a silent mis-apply: `moved`
    // is a DOCUMENT-level signal, so an edit to an unrelated leaf flips an untouched leaf's id-less op
    // to the moved path, where a repeated removal is ambiguous. The applier cannot prove the untouched
    // leaf's offset is still valid without char ids, so it refuses. An id-bearing op would apply.
    const a = createIdAllocator("idco_client_collateral");
    const L1 = leaf(a, "the cat and the dog");
    const L2 = leaf(a, "hello");
    const base = snap([L1, L2]);
    // Proposal deletes the 2nd "the " in L1 (id-less). L1's offset 12 is exact and stays exact.
    const proposal = proposalFrom(base, (store) => {
      store.dispatch(
        store
          .transaction()
          .replaceText({ at: 12, inserted: "", node: L1.id, removed: "the " }),
      );
    });
    // The reviewer edits ONLY L2 — a genuinely non-overlapping edit — but it bumps the revision.
    const current = edited(base, (store) => {
      store.dispatch(
        store
          .transaction()
          .replaceText({ at: 5, inserted: "!", node: L2.id, removed: "" }),
      );
    });

    const result = applyProposal(current, proposal);

    // L1 is untouched and offset 12 is still exact, yet the op conflicts — the safe over-conflict. It
    // is a false conflict, never a corruption; L1 is left intact. (Locked so the granularity trade is
    // a deliberate decision; carrying char ids on the op — the J6 producer contract — removes it.)
    expect(result.applied).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.reason).toBe("text-anchor-lost");
    expect(text(result.snapshot, L1.id)).toBe("the cat and the dog");
  });

  it("TEXT-ANCHOR-LOST CONFLICT: an intervening edit that removed the anchored text conflicts", () => {
    const a = createIdAllocator("idco_client_textlost");
    const L = leaf(a, "hello world");
    const base = snap([L]);
    // Proposal deletes " world".
    const proposal = proposalFrom(base, (store) => {
      store.dispatch(
        store
          .transaction()
          .replaceText({ at: 5, inserted: "", node: L.id, removed: " world" }),
      );
    });
    // The reviewer already deleted " world", so those character ids are gone.
    const current = edited(base, (store) => {
      store.dispatch(
        store
          .transaction()
          .replaceText({ at: 5, inserted: "", node: L.id, removed: " world" }),
      );
    });
    expect(text(current, L.id)).toBe("hello");

    const result = applyProposal(current, proposal);

    expect(result.applied).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.reason).toBe("text-anchor-lost");
    expect(result.conflicts[0]!.node).toBe(L.id);
    // The document is untouched by a conflicting op.
    expect(text(result.snapshot, L.id)).toBe("hello");
  });

  it("APPLY-FAILED CONFLICT: a clobbered attr from-value is surfaced, not thrown (totality)", () => {
    const a = createIdAllocator("idco_client_attr");
    const L = leaf(a, "x");
    const base = snap([L]);
    // Proposal sets align: undefined -> "center".
    const proposal: Proposal = {
      author: AGENT,
      baseVersion: 0,
      createdAt: "2026-07-02T00:00:00Z",
      id: "p1",
      ops: [
        {
          from: undefined,
          key: "align",
          node: L.id,
          to: "center",
          type: "set-node-attr",
        },
      ],
      status: "pending",
    };
    // The reviewer already set align to "right", so the proposal's from-value no longer matches.
    const current = edited(base, (store) => {
      store.dispatch({
        origin: "local",
        steps: [
          {
            from: undefined,
            key: "align",
            node: L.id,
            to: "right",
            type: "set-node-attr",
          },
        ],
      });
    });

    const result = applyProposal(current, proposal);

    expect(result.applied).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.reason).toBe("apply-failed");
    expect(result.conflicts[0]!.node).toBe(L.id);
  });
});
