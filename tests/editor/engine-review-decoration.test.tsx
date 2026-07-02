// @vitest-environment jsdom
/**
 * The passive marker layer generalized to any depth (docs/038 §7–§9, R6-J J3). These assert the pure
 * `changedElements` router — a top-level non-unchanged block gets a `bar`, a NESTED element whose
 * attr/object changed gets a `ring`, and a text-run edit / added / removed / pure bubble-container
 * gets no ring (owned by J6 track-changes / the ghost / the top-level ancestor's bar) — and the
 * `applyReviewIndicators` DOM half setting `data-engine-review-ring` on nested elements alongside the
 * top-level `data-engine-review-changed` bar. One end-to-end case runs a real `diffSnapshots` over a
 * table with a re-colored cell to prove `.attrs` actually reaches the nested cell.
 */
import { describe, expect, it } from "vitest";
import { diffSnapshots } from "../../packages/editor/src/core";
import {
  applyReviewIndicators,
  changedElements,
  REVIEW_INDICATOR_CSS,
  type ReviewChangedElement,
} from "../../packages/editor/src";
import { alloc, container, leaf, snap } from "./diff-fixtures";

/** A hand-built diff-node literal — `changedElements` reads only id/status/attrs/object/children. */
type Node = {
  id: string;
  status: string;
  attrs?: unknown;
  object?: unknown;
  children?: Node[];
};
const byId = (els: readonly ReviewChangedElement[]) =>
  new Map(els.map((e) => [e.id, e]));

describe("changedElements — top level is a bar (R6-I parity)", () => {
  it("reports each non-unchanged top-level block as a bar, skipping unchanged", () => {
    const els = changedElements({
      blocks: [
        { id: "a", status: "changed" },
        { id: "b", status: "unchanged" },
        { id: "c", status: "removed" },
        { id: "d", status: "added" },
        { id: "e", status: "moved" },
      ] as Node[],
    });
    const m = byId(els);
    expect(m.get("a")).toEqual({ id: "a", marker: "bar", status: "changed" });
    expect(m.has("b")).toBe(false);
    // `removed` is carried (parity with changedBlockIds) — applyReviewIndicators skips it at the DOM.
    expect(m.get("c")).toEqual({ id: "c", marker: "bar", status: "removed" });
    expect(m.get("d")?.marker).toBe("bar");
    expect(m.get("e")?.marker).toBe("bar");
  });
});

describe("changedElements — nested attr/object is a ring (J3)", () => {
  it("rings a nested cell whose attrs changed, and does NOT ring the bubble-up ancestors", () => {
    // table (changed, bubble) > row (changed, bubble) > cell (changed, attrs). Only the cell has a
    // direct element-level change; the table/row are "changed" only because a descendant changed.
    const els = changedElements({
      blocks: [
        {
          id: "table",
          status: "changed",
          children: [
            {
              id: "row",
              status: "changed",
              children: [
                { id: "cell", status: "changed", attrs: { changed: {} } },
                { id: "cell2", status: "unchanged" },
              ],
            },
          ],
        },
      ] as Node[],
    });
    const m = byId(els);
    // The top-level table is the bar (breadcrumb); the cell is the ring; the row is neither (bubble).
    expect(m.get("table")).toEqual({
      id: "table",
      marker: "bar",
      status: "changed",
    });
    expect(m.get("cell")).toEqual({
      id: "cell",
      marker: "ring",
      status: "changed",
    });
    expect(m.has("row")).toBe(false);
    expect(m.has("cell2")).toBe(false);
  });

  it("rings a nested object whose fields changed", () => {
    const els = changedElements({
      blocks: [
        {
          id: "callout",
          status: "changed",
          children: [{ id: "obj", status: "changed", object: { fields: [] } }],
        },
      ] as Node[],
    });
    expect(byId(els).get("obj")).toEqual({
      id: "obj",
      marker: "ring",
      status: "changed",
    });
  });

  it("does NOT ring a nested text-run edit, added, or removed element (owned by J6 / the ghost)", () => {
    const els = changedElements({
      blocks: [
        {
          id: "list",
          status: "changed",
          children: [
            { id: "textEdit", status: "changed" }, // .text only (no attrs/object) → J6 track-changes
            { id: "newItem", status: "added" }, // green content → J6 wash
            { id: "goneItem", status: "removed" }, // a GhostBlock renders it
          ],
        },
      ] as Node[],
    });
    const m = byId(els);
    expect(m.get("list")?.marker).toBe("bar");
    expect(m.has("textEdit")).toBe(false);
    expect(m.has("newItem")).toBe(false);
    expect(m.has("goneItem")).toBe(false);
  });

  it("does not descend into an added/removed container (its one-sided children are rendered whole)", () => {
    const els = changedElements({
      blocks: [
        {
          id: "addedTable",
          status: "added",
          children: [
            { id: "innerCell", status: "added", attrs: { added: {} } },
          ],
        },
      ] as Node[],
    });
    const m = byId(els);
    expect(m.get("addedTable")?.marker).toBe("bar");
    expect(m.has("innerCell")).toBe(false); // never recursed into
  });

  it("rings a nested element that MOVED and also carries attrs", () => {
    const els = changedElements({
      blocks: [
        {
          id: "list",
          status: "changed",
          children: [
            { id: "movedCell", status: "moved", attrs: { changed: {} } },
          ],
        },
      ] as Node[],
    });
    expect(byId(els).get("movedCell")).toEqual({
      id: "movedCell",
      marker: "ring",
      status: "moved",
    });
  });
});

