import type { Story, StoryDefault } from "@ladle/react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  OwnedModelEditor,
  OwnedModelEditorView,
  bakeObjectData,
  createDefaultBlockRegistry,
  createEditorStore,
  createEditorStoreFromCompat,
  createIdAllocator,
  makeObjectNode,
  makeStructuralNode,
  makeTextNode,
  registerToolbarAction,
  registerToolbarSlot,
  registerToolbarTab,
  type BlockRegistry,
  type EditorDocumentSnapshot,
  type EditorNode,
  type IdAllocator,
  type JsonValue,
  type NodeId,
  type ObjectNode,
  type OwnedModelEditorViewHandle,
  type TextLeafNode,
  type UploadImage,
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

// Mixed-direction (bidi) paragraphs: Latin + Hebrew + Latin, and a Latin +
// Arabic run. The caret affinity at the RTL boundaries (docs/018 §2.9) is the
// dedicated cross-browser target driven by tests/e2e/engine-bidi.spec.ts.
function createBidiStore() {
  const allocator = createIdAllocator("idco_client_bidi");
  const paragraph = (text: string) =>
    makeTextNode({
      content: allocator.createTextSlice(text),
      id: allocator.createNodeId(),
      type: "paragraph",
    });
  const blocks = [
    paragraph("Start שלום עולם end"),
    paragraph("Read مرحبا now"),
  ];
  const snapshot: EditorDocumentSnapshot = {
    body: {
      blocks: Object.fromEntries(blocks.map((n) => [n.id, n])) as Record<
        NodeId,
        EditorNode
      >,
      order: blocks.map((n) => n.id),
    },
    settings: { story: "owned-model-bidi" },
    version: 1,
  };
  return createEditorStore({ allocator, snapshot });
}

export const BidiCaret: Story = () => {
  const store = useMemo(() => createBidiStore(), []);
  const viewRef = useRef<OwnedModelEditorViewHandle | null>(null);

  return (
    <OwnedModelStoryFrame
      store={store}
      viewRef={viewRef}
      viewportHeight={PHASE5_VIEWPORT}
      virtualize={false}
    />
  );
};

/**
 * Phase 8 AC3 — a paragraph whose text carries overlapping bold/italic and a
 * link mark, so the leaf renders as many DOM text nodes across semantic mark
 * elements. The e2e drives caret/selection across that formatted run to prove
 * the offset↔DOM geometry stays correct over split spans.
 */
export const Phase8FormattedRun: Story = () => {
  const store = useMemo(() => createFormattedRunStore(), []);
  const viewRef = useRef<OwnedModelEditorViewHandle | null>(null);

  return (
    <OwnedModelStoryFrame store={store} viewRef={viewRef} virtualize={false} />
  );
};

/**
 * Phase 8 — the full opt-in editor (toolbar + find) over a seeded document,
 * exposing the view diagnostics so the e2e can drive the toolbar and assert the
 * commands land on the model.
 */
export const Phase8ToolbarEditor: Story = () => {
  const store = useMemo(() => createFormattedRunStore(), []);
  return (
    <OwnedModelEditor
      diagnosticsKey={ENGINE_VIEW_API_KEY}
      forcePolyfill
      store={store}
      virtualize={false}
    />
  );
};

// --- Toolbar SPI demo (docs/023 §5.8) ---------------------------------------
// The consumer's extension path: the framework ships the Home + Insert built-ins,
// and a host adds to the ribbon by *registering descriptors* — no edit to the
// editor. Here the demo registers a whole new "Tools" tab with a slot and an action
// that inserts a star at the caret, the same contract as `registerNode`/`registerMark`.
// Tabs/slots/actions are a global registry (a custom *tab* cannot be scoped through
// the per-instance `layout` prop), so registration is done in a `useState`
// initializer — it runs during this story's first render, before the child editor's
// toolbar renders, and only when this story is actually opened (not at bundle load),
// keeping it out of the other editor stories until then.
function registerToolsTab(): void {
  registerToolbarTab({ id: "tools", label: "Tools", order: 10 });
  registerToolbarSlot({ id: "tools.insert", order: 0, tab: "tools" });
  registerToolbarAction({
    icon: "Plus",
    id: "tools.insert-star",
    kind: "button",
    label: "Insert star",
    run: (ctx) => ctx.store.command({ text: "★", type: "insert-text" }),
    slot: "tools.insert",
  });
}

/**
 * docs/023 — the toolbar SPI. The same seeded editor as Phase8, but a "Tools" tab
 * (registered through `registerToolbarTab`/`registerToolbarSlot`/
 * `registerToolbarAction`) now appears in the ribbon alongside Home and Insert,
 * proving a host extends the toolbar by registration alone.
 */
