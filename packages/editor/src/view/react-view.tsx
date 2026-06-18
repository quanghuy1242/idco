import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type Ref,
  type RefObject,
} from "react";
import {
  install,
  releaseForcedInstall,
  syncPolyfillSelection,
} from "../core/vendor/editcontext-polyfill";
import {
  createEngineScheduler,
  pointAtOffset,
  replaceTextContent,
  sliceTextContent,
  type EditorSelection,
  type EditorStore,
  type EnginePerformanceSnapshot,
  type EngineScheduler,
  type EngineSchedulerTask,
  type NodeId,
  type StoreDirty,
  type TextLeafNode,
  type TextPoint,
} from "../core";

/**
 * React binding for the owned-model engine.
 *
 * This file is where Phase 4 becomes real: React renders every block, but the
 * document never moves into React state. The store remains the source of truth;
 * blocks subscribe to exactly one node with `useSyncExternalStore`, the order
 * subscribes to structural changes, and the selection overlay is notified through
 * the engine scheduler's frame lane.
 *
 * Flow:
 *
 *   EditContext textupdate -> replace-text step -> EditorStore.dispatch
 *   store dirty node       -> that block's external-store subscriber
 *   store dirty selection  -> scheduler frame task -> overlay subscriber
 *
 * The component is intentionally non-virtualized. Phase 5 owns windowing; Phase 4
 * proves the React/store/scheduler path while all blocks are mounted.
 */

export type OwnedModelEditorViewDiagnostics = {
  readonly activeNodeId: NodeId | null;
  readonly blockTexts: Readonly<Record<NodeId, string>>;
  readonly mountedCount: number;
  readonly order: readonly NodeId[];
  readonly renderCounts: Readonly<Record<NodeId, number>>;
  readonly scheduler: EnginePerformanceSnapshot;
  readonly selection: EditorSelection | null;
  readonly selectionOverlayRenderCount: number;
  readonly selectionRectCount: number;
};

export type OwnedModelEditorViewHandle = {
  readonly diagnostics: () => OwnedModelEditorViewDiagnostics;
  readonly focusBlock: (id: NodeId) => void;
  readonly selectText: (
    anchorNode: NodeId,
    anchorOffset: number,
    focusNode: NodeId,
    focusOffset: number,
  ) => void;
};

export type OwnedModelEditorViewProps = {
  readonly store: EditorStore;
  readonly scheduler?: EngineScheduler;
  readonly forcePolyfill?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly diagnosticsKey?: string;
};

type EditContextLike = EventTarget & {
  text: string;
  selectionStart: number;
  selectionEnd: number;
  updateText(rangeStart: number, rangeEnd: number, text: string): void;
  updateSelection(start: number, end: number): void;
};

type EditContextConstructor = new (init?: {
  text?: string;
  selectionStart?: number;
  selectionEnd?: number;
}) => EditContextLike;

type MaybePolyfilledEditContextConstructor = EditContextConstructor & {
  readonly isIdcoPolyfill?: boolean;
};

type TextBlockController = {
  readonly editContext: EditContextLike;
  readonly backend: "native" | "polyfill";
  readonly destroy: () => void;
};

type RenderRegistry = {
  readonly blockRefs: Map<NodeId, HTMLElement>;
  readonly renderCounts: Map<NodeId, number>;
  selectionOverlayRenderCount: number;
  selectionRectCount: number;
};

type TextDiff = {
  readonly at: number;
  readonly removed: string;
  readonly inserted: string;
};

type SelectionFramePayload = {
  readonly dirty: StoreDirty;
};

