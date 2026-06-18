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
      />
    </main>
  );
};

function createPhase4Store(blockCount: number) {
  const allocator = createIdAllocator("idco_client_phase4_story");
  const nodes: TextLeafNode[] = Array.from(
    { length: blockCount },
    (_value, index) =>
      makeTextNode({
        content: allocator.createTextSlice(
          `Phase 4 block ${index + 1}: model owned text leaf for the React scheduler surface.`,
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
    settings: { phase: "4", story: "owned-model-300-blocks" },
    version: 1,
  };
  return createEditorStore({ allocator, snapshot });
}
