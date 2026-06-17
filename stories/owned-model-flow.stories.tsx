// docs/012 Phase 2.5 — multi-block owned-model proof surface. This deliberately
// reuses the Phase 2 EditContext controller for the active text leaf; FlowSpike
// only proves document-flow concerns around that centralized input substrate.

import type { Story, StoryDefault } from "@ladle/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  calculateVirtualRange,
  createTextInputController,
  type OwnedInputDiagnostics,
} from "../packages/editor/src/owned-model/core";

export default {
  title: "Owned Model / Flow Spike",
} satisfies StoryDefault;

const FLOW_KEY = "__IDCO_OWNED_FLOW__";
const FLOW_API_KEY = "__IDCO_OWNED_FLOW_API__";
const UNSUPPORTED_OBJECT_COPY = "[unsupported object]";
const SMALL_ACTIVE_ID = "a";
const LARGE_ACTIVE_ID = "block-3";
const LARGE_BLOCK_COUNT = 1000;
const HUGE_BLOCK_COUNT = 5000;
const LARGE_BLOCK_HEIGHT = 40;
const LARGE_VIEWPORT_HEIGHT = LARGE_BLOCK_HEIGHT * 10;

type FlowTextBlock = {
  readonly id: string;
  readonly kind: "text";
  readonly text: string;
};

type FlowObjectBlock = {
  readonly id: string;
  readonly kind: "object";
  readonly label: string;
  readonly copyText?: string;
  readonly searchText?: string;
};

type FlowBlock = FlowTextBlock | FlowObjectBlock;

type FlowTextPoint = {
  readonly node: string;
  readonly offset: number;
};

type FlowSelection =
  | {
      readonly type: "text";
      readonly anchor: FlowTextPoint;
      readonly focus: FlowTextPoint;
    }
  | { readonly type: "node"; readonly node: string }
  | {
      readonly type: "gap";
      readonly node: string;
      readonly side: "before" | "after";
    };

type FlowDirty = {
  readonly nodes: readonly string[];
  readonly selection: boolean;
  readonly structure: boolean;
};

type FlowDiagnostics = {
  readonly selection: FlowSelection | null;
  readonly mountedIds: readonly string[];
  readonly blockTexts: Record<string, string>;
  readonly copiedText: string;
  readonly pastedText: string;
  readonly searchQuery: string;
  readonly searchHits: readonly string[];
  readonly renderCounts: Record<string, number>;
  readonly dirty: FlowDirty;
  readonly selectionRectCount: number;
  readonly activeLeafId: string;
  readonly activeInputBackend: OwnedInputDiagnostics["inputBackend"] | null;
  readonly activeInputText: string;
  readonly activeInputFocused: boolean;
  readonly activeInputLastEvent: string;
  readonly activeInputRectCount: number;
  readonly totalBlocks: number;
  readonly mountedCount: number;
  readonly virtualScrollOffset: number;
  readonly virtualViewportSize: number;
};

type FlowApi = {
  readonly selectText: (
    anchorNode: string,
    anchorOffset: number,
    focusNode: string,
    focusOffset: number,
  ) => FlowDiagnostics;
  readonly selectNode: (node: string) => FlowDiagnostics;
  readonly selectGap: (
    node: string,
    side: "before" | "after",
  ) => FlowDiagnostics;
  readonly setMiddleMounted: (mounted: boolean) => void;
  readonly copySelection: () => string;
  readonly pasteText: (text: string) => void;
  readonly search: (query: string) => readonly string[];
  readonly toggleActiveMark: () => void;
  readonly diagnostics: () => FlowDiagnostics;
};

type FlowSpikeProps = {
  readonly large?: boolean;
  readonly blockCount?: number;
  readonly forcePolyfill?: boolean;
};

function previewText(text: string): string {
  if (!text) return "(empty)";
  return text.length > 260
    ? `${text.slice(0, 260)}... (${text.length} chars)`
    : text;
}

function diagnosticsText(diagnostics: FlowDiagnostics): string {
  return [
    `Active block: ${diagnostics.activeLeafId}`,
    `Input backend: ${diagnostics.activeInputBackend ?? "(inactive)"}`,
    `Mounted: ${diagnostics.mountedIds.join(", ")}`,
    `Selection: ${diagnostics.selection ? JSON.stringify(diagnostics.selection) : "(none)"}`,
    `Copied text: ${previewText(diagnostics.copiedText)}`,
    `Pasted text: ${previewText(diagnostics.pastedText)}`,
    `Search hits: ${diagnostics.searchHits.join(", ") || "(none)"}`,
  ].join("\n");
}

