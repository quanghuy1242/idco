/**
 * Block-sequence, move, and structural-recursion diff (docs/036 R6-D, §5.4/§5.5).
 *
 * The load-bearing cases: an insertion must NOT flag following blocks as moved
 * (LCS-based detection, §8 "over-flagged moves"); a reorder is `moved`, not
 * remove+add; a removed+added pair in one gap links via `replaces`/`replacedBy`; a
 * cross-scope move is one `moved`, emitted once; structural containers mark only
 * their changed descendants; a matched id whose kind changed is `changed`.
 */
import { describe, expect, it } from "vitest";
import {
  type BlockDiff,
  diffSnapshots,
  type EditorDocumentSnapshot,
  type EditorNode,
  makeStructuralNode,
  makeTextNode,
  type NodeId,
  replaceTextContent,
} from "../../packages/editor/src/core";
import { alloc, container, leaf, object, snap } from "./diff-fixtures";

function statusById(blocks: readonly BlockDiff[]): Map<NodeId, BlockDiff> {
  const map = new Map<NodeId, BlockDiff>();
  const walk = (list: readonly BlockDiff[]) => {
    for (const b of list) {
      map.set(b.id, b);
      if (b.children) walk(b.children);
    }
  };
  walk(blocks);
  return map;
}

describe("diffScope — additions and deletions do not over-flag moves (R6-D, §8)", () => {
  it("an inserted block leaves every following block unchanged", () => {
    const a = alloc("tree_ins");
    const A = leaf(a, "A");
    const B = leaf(a, "B");
    const C = leaf(a, "C");
    const X = leaf(a, "X");
    const diff = diffSnapshots(snap([A, B, C]), snap([A, X, B, C]));
    const by = statusById(diff.blocks);
    expect(by.get(A.id)!.status).toBe("unchanged");
    expect(by.get(B.id)!.status).toBe("unchanged");
    expect(by.get(C.id)!.status).toBe("unchanged");
    expect(by.get(X.id)!.status).toBe("added");
    expect(diff.stats).toEqual({ added: 1, changed: 0, moved: 0, removed: 0 });
    // Merged order places the added block at its target index.
    expect(diff.blocks.map((b) => b.id)).toEqual([A.id, X.id, B.id, C.id]);
  });

  it("a deleted block is `removed` at its base index with no move noise and no replacedBy", () => {
    const a = alloc("tree_del");
    const A = leaf(a, "A");
    const B = leaf(a, "B");
    const C = leaf(a, "C");
    const diff = diffSnapshots(snap([A, B, C]), snap([A, C]));
    const by = statusById(diff.blocks);
    expect(by.get(B.id)!.status).toBe("removed");
    expect(by.get(B.id)!.baseIndex).toBe(1);
    expect(by.get(B.id)!.targetIndex).toBeNull();
    expect(by.get(B.id)!.replacedBy).toBeUndefined();
    expect(diff.stats).toEqual({ added: 0, changed: 0, moved: 0, removed: 1 });
  });
});

describe("diffScope — moves (R6-D, §5.4)", () => {
  it("a reorder is detected as a move, not remove+add, with correct indices", () => {
    const a = alloc("tree_move");
    const A = leaf(a, "A");
    const B = leaf(a, "B");
    const C = leaf(a, "C");
    const diff = diffSnapshots(snap([A, B, C]), snap([C, A, B]));
    const by = statusById(diff.blocks);
    expect(by.get(A.id)!.status).toBe("unchanged");
    expect(by.get(B.id)!.status).toBe("unchanged");
    expect(by.get(C.id)!.status).toBe("moved");
    expect(by.get(C.id)!.baseIndex).toBe(2);
    expect(by.get(C.id)!.targetIndex).toBe(0);
    expect(diff.stats.moved).toBe(1);
    expect(diff.stats.added + diff.stats.removed).toBe(0);
  });

  it("pairs a removed and an added in the same gap via replaces/replacedBy", () => {
    const a = alloc("tree_replace");
    const A = leaf(a, "A");
    const B = leaf(a, "B");
    const C = leaf(a, "C");
    const X = leaf(a, "X");
    const diff = diffSnapshots(snap([A, B, C]), snap([A, X, C]));
    const by = statusById(diff.blocks);
    expect(by.get(B.id)!.status).toBe("removed");
    expect(by.get(X.id)!.status).toBe("added");
    expect(by.get(B.id)!.replacedBy).toBe(X.id);
    expect(by.get(X.id)!.replaces).toBe(B.id);
  });
});