describe("changedElements — end to end over a real diff", () => {
  it("a re-colored table cell surfaces `.attrs` on the nested cell → a ring", () => {
    const a = alloc("j3_cell_attr");
    const t = leaf(a, "A1");
    const cellId = a.createNodeId();
    const baseCell = container(a, "tablecell", [t], {
      attrs: { background: "red" },
      id: cellId,
    });
    const targetCell = container(a, "tablecell", [t], {
      attrs: { background: "yellow" },
      id: cellId,
    });
    const rowId = a.createNodeId();
    const baseRow = container(a, "tablerow", [baseCell], { id: rowId });
    const targetRow = container(a, "tablerow", [targetCell], { id: rowId });
    const tableId = a.createNodeId();
    const baseTable = container(a, "table", [baseRow], { id: tableId });
    const targetTable = container(a, "table", [targetRow], { id: tableId });
    const base = snap([baseTable], { nested: [baseRow, baseCell, t] });
    const target = snap([targetTable], { nested: [targetRow, targetCell, t] });

    const els = changedElements(diffSnapshots(base, target));
    const m = byId(els);
    expect(m.get(tableId)?.marker).toBe("bar"); // top-level breadcrumb
    expect(m.get(cellId)?.marker).toBe("ring"); // the cell's fill changed → ring
    expect(m.has(rowId)).toBe(false); // the row only bubbles
  });
});

function root(ids: readonly string[]) {
  const el = document.createElement("div");
  for (const id of ids) {
    const node = document.createElement("div");
    node.setAttribute("data-engine-block-id", id);
    el.appendChild(node);
  }
  return el;
}
const bar = (el: HTMLElement, id: string) =>
  el
    .querySelector(`[data-engine-block-id="${id}"]`)
    ?.getAttribute("data-engine-review-changed") ?? null;
const ring = (el: HTMLElement, id: string) =>
  el
    .querySelector(`[data-engine-block-id="${id}"]`)
    ?.getAttribute("data-engine-review-ring") ?? null;

describe("REVIEW_INDICATOR_CSS — the ring is two-channel (J3, guards the object-chrome fix)", () => {
  // The element ring MUST declare BOTH `outline` and `box-shadow`, because the two ring-target classes
  // have opposite constraints: a nested object's hover/live `box-shadow` chrome (styles.ts) replaces a
  // box-shadow-only ring, while a nested text block's inline `outline:none` (blockStyle) kills an
  // outline-only ring. Only carrying both keeps at least one channel alive on every target. The
  // hover-survival proof is an e2e (review-decoration.spec.ts), which does NOT run under `pnpm check`;
  // this string assertion puts the load-bearing invariant behind the standard gate so a regression
  // (dropping a channel) fails here, not only in a separate Playwright run.
  const ringRule =
    REVIEW_INDICATOR_CSS.match(/\[data-engine-review-ring\]\{([^}]*)\}/)?.[1] ??
    "";

  it("declares the ring with both an outline and an inset box-shadow channel", () => {
    expect(ringRule).not.toBe("");
    expect(ringRule).toContain("outline:");
    expect(ringRule).toContain("box-shadow:");
    expect(ringRule).toContain("inset"); // the box-shadow is inset (occlusion-safe in tables)
  });
});

describe("applyReviewIndicators — rings + bars (J3)", () => {
  it("sets the ring attr on ring markers and the bar attr on bar markers, independently", () => {
    const r = root(["top", "cell"]);
    applyReviewIndicators(r, [
      { id: "top", marker: "bar", status: "changed" },
      { id: "cell", marker: "ring", status: "changed" },
    ]);
    expect(bar(r, "top")).toBe("changed");
    expect(ring(r, "top")).toBeNull();
    expect(ring(r, "cell")).toBe("changed");
    expect(bar(r, "cell")).toBeNull();
  });

  it("clears a stale ring when the element is no longer changed, without touching bars", () => {
    const r = root(["top", "cell"]);
    applyReviewIndicators(r, [
      { id: "top", marker: "bar", status: "changed" },
      { id: "cell", marker: "ring", status: "changed" },
    ]);
    applyReviewIndicators(r, [{ id: "top", marker: "bar", status: "changed" }]);
    expect(ring(r, "cell")).toBeNull();
    expect(bar(r, "top")).toBe("changed");
    applyReviewIndicators(r, []);
    expect(bar(r, "top")).toBeNull();
  });

  it("skips a ring for a removed element (no live element) and carries the moved status through", () => {
    const r = root(["moved"]);
    applyReviewIndicators(r, [
      { id: "moved", marker: "ring", status: "moved" },
      { id: "gone", marker: "ring", status: "removed" }, // no element in the root
    ]);
    expect(ring(r, "moved")).toBe("moved");
  });

  it("treats a marker-less ReviewChangedBlock as a bar (back-compat with changedBlockIds callers)", () => {
    const r = root(["p"]);
    applyReviewIndicators(r, [{ id: "p", status: "changed" }]);
    expect(bar(r, "p")).toBe("changed");
    expect(ring(r, "p")).toBeNull();
  });
});