function smallBlocks(): readonly FlowBlock[] {
  return [
    { id: "a", kind: "text", text: "Alpha active text" },
    { id: "b", kind: "text", text: "Bravo hidden middle" },
    {
      id: "obj",
      kind: "object",
      label: "Schema card",
      copyText: "[Schema card]",
      searchText: "resolver schema adapter",
    },
    { id: "raw", kind: "object", label: "Raw widget" },
    { id: "c", kind: "text", text: "Charlie tail text" },
  ];
}

function largeBlocks(blockCount: number): readonly FlowBlock[] {
  return Array.from({ length: blockCount }, (_, index) => ({
    id: `block-${index}`,
    kind: "text" as const,
    text: `Large block ${index} content`,
  }));
}

function blockCopyText(block: FlowBlock): string {
  if (block.kind === "text") return block.text;
  return block.copyText ?? `${UNSUPPORTED_OBJECT_COPY} ${block.label}`;
}

function blockSearchText(block: FlowBlock): string {
  if (block.kind === "text") return block.text;
  return block.searchText ?? "";
}

function blockIndex(blocks: readonly FlowBlock[], id: string): number {
  return blocks.findIndex((block) => block.id === id);
}

function comparePoints(
  blocks: readonly FlowBlock[],
  left: FlowTextPoint,
  right: FlowTextPoint,
): number {
  const leftIndex = blockIndex(blocks, left.node);
  const rightIndex = blockIndex(blocks, right.node);
  if (leftIndex !== rightIndex) return leftIndex - rightIndex;
  return left.offset - right.offset;
}

function orderedTextSelection(
  blocks: readonly FlowBlock[],
  selection: Extract<FlowSelection, { type: "text" }>,
): { readonly start: FlowTextPoint; readonly end: FlowTextPoint } {
  return comparePoints(blocks, selection.anchor, selection.focus) <= 0
    ? { start: selection.anchor, end: selection.focus }
    : { start: selection.focus, end: selection.anchor };
}

function clampTextOffset(block: FlowBlock | undefined, offset: number): number {
  return block?.kind === "text"
    ? Math.min(Math.max(0, offset), block.text.length)
    : 0;
}

function serializeSelection(
  blocks: readonly FlowBlock[],
  selection: FlowSelection | null,
): string {
  if (!selection) return "";
  if (selection.type === "gap") return "";
  if (selection.type === "node") {
    return blockCopyText(blocks.find((block) => block.id === selection.node)!);
  }

  const { start, end } = orderedTextSelection(blocks, selection);
  const startIndex = blockIndex(blocks, start.node);
  const endIndex = blockIndex(blocks, end.node);
  if (startIndex < 0 || endIndex < 0) return "";

  const chunks: string[] = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    const block = blocks[index];
    if (!block) continue;
    if (block.kind === "object") {
      chunks.push(blockCopyText(block));
      continue;
    }
    const from =
      block.id === start.node ? clampTextOffset(block, start.offset) : 0;
    const to =
      block.id === end.node
        ? clampTextOffset(block, end.offset)
        : block.text.length;
    chunks.push(block.text.slice(from, to));
  }
  return chunks.join("\n");
}

function replaceSelectionWithText(
  blocks: readonly FlowBlock[],
  selection: FlowSelection | null,
  text: string,
): readonly FlowBlock[] {
  if (!selection) return blocks;
  if (selection.type === "gap") {
    const index = blockIndex(blocks, selection.node);
    if (index < 0) return blocks;
    const insertIndex = selection.side === "before" ? index : index + 1;
    return [
      ...blocks.slice(0, insertIndex),
      { id: `paste-${Date.now()}`, kind: "text", text },
      ...blocks.slice(insertIndex),
    ];
  }
  if (selection.type === "node") {
    return blocks.map((block) =>
      block.id === selection.node
        ? { id: block.id, kind: "text", text }
        : block,
    );
  }

  const { start, end } = orderedTextSelection(blocks, selection);
  const startIndex = blockIndex(blocks, start.node);
  const endIndex = blockIndex(blocks, end.node);
  if (startIndex < 0 || endIndex < 0) return blocks;
  const startBlock = blocks[startIndex];
  const endBlock = blocks[endIndex];
  if (!startBlock || startBlock.kind !== "text") return blocks;
  const prefix = startBlock.text.slice(
    0,
    clampTextOffset(startBlock, start.offset),
  );
  const suffix =
    endBlock?.kind === "text"
      ? endBlock.text.slice(clampTextOffset(endBlock, end.offset))
      : "";
  const replacement: FlowTextBlock = {
    id: startBlock.id,
    kind: "text",
    text: `${prefix}${text}${suffix}`,
  };
  return [
    ...blocks.slice(0, startIndex),
    replacement,
    ...blocks.slice(endIndex + 1),
  ];
}