describe("diffScope — structural recursion (R6-D, §5.5)", () => {
  it("marks only the changed descendant inside a container, and the container as changed", () => {
    const a = alloc("tree_struct");
    const c1 = leaf(a, "cell one");
    const c2 = leaf(a, "cell two");
    const callout = container(a, "callout", [c1, c2]);
    const c1b = makeTextNode({
      content: replaceTextContent(
        c1.content,
        0,
        8,
        a.createTextSlice("CELL ONE"),
      ),
      id: c1.id,
    });
    const calloutB = makeStructuralNode({
      children: [c1.id, c2.id],
      id: callout.id,
      type: "callout",
    });
    const diff = diffSnapshots(
      snap([callout], { nested: [c1, c2] }),
      snap([calloutB], { nested: [c1b, c2] }),
    );
    const top = diff.blocks[0]!;
    expect(top.id).toBe(callout.id);
    expect(top.status).toBe("changed");
    expect(top.children).toBeDefined();
    const by = statusById(diff.blocks);
    expect(by.get(c1.id)!.status).toBe("changed");
    expect(by.get(c1.id)!.text).toBeDefined();
    expect(by.get(c2.id)!.status).toBe("unchanged");
  });

  it("leaves an unchanged container unchanged and does not attach children", () => {
    const a = alloc("tree_unchanged");
    const c1 = leaf(a, "one");
    const c2 = leaf(a, "two");
    const callout = container(a, "callout", [c1, c2]);
    const diff = diffSnapshots(
      snap([callout], { nested: [c1, c2] }),
      snap([callout], { nested: [c1, c2] }),
    );
    expect(diff.blocks[0]!.status).toBe("unchanged");
    expect(diff.blocks[0]!.children).toBeUndefined();
    expect(diff.stats).toEqual({ added: 0, changed: 0, moved: 0, removed: 0 });
  });

  it("marks a container changed when a child is added inside it", () => {
    const a = alloc("tree_childadd");
    const c1 = leaf(a, "one");
    const c2 = leaf(a, "two");
    const callout = container(a, "callout", [c1]);
    const calloutB = makeStructuralNode({
      children: [c1.id, c2.id],
      id: callout.id,
      type: "callout",
    });
    const diff = diffSnapshots(
      snap([callout], { nested: [c1] }),
      snap([calloutB], { nested: [c1, c2] }),
    );
    const by = statusById(diff.blocks);
    expect(by.get(callout.id)!.status).toBe("changed");
    expect(by.get(c1.id)!.status).toBe("unchanged");
    expect(by.get(c2.id)!.status).toBe("added");
  });

  it("emits every child of a REMOVED populated container so stats and emit-once hold", () => {
    const a = alloc("tree_rm_container");
    const c1 = leaf(a, "c1");
    const c2 = leaf(a, "c2");
    const callout = container(a, "callout", [c1, c2]);
    const keep = leaf(a, "keep");
    const diff = diffSnapshots(
      snap([callout, keep], { nested: [c1, c2] }),
      snap([keep]),
    );
    const by = statusById(diff.blocks);
    // The container and BOTH its children are emitted once, each `removed`.
    expect(by.get(callout.id)!.status).toBe("removed");
    expect(by.get(c1.id)!.status).toBe("removed");
    expect(by.get(c2.id)!.status).toBe("removed");
    expect(flat(diff.blocks).filter((b) => b.id === c1.id)).toHaveLength(1);
    // stats reflects the real magnitude (container + 2 leaves), not 1.
    expect(diff.stats.removed).toBe(3);
  });

  it("emits every child of an ADDED populated container", () => {
    const a = alloc("tree_add_container");
    const c1 = leaf(a, "c1");
    const c2 = leaf(a, "c2");
    const callout = container(a, "callout", [c1, c2]);
    const keep = leaf(a, "keep");
    const diff = diffSnapshots(
      snap([keep]),
      snap([keep, callout], { nested: [c1, c2] }),
    );
    const by = statusById(diff.blocks);
    expect(by.get(callout.id)!.status).toBe("added");
    expect(by.get(c1.id)!.status).toBe("added");
    expect(by.get(c2.id)!.status).toBe("added");
    expect(diff.stats.added).toBe(3);
  });

  it("does not lose a genuinely-deleted sibling when another child moves out of a removed container", () => {
    const a = alloc("tree_rm_move_out");
    const inner = leaf(a, "inner"); // genuinely deleted
    const survivor = leaf(a, "survivor"); // pulled out to body
    const callout = container(a, "callout", [inner, survivor]);
    const diff = diffSnapshots(
      snap([callout], { nested: [inner, survivor] }),
      snap([survivor]),
    );
    const by = statusById(diff.blocks);
    expect(by.get(callout.id)!.status).toBe("removed");
    expect(by.get(inner.id)!.status).toBe("removed"); // not silently dropped
    // `survivor` is in both snapshots at a different parent → a move (D5), not a
    // degrade to add/remove; its base parent is the (removed) callout.
    expect(by.get(survivor.id)!.status).toBe("moved");
    expect(by.get(survivor.id)!.baseParent).toBe(callout.id);
    expect(by.get(survivor.id)!.targetParent).toBeNull();
    // `survivor` is emitted exactly once (not also as removed inside the callout).
    expect(flat(diff.blocks).filter((b) => b.id === survivor.id)).toHaveLength(
      1,
    );
    expect(diff.stats).toEqual({ added: 0, changed: 0, moved: 1, removed: 2 });
  });

  it("surfaces a CHANGED descendant of a moved sub-container whose parent was removed (deep move-out)", () => {
    // base: removedWrapper[ moverBox[grandchild], trulyGone ]; target: moverBox[grandchild'].
    // moverBox survives (moves to body) and its grandchild's content changes; the
    // deleted wrapper + its non-moving sibling are surfaced, and the changed
    // descendant of the moved sub-container is NOT dropped (the deep case of the bug).
    const a = alloc("tree_deep_moveout");
    const grandchild = leaf(a, "grandchild");
    const grandchildEdited = makeTextNode({
      content: replaceTextContent(
        grandchild.content,
        0,
        10,
        a.createTextSlice("GRANDCHILD"),
      ),
      id: grandchild.id,
    });
    const trulyGone = leaf(a, "trulyGone");
    const moverBox = container(a, "callout", [grandchild]);
    const removedWrapper = makeStructuralNode({
      children: [moverBox.id, trulyGone.id],
      id: a.createNodeId(),
      type: "callout",
    });
    const diff = diffSnapshots(
      snap([removedWrapper], { nested: [moverBox, grandchild, trulyGone] }),
      snap([moverBox], { nested: [grandchildEdited] }),
    );
    const by = statusById(diff.blocks);
    expect(by.get(removedWrapper.id)!.status).toBe("removed");
    expect(by.get(trulyGone.id)!.status).toBe("removed"); // genuine deletion, surfaced
    expect(by.get(moverBox.id)!.status).toBe("moved"); // survived; a move (D5), not degrade
    expect(by.get(moverBox.id)!.alsoChanged).toBe(true);
    // The crux: the changed descendant of the moved sub-container is emitted, once.
    expect(by.get(grandchild.id)!.status).toBe("changed");
    expect(
      flat(diff.blocks).filter((b) => b.id === grandchild.id),
    ).toHaveLength(1);
    expect(diff.stats).toEqual({ added: 0, changed: 1, moved: 1, removed: 2 });
  });

  it("wraps a sub-container in a new container as added + moved, carrying an unchanged descendant (deep move-in)", () => {
    // base: [subCallout[para]]; target: [newCallout[subCallout[para]]]
    const a = alloc("tree_deep_movein");
    const para = leaf(a, "para");
    const subCallout = container(a, "callout", [para]);
    const newCallout = makeStructuralNode({
      children: [subCallout.id],
      id: a.createNodeId(),
      type: "callout",
    });
    const diff = diffSnapshots(
      snap([subCallout], { nested: [para] }),
      snap([newCallout], { nested: [subCallout, para] }),
    );
    const by = statusById(diff.blocks);
    expect(by.get(newCallout.id)!.status).toBe("added");
    expect(by.get(subCallout.id)!.status).toBe("moved"); // wrapped → moved into the new container
    // `para` is unchanged and carried inside the moved sub-container's node — so it
    // is not a separate BlockDiff (same as any unchanged descendant), but it is
    // never lost: it round-trips through the target snapshot.
    expect(by.get(para.id)).toBeUndefined();
    expect(diff.target.body.blocks[para.id]).toBeDefined();
    expect(diff.stats).toEqual({ added: 1, changed: 0, moved: 1, removed: 0 });
  });

  it("does not hang on a malformed self-referential removed container", () => {
    const a = alloc("tree_cyclic");
    const inner = leaf(a, "inner");
    const cyclicId = a.createNodeId();
    const cyclic = makeStructuralNode({
      children: [inner.id, cyclicId], // references itself — malformed
      id: cyclicId,
      type: "callout",
    });
    const keep = leaf(a, "keep");
    const diff = diffSnapshots(
      snap([cyclic, keep], { nested: [inner] }),
      snap([keep]),
    );
    const by = statusById(diff.blocks);
    expect(by.get(cyclic.id)!.status).toBe("removed");
    expect(by.get(inner.id)!.status).toBe("removed");
    // The cycle is visited once, not infinitely.
    expect(flat(diff.blocks).filter((b) => b.id === cyclic.id)).toHaveLength(1);
  });

  it("stays total when a block is orphaned on one side and reachable on the other", () => {
    // `diffSnapshots` promises no error for any input. A node present in `blocks` but
    // unreachable from `order`/`children` on one side (an orphan) must not be mistaken
    // for a matched node (which would dereference a missing parent-index entry).
    const a = alloc("tree_orphan_matched");
    const box = leaf(a, "box");
    const x = leaf(a, "x");
    const blocks = { [box.id]: box, [x.id]: x } as Record<NodeId, EditorNode>;
    // Orphan in base (not in order), reachable in target → treated as added.
    const baseOrphan: EditorDocumentSnapshot = {
      body: { blocks, order: [x.id] },
      settings: {},
      version: 1,
    };
    const targetReach: EditorDocumentSnapshot = {
      body: { blocks, order: [box.id, x.id] },
      settings: {},
      version: 1,
    };
    const diff = diffSnapshots(baseOrphan, targetReach);
    const by = statusById(diff.blocks);
    expect(by.get(box.id)!.status).toBe("added");
    expect(by.get(x.id)!.status).toBe("unchanged");

    // Mirror: reachable in base, orphan in target → treated as removed. No throw.
    const mirror = diffSnapshots(targetReach, baseOrphan);
    expect(statusById(mirror.blocks).get(box.id)!.status).toBe("removed");
  });

  it("marks a container changed on an attr-only change with no child change", () => {
    const a = alloc("tree_attr_only");
    const c1 = leaf(a, "c1");
    const callout = makeStructuralNode({
      attrs: { tone: "info" },
      children: [c1.id],
      id: a.createNodeId(),
      type: "callout",
    });
    const calloutB = makeStructuralNode({
      attrs: { tone: "warn" },
      children: [c1.id],
      id: callout.id,
      type: "callout",
    });
    const diff = diffSnapshots(
      snap([callout], { nested: [c1] }),
      snap([calloutB], { nested: [c1] }),
    );
    const by = statusById(diff.blocks);
    expect(by.get(callout.id)!.status).toBe("changed");
    expect(by.get(callout.id)!.attrs!.changed).toEqual({
      tone: { base: "info", target: "warn" },
    });
    expect(by.get(c1.id)!.status).toBe("unchanged");
  });

  it("propagates a deep (3-level) leaf edit up through every ancestor only", () => {
    const a = alloc("tree_deep");
    const deep = leaf(a, "deep");
    const mid = container(a, "callout", [deep]);
    const top = container(a, "callout", [mid]);
    const sibling = leaf(a, "sibling");
    const deepB = makeTextNode({
      content: replaceTextContent(
        deep.content,
        0,
        4,
        a.createTextSlice("DEEP"),
      ),
      id: deep.id,
    });
    const diff = diffSnapshots(
      snap([top, sibling], { nested: [mid, deep] }),
      snap([top, sibling], { nested: [mid, deepB] }),
    );
    const by = statusById(diff.blocks);
    expect(by.get(top.id)!.status).toBe("changed");
    expect(by.get(mid.id)!.status).toBe("changed");
    expect(by.get(deep.id)!.status).toBe("changed");
    expect(by.get(sibling.id)!.status).toBe("unchanged");
    expect(diff.stats.changed).toBe(3);
  });
});

