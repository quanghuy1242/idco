import type { Story, StoryDefault } from "@ladle/react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  OwnedModelEditorView,
  createEditorStore,
  createIdAllocator,
  makeStructuralNode,
  makeTextNode,
  type EditorDocumentSnapshot,
  type EditorNode,
  type NodeId,
  type OwnedModelEditorViewHandle,
  type TextLeafNode,
} from "../packages/editor/src";

export default {
  title: "Engine / Owned Model",
} satisfies StoryDefault;

const PHASE4_BLOCKS = 300;
const PHASE5_BLOCKS = 5000;
const PHASE5_VIEWPORT = 480;
const ENGINE_VIEW_API_KEY = "__IDCO_ENGINE_VIEW_API__";
const INPUT_MODE_PARAM = "engineInput";

type OwnedModelInputMode = "polyfill" | "native";

const DEFAULT_INPUT_MODE: OwnedModelInputMode = "polyfill";
const NEXT_INPUT_MODE: Record<OwnedModelInputMode, OwnedModelInputMode> = {
  native: "polyfill",
  polyfill: "native",
};
const APPLY_INPUT_MODE_PARAM: Record<
  OwnedModelInputMode,
  (params: URLSearchParams) => void
> = {
  native: (params) => params.set(INPUT_MODE_PARAM, "native"),
  polyfill: (params) => params.delete(INPUT_MODE_PARAM),
};

export const Phase4300Blocks: Story = () => {
  const store = useMemo(() => createPhase4Store(PHASE4_BLOCKS), []);
  const viewRef = useRef<OwnedModelEditorViewHandle | null>(null);

  return (
    <OwnedModelStoryFrame store={store} viewRef={viewRef} virtualize={false} />
  );
};

export const Phase55000Blocks: Story = () => {
  const store = useMemo(() => createEngineStore(PHASE5_BLOCKS, "5"), []);
  const viewRef = useRef<OwnedModelEditorViewHandle | null>(null);

  return (
    <OwnedModelStoryFrame
      store={store}
      viewRef={viewRef}
      viewportHeight={PHASE5_VIEWPORT}
      virtualize
    />
  );
};

export const Phase5VariableHeights: Story = () => {
  const store = useMemo(() => createVariableHeightStore(PHASE5_BLOCKS), []);
  const viewRef = useRef<OwnedModelEditorViewHandle | null>(null);

  return (
    <OwnedModelStoryFrame
      store={store}
      viewRef={viewRef}
      viewportHeight={PHASE5_VIEWPORT}
      virtualize
    />
  );
};

export const Phase55Editing: Story = () => {
  const store = useMemo(() => createEditingStore(), []);
  const viewRef = useRef<OwnedModelEditorViewHandle | null>(null);

  return (
    <OwnedModelStoryFrame
      store={store}
      viewRef={viewRef}
      viewportHeight={PHASE5_VIEWPORT}
      virtualize
    />
  );
};

function OwnedModelStoryFrame(props: {
  readonly store: ReturnType<typeof createEditorStore>;
  readonly viewRef: RefObject<OwnedModelEditorViewHandle | null>;
  readonly viewportHeight?: number;
  readonly virtualize: boolean;
}) {
  const { store, viewRef, viewportHeight, virtualize } = props;
  const mode = ownedModelInputMode();
  const [activeMode, setActiveMode] = useState<OwnedModelInputMode | null>(
    null,
  );

  useEffect(() => {
    const sync = () => {
      const next = viewRef.current?.diagnostics().activeInputBackend ?? null;
      setActiveMode((current) => (current === next ? current : next));
    };
    sync();
    const handle = window.setInterval(sync, 250);
    return () => window.clearInterval(handle);
  }, [viewRef]);

  return (
    <main
      style={{
        background: "Canvas",
        color: "CanvasText",
        minHeight: "100vh",
        padding: 24,
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          gap: 12,
          justifyContent: "center",
          margin: "0 auto 16px",
          maxWidth: 920,
        }}
      >
        <output
          data-engine-active-input-mode={activeMode ?? ""}
          data-engine-input-mode={mode}
          style={{
            color: "color-mix(in srgb, CanvasText 72%, transparent)",
            font: "13px/1.4 ui-sans-serif, system-ui, sans-serif",
          }}
        >
          Requested: {mode} · Active: {activeMode ?? "not focused"}
        </output>
        <button
          data-engine-input-mode-toggle=""
          onClick={() => hardRefreshOwnedModelInputMode(toggleMode(mode))}
          style={{
            border: "1px solid color-mix(in srgb, CanvasText 30%, transparent)",
            borderRadius: 6,
            color: "CanvasText",
            cursor: "pointer",
            font: "13px/1.4 ui-sans-serif, system-ui, sans-serif",
            padding: "6px 10px",
          }}
          type="button"
        >
          Reload in {toggleMode(mode)} mode
        </button>
      </div>
      <OwnedModelEditorView
        diagnosticsKey={ENGINE_VIEW_API_KEY}
        forcePolyfill={mode === "polyfill"}
        ref={viewRef}
        store={store}
        style={{ margin: "0 auto" }}
        viewportHeight={viewportHeight}
        virtualize={virtualize}
      />
    </main>
  );
}