function textPosition(
  textElement: HTMLElement,
  offset: number,
): { readonly node: Text; readonly offset: number } | null {
  const walker = textElement.ownerDocument.createTreeWalker(
    textElement,
    NodeFilter.SHOW_TEXT,
  );
  let remaining = Math.max(0, offset);
  let last: Text | null = null;
  let current = walker.nextNode();
  while (current) {
    if (
      current instanceof Text &&
      !current.parentElement?.closest(
        "[data-owned-trailing-line],[data-owned-caret-probe]",
      )
    ) {
      if (remaining <= current.length) {
        return { node: current, offset: remaining };
      }
      remaining -= current.length;
      last = current;
    }
    current = walker.nextNode();
  }
  return last ? { node: last, offset: last.length } : null;
}

function textOffsetFromPointer(
  textElement: HTMLElement,
  clientX: number,
  clientY: number,
): number {
  const doc = textElement.ownerDocument;
  const point =
    doc.caretPositionFromPoint?.(clientX, clientY) ??
    (() => {
      const range = doc.caretRangeFromPoint?.(clientX, clientY);
      return range
        ? { offset: range.startOffset, offsetNode: range.startContainer }
        : null;
    })();
  if (!point) return textElement.textContent?.length ?? 0;

  let base = 0;
  const walker = doc.createTreeWalker(textElement, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    if (current === point.offsetNode) {
      return (
        base +
        Math.min(Math.max(0, point.offset), current.textContent?.length ?? 0)
      );
    }
    base += current.textContent?.length ?? 0;
    current = walker.nextNode();
  }
  return point.offsetNode === textElement && point.offset <= 0 ? 0 : base;
}

function appendRect(
  overlay: HTMLElement,
  rootRect: DOMRect,
  rect: DOMRect,
): void {
  if (rect.width <= 0 && rect.height <= 0) return;
  const root = overlay.parentElement;
  const box = overlay.ownerDocument.createElement("div");
  box.dataset.flowSelrect = "";
  Object.assign(box.style, {
    background: "Highlight",
    height: `${Math.max(2, rect.height)}px`,
    left: `${rect.left - rootRect.left + (root?.scrollLeft ?? 0)}px`,
    opacity: "0.28",
    position: "absolute",
    top: `${rect.top - rootRect.top + (root?.scrollTop ?? 0)}px`,
    width: `${Math.max(2, rect.width)}px`,
  } satisfies Partial<CSSStyleDeclaration>);
  overlay.append(box);
}

function paintFlowOverlay(
  root: HTMLElement,
  overlay: HTMLElement,
  blocks: readonly FlowBlock[],
  selection: FlowSelection | null,
): number {
  overlay.replaceChildren();
  if (!selection) return 0;
  const rootRect = root.getBoundingClientRect();
  let count = 0;

  const paintObject = (id: string) => {
    const element = root.querySelector<HTMLElement>(
      `[data-flow-object-id="${id}"]`,
    );
    if (!element) return;
    appendRect(overlay, rootRect, element.getBoundingClientRect());
    count += 1;
  };

  const paintText = (id: string, from: number, to: number) => {
    if (to <= from) return;
    const element = root.querySelector<HTMLElement>(
      `[data-flow-text-id="${id}"]`,
    );
    if (!element) return;
    const start = textPosition(element, from);
    const end = textPosition(element, to);
    if (!start || !end) return;
    const range = root.ownerDocument.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    for (const rect of Array.from(range.getClientRects())) {
      appendRect(overlay, rootRect, rect);
      count += 1;
    }
  };

  if (selection.type === "node") {
    paintObject(selection.node);
    return count;
  }

  if (selection.type === "gap") {
    const gap = root.querySelector<HTMLElement>(
      `[data-flow-gap-id="${selection.node}"][data-flow-gap-side="${selection.side}"]`,
    );
    if (!gap) return 0;
    appendRect(overlay, rootRect, gap.getBoundingClientRect());
    return 1;
  }

  const { start, end } = orderedTextSelection(blocks, selection);
  const startIndex = blockIndex(blocks, start.node);
  const endIndex = blockIndex(blocks, end.node);
  for (let index = startIndex; index <= endIndex; index += 1) {
    const block = blocks[index];
    if (!block) continue;
    if (block.kind === "object") {
      paintObject(block.id);
      continue;
    }
    paintText(
      block.id,
      block.id === start.node ? clampTextOffset(block, start.offset) : 0,
      block.id === end.node
        ? clampTextOffset(block, end.offset)
        : block.text.length,
    );
  }
  return count;
}