describe("diffScope — cross-scope moves (R6-D)", () => {
  it("moves a leaf from body into a callout as one `moved`, not removed+added", () => {
    const a = alloc("tree_cross_in");
    const inner = leaf(a, "inner");
    const mover = leaf(a, "mover");
    const calloutBase = container(a, "callout", [inner]);
    const calloutTarget = makeStructuralNode({
      children: [inner.id, mover.id],
      id: calloutBase.id,
      type: "callout",
    });
    const diff = diffSnapshots(
      snap([calloutBase, mover], { nested: [inner] }),
      snap([calloutTarget], { nested: [inner, mover] }),
    );
    const by = statusById(diff.blocks);
    // `mover` appears exactly once, as a move into the callout.
    const moverEntries = flat(diff.blocks).filter((b) => b.id === mover.id);
    expect(moverEntries).toHaveLength(1);
    expect(by.get(mover.id)!.status).toBe("moved");
    expect(by.get(mover.id)!.baseParent).toBeNull(); // was in body
    expect(by.get(mover.id)!.targetParent).toBe(calloutBase.id);
    expect(by.get(calloutBase.id)!.status).toBe("changed"); // gained a child
    expect(diff.stats.removed).toBe(0);
  });

  it("moving a child out of a callout marks the callout changed and the child moved once", () => {
    const a = alloc("tree_cross_out");
    const l1 = leaf(a, "l1");
    const l2 = leaf(a, "l2");
    const tail = leaf(a, "tail");
    const calloutBase = container(a, "callout", [l1, l2]);
    const calloutTarget = makeStructuralNode({
      children: [l1.id],
      id: calloutBase.id,
      type: "callout",
    });
    const diff = diffSnapshots(
      snap([calloutBase, tail], { nested: [l1, l2] }),
      snap([calloutTarget, tail, l2], { nested: [l1] }),
    );
    const by = statusById(diff.blocks);
    const l2Entries = flat(diff.blocks).filter((b) => b.id === l2.id);
    expect(l2Entries).toHaveLength(1);
    expect(by.get(l2.id)!.status).toBe("moved");
    expect(by.get(l2.id)!.baseParent).toBe(calloutBase.id);
    expect(by.get(l2.id)!.targetParent).toBeNull(); // now in body
    expect(by.get(calloutBase.id)!.status).toBe("changed"); // lost a child
  });
});