export const Phase8ToolbarSpiDemo: Story = () => {
  const store = useMemo(() => createFormattedRunStore(), []);
  useState(() => {
    registerToolsTab();
    return null;
  });
  return <OwnedModelEditor forcePolyfill store={store} virtualize={false} />;
};

export const Phase6MixedBook: Story = () => {
  const store = useMemo(() => createMixedBookStore(), []);
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

export const Phase7RaggedLines: Story = () => {
  const store = useMemo(() => createRaggedLinesStore(), []);
  const viewRef = useRef<OwnedModelEditorViewHandle | null>(null);

  // A non-virtualized surface so the multiline blocks render their full height;
  // vertical caret navigation must hold a goal column across the ragged lines.
  return (
    <OwnedModelStoryFrame store={store} viewRef={viewRef} virtualize={false} />
  );
};

/**
 * docs/019 Phase 2/3 — positional editing. A divider (an atom) is the FIRST and
 * LAST block, with a paragraph between two dividers: the configuration where the
 * caret could not previously rest above the first object, between two stacked
 * objects, or below the last one. Drives the gap cursor (paint, click, arrow,
 * materialize) and the mid-text split insert. The full editor is used so the
 * Insert (+) menu is available for the split path.
 */
export const Phase019GapCursor: Story = () => {
  const store = useMemo(() => createGapCursorStore(), []);
  // Expose the store so the e2e can drive a positional insert (split) directly,
  // the same `insert-object` command the toolbar dispatches.
  useEffect(() => {
    (window as unknown as Record<string, unknown>)["__IDCO_GAP_STORE__"] =
      store;
    return () => {
      delete (window as unknown as Record<string, unknown>)[
        "__IDCO_GAP_STORE__"
      ];
    };
  }, [store]);
  return (
    <OwnedModelEditor
      diagnosticsKey={ENGINE_VIEW_API_KEY}
      forcePolyfill
      store={store}
      uploadImage={fakeGapUpload}
      virtualize={false}
    />
  );
};

// A fake host upload binding so the image block's "Upload" affordance is present
// to dogfood (the engine never owns transport — docs/016 §9). Without a binding
// the Upload button is intentionally hidden, not broken.
const fakeGapUpload: UploadImage = async (file) => {
  await new Promise((resolve) => setTimeout(resolve, 150));
  return { alt: file.name, src: `/uploads/${file.name}` };
};

/**
 * docs/019 repro: atoms (media/embed) then a structural callout as the last
 * block. The callout is a container, so it nests block children — a lead
 * paragraph plus a bulleted list, the shape the old text-leaf callout could not
 * hold. A body gap opens after the trailing container (arrow-down / click below).
 */
export const Phase019CalloutTail: Story = () => {
  const store = useMemo(() => {
    const allocator = createIdAllocator("idco_client_phase019_callout");
    const registry = createDefaultBlockRegistry();
    const p = makeTextNode({
      content: allocator.createTextSlice("A leading paragraph."),
      id: allocator.createNodeId(),
      type: "paragraph",
    });
    const media = objectNode(allocator, registry, "media", {
      alt: "",
      caption: "",
      src: "",
    });
    const embed = objectNode(allocator, registry, "embed", { url: "" });
    const calloutLead = makeTextNode({
      content: allocator.createTextSlice("A callout at the very bottom."),
      id: allocator.createNodeId(),
      type: "paragraph",
    });
    const calloutItem1 = makeTextNode({
      attrs: { listType: "bullet" },
      content: allocator.createTextSlice("with a list inside it"),
      id: allocator.createNodeId(),
      type: "listitem",
    });
    const calloutItem2 = makeTextNode({
      attrs: { listType: "bullet" },
      content: allocator.createTextSlice(
        "which the old callout could not hold",
      ),
      id: allocator.createNodeId(),
      type: "listitem",
    });
    const callout = makeStructuralNode({
      attrs: { tone: "info" },
      children: [calloutLead.id, calloutItem1.id, calloutItem2.id],
      id: allocator.createNodeId(),
      type: "callout",
    });
    const topLevel: EditorNode[] = [p, media, embed, callout];
    const allBlocks: EditorNode[] = [
      ...topLevel,
      calloutLead,
      calloutItem1,
      calloutItem2,
    ];
    return createEditorStore({
      allocator,
      registry,
      snapshot: {
        body: {
          blocks: Object.fromEntries(allBlocks.map((n) => [n.id, n])) as Record<
            NodeId,
            EditorNode
          >,
          order: topLevel.map((n) => n.id),
        },
        settings: {},
        version: 1,
      },
    });
  }, []);
  return (
    <OwnedModelEditor
      diagnosticsKey={ENGINE_VIEW_API_KEY}
      forcePolyfill
      store={store}
      virtualize={false}
    />
  );
};

function createGapCursorStore() {
  const allocator = createIdAllocator("idco_client_phase019_gap");
  const registry = createDefaultBlockRegistry();
  const paragraph = (text: string) =>
    makeTextNode({
      content: allocator.createTextSlice(text),
      id: allocator.createNodeId(),
      type: "paragraph",
    });
  const topDivider = objectNode(allocator, registry, "divider", {});
  const middle = paragraph(
    "A paragraph between two dividers; helloworld marks a mid-split point.",
  );
  const bottomDivider = objectNode(allocator, registry, "divider", {});
  const blocks: EditorNode[] = [topDivider, middle, bottomDivider];
  const snapshot: EditorDocumentSnapshot = {
    body: {
      blocks: Object.fromEntries(blocks.map((n) => [n.id, n])) as Record<
        NodeId,
        EditorNode
      >,
      order: blocks.map((n) => n.id),
    },
    settings: { story: "phase019-gap-cursor" },
    version: 1,
  };
  return createEditorStore({ allocator, snapshot, registry });
}

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
  // A small, mixed document for structural editing: paragraphs, a heading, a
  // bulleted list, an ordered list, AND a structural (nested) list. Two list
  // shapes coexist on purpose:
  //  - Flat-by-design lists (docs/018 §2.10): each item is a top-level `listitem`
  //    text leaf carrying a `listType` (bullet/number); the ordered run is numbered
  //    by the view's render-time ordinal pass. This is the authoring/import shape.
  //  - A structural `list` container over `listitem` children (one nesting a
  //    sublist): the engine renders it recursively (docs/018 §2.11) — nothing under
  //    a structural node is a placeholder. Kept visible so the capability is real.
  const allocator = createIdAllocator("idco_client_phase55_story");
  const paragraph = (text: string, type: TextLeafNode["type"] = "paragraph") =>
    makeTextNode({
      content: allocator.createTextSlice(text),
      id: allocator.createNodeId(),
      type,
    });
  const listItem = (text: string, listType: "bullet" | "number") =>
    makeTextNode({
      attrs: { listType },
      content: allocator.createTextSlice(text),
      id: allocator.createNodeId(),
      type: "listitem",
    });
  const intro = paragraph("Phase 5.5 editing surface", "heading");
  const first = paragraph(
    "The quick brown fox jumps over the lazy dog near the river bank.",
  );
  const second = paragraph(
    "Press Enter to split this paragraph, Backspace at the start to merge.",
  );
  const bullets = ["First item", "Second item", "Third item"].map((t) =>
    listItem(t, "bullet"),
  );
  const stepsHeading = paragraph("Steps to reproduce");
  const steps = ["Open the editor", "Type a list", "Toggle ordered"].map((t) =>
    listItem(t, "number"),
  );
  // A *structural* list (a `list` container over `listitem` children, one item
  // nesting a sublist) — the genuine multi-block-container shape. The engine
  // renders it recursively: nothing under a structural node is a placeholder
  // (docs/018 §2.11). Kept on purpose so the capability is visible, not hidden.
  const nestedHeading = paragraph("Nested (structural) list");
  const nestedLeaf = listItem("Deeply nested item", "bullet");
  const subList = makeStructuralNode({
    children: [nestedLeaf.id],
    id: allocator.createNodeId(),
    type: "list",
  });
  const parentLeaf = listItem("Parent with a sublist", "bullet");
  const parentItem = makeStructuralNode({
    children: [parentLeaf.id, subList.id],
    id: allocator.createNodeId(),
    type: "listitem",
  });
  const siblingLeaf = listItem("Sibling structural item", "bullet");
  const structuralList = makeStructuralNode({
    children: [siblingLeaf.id, parentItem.id],
    id: allocator.createNodeId(),
    type: "list",
  });
  const tail = paragraph("A closing paragraph after the list.");
  const topLevel: EditorNode[] = [
    intro,
    first,
    second,
    ...bullets,
    stepsHeading,
    ...steps,
    nestedHeading,
    structuralList,
    tail,
  ];
  // The structural list's descendants live in `blocks` but not the top-level
  // `order` — the engine reaches them through the container's `children`.
  const descendants: EditorNode[] = [
    siblingLeaf,
    parentItem,
    parentLeaf,
    subList,
    nestedLeaf,
  ];
  const snapshot: EditorDocumentSnapshot = {
    body: {
      blocks: Object.fromEntries(
        [...topLevel, ...descendants].map((n) => [n.id, n]),
      ) as Record<NodeId, EditorNode>,
      order: topLevel.map((n) => n.id),
    },
    settings: { phase: "5.5", story: "owned-model-editing" },
    version: 1,
  };
  return createEditorStore({ allocator, snapshot });
}

