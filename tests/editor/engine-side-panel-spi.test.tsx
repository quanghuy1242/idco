// @vitest-environment jsdom
/**
 * Side Panel SPI + dock (docs/027 §8) — the registry contract, provenance gating,
 * the View→Outline command wiring through the panel host, and the dock's render
 * behavior (one pane visible, closed renders nothing, Outline consumes the index).
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  createEditorStore,
  createIdAllocator,
  makeTextNode,
  type DocumentIndex,
  type EditorStore,
  type NodeId,
} from "../../packages/editor/src/core";
import {
  createDocumentIndexStore,
  type MutableDocumentIndexStore,
} from "../../packages/editor/src/view/controllers/document-index-store";
import {
  buildCommandContext,
  computeToolbarLayout,
  getCommand,
  getSidePanel,
  listSidePanels,
  registerBuiltInBlockTypes,
  registerSidePanel,
  unregisterSidePanel,
  type CommandContext,
  type PanelHost,
  type ToolbarCapabilities,
} from "../../packages/editor/src/view/spi";
import { registerBuiltInMarks } from "../../packages/editor/src/view/render";
import { registerBuiltInNodeViews } from "../../packages/editor/src/view/nodes";
import {
  registerBuiltInCommands,
  SidePanelDock,
} from "../../packages/editor/src/view/chrome";

beforeAll(() => {
  registerBuiltInMarks();
  registerBuiltInBlockTypes();
  registerBuiltInNodeViews();
  registerBuiltInCommands();
});

const CAPS: ToolbarCapabilities = {
  ai: false,
  insertTable: true,
  media: false,
  review: false,
};

function paragraphStore(text: string): EditorStore {
  const allocator = createIdAllocator("idco_client_side_panel");
  const node = makeTextNode({
    content: allocator.createTextSlice(text),
    id: allocator.createNodeId(),
    type: "paragraph",
  });
  return createEditorStore({
    allocator,
    snapshot: {
      body: { blocks: { [node.id]: node }, order: [node.id] },
      settings: {},
      version: 1,
    },
  });
}

/** A no-op panel host that records the last open/toggle, for command-wiring asserts. */
function fakePanelHost(): PanelHost & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    close: () => calls.push("close"),
    open: (id) => calls.push(`open:${id}`),
    toggle: (id) => calls.push(`toggle:${id}`),
  };
}

describe("side-panel registry", () => {
  afterEach(() => {
    unregisterSidePanel("test-a");
    unregisterSidePanel("test-b");
  });

  it("registers, lists in registration order, replaces idempotently, unregisters", () => {
    registerSidePanel({
      iconName: "List",
      id: "test-a",
      render: () => null,
      title: "A",
    });
    registerSidePanel({
      iconName: "List",
      id: "test-b",
      render: () => null,
      title: "B",
    });
    const ids = listSidePanels().map((p) => p.id);
    // Outline (built-in) registered first; the two test panels keep insertion order.
    expect(ids.indexOf("test-a")).toBeLessThan(ids.indexOf("test-b"));

    // Idempotent by id: re-register replaces, never duplicates.
    registerSidePanel({
      iconName: "List",
      id: "test-a",
      render: () => null,
      title: "A2",
    });
    expect(getSidePanel("test-a")?.title).toBe("A2");
    expect(listSidePanels().filter((p) => p.id === "test-a")).toHaveLength(1);

    unregisterSidePanel("test-a");
    expect(getSidePanel("test-a")).toBeUndefined();
  });

  it("ships the built-in Outline pane after registerBuiltInCommands", () => {
    expect(getSidePanel("outline")?.title).toBe("Outline");
  });
});

describe("View → Outline command (docs/027 §8.2)", () => {
  it("places the Outline command in the View tab", () => {
    const layout = computeToolbarLayout(
      buildCommandContext(paragraphStore("x"), CAPS),
    );
    const view = layout.tabs.find((t) => t.id === "view");
    expect(view).toBeDefined();
    const ids = view!.slots.flatMap((s) => s.items.map((i) => i.id));
    expect(ids).toContain("view.outline");
  });

  it("toggles the dock through the panel host (the tab/pane seam)", () => {
    const host = fakePanelHost();
    const ctx: CommandContext = buildCommandContext(
      paragraphStore("x"),
      CAPS,
      host,
    );
    getCommand("view.outline")!.run!(ctx);
    expect(host.calls).toEqual(["toggle:outline"]);
  });

  it("is a no-op when no dock is mounted (panelHost absent)", () => {
    const ctx = buildCommandContext(paragraphStore("x"), CAPS);
    // No panelHost on the context → the optional call must not throw.
    expect(() => getCommand("view.outline")!.run!(ctx)).not.toThrow();
  });
});

const noopReveal = (_: NodeId) => {};

describe("the dock (docs/027 §8.1/§8.3)", () => {
  const host = fakePanelHost();
  let indexStore: MutableDocumentIndexStore;

  function renderDock(open: boolean, activeId: string | null) {
    indexStore = createDocumentIndexStore();
    return render(
      <SidePanelDock
        activeId={activeId}
        capabilities={CAPS}
        indexStore={indexStore}
        onClose={() => {}}
        onSelect={() => {}}
        open={open}
        panelHost={host}
        reveal={noopReveal}
        store={paragraphStore("hello")}
      />,
    );
  }

  it("renders nothing when closed", () => {
    const { container } = renderDock(false, "outline");
    expect(container.querySelector("[data-engine-side-panel-dock]")).toBeNull();
  });

  it("shows exactly one pane body when open", () => {
    const { container } = renderDock(true, "outline");
    expect(
      container.querySelector("[data-engine-side-panel-dock]"),
    ).not.toBeNull();
    const bodies = container.querySelectorAll("[data-engine-side-panel]");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.getAttribute("data-engine-side-panel")).toBe("outline");
  });

  it("hides a pane whose isAvailable is false (provenance gating)", () => {
    registerSidePanel({
      iconName: "List",
      id: "gated",
      isAvailable: () => false,
      render: () => <div data-testid="gated-body" />,
      title: "Gated",
    });
    try {
      const { container } = renderDock(true, "gated");
      // The gated pane is filtered, so the dock falls back to the first available
      // pane (outline), never the gated one.
      const active = container
        .querySelector("[data-engine-side-panel]")
        ?.getAttribute("data-engine-side-panel");
      expect(active).toBe("outline");
      expect(container.querySelector("[data-testid='gated-body']")).toBeNull();
    } finally {
      unregisterSidePanel("gated");
    }
  });

  it("Outline lists headings from the live document index and jumps on click", () => {
    const index: DocumentIndex = {
      collections: {},
      comments: [],
      text: [],
      toc: [
        {
          anchor: "h1",
          id: "h1" as NodeId,
          level: 1,
          slug: "intro",
          text: "Intro",
        },
        {
          anchor: "h2",
          id: "h2" as NodeId,
          level: 2,
          slug: "details",
          text: "Details",
        },
      ],
    };
    const jumps: NodeId[] = [];
    indexStore = createDocumentIndexStore(index);
    const { container, getByText } = render(
      <SidePanelDock
        activeId="outline"
        capabilities={CAPS}
        indexStore={indexStore}
        onClose={() => {}}
        onSelect={() => {}}
        open
        panelHost={host}
        reveal={(id) => jumps.push(id)}
        store={paragraphStore("hello")}
      />,
    );
    expect(getByText("Intro")).toBeTruthy();
    (getByText("Details") as HTMLButtonElement).click();
    expect(jumps).toEqual(["h2"]);
    expect(
      container.querySelector("nav[aria-label='Document outline']"),
    ).not.toBeNull();
  });
});