function ownedModelInputMode(): OwnedModelInputMode {
  if (typeof window === "undefined") return DEFAULT_INPUT_MODE;
  const value = new URL(window.location.href).searchParams.get(
    INPUT_MODE_PARAM,
  );
  return value === "native" ? "native" : DEFAULT_INPUT_MODE;
}

function toggleMode(mode: OwnedModelInputMode): OwnedModelInputMode {
  return NEXT_INPUT_MODE[mode];
}

function hardRefreshOwnedModelInputMode(mode: OwnedModelInputMode): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const params = url.searchParams;
  APPLY_INPUT_MODE_PARAM[mode](params);
  window.location.assign(url.toString());
}

function createEditingStore() {
  // A small, mixed document for structural editing: paragraphs, a heading, and
  // a three-item list (a structural `list` over text-leaf `listitem`s).
  const allocator = createIdAllocator("idco_client_phase55_story");
  const paragraph = (text: string, type: TextLeafNode["type"] = "paragraph") =>
    makeTextNode({
      content: allocator.createTextSlice(text),
      id: allocator.createNodeId(),
      type,
    });
  const intro = paragraph("Phase 5.5 editing surface", "heading");
  const first = paragraph(
    "The quick brown fox jumps over the lazy dog near the river bank.",
  );
  const second = paragraph(
    "Press Enter to split this paragraph, Backspace at the start to merge.",
  );
  const items = ["First item", "Second item", "Third item"].map((t) =>
    paragraph(t, "listitem"),
  );
  const list = makeStructuralNode({
    children: items.map((i) => i.id),
    id: allocator.createNodeId(),
    type: "list",
  });
  const tail = paragraph("A closing paragraph after the list.");
  const topLevel: EditorNode[] = [intro, first, second, list, tail];
  const blocks = [...topLevel, ...items];
  const snapshot: EditorDocumentSnapshot = {
    body: {
      blocks: Object.fromEntries(blocks.map((n) => [n.id, n])) as Record<
        NodeId,
        EditorNode
      >,
      order: topLevel.map((n) => n.id),
    },
    settings: { phase: "5.5", story: "owned-model-editing" },
    version: 1,
  };
  return createEditorStore({ allocator, snapshot });
}

function createPhase4Store(blockCount: number) {
  return createEngineStore(blockCount, "4");
}

function createVariableHeightStore(blockCount: number) {
  // Non-uniform block heights: every block wraps to a different number of lines,
  // so the locked estimate is deliberately wrong for most blocks. This stresses
  // scroll-to-block and the window bound on a realistic document, not a grid.
  const allocator = createIdAllocator("idco_client_phase5_variable");
  const nodes: TextLeafNode[] = Array.from(
    { length: blockCount },
    (_value, index) => {
      const lines = 1 + (index % 5);
      const text = Array.from(
        { length: lines },
        (_l, line) =>
          `Block ${index + 1} line ${line + 1}: variable height owned-model leaf with enough words to wrap across the measured viewport width for realistic geometry.`,
      ).join("\n");
      return makeTextNode({
        content: allocator.createTextSlice(text),
        id: allocator.createNodeId(),
        type: index % 9 === 0 ? "heading" : "paragraph",
      });
    },
  );
  const snapshot: EditorDocumentSnapshot = {
    body: {
      blocks: Object.fromEntries(
        nodes.map((node) => [node.id, node]),
      ) as Record<NodeId, TextLeafNode>,
      order: nodes.map((node) => node.id),
    },
    settings: { phase: "5", story: "owned-model-variable-heights" },
    version: 1,
  };
  return createEditorStore({ allocator, snapshot });
}

function createEngineStore(blockCount: number, phase: string) {
  const allocator = createIdAllocator(`idco_client_phase${phase}_story`);
  const nodes: TextLeafNode[] = Array.from(
    { length: blockCount },
    (_value, index) =>
      makeTextNode({
        content: allocator.createTextSlice(
          `Phase ${phase} block ${index + 1}: model owned text leaf for the virtualized engine surface.`,
        ),
        id: allocator.createNodeId(),
      }),
  );
  const snapshot: EditorDocumentSnapshot = {
    body: {
      blocks: Object.fromEntries(
        nodes.map((node) => [node.id, node]),
      ) as Record<NodeId, TextLeafNode>,
      order: nodes.map((node) => node.id),
    },
    settings: { phase, story: `owned-model-${blockCount}-blocks` },
    version: 1,
  };
  return createEditorStore({ allocator, snapshot });
}
