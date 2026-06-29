// @vitest-environment jsdom
/**
 * Host-placed editor chrome — the Tier 1 dock placement seam (docs/034 HPC-1 / HPC-2).
 *
 * Proves the §12 invariants that are observable without real layout: a host can wrap the
 * dock in its own markup (`renderDock`) while it stays a sibling of the surface, or portal
 * it into a host element outside the editor (`dockContainer`); the relocated dock is the
 * same wired dock (one wiring path, §9.4) — `panelHost.open` from the editor handle still
 * routes to it; and a host-placed trigger reaches the authority-owned find bar through the
 * passable handle (the find button / find bar split, §5.3). The scroll-to-windowed-heading
 * and no-offset-corruption invariants need real layout and are left to the browser.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createRef, useState, type RefObject } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  createEditorStore,
  createEngineScheduler,
  createIdAllocator,
  makeTextNode,
  type EditorStore,
} from "../../packages/editor/src/core";
import {
  OwnedModelEditor,
  type OwnedModelEditorHandle,
} from "../../packages/editor/src/view";

function build(texts: readonly string[]): EditorStore {
  const allocator = createIdAllocator("idco_client_hpc");
  const nodes = texts.map((text) =>
    makeTextNode({
      content: allocator.createTextSlice(text),
      id: allocator.createNodeId(),
    }),
  );
  return createEditorStore({
    allocator,
    snapshot: {
      body: {
        blocks: Object.fromEntries(nodes.map((n) => [n.id, n])),
        order: nodes.map((n) => n.id),
      },
      settings: {},
      version: 1,
    },
  });
}

/** A non-mobile, polyfilled editor mount that mirrors the chrome test harness. */
function mountEditor(
  store: EditorStore,
  ref: RefObject<OwnedModelEditorHandle | null>,
  extra?: Partial<React.ComponentProps<typeof OwnedModelEditor>>,
) {
  return render(
    <OwnedModelEditor
      forcePolyfill
      ref={ref}
      scheduler={createEngineScheduler({ publishDashboard: false })}
      store={store}
      virtualize={false}
      {...extra}
    />,
  );
}

const DOCK = "[data-engine-side-panel-dock]";