export const OwnedModelEditorView = forwardRef(function OwnedModelEditorView(
  props: OwnedModelEditorViewProps,
  ref: Ref<OwnedModelEditorViewHandle>,
) {
  const {
    store,
    scheduler: providedScheduler,
    forcePolyfill = false,
    className,
    style,
    diagnosticsKey,
  } = props;
  const localSchedulerRef = useRef<EngineScheduler | null>(null);
  if (!providedScheduler && !localSchedulerRef.current) {
    localSchedulerRef.current = createEngineScheduler();
  }
  const scheduler = providedScheduler ?? localSchedulerRef.current!;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const registryRef = useRef<RenderRegistry>({
    blockRefs: new Map(),
    renderCounts: new Map(),
    selectionOverlayRenderCount: 0,
    selectionRectCount: 0,
  });
  const order = useEditorOrder(store);

  const registerBlock = useCallback(
    (id: NodeId, element: HTMLElement | null) => {
      if (element) {
        registryRef.current.blockRefs.set(id, element);
      } else {
        registryRef.current.blockRefs.delete(id);
      }
    },
    [],
  );

  const recordBlockRender = useCallback((id: NodeId) => {
    const counts = registryRef.current.renderCounts;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }, []);

  const selectText = useCallback(
    (
      anchorNode: NodeId,
      anchorOffset: number,
      focusNode: NodeId,
      focusOffset: number,
    ) => {
      store.dispatch({
        origin: "local",
        selectionAfter: {
          anchor: pointForStoreOffset(store, anchorNode, anchorOffset),
          focus: pointForStoreOffset(store, focusNode, focusOffset),
          type: "text",
        },
        steps: [],
      });
    },
    [store],
  );

  const focusBlock = useCallback((id: NodeId) => {
    registryRef.current.blockRefs.get(id)?.focus({ preventScroll: true });
  }, []);

  const diagnostics = useCallback((): OwnedModelEditorViewDiagnostics => {
    const blockTexts: Record<NodeId, string> = {};
    for (const id of store.order) {
      const node = store.requireNode(id);
      if (node.kind === "text") blockTexts[id] = node.content.text;
    }
    return {
      activeNodeId: activeSelectionNode(store.selection),
      blockTexts,
      mountedCount: registryRef.current.blockRefs.size,
      order: [...store.order],
      renderCounts: Object.fromEntries(registryRef.current.renderCounts),
      scheduler: scheduler.snapshot(),
      selection: store.selection,
      selectionOverlayRenderCount:
        registryRef.current.selectionOverlayRenderCount,
      selectionRectCount: registryRef.current.selectionRectCount,
    };
  }, [scheduler, store]);

  const api = useMemo<OwnedModelEditorViewHandle>(
    () => ({ diagnostics, focusBlock, selectText }),
    [diagnostics, focusBlock, selectText],
  );

  useImperativeHandle(ref, () => api, [api]);

  useEffect(() => {
    if (!diagnosticsKey || typeof window === "undefined") return;
    (window as unknown as Record<string, unknown>)[diagnosticsKey] = api;
    return () => {
      delete (window as unknown as Record<string, unknown>)[diagnosticsKey];
    };
  }, [api, diagnosticsKey]);

  return (
    <div
      ref={rootRef}
      className={className}
      data-engine-view-root=""
      role="application"
      style={{
        border: "1px solid color-mix(in srgb, CanvasText 18%, transparent)",
        borderRadius: 8,
        color: "CanvasText",
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        lineHeight: 1.55,
        maxWidth: 920,
        padding: 16,
        position: "relative",
        ...style,
      }}
    >
      {order.map((id) => (
        <EngineBlock
          forcePolyfill={forcePolyfill}
          id={id}
          key={id}
          onRender={recordBlockRender}
          registerBlock={registerBlock}
          store={store}
        />
      ))}
      <SelectionOverlay
        registry={registryRef.current}
        rootRef={rootRef}
        scheduler={scheduler}
        store={store}
      />
    </div>
  );
});

function EngineBlock(props: {
  readonly id: NodeId;
  readonly store: EditorStore;
  readonly forcePolyfill: boolean;
  readonly registerBlock: (id: NodeId, element: HTMLElement | null) => void;
  readonly onRender: (id: NodeId) => void;
}) {
  const { id, store, forcePolyfill, registerBlock, onRender } = props;
  const node = useEditorNode(store, id);
  onRender(id);
  if (node.kind === "text") {
    return (
      <EngineTextBlock
        forcePolyfill={forcePolyfill}
        node={node}
        registerBlock={registerBlock}
        store={store}
      />
    );
  }
  return (
    <div
      data-engine-block-id={node.id}
      ref={(element) => registerBlock(node.id, element)}
      style={blockStyle}
    >
      [{node.type}]
    </div>
  );
}