function FlowSpike({
  large = false,
  blockCount = LARGE_BLOCK_COUNT,
  forcePolyfill = false,
}: FlowSpikeProps) {
  const initialBlocks = useMemo(
    () => (large ? largeBlocks(blockCount) : smallBlocks()),
    [blockCount, large],
  );
  const initialActiveLeafId = large ? LARGE_ACTIVE_ID : SMALL_ACTIVE_ID;
  const [activeLeafId, setActiveLeafId] = useState(initialActiveLeafId);
  const [activationSelection, setActivationSelection] =
    useState<FlowTextPoint | null>({
      node: initialActiveLeafId,
      offset:
        initialBlocks.find(
          (block): block is FlowTextBlock =>
            block.id === initialActiveLeafId && block.kind === "text",
        )?.text.length ?? 0,
    });
  const [blocks, setBlocks] = useState(initialBlocks);
  const [middleMounted, setMiddleMounted] = useState(true);
  const [activeRevision, setActiveRevision] = useState(0);
  const [virtualViewport, setVirtualViewport] = useState({
    scrollOffset: 0,
    viewportSize: LARGE_VIEWPORT_HEIGHT,
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const diagnosticsRef = useRef<HTMLPreElement>(null);
  const pendingFocusRef = useRef(false);
  const blocksRef = useRef<readonly FlowBlock[]>(initialBlocks);
  const selectionRef = useRef<FlowSelection | null>(null);
  const mountedIdsRef = useRef<readonly string[]>([]);
  const copiedTextRef = useRef("");
  const pastedTextRef = useRef("");
  const searchQueryRef = useRef("");
  const searchHitsRef = useRef<readonly string[]>([]);
  const dirtyRef = useRef<FlowDirty>({
    nodes: [],
    selection: false,
    structure: false,
  });
  const rectCountRef = useRef(0);
  const renderCountsRef = useRef<Record<string, number>>({});
  const activeInputRef = useRef<OwnedInputDiagnostics | null>(null);
  const activeLeafIdRef = useRef(activeLeafId);
  const virtualViewportRef = useRef(virtualViewport);
  activeLeafIdRef.current = activeLeafId;
  virtualViewportRef.current = virtualViewport;

  const publish = useCallback((): FlowDiagnostics => {
    const root = rootRef.current;
    const overlay = overlayRef.current;
    const currentVirtualViewport = virtualViewportRef.current;
    if (root && overlay) {
      rectCountRef.current = paintFlowOverlay(
        root,
        overlay,
        blocksRef.current,
        selectionRef.current,
      );
    }
    const activeInput = activeInputRef.current;
    const diagnostics: FlowDiagnostics = {
      activeInputBackend: activeInput?.inputBackend ?? null,
      activeInputFocused: activeInput?.focused ?? false,
      activeInputLastEvent: activeInput?.lastEvent ?? "",
      activeInputRectCount: activeInput?.rectCount ?? 0,
      activeInputText: activeInput?.text ?? "",
      activeLeafId: activeLeafIdRef.current,
      blockTexts: Object.fromEntries(
        blocksRef.current
          .filter((block): block is FlowTextBlock => block.kind === "text")
          .map((block) => [block.id, block.text]),
      ),
      copiedText: copiedTextRef.current,
      dirty: dirtyRef.current,
      mountedCount: mountedIdsRef.current.length,
      mountedIds: mountedIdsRef.current,
      pastedText: pastedTextRef.current,
      renderCounts: { ...renderCountsRef.current },
      searchHits: searchHitsRef.current,
      searchQuery: searchQueryRef.current,
      selection: selectionRef.current,
      selectionRectCount: rectCountRef.current,
      totalBlocks: blocksRef.current.length,
      virtualScrollOffset: currentVirtualViewport.scrollOffset,
      virtualViewportSize: currentVirtualViewport.viewportSize,
    };
    (window as unknown as Record<string, unknown>)[FLOW_KEY] = diagnostics;
    if (diagnosticsRef.current) {
      diagnosticsRef.current.textContent = diagnosticsText(diagnostics);
    }
    return diagnostics;
  }, []);

  const onBlockRender = useCallback(
    (id: string, count: number) => {
      renderCountsRef.current = { ...renderCountsRef.current, [id]: count };
      publish();
    },
    [publish],
  );

  const updateActiveInput = useCallback(
    (diagnostics: OwnedInputDiagnostics) => {
      activeInputRef.current = diagnostics;
      blocksRef.current = blocksRef.current.map((block) =>
        block.id === activeLeafId && block.kind === "text"
          ? { ...block, text: diagnostics.text }
          : block,
      );
      const currentSelection = selectionRef.current;
      const ownsCurrentSelection =
        currentSelection === null ||
        (currentSelection.type === "text" &&
          currentSelection.anchor.node === activeLeafId &&
          currentSelection.focus.node === activeLeafId);
      if (ownsCurrentSelection) {
        selectionRef.current = {
          anchor: { node: activeLeafId, offset: diagnostics.anchor },
          focus: { node: activeLeafId, offset: diagnostics.focus },
          type: "text",
        };
      }
      dirtyRef.current = {
        nodes: [activeLeafId],
        selection: ownsCurrentSelection,
        structure: false,
      };
      publish();
    },
    [activeLeafId, publish],
  );

  const activateTextBlock = useCallback(
    (id: string, offset?: number) => {
      const block = blocksRef.current.find((candidate) => candidate.id === id);
      if (!block || block.kind !== "text") return;
      const nextOffset = clampTextOffset(block, offset ?? block.text.length);
      blocksRef.current = blocksRef.current.map((candidate) =>
        candidate.id === activeLeafId && candidate.kind === "text"
          ? {
              ...candidate,
              text: activeInputRef.current?.text ?? candidate.text,
            }
          : candidate,
      );
      activeInputRef.current = null;
      selectionRef.current = {
        anchor: { node: id, offset: nextOffset },
        focus: { node: id, offset: nextOffset },
        type: "text",
      };
      dirtyRef.current = {
        nodes: [id],
        selection: true,
        structure: false,
      };
      pendingFocusRef.current = true;
      setActivationSelection({ node: id, offset: nextOffset });
      setBlocks(blocksRef.current);
      setActiveLeafId(id);
      setActiveRevision((revision) => revision + 1);
    },
    [activeLeafId],
  );

  const syncVirtualViewport = useCallback((element: HTMLElement) => {
    const next = {
      scrollOffset: element.scrollTop,
      viewportSize: Math.max(1, element.clientHeight),
    };
    virtualViewportRef.current = next;
    setVirtualViewport((previous) =>
      previous.scrollOffset === next.scrollOffset &&
      previous.viewportSize === next.viewportSize
        ? previous
        : next,
    );
  }, []);

  const mountedBlocks = useMemo(() => {
    if (large) {
      const range = calculateVirtualRange({
        getItemSize: () => LARGE_BLOCK_HEIGHT,
        itemCount: blocks.length,
        overscan: 2,
        scrollOffset: virtualViewport.scrollOffset,
        viewportSize: virtualViewport.viewportSize,
      });
      return {
        afterHeight: range.afterHeight,
        beforeHeight: range.beforeHeight,
        items: blocks.slice(range.startIndex, range.endIndex),
      };
    }
    return {
      afterHeight: 0,
      beforeHeight: 0,
      items: blocks.filter((block) => middleMounted || block.id !== "b"),
    };
  }, [blocks, large, middleMounted, virtualViewport]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (large && root) syncVirtualViewport(root);
  }, [large, syncVirtualViewport]);

  useLayoutEffect(() => {
    if (!pendingFocusRef.current) return;
    pendingFocusRef.current = false;
    requestAnimationFrame(() => {
      rootRef.current
        ?.querySelector<HTMLElement>("[data-flow-active-leaf-host]")
        ?.focus({ preventScroll: true });
    });
  }, [activeLeafId, activeRevision]);

  useLayoutEffect(() => {
    mountedIdsRef.current = mountedBlocks.items.map((block) => block.id);
    publish();
  }, [mountedBlocks, publish]);

  useLayoutEffect(() => {
    if (
      large &&
      !mountedBlocks.items.some((block) => block.id === activeLeafId) &&
      blocksRef.current !== blocks
    ) {
      setBlocks(blocksRef.current);
    }
  }, [activeLeafId, blocks, large, mountedBlocks.items]);

  useEffect(() => {
    const api: FlowApi = {
      copySelection: () => {
        const text = serializeSelection(
          blocksRef.current,
          selectionRef.current,
        );
        copiedTextRef.current = text;
        publish();
        return text;
      },
      diagnostics: publish,
      pasteText: (text: string) => {
        const next = replaceSelectionWithText(
          blocksRef.current,
          selectionRef.current,
          text,
        );
        pastedTextRef.current = text;
        dirtyRef.current = {
          nodes:
            selectionRef.current?.type === "text"
              ? [selectionRef.current.anchor.node]
              : [],
          selection: true,
          structure: true,
        };
        blocksRef.current = next;
        setBlocks(next);
        setActiveRevision((revision) => revision + 1);
      },
      search: (query: string) => {
        searchQueryRef.current = query;
        searchHitsRef.current = blocksRef.current
          .filter((block) =>
            blockSearchText(block).toLowerCase().includes(query.toLowerCase()),
          )
          .map((block) => block.id);
        publish();
        return searchHitsRef.current;
      },
      selectGap: (node, side) => {
        selectionRef.current = { node, side, type: "gap" };
        dirtyRef.current = { nodes: [], selection: true, structure: false };
        return publish();
      },
      selectNode: (node) => {
        selectionRef.current = { node, type: "node" };
        dirtyRef.current = { nodes: [node], selection: true, structure: false };
        return publish();
      },
      selectText: (anchorNode, anchorOffset, focusNode, focusOffset) => {
        selectionRef.current = {
          anchor: { node: anchorNode, offset: anchorOffset },
          focus: { node: focusNode, offset: focusOffset },
          type: "text",
        };
        dirtyRef.current = { nodes: [], selection: true, structure: false };
        return publish();
      },
      setMiddleMounted: (mounted) => {
        setBlocks(blocksRef.current);
        setMiddleMounted(mounted);
      },
      toggleActiveMark: () => {
        dirtyRef.current = {
          nodes: [activeLeafId],
          selection: false,
          structure: false,
        };
        setBlocks(blocksRef.current);
        setActiveRevision((revision) => revision + 1);
      },
    };
    (window as unknown as Record<string, unknown>)[FLOW_API_KEY] = api;
  }, [activeLeafId, publish]);

  useEffect(
    () => () => {
      delete (window as unknown as Record<string, unknown>)[FLOW_API_KEY];
      delete (window as unknown as Record<string, unknown>)[FLOW_KEY];
    },
    [],
  );

  const copySelection = () => {
    const api = (window as unknown as Record<string, FlowApi | undefined>)[
      FLOW_API_KEY
    ];
    api?.copySelection();
  };

  const pasteSelection = () => {
    const api = (window as unknown as Record<string, FlowApi | undefined>)[
      FLOW_API_KEY
    ];
    api?.pasteText("pasted model text");
  };

  const searchObjects = () => {
    const api = (window as unknown as Record<string, FlowApi | undefined>)[
      FLOW_API_KEY
    ];
    api?.search("schema");
  };

  return (
    <div style={{ display: "grid", gap: "0.75rem", maxWidth: "48rem" }}>
      {!large ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          <button
            data-flow-select-a-c=""
            type="button"
            onClick={() =>
              (window as unknown as Record<string, FlowApi | undefined>)[
                FLOW_API_KEY
              ]?.selectText("a", 0, "c", "Charlie".length)
            }
          >
            Select A-C
          </button>
          <button
            data-flow-select-object=""
            type="button"
            onClick={() =>
              (window as unknown as Record<string, FlowApi | undefined>)[
                FLOW_API_KEY
              ]?.selectNode("obj")
            }
          >
            Select object
          </button>
          <button
            data-flow-select-gap=""
            type="button"
            onClick={() =>
              (window as unknown as Record<string, FlowApi | undefined>)[
                FLOW_API_KEY
              ]?.selectGap("obj", "before")
            }
          >
            Select gap
          </button>
          <button
            data-flow-toggle-middle=""
            type="button"
            onClick={() => {
              setBlocks(blocksRef.current);
              setMiddleMounted((value) => !value);
            }}
          >
            Toggle middle
          </button>
          <button data-flow-copy="" type="button" onClick={copySelection}>
            Copy model
          </button>
          <button data-flow-paste="" type="button" onClick={pasteSelection}>
            Paste model
          </button>
          <button data-flow-search="" type="button" onClick={searchObjects}>
            Search object
          </button>
        </div>
      ) : null}
      <div
        ref={rootRef}
        data-flow-root=""
        style={{
          background: "#fff",
          border: "1px solid #777",
          borderRadius: "8px",
          color: "#111",
          font: "16px/1.55 system-ui, sans-serif",
          height: large ? `${LARGE_VIEWPORT_HEIGHT}px` : undefined,
          minHeight: large ? undefined : "18rem",
          overflowAnchor: "none",
          overflowY: large ? "auto" : undefined,
          padding: "0.75rem",
          position: "relative",
          userSelect: "none",
        }}
        onScroll={(event) => {
          if (large) syncVirtualViewport(event.currentTarget);
        }}
        onCopy={(event) => {
          const text = serializeSelection(
            blocksRef.current,
            selectionRef.current,
          );
          event.clipboardData.setData("text/plain", text);
          copiedTextRef.current = text;
          event.preventDefault();
          publish();
        }}
        onPaste={(event) => {
          const text = event.clipboardData.getData("text/plain");
          pastedTextRef.current = text;
          const next = replaceSelectionWithText(
            blocksRef.current,
            selectionRef.current,
            text,
          );
          blocksRef.current = next;
          setBlocks(next);
          setActiveRevision((revision) => revision + 1);
          event.preventDefault();
        }}
      >
        <div
          ref={overlayRef}
          data-flow-overlay=""
          style={{
            inset: 0,
            pointerEvents: "none",
            position: "absolute",
          }}
        />
        {mountedBlocks.beforeHeight > 0 ? (
          <div
            data-flow-virtual-before=""
            style={{ height: `${mountedBlocks.beforeHeight}px` }}
          />
        ) : null}
        {mountedBlocks.items.map((block) =>
          block.kind === "text" ? (
            <FlowTextView
              key={`${block.id}-${block.id === activeLeafId ? activeRevision : 0}`}
              activate={activateTextBlock}
              active={block.id === activeLeafId}
              block={block}
              forcePolyfill={forcePolyfill}
              initialSelection={
                activationSelection?.node === block.id
                  ? activationSelection.offset
                  : undefined
              }
              onInputState={updateActiveInput}
              onRender={onBlockRender}
            />
          ) : (
            <FlowObjectView
              key={block.id}
              block={block}
              onRender={onBlockRender}
              selectGap={(side) => {
                selectionRef.current = { node: block.id, side, type: "gap" };
                dirtyRef.current = {
                  nodes: [],
                  selection: true,
                  structure: false,
                };
                publish();
              }}
              selectNode={() => {
                selectionRef.current = { node: block.id, type: "node" };
                dirtyRef.current = {
                  nodes: [block.id],
                  selection: true,
                  structure: false,
                };
                publish();
              }}
            />
          ),
        )}
        {mountedBlocks.afterHeight > 0 ? (
          <div
            data-flow-virtual-after=""
            style={{ height: `${mountedBlocks.afterHeight}px` }}
          />
        ) : null}
      </div>
      <pre
        ref={diagnosticsRef}
        data-flow-diagnostics=""
        style={{
          background: "#f7f7f8",
          border: "1px solid #bbb",
          borderRadius: "6px",
          font: "12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace",
          margin: 0,
          maxHeight: "11rem",
          overflow: "auto",
          padding: "0.65rem",
          whiteSpace: "pre-wrap",
        }}
      />
    </div>
  );
}

