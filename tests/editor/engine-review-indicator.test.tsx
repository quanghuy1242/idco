// @vitest-environment jsdom
/**
 * The R6-I change indicator + object `diffData` seam (docs/036 §5.6/§6.2.1/§6.4). These assert the
 * pure `changedBlockIds` selector, the `applyReviewIndicators` DOM decoration (set on changed
 * blocks, cleared when no longer changed, `removed` skipped since it has no live element), and the
 * code block's `diffData` field-level diff through `nodeDiffResolver` (a code/language change reads
 * as object fields, not a bare block-level "changed"; without the seam, still `changed` but no fields).
 */
import { describe, expect, it } from "vitest";
import {
  applyReviewIndicators,
  changedBlockIds,
  createDefaultBlockRegistry,
  createIdAllocator,
  deletionAnchors,
  diffSnapshots,
  type EditorDocumentSnapshot,
  type EditorNode,
  makeObjectNode,
  makeTextNode,
  type NodeId,
  nodeDiffResolver,
} from "../../packages/editor/src";

const alloc = createIdAllocator("idco_client_reviewind");

function para(id: NodeId, text: string) {
  return makeTextNode({ content: alloc.createTextSlice(text), id });
}

function doc(nodes: readonly EditorNode[]): EditorDocumentSnapshot {
  return {
    body: {
      blocks: Object.fromEntries(nodes.map((n) => [n.id, n])),
      order: nodes.map((n) => n.id),
    },
    settings: {},
    version: 1,
  };
}

describe("changedBlockIds (docs/036 §6.2.1)", () => {
  it("reports each non-unchanged top-level block with its status, skipping unchanged", () => {
    const a = alloc.createNodeId();
    const b = alloc.createNodeId();
    const c = alloc.createNodeId();
    const d = alloc.createNodeId();
    const base = doc([para(a, "Alpha"), para(b, "Bravo"), para(c, "Charlie")]);
    // a edited, b untouched, c removed, d added.
    const target = doc([
      para(a, "Alpha edited"),
      para(b, "Bravo"),
      para(d, "Delta"),
    ]);
    const changed = changedBlockIds(diffSnapshots(base, target));
    const byId = new Map(changed.map((x) => [x.id, x.status]));
    expect(byId.get(a)).toBe("changed");
    expect(byId.get(c)).toBe("removed");
    expect(byId.get(d)).toBe("added");
    expect(byId.has(b)).toBe(false);
  });
});

describe("applyReviewIndicators (DOM decoration, docs/036 §6.2.1)", () => {
  it("marks present changed blocks, skips removed, and clears stale markers", () => {
    const a = "idco_node_a";
    const b = "idco_node_b";
    const d = "idco_node_d";
    const root = document.createElement("div");
    for (const id of [a, b, d]) {
      const el = document.createElement("p");
      el.setAttribute("data-engine-block-id", id);
      root.appendChild(el);
    }
    const get = (id: string) =>
      root
        .querySelector(`[data-engine-block-id="${id}"]`)
        ?.getAttribute("data-engine-review-changed") ?? null;

    applyReviewIndicators(root, [
      { id: a, status: "changed" },
      { id: d, status: "added" },
      { id: "idco_node_c", status: "removed" }, // no element — nothing to mark
    ]);
    expect(get(a)).toBe("changed");
    expect(get(d)).toBe("added");
    expect(get(b)).toBeNull(); // unchanged block: no marker

    // Re-apply with a reduced set: a's marker is cleared, d stays.
    applyReviewIndicators(root, [{ id: d, status: "added" }]);
    expect(get(a)).toBeNull();
    expect(get(d)).toBe("added");

    // Empty clears everything.
    applyReviewIndicators(root, []);
    expect(get(d)).toBeNull();
  });
});

describe("deletionAnchors (docs/036 §6.2.1)", () => {
  it("anchors a removed block's hint to its surviving neighbor (before, or after at the end)", () => {
    // Merged-order block list: a removed block in the middle hints the FOLLOWING survivor; a removed
    // block at the very end hints the PRECEDING one. Consecutive removals collapse to one hint.
    const anchors = deletionAnchors({
      blocks: [
        { id: "keep1", status: "unchanged" },
        { id: "gone1", status: "removed" },
        { id: "gone2", status: "removed" },
        { id: "keep2", status: "changed" },
        { id: "gone3", status: "removed" }, // trailing removal
      ],
    });
    expect(anchors).toEqual([
      { id: "keep2", side: "before" },
      { id: "keep2", side: "after" },
    ]);
  });
});

describe("applyReviewIndicators deletion ticks (docs/036 §6.2.1)", () => {
  it("flags the surviving neighbor of a removed block and clears it when the deletion is gone", () => {
    const before = "idco_node_before";
    const root = document.createElement("div");
    const el = document.createElement("p");
    el.setAttribute("data-engine-block-id", before);
    root.appendChild(el);
    const attr = () => el.getAttribute("data-engine-review-removed-before");

    applyReviewIndicators(root, [], [{ id: before, side: "before" }]);
    expect(attr()).toBe("");
    // A block can be both a changed block AND a deletion neighbor.
    applyReviewIndicators(
      root,
      [{ id: before, status: "changed" }],
      [{ id: before, side: "before" }],
    );
    expect(el.getAttribute("data-engine-review-changed")).toBe("changed");
    expect(attr()).toBe("");
    // No more deletion beside it → the tick clears (the status marker stays).
    applyReviewIndicators(root, [{ id: before, status: "changed" }], []);
    expect(attr()).toBeNull();
    expect(el.getAttribute("data-engine-review-changed")).toBe("changed");
  });
});

describe("code block diffData seam (docs/036 §5.6/§6.4, D6)", () => {
  const registry = createDefaultBlockRegistry();
  const codeDef = registry.require("code-block");
  const codeNode = (id: NodeId, source: string, language = "ts") => {
    const data = codeDef.normalizeData({ code: source, language }).data;
    return makeObjectNode({
      baked: codeDef.bake?.(data) ?? undefined,
      data,
      id,
      status: "ready",
      type: "code-block",
    });
  };

  it("reports a code/language field change through the resolver", () => {
    const id = alloc.createNodeId();
    const base = doc([codeNode(id, "const x = 1;")]);
    const target = doc([codeNode(id, "const x = 2;", "js")]);
    const diff = diffSnapshots(base, target, {
      getNodeDefinition: nodeDiffResolver(),
    });
    const block = diff.blocks.find((b) => b.id === id);
    expect(block?.status).toBe("changed");
    const fields = block?.object?.fields ?? [];
    const code = fields.find((f) => f.path === "code");
    const lang = fields.find((f) => f.path === "language");
    expect(code?.base).toBe("const x = 1;");
    expect(code?.target).toBe("const x = 2;");
    expect(lang?.base).toBe("ts");
    expect(lang?.target).toBe("js");
  });

  it("still reports the block changed without the seam, but with no field detail", () => {
    const id = alloc.createNodeId();
    const base = doc([codeNode(id, "const x = 1;")]);
    const target = doc([codeNode(id, "const x = 2;")]);
    const diff = diffSnapshots(base, target); // no getNodeDefinition
    const block = diff.blocks.find((b) => b.id === id);
    expect(block?.status).toBe("changed");
    expect(block?.object?.fields).toBeUndefined();
  });
});