function EngineTextBlock(props: {
  readonly node: TextLeafNode;
  readonly store: EditorStore;
  readonly forcePolyfill: boolean;
  readonly registerBlock: (id: NodeId, element: HTMLElement | null) => void;
}) {
  const { node, store, forcePolyfill, registerBlock } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<TextBlockController | null>(null);
  const latestNodeRef = useRef(node);
  latestNodeRef.current = node;

  const syncSelectionIntoEditContext = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    const selection = store.selection;
    if (selection?.type === "text" && selection.focus.node === node.id) {
      controller.editContext.updateSelection(
        Math.min(selection.anchor.offset, selection.focus.offset),
        Math.max(selection.anchor.offset, selection.focus.offset),
      );
      if (controller.backend === "polyfill" && hostRef.current) {
        syncPolyfillSelection(hostRef.current);
      }
    }
  }, [node.id, store]);

  const onTextUpdate = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    const editContext = controller.editContext;
    const current = store.requireTextNode(node.id);
    const diff = diffText(current.content.text, editContext.text);
    const selectionStart = clampOffset(
      editContext.selectionStart,
      editContext.text.length,
    );
    const selectionEnd = clampOffset(
      editContext.selectionEnd,
      editContext.text.length,
    );

    if (
      diff.removed.length === 0 &&
      diff.inserted.length === 0 &&
      store.selection?.type === "text" &&
      store.selection.anchor.node === node.id &&
      store.selection.anchor.offset === selectionStart &&
      store.selection.focus.offset === selectionEnd
    ) {
      return;
    }

    const inserted = store.allocator.createTextSlice(diff.inserted);
    const nextContent = replaceTextContent(
      current.content,
      diff.at,
      diff.removed.length,
      inserted,
    );
    const steps =
      diff.removed.length > 0 || diff.inserted.length > 0
        ? [
            {
              at: diff.at,
              inserted,
              node: node.id,
              removed: sliceTextContent(
                current.content,
                diff.at,
                diff.at + diff.removed.length,
              ),
              type: "replace-text" as const,
            },
          ]
        : [];
    store.dispatch({
      origin: "local",
      selectionAfter: {
        anchor: pointAtOffset(node.id, nextContent, selectionStart),
        focus: pointAtOffset(node.id, nextContent, selectionEnd),
        type: "text",
      },
      steps,
    });
  }, [node.id, store]);

  const ensureController = useCallback((): TextBlockController | null => {
    if (controllerRef.current) return controllerRef.current;
    const host = hostRef.current;
    if (!host) return null;
    const view = host.ownerDocument.defaultView ?? window;
    const existing = (view as { EditContext?: unknown }).EditContext as
      | MaybePolyfilledEditContextConstructor
      | undefined;
    const hasNative =
      typeof existing === "function" && existing.isIdcoPolyfill !== true;
    const backend = forcePolyfill || !hasNative ? "polyfill" : "native";
    if (backend === "polyfill") {
      install({
        force: forcePolyfill,
        target: view as unknown as Record<string, unknown>,
      });
    }
    const Ctor = (view as unknown as { EditContext: EditContextConstructor })
      .EditContext;
    const length = latestNodeRef.current.content.text.length;
    const editContext = new Ctor({
      selectionEnd: length,
      selectionStart: length,
      text: latestNodeRef.current.content.text,
    });
    editContext.addEventListener("textupdate", onTextUpdate);
    (host as unknown as { editContext: EditContextLike }).editContext =
      editContext;
    const destroy = () => {
      editContext.removeEventListener("textupdate", onTextUpdate);
      (host as unknown as { editContext: EditContextLike | null }).editContext =
        null;
      if (forcePolyfill) releaseForcedInstall();
    };
    controllerRef.current = { backend, destroy, editContext };
    return controllerRef.current;
  }, [forcePolyfill, onTextUpdate]);

  useLayoutEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    const current = node.content.text;
    if (controller.editContext.text !== current) {
      controller.editContext.updateText(
        0,
        controller.editContext.text.length,
        current,
      );
    }
    syncSelectionIntoEditContext();
  }, [node, syncSelectionIntoEditContext]);

  useEffect(
    () => () => {
      controllerRef.current?.destroy();
      controllerRef.current = null;
    },
    [],
  );

  const bindRef = useCallback(
    (element: HTMLDivElement | null) => {
      hostRef.current = element;
      registerBlock(node.id, element);
    },
    [node.id, registerBlock],
  );

  const focusAtEnd = useCallback(() => {
    const controller = ensureController();
    const current = store.requireTextNode(node.id);
    const existing = store.selection;
    const offset =
      existing?.type === "text" && existing.focus.node === node.id
        ? existing.focus.offset
        : current.content.text.length;
    store.dispatch({
      origin: "local",
      selectionAfter: {
        anchor: pointAtOffset(node.id, current.content, offset),
        focus: pointAtOffset(node.id, current.content, offset),
        type: "text",
      },
      steps: [],
    });
    controller?.editContext.updateSelection(offset, offset);
    if (controller?.backend === "polyfill" && hostRef.current) {
      syncPolyfillSelection(hostRef.current);
    }
  }, [ensureController, node.id, store]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        event.stopPropagation();
      }
      const selection = store.selection;
      if (selection?.type !== "text" || selection.focus.node !== node.id) {
        return;
      }
      const next = selectionForNavigation(
        store,
        selection,
        event.key,
        event.shiftKey,
      );
      if (!next) return;
      event.preventDefault();
      store.dispatch({ origin: "local", selectionAfter: next, steps: [] });
      syncSelectionIntoEditContext();
    },
    [node.id, store, syncSelectionIntoEditContext],
  );

  return (
    <div
      aria-label={`Block ${node.id}`}
      data-engine-block-id={node.id}
      data-engine-text-id={node.id}
      onClick={focusAtEnd}
      onFocus={focusAtEnd}
      onKeyDown={handleKeyDown}
      ref={bindRef}
      role="textbox"
      style={blockStyle}
      tabIndex={0}
    >
      {node.content.text.length > 0 ? node.content.text : "\u200b"}
    </div>
  );
}