function objectNode(
  allocator: IdAllocator,
  registry: BlockRegistry,
  type: string,
  rawData: JsonValue,
): ObjectNode {
  // Normalize through the registry (so code-block data gets its piece table) and
  // pre-bake, so the resting block mounts its static snapshot from the first frame.
  const normalized = registry.normalizeSnapshotObject(type, rawData);
  const baked = bakeObjectData(registry, type, normalized.data);
  return makeObjectNode({
    baked: baked.baked ?? undefined,
    data: normalized.data,
    id: allocator.createNodeId(),
    status: baked.status,
    type,
  });
}

function createFormattedRunStore() {
  // A paragraph with overlapping bold/italic plus a link, imported through compat
  // so the marks render as nested semantic elements (Phase 8 AC3).
  return createEditorStoreFromCompat({
    root: {
      children: [
        {
          children: [
            { format: 0, text: "plain ", type: "text" },
            { format: 1, text: "bold", type: "text" },
            { format: 3, text: "bolditalic", type: "text" },
            { format: 0, text: " then ", type: "text" },
            {
              children: [{ format: 0, text: "a link", type: "text" }],
              type: "link",
              url: "https://idco.dev",
            },
            { format: 0, text: " end", type: "text" },
          ],
          type: "paragraph",
        },
      ],
    },
  });
}