function useRenderCount(
  id: string,
  onRender: (id: string, count: number) => void,
): void {
  const countRef = useRef(0);
  countRef.current += 1;
  useLayoutEffect(() => {
    onRender(id, countRef.current);
  });
}

function FlowTextView({
  activate,
  active,
  block,
  forcePolyfill,
  initialSelection,
  onInputState,
  onRender,
}: {
  readonly activate: (id: string, offset?: number) => void;
  readonly active: boolean;
  readonly block: FlowTextBlock;
  readonly forcePolyfill: boolean;
  readonly initialSelection?: number;
  readonly onInputState: (diagnostics: OwnedInputDiagnostics) => void;
  readonly onRender: (id: string, count: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  useRenderCount(block.id, onRender);

  useEffect(() => {
    if (!active) return;
    const host = hostRef.current;
    if (!host) return;
    const textElement = host.querySelector<HTMLElement>("[data-owned-text]");
    const overlayElement = host.querySelector<HTMLElement>(
      "[data-owned-overlay]",
    );
    if (!textElement || !overlayElement) return;
    const controller = createTextInputController({
      forcePolyfill,
      host,
      initialText: block.text,
      initialSelection:
        initialSelection === undefined
          ? undefined
          : { anchor: initialSelection, focus: initialSelection },
      onStateChange: onInputState,
      overlayElement,
      publishGlobal: false,
      textElement,
    });
    return () => controller.destroy();
  }, [active, block.text, forcePolyfill, onInputState]);

  if (active) {
    return (
      <div data-flow-block-id={block.id} data-flow-block-kind="text">
        <div
          ref={hostRef}
          data-flow-active-leaf-host=""
          data-flow-block-id={block.id}
          data-owned-host=""
          aria-label={`Flow text block ${block.id}`}
          aria-multiline="true"
          role="textbox"
          style={{
            boxSizing: "border-box",
            borderRadius: "4px",
            minHeight: "2rem",
            outline: "none",
            padding: "0.45rem 0.5rem",
            position: "relative",
            whiteSpace: "pre-wrap",
          }}
        >
          <div
            data-flow-text-content=""
            data-flow-text-id={block.id}
            data-owned-text=""
          />
          <div
            data-owned-overlay=""
            style={{ inset: 0, pointerEvents: "none", position: "absolute" }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      data-flow-block-id={block.id}
      data-flow-block-kind="text"
      onPointerDown={(event) => {
        const textElement = event.currentTarget.querySelector<HTMLElement>(
          "[data-flow-text-content]",
        );
        activate(
          block.id,
          textElement
            ? textOffsetFromPointer(textElement, event.clientX, event.clientY)
            : block.text.length,
        );
      }}
      style={{
        boxSizing: "border-box",
        minHeight: "2rem",
        padding: "0.45rem 0.5rem",
        whiteSpace: "pre-wrap",
      }}
    >
      <span data-flow-text-content="" data-flow-text-id={block.id}>
        {block.text}
      </span>
    </div>
  );
}

function FlowObjectView({
  block,
  onRender,
  selectGap,
  selectNode,
}: {
  readonly block: FlowObjectBlock;
  readonly onRender: (id: string, count: number) => void;
  readonly selectGap: (side: "before" | "after") => void;
  readonly selectNode: () => void;
}) {
  useRenderCount(block.id, onRender);
  return (
    <div
      data-flow-block-id={block.id}
      data-flow-block-kind="object"
      style={{
        alignItems: "stretch",
        display: "grid",
        gap: "0.25rem",
        gridTemplateColumns: "0.35rem 1fr 0.35rem",
        padding: "0.3rem 0",
      }}
    >
      <button
        data-flow-gap-id={block.id}
        data-flow-gap-side="before"
        aria-label={`Gap before ${block.label}`}
        type="button"
        onClick={selectGap.bind(null, "before")}
        style={{ border: 0, padding: 0 }}
      />
      <button
        data-flow-object-id={block.id}
        type="button"
        onClick={selectNode}
        style={{
          background: "#f4f4f5",
          border: "1px solid #999",
          borderRadius: "6px",
          color: "#111",
          minHeight: "2.5rem",
          padding: "0.45rem 0.6rem",
          textAlign: "left",
        }}
      >
        {block.label}
      </button>
      <button
        data-flow-gap-id={block.id}
        data-flow-gap-side="after"
        aria-label={`Gap after ${block.label}`}
        type="button"
        onClick={selectGap.bind(null, "after")}
        style={{ border: 0, padding: 0 }}
      />
    </div>
  );
}

export const Small: Story = () => <FlowSpike />;
export const ForcedPolyfill: Story = () => <FlowSpike forcePolyfill />;
export const Large: Story = () => <FlowSpike large />;
export const Huge: Story = () => (
  <FlowSpike blockCount={HUGE_BLOCK_COUNT} large />
);
