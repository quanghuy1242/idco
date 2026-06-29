// docs/034 HPC-2 — the outline-rail proof case for the Tier 1 dock placement seam.
//
// Two stories exercise the two placement shapes against a virtualized document:
// `PortalIntoHostSidebar` portals the dock into a host-owned left column
// (`dockContainer`), and `FramedByHost` wraps it in host markup while it stays a sibling
// of the surface (`renderDock`). Both keep the same wired dock the editor drives: the
// Outline pane lists headings live, clicking one scrolls the (possibly windowed-out) block
// into view, and a host-placed Find button reaches the authority-owned find bar — the
// anchored-vs-layout line (docs/034 §5) holding across the seam.
import type { Story, StoryDefault } from "@ladle/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  OwnedModelEditor,
  createEditorStore,
  createIdAllocator,
  makeTextNode,
  type EditorNode,
  type OwnedModelEditorHandle,
} from "../packages/editor/src";

export default {
  title: "Engine / Host-Placed Chrome",
} satisfies StoryDefault;

// A long, heading-rich document so the Outline pane has entries and virtualization windows
// out the deep headings (the jump-to-anchor `reveal` must reach them, docs/034 §12).
function createOutlineStore() {
  const allocator = createIdAllocator("idco_client_hpc_story");
  const text = (value: string) =>
    makeTextNode({
      content: allocator.createTextSlice(value),
      id: allocator.createNodeId(),
    });
  const heading = (value: string) =>
    makeTextNode({
      attrs: { tag: "h2" },
      content: allocator.createTextSlice(value),
      id: allocator.createNodeId(),
      type: "heading",
    });
  const nodes: EditorNode[] = [];
  for (let s = 1; s <= 10; s += 1) {
    nodes.push(heading(`Section ${s}`));
    for (let p = 1; p <= 5; p += 1) {
      nodes.push(
        text(
          `Section ${s}, paragraph ${p}. The Outline rail lives in the host's own layout; click a heading to jump here even when it is scrolled out of the virtual window.`,
        ),
      );
    }
  }
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

// Open the Outline pane after mount so the rail is visible on load. A frame's delay lets
// the editor handle attach and (for the portal story) the host sidebar ref resolve.
function useOpenOutline(ref: React.RefObject<OwnedModelEditorHandle | null>) {
  useEffect(() => {
    const id = requestAnimationFrame(() => ref.current?.openPanel("outline"));
    return () => cancelAnimationFrame(id);
  }, [ref]);
}

const hostBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 12px",
  borderBottom: "1px solid var(--color-base-300, #e5e7eb)",
};

/** Tier 1 escape hatch: the dock portaled into a host-owned sidebar column. */
export const PortalIntoHostSidebar: Story = () => {
  const store = useMemo(createOutlineStore, []);
  const ref = useRef<OwnedModelEditorHandle | null>(null);
  // Drive the portal target from state (a callback ref): render-pure, tracks mount/unmount.
  const [sidebar, setSidebar] = useState<HTMLDivElement | null>(null);
  useOpenOutline(ref);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "85vh" }}>
      {/* Host chrome the editor does not own: a top bar with a host Find button. */}
      <div style={hostBarStyle}>
        <strong style={{ fontSize: 13 }}>Host top bar</strong>
        <button onClick={() => ref.current?.openFind()} type="button">
          Find (host-placed)
        </button>
      </div>
      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "auto 1fr",
          minHeight: 0,
          flex: 1,
          padding: 16,
        }}
      >
        {/* The host-owned sidebar the dock portals into. */}
        <aside
          ref={setSidebar}
          style={{ display: "flex", minHeight: 0, alignItems: "stretch" }}
        />
        <div style={{ display: "flex", minWidth: 0, minHeight: 0 }}>
          <OwnedModelEditor
            dockContainer={sidebar}
            fillHeight
            ref={ref}
            store={store}
          />
        </div>
      </div>
    </div>
  );
};

/** Tier 1 primary: the dock wrapped in host markup, still a sibling of the surface. */
export const FramedByHost: Story = () => {
  const store = useMemo(createOutlineStore, []);
  const ref = useRef<OwnedModelEditorHandle | null>(null);
  useOpenOutline(ref);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "85vh" }}>
      <div style={hostBarStyle}>
        <strong style={{ fontSize: 13 }}>Host top bar</strong>
        <button onClick={() => ref.current?.openFind()} type="button">
          Find (host-placed)
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: 16 }}>
        <OwnedModelEditor
          fillHeight
          ref={ref}
          renderDock={(dock) => (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                marginInlineStart: 4,
              }}
            >
              <div style={{ fontSize: 11, opacity: 0.6, padding: "0 4px 4px" }}>
                Host frame around the editor's dock
              </div>
              {dock}
            </div>
          )}
          store={store}
        />
      </div>
    </div>
  );
};
