/**
 * Node SPI fixture tests (docs/016 §11, docs/017 §3.2 DoD).
 *
 * Prove the node contract end to end without touching any view internals:
 *
 * - the `divider` worked example (docs/016 §8) imports, bakes, renders at rest
 *   through its registered NodeView, and round-trips the compat boundary;
 * - a brand-new synthetic node registered once via `registerNode` is known to
 *   the core block registry (compat + bake) and to the view registry, with a
 *   working resting render — the whole point of the SPI.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  bakeObjectData,
  compatFromEditorStore,
  createDefaultBlockRegistry,
  createEditorStoreFromCompat,
  type NodeDefinition,
  type RichTextCompatDocument,
} from "../../packages/editor/src/core";
import { getNodeView, registerNode } from "../../packages/editor/src/view";

function objectNodesOf(store: ReturnType<typeof createEditorStoreFromCompat>) {
  return store.order
    .map((id) => store.getNode(id))
    .filter((node) => node?.kind === "object");
}

describe("node SPI — divider built-in (docs/016 §8)", () => {
  const doc: RichTextCompatDocument = {
    root: { children: [{ type: "divider" }] },
  };

  it("imports as an object node, bakes, and round-trips compat", () => {
    const store = createEditorStoreFromCompat(doc);
    const objects = objectNodesOf(store);
    expect(objects).toHaveLength(1);
    expect(objects[0]!.type).toBe("divider");

    const registry = createDefaultBlockRegistry();
    const baked = bakeObjectData(registry, "divider", {});
    expect(baked.status).toBe("ready");
    expect(baked.baked?.kind).toBe("divider");

    const out = compatFromEditorStore(store);
    expect(out.root.children[0]?.type).toBe("divider");
  });

  it("has a registered NodeView whose resting render is callable", () => {
    const view = getNodeView("divider");
    expect(view).toBeDefined();
    const node = objectNodesOf(createEditorStoreFromCompat(doc))[0]!;
    const rendered = view!.renderResting({
      baked: { kind: "divider", payload: {} },
      node: node as never,
    });
    expect(rendered).not.toBeNull();
  });
});

describe("node SPI — a brand-new node via registerNode (docs/016 §7)", () => {
  const calloutDefinition: NodeDefinition = {
    bake: (data) => ({ kind: "spi-callout", payload: data }),
    fromCompatNode: (node) => ({
      data: { tone: typeof node.tone === "string" ? node.tone : "info" },
      status: "ready",
    }),
    normalizeData: (value) => ({
      data:
        typeof value === "object" && value !== null
          ? (value as Record<string, never>)
          : {},
      status: "ready",
    }),
    plainText: () => "",
    toCompatNode: (value) => ({ tone: (value.data as { tone?: string }).tone }),
    type: "spi-callout",
  };

  it("registers both halves and works through compat + bake + view", () => {
    registerNode({
      definition: calloutDefinition,
      view: {
        renderResting: ({ baked }) =>
          createElement("aside", { "data-tone": true }, String(baked.kind)),
        type: "spi-callout",
      },
    });

    // Core side: the global registry now knows the custom node, so compat and
    // bake resolve it with no registry threaded by the caller.
    const registry = createDefaultBlockRegistry();
    expect(registry.get("spi-callout")).toBeDefined();

    const store = createEditorStoreFromCompat({
      root: { children: [{ tone: "warning", type: "spi-callout" }] },
    });
    const object = store
      .order!.map((id) => store.getNode(id))
      .find((node) => node?.kind === "object");
    expect(object?.type).toBe("spi-callout");
    expect((object!.data as { tone: string }).tone).toBe("warning");

    const baked = bakeObjectData(registry, "spi-callout", { tone: "warning" });
    expect(baked.status).toBe("ready");
    expect(baked.baked?.kind).toBe("spi-callout");

    const out = compatFromEditorStore(store);
    expect(out.root.children[0]?.tone).toBe("warning");

    // View side: the same registerNode call wired the React half.
    expect(getNodeView("spi-callout")).toBeDefined();
  });

  it("treats a registered object nested in a quote as a block child (W7)", () => {
    registerNode({
      definition: calloutDefinition,
      view: {
        renderResting: ({ baked }) =>
          createElement("aside", null, String(baked.kind)),
        type: "spi-callout",
      },
    });
    // Before W7 the compat `isBlockChild` used a hardcoded built-in object list
    // that excluded custom (and even some built-in) objects, so an object nested
    // in a quote was misread as inline and flattened away. Now it is registry-
    // driven, so the quote imports as a structural container holding the object.
    const store = createEditorStoreFromCompat({
      root: {
        children: [
          {
            children: [{ tone: "warning", type: "spi-callout" }],
            type: "quote",
          },
        ],
      },
    });
    const quote = store
      .order!.map((id) => store.getNode(id))
      .find((node) => node?.kind === "structural" && node.type === "quote");
    expect(quote?.kind).toBe("structural");
    const childIds = quote && quote.kind === "structural" ? quote.children : [];
    const child = childIds
      .map((id) => store.getNode(id))
      .find((node) => node?.kind === "object");
    expect(child?.type).toBe("spi-callout");
  });
});
