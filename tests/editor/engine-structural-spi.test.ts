/**
 * Structural node SPI fixture tests (docs/020 §7.1 R1 acceptance criteria).
 *
 * Prove the structural-container contract end to end without touching the engine
 * dispatcher internals:
 *
 * - the built-in `callout` and `list` structural views are registered with both
 *   halves (live `renderContainer` + resting `renderResting`), and callout offers
 *   an insert affordance whose command is the generic `insert-structural`;
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
// The overlay enumerators are orchestrator-internal (only `react-view` consumes
// them, like `getStructuralView`/`getNodeView`), so they are deep-imported here.
import { listOverlayStructuralViews } from "../../packages/editor/src/view/spi";
import { listOverlayNodeViews } from "../../packages/editor/src/view/spi";
import { listTabHandlers } from "../../packages/editor/src/view/spi";

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
    expect(view!.insert?.createCommand()).toEqual({
      structuralType: "callout",
      type: "insert-structural",
    });
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

describe("overlay SPI — renderOverlay slot (note.md W1)", () => {
  it("registers the table overlay once, on the canonical `table` view only", () => {
    // One pair of portals serves every table, so the overlay rides the canonical
    // `table` view and not the `editor-table` alias — otherwise it mounts twice.
    expect(typeof getStructuralView("table")!.renderOverlay).toBe("function");
    expect(getStructuralView("editor-table")!.renderOverlay).toBeUndefined();
    const types = listOverlayStructuralViews().map((view) => view.type);
    expect(types).toContain("table");
    expect(types).not.toContain("editor-table");
  });

  it("enumerates a custom structural overlay and skips a view without one", () => {
    const withOverlay: StructuralNodeView = {
      renderContainer: ({ children }) => createElement("div", null, children),
      renderOverlay: () =>
        createElement("div", { "data-overlay": "custom" }, "OVERLAY"),
      renderResting: ({ children, renderSequence }) =>
        createElement("div", null, renderSequence(children)),
      type: "spi-overlay-yes",
    };
    const withoutOverlay: StructuralNodeView = {
      renderContainer: ({ children }) => createElement("div", null, children),
      renderResting: ({ children, renderSequence }) =>
        createElement("div", null, renderSequence(children)),
      type: "spi-overlay-no",
    };
    registerNode({ structuralView: withOverlay });
    registerNode({ structuralView: withoutOverlay });

    const types = listOverlayStructuralViews().map((view) => view.type);
    expect(types).toContain("spi-overlay-yes");
    expect(types).not.toContain("spi-overlay-no");

    // The slot is invoked with the orchestrator's args and its node renders.
    const { container } = render(
      getStructuralView("spi-overlay-yes")!.renderOverlay!({
        rootRef: { current: null },
        store: {} as never,
      }) as never,
    );
    expect(container.querySelector('[data-overlay="custom"]')).not.toBeNull();
    expect(container.textContent).toContain("OVERLAY");
  });

  it("enumerates a registered object overlay (no built-in object uses the slot)", () => {
    expect(
      listOverlayNodeViews().some((view) => view.type === "spi-object-overlay"),
    ).toBe(false);
    registerNode({
      view: {
        renderOverlay: () =>
          createElement("div", { "data-overlay": "obj" }, "OBJ"),
        renderResting: () => createElement("div", null, "rest"),
        type: "spi-object-overlay",
      },
    });
    expect(
      listOverlayNodeViews().some((view) => view.type === "spi-object-overlay"),
    ).toBe(true);
  });
});

describe("structural Tab SPI — handleTab slot (note.md VP6)", () => {
  it("registers the table Tab handler once, on the canonical `table` view only", () => {
    // The table claims Tab to walk cells (docs/022 §5); like renderOverlay it
    // rides the canonical `table` view, not the `editor-table` alias, so the
    // handler runs once.
    expect(typeof getStructuralView("table")!.handleTab).toBe("function");
    expect(getStructuralView("editor-table")!.handleTab).toBeUndefined();
    const types = listTabHandlers().map((view) => view.type);
    expect(types).toContain("table");
    expect(types).not.toContain("editor-table");
  });

  it("enumerates a custom Tab handler, skips a view without one, and self-checks", () => {
    // A handler self-checks whether the caret is in its container and returns
    // false otherwise — `text-block` tries each, first true wins, else
    // indent/outdent. Here the custom handler claims Tab only when forward.
    const calls: boolean[] = [];
    const withTab: StructuralNodeView = {
      handleTab: ({ forward }) => {
        calls.push(forward);
        return forward;
      },
      renderContainer: ({ children }) => createElement("div", null, children),
      renderResting: ({ children, renderSequence }) =>
        createElement("div", null, renderSequence(children)),
      type: "spi-tab-yes",
    };
    const withoutTab: StructuralNodeView = {
      renderContainer: ({ children }) => createElement("div", null, children),
      renderResting: ({ children, renderSequence }) =>
        createElement("div", null, renderSequence(children)),
      type: "spi-tab-no",
    };
    registerNode({ structuralView: withTab });
    registerNode({ structuralView: withoutTab });

    const types = listTabHandlers().map((view) => view.type);
    expect(types).toContain("spi-tab-yes");
    expect(types).not.toContain("spi-tab-no");

    const handler = listTabHandlers().find((v) => v.type === "spi-tab-yes")!;
    expect(handler.handleTab({ forward: true, store: {} as never })).toBe(true);
    expect(handler.handleTab({ forward: false, store: {} as never })).toBe(
      false,
    );
    expect(calls).toEqual([true, false]);
  });
});
