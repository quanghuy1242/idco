/**
 * Diff primitives (docs/036 R6-B): the parent index and the attr/settings diff.
 *
 * `buildParentIndex` maps every reachable node to its parent scope and index and
 * ignores orphans, dangling refs, and cycles; `diffAttrs` (on `jsonEqual`) reports
 * added/removed/changed keys and is key-order insensitive so an independently
 * authored snapshot never reads as changed for a reordered attrs bag.
 */
import { describe, expect, it } from "vitest";
import {
  BODY_SCOPE_ID,
  buildParentIndex,
  diffAttrs,
  type EditorDocumentSnapshot,
  type EditorNode,
  jsonEqual,
  makeStructuralNode,
  type NodeId,
} from "../../packages/editor/src/core";
import { alloc, container, leaf, snap } from "./diff-fixtures";

describe("buildParentIndex (R6-B)", () => {
  it("maps top-level nodes under the body scope in order", () => {
    const a = alloc("pi_flat");
    const x = leaf(a, "one");
    const y = leaf(a, "two");
    const z = leaf(a, "three");
    const index = buildParentIndex(snap([x, y, z]));

    expect(index.get(x.id)).toEqual({ index: 0, parent: BODY_SCOPE_ID });
    expect(index.get(y.id)).toEqual({ index: 1, parent: BODY_SCOPE_ID });
    expect(index.get(z.id)).toEqual({ index: 2, parent: BODY_SCOPE_ID });
    expect(index.size).toBe(3);
  });

  it("maps nested structural children under their container", () => {
    const a = alloc("pi_nested");
    const c1 = leaf(a, "cell one");
    const c2 = leaf(a, "cell two");
    const callout = container(a, "callout", [c1, c2]);
    const tail = leaf(a, "after");
    const index = buildParentIndex(snap([callout, tail], { nested: [c1, c2] }));

    expect(index.get(callout.id)).toEqual({ index: 0, parent: BODY_SCOPE_ID });
    expect(index.get(tail.id)).toEqual({ index: 1, parent: BODY_SCOPE_ID });
    expect(index.get(c1.id)).toEqual({ index: 0, parent: callout.id });
    expect(index.get(c2.id)).toEqual({ index: 1, parent: callout.id });
    expect(index.size).toBe(4);
  });

  it("ignores orphan nodes present in blocks but unreachable from order", () => {
    const a = alloc("pi_orphan");
    const x = leaf(a, "kept");
    const orphan = leaf(a, "orphan");
    const snapshot: EditorDocumentSnapshot = {
      body: {
        blocks: { [x.id]: x, [orphan.id]: orphan } as Record<
          NodeId,
          EditorNode
        >,
        order: [x.id],
      },
      settings: {},
      version: 1,
    };
    const index = buildParentIndex(snapshot);
    expect(index.has(x.id)).toBe(true);
    expect(index.has(orphan.id)).toBe(false);
  });

  it("ignores a dangling child ref with no backing node and keeps sibling indexes true to array position", () => {
    const a = alloc("pi_dangling");
    const real = leaf(a, "real");
    const missing = "idco_node_ghost" as NodeId;
    const callout = makeStructuralNode({
      children: [missing, real.id],
      id: a.createNodeId(),
      type: "callout",
    });
    const index = buildParentIndex(snap([callout], { nested: [real] }));
    expect(index.has(missing)).toBe(false);
    // `real` is at array position 1 in the children list; the dangling ref does
    // not exist as a node but still occupies index 0.
    expect(index.get(real.id)).toEqual({ index: 1, parent: callout.id });
  });

  it("does not loop on a cyclic child reference (first-seen position wins)", () => {
    const a = alloc("pi_cycle");
    const inner = leaf(a, "inner");
    const outerId = a.createNodeId();
    // A container whose children include itself: a malformed snapshot must not
    // hang the walk.
    const outer = makeStructuralNode({
      children: [inner.id, outerId],
      id: outerId,
      type: "callout",
    });
    const index = buildParentIndex(snap([outer], { nested: [inner] }));
    expect(index.get(outer.id)).toEqual({ index: 0, parent: BODY_SCOPE_ID });
    expect(index.get(inner.id)).toEqual({ index: 0, parent: outer.id });
    expect(index.size).toBe(2);
  });
});

describe("diffAttrs (R6-B)", () => {
  it("reports added, removed, and changed keys with values", () => {
    const diff = diffAttrs(
      { keep: "same", lose: "gone", tone: "info" },
      { gain: "new", keep: "same", tone: "warn" },
    );
    expect(diff.added).toEqual({ gain: "new" });
    expect(diff.removed).toEqual({ lose: "gone" });
    expect(diff.changed).toEqual({ tone: { base: "info", target: "warn" } });
  });

  it("treats an absent bag as empty (undefined vs {} is no change)", () => {
    expect(diffAttrs(undefined, {})).toEqual({
      added: {},
      changed: {},
      removed: {},
    });
    expect(diffAttrs(undefined, { a: 1 }).added).toEqual({ a: 1 });
    expect(diffAttrs({ a: 1 }, undefined).removed).toEqual({ a: 1 });
  });

  it("is key-order insensitive but array-order sensitive", () => {
    expect(diffAttrs({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual({
      added: {},
      changed: {},
      removed: {},
    });
    const arr = diffAttrs({ list: [1, 2, 3] }, { list: [1, 3, 2] });
    expect(Object.keys(arr.changed)).toEqual(["list"]);
  });

  it("detects deep nested value changes", () => {
    const diff = diffAttrs(
      { meta: { level: 1, nested: { x: true } } },
      { meta: { level: 1, nested: { x: false } } },
    );
    expect(Object.keys(diff.changed)).toEqual(["meta"]);
  });
});

describe("jsonEqual (R6-B)", () => {
  it("compares primitives, null, and undefined-vs-empty", () => {
    expect(jsonEqual(1, 1)).toBe(true);
    expect(jsonEqual("a", "b")).toBe(false);
    expect(jsonEqual(null, null)).toBe(true);
    expect(jsonEqual(null, 0)).toBe(false);
    expect(jsonEqual(undefined, {})).toBe(true);
    expect(jsonEqual(undefined, { a: 1 })).toBe(false);
    expect(jsonEqual(undefined, undefined)).toBe(true);
  });

  it("compares nested objects key-order-insensitively and arrays order-sensitively", () => {
    expect(
      jsonEqual({ a: [1, { z: 2 }], b: 3 }, { b: 3, a: [1, { z: 2 }] }),
    ).toBe(true);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});