describe("diffScope — kind change and move+change (R6-D)", () => {
  it("reports a matched id whose kind changed as `changed`", () => {
    const a = alloc("tree_kind");
    const id = a.createNodeId();
    const asText = makeTextNode({ content: a.createTextSlice("was text"), id });
    const asObject = object(a, "divider", {}, { id });
    const diff = diffSnapshots(snap([asText]), snap([asObject]));
    const block = diff.blocks[0]!;
    expect(block.status).toBe("changed");
    expect(block.node.kind).toBe("object");
    // The base node stays reachable by id for the removed-old-over-added-new view.
    expect(diff.base.body.blocks[id]!.kind).toBe("text");
  });

  it("flags a cross-scope move that also changed content as moved + alsoChanged", () => {
    const a = alloc("tree_movechange");
    const inner = leaf(a, "inner");
    const mover = leaf(a, "mover");
    const calloutBase = container(a, "callout", [inner]);
    const moverChanged = makeTextNode({
      content: replaceTextContent(
        mover.content,
        0,
        5,
        a.createTextSlice("MOVER!"),
      ),
      id: mover.id,
    });
    const calloutTarget = makeStructuralNode({
      children: [inner.id, mover.id],
      id: calloutBase.id,
      type: "callout",
    });
    const diff = diffSnapshots(
      snap([calloutBase, mover], { nested: [inner] }),
      snap([calloutTarget], { nested: [inner, moverChanged] }),
    );
    const by = statusById(diff.blocks);
    expect(by.get(mover.id)!.status).toBe("moved");
    expect(by.get(mover.id)!.alsoChanged).toBe(true);
    expect(by.get(mover.id)!.text).toBeDefined();
  });

  it("flags a within-scope reorder that also changed content as moved + alsoChanged", () => {
    const a = alloc("tree_within_movechange");
    const X = leaf(a, "hello");
    const Y = leaf(a, "y");
    const Z = leaf(a, "z");
    const Xc = makeTextNode({
      content: replaceTextContent(X.content, 0, 5, a.createTextSlice("HELLO!")),
      id: X.id,
    });
    // spine [Y, Z]; X reorders to the end and its content changes.
    const diff = diffSnapshots(snap([X, Y, Z]), snap([Y, Z, Xc]));
    const bx = statusById(diff.blocks).get(X.id)!;
    expect(bx.status).toBe("moved");
    expect(bx.alsoChanged).toBe(true);
    expect(bx.text).toBeDefined();
  });
});

function flat(blocks: readonly BlockDiff[]): BlockDiff[] {
  const out: BlockDiff[] = [];
  const walk = (list: readonly BlockDiff[]) => {
    for (const b of list) {
      out.push(b);
      if (b.children) walk(b.children);
    }
  };
  walk(blocks);
  return out;
}