function SelectionOverlay(props: {
  readonly store: EditorStore;
  readonly scheduler: EngineScheduler;
  readonly rootRef: RefObject<HTMLElement | null>;
  readonly registry: RenderRegistry;
}) {
  const { store, scheduler, rootRef, registry } = props;
  const version = useSelectionFrameVersion(store, scheduler);
  void version;
  const rects = selectionRects(store, rootRef.current, registry.blockRefs);
  registry.selectionOverlayRenderCount += 1;
  registry.selectionRectCount = rects.length;
  return (
    <div
      aria-hidden="true"
      data-engine-selection-overlay=""
      data-engine-selection-rect-count={rects.length}
      style={{
        inset: 0,
        pointerEvents: "none",
        position: "absolute",
      }}
    >
      {rects.map((rect, index) => (
        <div
          data-engine-selection-rect=""
          key={`${rect.node}-${index}`}
          style={{
            background:
              rect.kind === "caret"
                ? "CanvasText"
                : "color-mix(in srgb, Highlight 36%, transparent)",
            borderRadius: rect.kind === "caret" ? 0 : 3,
            height: rect.height,
            left: rect.left,
            opacity: rect.kind === "caret" ? 0.82 : 1,
            position: "absolute",
            top: rect.top,
            width: rect.width,
          }}
        />
      ))}
    </div>
  );
}

function useEditorOrder(store: EditorStore): readonly NodeId[] {
  return useSyncExternalStore(
    (listener) => store.subscribeOrder(listener),
    () => store.order,
    () => store.order,
  );
}

function useEditorNode(store: EditorStore, id: NodeId) {
  return useSyncExternalStore(
    (listener) => store.subscribeNode(id, listener),
    () => store.requireNode(id),
    () => store.requireNode(id),
  );
}

function useSelectionFrameVersion(
  store: EditorStore,
  scheduler: EngineScheduler,
): number {
  const externalStore = useMemo(
    () => new SelectionFrameStore(store, scheduler),
    [scheduler, store],
  );
  return useSyncExternalStore(
    externalStore.subscribe,
    externalStore.getSnapshot,
    externalStore.getSnapshot,
  );
}

class SelectionFrameStore {
  readonly #listeners = new Set<() => void>();
  readonly #store: EditorStore;
  readonly #task: EngineSchedulerTask<SelectionFramePayload>;
  #storeUnsubscribe: (() => void) | null = null;
  #version = 0;

  constructor(store: EditorStore, scheduler: EngineScheduler) {
    this.#store = store;
    this.#task = scheduler.createTask<SelectionFramePayload>(
      {
        budgetMs: 2,
        cost: "Notify the React selection overlay after model selection changes.",
        frequency: "on owned-model selection dirty",
        label: "engine-selection-overlay",
        lane: "frame",
        priority: "high",
      },
      () => {
        this.#version += 1;
        this.#listeners.forEach((listener) => listener());
      },
    );
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    if (!this.#storeUnsubscribe) {
      this.#storeUnsubscribe = this.#store.subscribeSelection((dirty) => {
        this.#task.schedule({ dirty });
      });
    }
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) {
        this.#storeUnsubscribe?.();
        this.#storeUnsubscribe = null;
        this.#task.cancel();
      }
    };
  };

  readonly getSnapshot = (): number => this.#version;
}

function pointForStoreOffset(
  store: EditorStore,
  nodeId: NodeId,
  offset: number,
): TextPoint {
  const node = store.requireTextNode(nodeId);
  return pointAtOffset(
    node.id,
    node.content,
    clampOffset(offset, node.content.text.length),
  );
}