describe("host-placed editor chrome (docs/034 HPC-1)", () => {
  it("renders the dock in its default slot — a sibling of the surface — with no placement props", async () => {
    const store = build(["Alpha", "Beta"]);
    const ref = createRef<OwnedModelEditorHandle>();
    const { container } = mountEditor(store, ref);

    expect(container.querySelector(DOCK)).toBeNull(); // closed → nothing
    await act(async () => ref.current!.openPanel("outline"));

    const body = container.querySelector(
      "[data-engine-editor-body]",
    ) as HTMLElement;
    const dock = container.querySelector(DOCK)!;
    expect(dock).not.toBeNull();
    // Default home: inside the editor body, a sibling of the surface (not nested in it).
    expect(body.contains(dock)).toBe(true);
    expect(
      container.querySelector("[data-engine-surface]")!.contains(dock),
    ).toBe(false);
    expect(within(body).getByText("Outline")).toBeInTheDocument();
  });

  it("renderDock wraps the dock in host markup while it stays inside the editor body", async () => {
    const store = build(["Alpha", "Beta"]);
    const ref = createRef<OwnedModelEditorHandle>();
    const { container } = mountEditor(store, ref, {
      renderDock: (dock) => <div data-host-dock-frame="">{dock}</div>,
    });
    await act(async () => ref.current!.openPanel("outline"));

    const frame = container.querySelector("[data-host-dock-frame]")!;
    const dock = container.querySelector(DOCK)!;
    expect(frame).not.toBeNull();
    expect(frame.contains(dock)).toBe(true); // host wrapper owns the dock
    // The render-prop keeps it in-tree: still inside the editor body.
    expect(
      container.querySelector("[data-engine-editor-body]")!.contains(frame),
    ).toBe(true);
  });

  it("dockContainer portals the dock into a host element outside the editor body, with no double mount", async () => {
    const store = build(["Alpha", "Beta"]);
    const ref = createRef<OwnedModelEditorHandle>();
    function HostLayout() {
      // The host drives the portal target from state (a callback ref) so it stays
      // render-pure and tracks the element mounting — the documented dockContainer shape.
      const [sidebar, setSidebar] = useState<HTMLDivElement | null>(null);
      return (
        <div>
          <div data-host-sidebar="" ref={setSidebar} />
          <OwnedModelEditor
            dockContainer={sidebar}
            forcePolyfill
            ref={ref}
            scheduler={createEngineScheduler({ publishDashboard: false })}
            store={store}
            virtualize={false}
          />
        </div>
      );
    }
    const { container } = render(<HostLayout />);
    await act(async () => ref.current!.openPanel("outline"));

    const sidebar = container.querySelector(
      "[data-host-sidebar]",
    ) as HTMLElement;
    const body = container.querySelector(
      "[data-engine-editor-body]",
    ) as HTMLElement;
    const dock = container.querySelector(DOCK)!;
    expect(dock).not.toBeNull();
    // Relocated into the host element…
    expect(sidebar.contains(dock)).toBe(true);
    // …and NOT also in the default slot (never double-mounted).
    expect(body.contains(dock)).toBe(false);
    // Exactly one dock in the whole tree.
    expect(container.querySelectorAll(DOCK)).toHaveLength(1);
  });

  it("routes panelHost.open from the editor handle to the relocated (portaled) dock", async () => {
    const store = build(["Alpha", "Beta"]);
    const ref = createRef<OwnedModelEditorHandle>();
    function HostLayout() {
      // The host drives the portal target from state (a callback ref) so it stays
      // render-pure and tracks the element mounting — the documented dockContainer shape.
      const [sidebar, setSidebar] = useState<HTMLDivElement | null>(null);
      return (
        <div>
          <div data-host-sidebar="" ref={setSidebar} />
          <OwnedModelEditor
            dockContainer={sidebar}
            forcePolyfill
            ref={ref}
            scheduler={createEngineScheduler({ publishDashboard: false })}
            store={store}
            virtualize={false}
          />
        </div>
      );
    }
    const { container } = render(<HostLayout />);
    const sidebar = container.querySelector(
      "[data-host-sidebar]",
    ) as HTMLElement;

    await act(async () => ref.current!.openPanel("outline"));
    expect(within(sidebar).getByText("Outline")).toBeInTheDocument();

    // Switching panes from the handle re-routes the *relocated* dock, proving it is the
    // same wired dock the editor drives (§9.4), not a detached copy.
    await act(async () => ref.current!.openPanel("insights"));
    expect(within(sidebar).getByText("Insights")).toBeInTheDocument();
    expect(within(sidebar).queryByText("Outline")).toBeNull();

    await act(async () => ref.current!.closePanel());
    expect(sidebar.querySelector(DOCK)).toBeNull();
  });

  it("opens the authority-owned find bar from a host-placed trigger via the passable handle", async () => {
    const store = build(["alpha bravo", "charlie bravo"]);
    const ref = createRef<OwnedModelEditorHandle>();
    function HostChrome() {
      return (
        <div>
          {/* A find trigger the host renders in its OWN chrome, outside the editor. */}
          <button onClick={() => ref.current?.openFind()} type="button">
            Host Find
          </button>
          <OwnedModelEditor
            forcePolyfill
            ref={ref}
            scheduler={createEngineScheduler({ publishDashboard: false })}
            store={store}
            virtualize={false}
          />
        </div>
      );
    }
    const { container } = render(<HostChrome />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Host Find" }));
    });
    // The button (placeable) reached the find bar (authority-owned, not placeable, §5.3).
    const findInput = await screen.findByRole("textbox", { name: "Find" });
    expect(findInput).toBeInTheDocument();
    // The eligibility line (§5) is enforced structurally: there is no placement prop for the
    // find bar, and it renders in the overlay authority's transform-free body portal
    // (`[data-engine-overlay-layer]`, docs/029) — outside the editor subtree entirely, so it
    // can never be relocated by a host dock slot. Anchored surface stays authority-owned.
    const overlayLayer = document.querySelector("[data-engine-overlay-layer]");
    expect(overlayLayer).not.toBeNull();
    expect(overlayLayer!.contains(findInput)).toBe(true);
    expect(container.contains(findInput)).toBe(false);
  });

  it("bypasses host placement on a narrow viewport — the mobile sheet stays editor-owned (A1)", async () => {
    // Force the mobile breakpoint so the dock becomes a self-portaling Drawer; placement
    // must be bypassed (no empty host wrapper, no no-op portal), docs/034 §9.5 / A1.
    // `window.matchMedia` is read-only in jsdom, so stub it on the global.
    vi.stubGlobal("matchMedia", (query: string) => ({
      addEventListener: () => {},
      addListener: () => {},
      dispatchEvent: () => false,
      matches: true,
      media: query,
      onchange: null,
      removeEventListener: () => {},
      removeListener: () => {},
    }));
    try {
      const store = build(["Alpha", "Beta"]);
      const ref = createRef<OwnedModelEditorHandle>();
      const { container } = mountEditor(store, ref, {
        renderDock: (dock) => <div data-host-dock-frame="">{dock}</div>,
      });
      await act(async () => ref.current!.openPanel("outline"));
      // The render-prop is not applied on mobile, so there is no empty host frame box…
      expect(container.querySelector("[data-host-dock-frame]")).toBeNull();
      // …and the dock is not lost: it renders as the editor-owned overlay sheet (the Drawer
      // carries the Outline pane, portaled by React Aria, not into any host slot).
      expect(
        document.querySelector('[data-engine-side-panel="outline"]'),
      ).not.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("the in-tree wrapper renders no dock until a pane opens (no empty dock box)", async () => {
    const store = build(["Alpha"]);
    const ref = createRef<OwnedModelEditorHandle>();
    const { container } = mountEditor(store, ref, {
      renderDock: (dock) => <div data-host-dock-frame="">{dock}</div>,
    });
    // The host wrapper exists, but the dock element renders null while closed.
    expect(container.querySelector("[data-host-dock-frame]")).not.toBeNull();
    expect(container.querySelector(DOCK)).toBeNull();

    await act(async () => ref.current!.openPanel("outline"));
    expect(container.querySelector(DOCK)).not.toBeNull();
    await waitFor(() => expect(container.querySelector(DOCK)).not.toBeNull());
  });
});