function createMixedBookStore() {
  // A live-book page: prose interleaved with heavy objects. Each object rests as
  // a baked snapshot and edits as a single live surface (docs/010 Phase 6).
  const allocator = createIdAllocator("idco_client_phase6_story");
  const registry = createDefaultBlockRegistry();
  const text = (value: string, type: TextLeafNode["type"] = "paragraph") =>
    makeTextNode({
      content: allocator.createTextSlice(value),
      id: allocator.createNodeId(),
      type,
    });
  const heading = (value: string) =>
    makeTextNode({
      attrs: { tag: "h2" },
      content: allocator.createTextSlice(value),
      id: allocator.createNodeId(),
      type: "heading",
    });

  const topLevel: EditorNode[] = [
    heading("Phase 6 — heavy objects, baked at rest"),
    text(
      "Objects below rest as baked static snapshots. Click one to edit it live; only one object is live at a time.",
    ),
    objectNode(allocator, registry, "code-block", {
      code: "function greet(name) {\n  return `Hello, ${name}!`;\n}",
      language: "ts",
    }),
    text(
      "A media block bakes from its source; clearing the source makes it unbakeable.",
    ),
    objectNode(allocator, registry, "media", {
      alt: "Diagram",
      caption: "A baked media block",
      src: "https://example.com/diagram.png",
    }),
    heading("Second section"),
    text("An embed block resting baked, activatable through its config panel."),
    objectNode(allocator, registry, "embed", {
      title: "Reference embed",
      url: "https://example.com/embed",
    }),
  ];
  const snapshot: EditorDocumentSnapshot = {
    body: {
      blocks: Object.fromEntries(topLevel.map((n) => [n.id, n])) as Record<
        NodeId,
        EditorNode
      >,
      order: topLevel.map((n) => n.id),
    },
    settings: { phase: "6", story: "owned-model-mixed-book" },
    version: 1,
  };
  return createEditorStore({ allocator, registry, snapshot });
}

function createRaggedLinesStore() {
  // One block of deliberately ragged visual lines (rendered via pre-wrap `\n`):
  // a long line, a short line, then a long line. Goal-column navigation must let
  // ArrowDown from a column on the first long line land near that same column on
  // the third line, instead of sticking at the short middle line's end (AC7).
  const allocator = createIdAllocator("idco_client_phase7_story");
  const long1 = "The quick brown fox jumps over the lazy dog by the riverbank.";
  const short = "Short.";
  const long2 =
    "Pack my box with five dozen liquor jugs before the long night.";
  const block = makeTextNode({
    content: allocator.createTextSlice(`${long1}\n${short}\n${long2}`),
    id: allocator.createNodeId(),
  });
  const tail = makeTextNode({
    content: allocator.createTextSlice("A trailing paragraph after the block."),
    id: allocator.createNodeId(),
  });
  const blocks = [block, tail];
  const snapshot: EditorDocumentSnapshot = {
    body: {
      blocks: Object.fromEntries(blocks.map((n) => [n.id, n])) as Record<
        NodeId,
        EditorNode
      >,
      order: blocks.map((n) => n.id),
    },
    settings: { phase: "7", story: "owned-model-ragged-lines" },
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