function selectionForNavigation(
  store: EditorStore,
  selection: Extract<EditorSelection, { type: "text" }>,
  key: string,
  extend: boolean,
): EditorSelection | null {
  const current = store.requireTextNode(selection.focus.node);
  const order = store.order;
  const currentIndex = order.indexOf(current.id);
  let targetNode = current;
  let offset = selection.focus.offset;
  if (key === "ArrowRight") {
    if (offset < current.content.text.length) {
      offset += 1;
    } else if (currentIndex >= 0 && currentIndex < order.length - 1) {
      targetNode = store.requireTextNode(order[currentIndex + 1]!);
      offset = 0;
    } else {
      return null;
    }
  } else if (key === "ArrowLeft") {
    if (offset > 0) {
      offset -= 1;
    } else if (currentIndex > 0) {
      targetNode = store.requireTextNode(order[currentIndex - 1]!);
      offset = targetNode.content.text.length;
    } else {
      return null;
    }
  } else if (key === "ArrowDown") {
    if (currentIndex < 0 || currentIndex >= order.length - 1) return null;
    targetNode = store.requireTextNode(order[currentIndex + 1]!);
    offset = Math.min(offset, targetNode.content.text.length);
  } else if (key === "ArrowUp") {
    if (currentIndex <= 0) return null;
    targetNode = store.requireTextNode(order[currentIndex - 1]!);
    offset = Math.min(offset, targetNode.content.text.length);
  } else if (key === "Home") {
    offset = 0;
  } else if (key === "End") {
    offset = current.content.text.length;
  } else {
    return null;
  }
  const focus = pointAtOffset(targetNode.id, targetNode.content, offset);
  return {
    anchor: extend ? selection.anchor : focus,
    focus,
    type: "text",
  };
}

type OverlayRect = {
  readonly height: number;
  readonly kind: "caret" | "range";
  readonly left: number;
  readonly node: NodeId;
  readonly top: number;
  readonly width: number;
};

function selectionRects(
  store: EditorStore,
  root: HTMLElement | null,
  blockRefs: ReadonlyMap<NodeId, HTMLElement>,
): readonly OverlayRect[] {
  if (!root || store.selection?.type !== "text") return [];
  const selection = store.selection;
  const rootRect = root.getBoundingClientRect();
  const order = store.order;
  const anchorIndex = order.indexOf(selection.anchor.node);
  const focusIndex = order.indexOf(selection.focus.node);
  if (anchorIndex < 0 || focusIndex < 0) return [];
  const startIndex = Math.min(anchorIndex, focusIndex);
  const endIndex = Math.max(anchorIndex, focusIndex);
  const collapsed =
    selection.anchor.node === selection.focus.node &&
    selection.anchor.offset === selection.focus.offset;
  if (collapsed) {
    const node = store.requireTextNode(selection.focus.node);
    const element = blockRefs.get(node.id);
    if (!element) return [];
    const rect = element.getBoundingClientRect();
    const usableWidth = Math.max(1, rect.width - 24);
    const left =
      rect.left -
      rootRect.left +
      12 +
      (usableWidth * selection.focus.offset) /
        Math.max(1, node.content.text.length);
    return [
      {
        height: Math.max(18, rect.height - 10),
        kind: "caret",
        left,
        node: node.id,
        top: rect.top - rootRect.top + 5,
        width: 2,
      },
    ];
  }
  const rects: OverlayRect[] = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    const id = order[index];
    if (!id) continue;
    const element = blockRefs.get(id);
    if (!element) continue;
    const blockRect = element.getBoundingClientRect();
    rects.push({
      height: Math.max(18, blockRect.height - 10),
      kind: "range",
      left: blockRect.left - rootRect.left + 8,
      node: id,
      top: blockRect.top - rootRect.top + 5,
      width: Math.max(1, blockRect.width - 16),
    });
  }
  return rects;
}

function diffText(before: string, after: string): TextDiff {
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  ) {
    start += 1;
  }
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (
    beforeEnd > start &&
    afterEnd > start &&
    before[beforeEnd - 1] === after[afterEnd - 1]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  return {
    at: start,
    inserted: after.slice(start, afterEnd),
    removed: before.slice(start, beforeEnd),
  };
}

function activeSelectionNode(selection: EditorSelection | null): NodeId | null {
  if (!selection) return null;
  if (selection.type === "text") return selection.focus.node;
  return selection.node;
}

function clampOffset(offset: number, length: number): number {
  return Math.min(Math.max(0, Math.floor(offset)), length);
}

const blockStyle: CSSProperties = {
  borderRadius: 6,
  minHeight: 28,
  outline: "none",
  padding: "5px 8px",
  position: "relative",
  whiteSpace: "pre-wrap",
};
