/**
 * The woven review plan projection (docs/038 §5, R6-J J2).
 *
 * `buildReviewModel` is pure — a projection of a `SnapshotDiff` — so it is tested without a live
 * editor. These prove the J2 additions over J0's top-level-only plan: removed CHILDREN inside a
 * surviving container are recorded as ghosts and spliced into that container's merged child order;
 * the per-container ghost budget bounds a deletion-heavy container (containers do not virtualize) and
 * records the dropped count rather than hiding it; and the TOP level is never capped (the treap
 * virtualizes it).
 */
import { describe, expect, it } from "vitest";
import { diffSnapshots } from "../../packages/editor/src/core";
import { buildReviewModel } from "../../packages/editor/src/view/review-model";
import { container, leaf, snap } from "./diff-fixtures";
import { alloc } from "./diff-fixtures";

describe("buildReviewModel — top-level ghosts (J0 parity)", () => {
  it("records a removed top-level block at its slot and never caps the top level", () => {
    const a = alloc("rm_top");
    // 30 paragraphs in base; the target keeps only the first — 29 top-level removals.
    const paras = Array.from({ length: 30 }, (_v, i) => leaf(a, `p${i}`));
    const base = snap(paras);
    const target = snap([paras[0]!]);

    const model = buildReviewModel(diffSnapshots(base, target), {
      containerGhostBudget: 4,
    });

    // Every removed top-level id is a ghost and appears in the order (the treap virtualizes them, so
    // the small budget does NOT cap the top level).
    expect(model.ghosts.size).toBe(29);
    expect(model.order).toHaveLength(30);
    expect(model.collapsed.size).toBe(0);
    expect(model.childOrder.size).toBe(0);
  });

  it("leaves an unchanged document with an empty plan", () => {
    const a = alloc("rm_same");
    const s = snap([leaf(a, "x"), leaf(a, "y")]);
    const model = buildReviewModel(diffSnapshots(s, s));
    expect(model.ghosts.size).toBe(0);
    expect(model.childOrder.size).toBe(0);
    expect(model.collapsed.size).toBe(0);
    expect(model.order).toHaveLength(2);
  });
});

describe("buildReviewModel — in-container ghosts (J2)", () => {
  it("splices a removed child into its surviving container's merged child order", () => {
    const a = alloc("rm_child");
    const i1 = leaf(a, "i1", { type: "listitem" });
    const i2 = leaf(a, "i2", { type: "listitem" });
    const i3 = leaf(a, "i3", { type: "listitem" });
    const i4 = leaf(a, "i4", { type: "listitem" });
    const listId = a.createNodeId();
    const p = leaf(a, "p");
    const baseList = container(a, "list", [i1, i2, i3, i4], { id: listId });
    const targetList = container(a, "list", [i1, i3], { id: listId });
    const base = snap([p, baseList], { nested: [i1, i2, i3, i4] });
    const target = snap([p, targetList], { nested: [i1, i3] });

    const model = buildReviewModel(diffSnapshots(base, target));

    // The removed children are ghosts (nested, not top-level), and the container's merged child order
    // splices them at their base slots between the survivors.
    expect(model.ghosts.has(i2.id)).toBe(true);
    expect(model.ghosts.has(i4.id)).toBe(true);
    expect(model.childOrder.get(listId)).toEqual([i1.id, i2.id, i3.id, i4.id]);
    // The list is a live block, not a ghost; the top-level order is unchanged (p + list).
    expect(model.ghosts.has(listId)).toBe(false);
    expect(model.order).toEqual([p.id, listId]);
    expect(model.collapsed.size).toBe(0);
  });

  it("does not override child order for a container that only gained/moved children (no removals)", () => {
    const a = alloc("rm_none");
    const i1 = leaf(a, "i1", { type: "listitem" });
    const i2 = leaf(a, "i2", { type: "listitem" });
    const i3 = leaf(a, "i3", { type: "listitem" });
    const listId = a.createNodeId();
    const baseList = container(a, "list", [i1, i2], { id: listId });
    const targetList = container(a, "list", [i1, i2, i3], { id: listId }); // added i3, no removal
    const base = snap([baseList], { nested: [i1, i2] });
    const target = snap([targetList], { nested: [i1, i2, i3] });

    const model = buildReviewModel(diffSnapshots(base, target));

    // No removed child ⇒ no childOrder override (the live `node.children` already carries the added
    // child in target order).
    expect(model.childOrder.has(listId)).toBe(false);
    expect(model.ghosts.size).toBe(0);
  });
});

describe("buildReviewModel — tables are deferred, not spliced (J2)", () => {
  it("does not splice a ghost into a table (invalid <div> in <table>); records the deferred count", () => {
    const a = alloc("rm_table");
    const t1 = leaf(a, "A1");
    const cellA = container(a, "tablecell", [t1]);
    const rowA = container(a, "tablerow", [cellA]);
    const t2 = leaf(a, "B1");
    const cellB = container(a, "tablecell", [t2]);
    const rowB = container(a, "tablerow", [cellB]);
    const tableId = a.createNodeId();
    const baseTable = container(a, "table", [rowA, rowB], { id: tableId });
    const targetTable = container(a, "table", [rowA], { id: tableId }); // rowB removed
    const base = snap([baseTable], {
      nested: [rowA, rowB, cellA, cellB, t1, t2],
    });
    const target = snap([targetTable], { nested: [rowA, cellA, t1] });

    const model = buildReviewModel(diffSnapshots(base, target));

    // No merged child order for the table (so `block-dispatch` renders its live rows only — no invalid
    // `<div>` ghost in `<tbody>`), and the removed row is NOT a ghost anywhere; instead the removed
    // count is surfaced on `collapsed` for J3's faithful table-ghost rendering.
    expect(model.childOrder.has(tableId)).toBe(false);
    expect(model.ghosts.has(rowB.id)).toBe(false);
    expect(model.ghosts.size).toBe(0);
    expect(model.collapsed.get(tableId)).toBe(1);
  });
});

describe("buildReviewModel — per-container ghost budget (J2)", () => {
  it("caps a deletion-heavy container at the budget and records the dropped count", () => {
    const a = alloc("rm_budget");
    const items = Array.from({ length: 7 }, (_v, i) =>
      leaf(a, `it${i}`, { type: "listitem" }),
    );
    const listId = a.createNodeId();
    const baseList = container(a, "list", items, { id: listId });
    const targetList = container(a, "list", [items[0]!], { id: listId }); // 6 removed, keep 1
    const base = snap([baseList], { nested: items });
    const target = snap([targetList], { nested: [items[0]!] });

    const model = buildReviewModel(diffSnapshots(base, target), {
      containerGhostBudget: 4,
    });

    // 6 removed, budget 4 → keep 4 ghost children, drop 2; the merged order is the survivor + 4 kept
    // ghosts (5 ids), and the dropped count is surfaced, not silent.
    const merged = model.childOrder.get(listId)!;
    expect(merged).toHaveLength(5);
    expect(model.collapsed.get(listId)).toBe(2);
    // Exactly the kept ghosts are registered (the dropped ones never render, so they are not ghosts).
    const ghostChildren = items.filter((item) => model.ghosts.has(item.id));
    expect(ghostChildren).toHaveLength(4);
  });
});
