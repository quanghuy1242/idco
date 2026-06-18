import type { Story, StoryDefault } from "@ladle/react";
import { useMemo, useRef } from "react";
import {
  OwnedModelEditorView,
  createEditorStore,
  createIdAllocator,
  makeTextNode,
  type EditorDocumentSnapshot,
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

export const Phase4300Blocks: Story = () => {
  const store = useMemo(() => createPhase4Store(PHASE4_BLOCKS), []);
  const viewRef = useRef<OwnedModelEditorViewHandle | null>(null);

  return (
    <main
      style={{
        background: "Canvas",
        color: "CanvasText",
        minHeight: "100vh",
        padding: 24,
      }}
    >
      <OwnedModelEditorView
        diagnosticsKey={ENGINE_VIEW_API_KEY}
        forcePolyfill
        ref={viewRef}
        store={store}
        style={{ margin: "0 auto" }}
        virtualize={false}
      />
    </main>
  );
};

export const Phase55000Blocks: Story = () => {
  const store = useMemo(() => createEngineStore(PHASE5_BLOCKS, "5"), []);
  const viewRef = useRef<OwnedModelEditorViewHandle | null>(null);

  return (
    <main
      style={{
        background: "Canvas",
        color: "CanvasText",
        minHeight: "100vh",
        padding: 24,
      }}
    >
      <OwnedModelEditorView
        diagnosticsKey={ENGINE_VIEW_API_KEY}
        forcePolyfill
        ref={viewRef}
        store={store}
        style={{ margin: "0 auto" }}
        viewportHeight={PHASE5_VIEWPORT}
        virtualize
      />
    </main>
  );
};

export const Phase5VariableHeights: Story = () => {
  const store = useMemo(() => createVariableHeightStore(PHASE5_BLOCKS), []);
  const viewRef = useRef<OwnedModelEditorViewHandle | null>(null);

  return (
    <main
      style={{
        background: "Canvas",
        color: "CanvasText",
        minHeight: "100vh",
        padding: 24,
      }}
    >
      <OwnedModelEditorView
        diagnosticsKey={ENGINE_VIEW_API_KEY}
        forcePolyfill
        ref={viewRef}
        store={store}
        style={{ margin: "0 auto" }}
        viewportHeight={PHASE5_VIEWPORT}
        virtualize
      />
    </main>
  );
};

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
