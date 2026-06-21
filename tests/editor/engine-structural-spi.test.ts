/**
 * Structural node SPI fixture tests (docs/020 §7.1 R1 acceptance criteria).
 *
 * Prove the structural-container contract end to end without touching the engine
 * dispatcher internals:
 *
 * - the built-in `callout` and `list` structural views are registered with both
 *   halves (live `renderContainer` + resting `renderResting`), and callout offers
 *   an insert affordance whose command is `insert-callout`;
 * - a brand-new synthetic structural node registered once via `registerNode`
 *   ({ structuralView }) is known to the structural registry and renders its
 *   container around the engine-provided children — the whole point of the SPI;
 * - an unregistered structural type resolves to `undefined`, so the dispatcher
 *   falls back to its default stacking container (no crash, no silent skip).
 */
import { createElement } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { NodeId, StructuralNode } from "../../packages/editor/src/core";
import {
  getStructuralView,
  listInsertableStructuralNodes,
  registerNode,
  type StructuralNodeView,
} from "../../packages/editor/src/view";

function structuralNode(type: string, attrs: object = {}): StructuralNode {
  return {
    attrs,
    children: [],
    id: "n1" as NodeId,
    kind: "structural",
    type,
  } as StructuralNode;
}

describe("structural SPI — built-in callout + list (docs/020 §7.1)", () => {
  it("registers both halves of the callout view with an insert command", () => {
    const view = getStructuralView("callout");
    expect(view).toBeDefined();
    expect(typeof view!.renderContainer).toBe("function");
    expect(typeof view!.renderResting).toBe("function");
    expect(view!.insert?.createCommand()).toEqual({ type: "insert-callout" });
  });

  it("registers the list view with both halves", () => {
    const view = getStructuralView("list");
    expect(view).toBeDefined();
    expect(typeof view!.renderContainer).toBe("function");
    expect(typeof view!.renderResting).toBe("function");
  });

  it("lists the callout as an insertable structural node", () => {
    const inserts = listInsertableStructuralNodes();
    expect(inserts.some((entry) => entry.type === "callout")).toBe(true);
  });

  it("renders the callout resting view as a DaisyUI alert around its children", () => {
    const view = getStructuralView("callout")!;
    const { container } = render(
      view.renderResting({
        children: [],
        node: structuralNode("callout"),
        renderListItems: () => null,
        renderSequence: () => createElement("p", { key: "c" }, "callout body"),
      }) as never,
    );
    const aside = container.querySelector("aside");
    expect(aside).not.toBeNull();
    expect(aside!.className).toContain("alert");
    expect(aside!.getAttribute("role")).toBe("note");
    expect(container.textContent).toContain("callout body");
  });

  it("renders the list resting view as a real <ol> for a numbered list", () => {
    const view = getStructuralView("list")!;
    const { container } = render(
      view.renderResting({
        children: [],
        node: structuralNode("list", { listType: "number" }),
        renderListItems: () => createElement("li", { key: "i" }, "item"),
        renderSequence: () => null,
      }) as never,
    );
    expect(container.querySelector("ol")).not.toBeNull();
    expect(container.textContent).toContain("item");
  });
});

describe("structural SPI — a brand-new node via registerNode (docs/020 §4.2)", () => {
  it("registers a structural view and renders its container around children", () => {
    const syntheticView: StructuralNodeView = {
      renderContainer: ({ children }) =>
        createElement("section", { "data-spi": "panel" }, children),
      renderResting: ({ children, renderSequence }) =>
        createElement(
          "section",
          { "data-spi-resting": "true" },
          renderSequence(children),
        ),
      type: "spi-panel",
    };
    registerNode({ structuralView: syntheticView });

    const view = getStructuralView("spi-panel");
    expect(view).toBeDefined();

    const { container } = render(
      view!.renderContainer({
        children: createElement("p", { key: "k" }, "inner"),
        node: structuralNode("spi-panel"),
        registerBlock: () => {},
        store: {} as never,
      }) as never,
    );
    expect(container.querySelector('section[data-spi="panel"]')).not.toBeNull();
    expect(container.textContent).toContain("inner");
  });

  it("returns undefined for an unregistered structural type (default fallback)", () => {
    expect(
      getStructuralView("not-a-registered-structural-type"),
    ).toBeUndefined();
  });
});
