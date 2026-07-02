// @vitest-environment jsdom
/**
 * The R6-I change indicator + object `diffData` seam (docs/036 §5.6/§6.2.1/§6.4, docs/039 R-GI/D8).
 * These assert the pure `changedBlockIds` selector, the `applyReviewIndicators` DOM decoration (a
 * status-hued gutter bar set on changed blocks — incl. a RED bar on a removed block's ghost element —
 * cleared when no longer changed; the vestigial deletion tick is gone), and the code block's `diffData`
 * field-level diff through `nodeDiffResolver`.
 */
import { describe, expect, it } from "vitest";
import {
  applyReviewIndicators,
  changedBlockIds,
  createDefaultBlockRegistry,
  createIdAllocator,
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

describe("applyReviewIndicators (DOM decoration, docs/036 §6.2.1, docs/039 R-GI/D8)", () => {
  it("marks changed/added/removed blocks (a removed block's ghost gets the red bar), clears stale", () => {
    const a = "idco_node_a";
    const b = "idco_node_b";
    const d = "idco_node_d";
    const gone = "idco_node_gone"; // a removed block's GHOST element (docs/039 R-RO)
    const root = document.createElement("div");
    for (const id of [a, b, d, gone]) {
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
      { id: gone, status: "removed" }, // has a live ghost element → gets the red bar
    ]);
    expect(get(a)).toBe("changed");
    expect(get(d)).toBe("added");
    expect(get(gone)).toBe("removed"); // the ghost carries the removal's red bar, no separate tick
    expect(get(b)).toBeNull(); // unchanged block: no marker

    // Re-apply with a reduced set: a's and gone's markers clear, d stays.
    applyReviewIndicators(root, [{ id: d, status: "added" }]);
    expect(get(a)).toBeNull();
    expect(get(gone)).toBeNull();
    expect(get(d)).toBe("added");

    // Empty clears everything; no deletion-tick attributes are ever set.
    applyReviewIndicators(root, []);
    expect(get(d)).toBeNull();
    expect(
      root.querySelector(
        "[data-engine-review-removed-before],[data-engine-review-removed-after]",
      ),
    ).toBeNull();
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
