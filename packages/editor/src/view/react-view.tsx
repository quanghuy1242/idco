import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
  collectSelectionText,
  createEngineScheduler,
  createOwnedEditorHandle,
  orderedTextLeaves,
  pointAtOffset,
  replaceTextContent,
  sliceTextContent,
  type EditorCommand,
  type EditorSelection,
  type EditorStore,
  type OwnedEditorHandle,
  type EnginePerformanceSnapshot,
  type EngineScheduler,
  type EngineSchedulerTask,
  type NodeId,
  type StoreDirty,
  type TextLeafNode,
  type TextPoint,
} from "../core";
import { calculateVirtualRange } from "../core/virtual-range";

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
 * Phase 5 adds windowing: with `virtualize` (default true, docs/011 §2.6) only
 * the viewport slice plus overscan mounts, the selection overlay paints just the
 * mounted edges (§8.5), and copy reads the model so a range across virtualized
 * gaps stays whole (§13.9). `virtualize={false}` keeps the Phase 4 all-mounted
 * render, the maintained path docs/015's reader builds on.
 */

export type OwnedModelEditorViewDiagnostics = {
  readonly activeNodeId: NodeId | null;
  readonly activeInputBackend: "native" | "polyfill" | null;
  readonly blockTexts: Readonly<Record<NodeId, string>>;
  readonly mountedCount: number;
  readonly order: readonly NodeId[];
  readonly renderCounts: Readonly<Record<NodeId, number>>;
  readonly scheduler: EnginePerformanceSnapshot;
  readonly selection: EditorSelection | null;
  readonly selectionOverlayRenderCount: number;
  readonly selectionRectCount: number;
  readonly virtualized: boolean;
  readonly windowStart: number;
  readonly windowEnd: number;
  readonly totalHeight: number;
  readonly scrollTop: number;
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
  /** Scroll an offscreen block into view, correcting after it is measured. */
  readonly scrollToBlock: (id: NodeId) => void;
  /** The current model selection serialized to plain text (cross-virtual copy). */
  readonly serializeSelection: () => string;
  /** The public command/undo/dirty/event control surface (docs/011 §12.2). */
  readonly getEditorHandle: () => OwnedEditorHandle;
};

export type OwnedModelEditorViewProps = {
  readonly store: EditorStore;
  readonly scheduler?: EngineScheduler;
  readonly forcePolyfill?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly diagnosticsKey?: string;
  /**
   * Window the body order so only the viewport slice mounts (docs/011 §2.6).
   * Defaults to `true`. Set `false` to mount every block, the maintained
   * non-virtualized render Phase 4 proves and docs/015's reader builds on.
   */
  readonly virtualize?: boolean;
  /** Scroller height for the virtualized path; ignored when `virtualize` is false. */
  readonly viewportHeight?: number;
  /** Overscan blocks kept mounted on each side of the viewport. */
  readonly overscan?: number;
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
  readonly inputBackends: Map<NodeId, "native" | "polyfill">;
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
    forcePolyfill = true,
    className,
    style,
    diagnosticsKey,
    virtualize = true,
    viewportHeight = DEFAULT_VIEWPORT_HEIGHT,
    overscan = DEFAULT_OVERSCAN,
  } = props;
  const localSchedulerRef = useRef<EngineScheduler | null>(null);
  if (!providedScheduler && !localSchedulerRef.current) {
    localSchedulerRef.current = createEngineScheduler();
  }
  const scheduler = providedScheduler ?? localSchedulerRef.current!;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const heightCacheRef = useRef<Map<NodeId, number>>(new Map());
  const estimateRef = useRef<number>(DEFAULT_BLOCK_ESTIMATE);
  const estimateLockedRef = useRef<boolean>(false);
  const pendingScrollRef = useRef<{
    readonly id: NodeId;
    readonly attempts: number;
  } | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const dragAnchorRef = useRef<TextPoint | null>(null);
  const draggingRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const autoscrollFrameRef = useRef<number | null>(null);
  const registryRef = useRef<RenderRegistry>({
    blockRefs: new Map(),
    inputBackends: new Map(),
    renderCounts: new Map(),
    selectionOverlayRenderCount: 0,
    selectionRectCount: 0,
  });
  const order = useEditorOrder(store);
  const [scrollTop, setScrollTop] = useState(0);
  const [measureVersion, setMeasureVersion] = useState(0);

  /*
   * The window is the body-order slice the viewport covers plus overscan
   * (docs/011 §2.6). Item sizes come from the measured height cache, falling
   * back to a running estimate for blocks not yet mounted, so a block scrolled
   * out and back keeps its size and the scroll geometry stays stable.
   */
  const windowRange = useMemo(() => {
    if (!virtualize) {
      return {
        afterHeight: 0,
        beforeHeight: 0,
        endIndex: order.length,
        ids: order,
        startIndex: 0,
        totalHeight: 0,
      };
    }
    const range = calculateVirtualRange({
      getItemSize: (index) =>
        heightCacheRef.current.get(order[index]!) ?? estimateRef.current,
      itemCount: order.length,
      overscan,
      scrollOffset: scrollTop,
      viewportSize: viewportHeight,
    });
    return { ...range, ids: order.slice(range.startIndex, range.endIndex) };
    // measureVersion forces a recompute after the height cache changes.
  }, [virtualize, order, scrollTop, measureVersion, overscan, viewportHeight]);

  const registerBlock = useCallback(
    (id: NodeId, element: HTMLElement | null) => {
      if (element) {
        registryRef.current.blockRefs.set(id, element);
      } else {
        registryRef.current.blockRefs.delete(id);
        registryRef.current.inputBackends.delete(id);
      }
    },
    [],
  );

  const registerInputBackend = useCallback(
    (id: NodeId, backend: "native" | "polyfill" | null) => {
      if (backend) {
        registryRef.current.inputBackends.set(id, backend);
      } else {
        registryRef.current.inputBackends.delete(id);
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

  const scrollToBlock = useCallback(
    (id: NodeId) => {
      const index = store.order.indexOf(id);
      if (index < 0) return;
      if (!virtualize) {
        registryRef.current.blockRefs
          .get(id)
          ?.scrollIntoView({ block: "start" });
        return;
      }
      let offset = 0;
      for (let i = 0; i < index; i += 1) {
        offset +=
          heightCacheRef.current.get(store.order[i]!) ?? estimateRef.current;
      }
      // First jump uses estimated offset; the measure effect then corrects it
      // to the target's real layout position, iterating until stable (AC3).
      pendingScrollRef.current = { attempts: 0, id };
      if (rootRef.current) rootRef.current.scrollTop = offset;
      setScrollTop(offset);
    },
    [store, virtualize],
  );

  // Keyboard caret/selection movement must keep the focus visible, the way a
  // browser scrolls a contenteditable caret into view. We paint the caret and
  // pass `preventScroll` on focus, so nothing scrolls for free; worse, under
  // virtualization a focus that crosses the mounted window+overscan band would
  // unmount, stranding the overlay. `revealBlock` reveals the *caret line*, not
  // the whole block: a block-granular reveal would yank an entire multi-line
  // block into view on a one-line move, the aggressive jump a native editor
  // never makes. It scrolls the minimum needed (with a small lead margin so the
  // caret is not flush to the edge) and only estimate-jumps when the target is
  // off the mounted window entirely.
  const revealBlock = useCallback(
    (id: NodeId) => {
      const scroller = rootRef.current;
      if (!scroller) return;
      const element = registryRef.current.blockRefs.get(id);
      if (!virtualize) {
        element?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (element) {
        const selection = store.selection;
        const focusOffset =
          selection?.type === "text" && selection.focus.node === id
            ? selection.focus.offset
            : null;
        const targetRect =
          focusOffset === null
            ? element.getBoundingClientRect()
            : (caretClientRect(element, focusOffset) ??
              element.getBoundingClientRect());
        const viewRect = scroller.getBoundingClientRect();
        const top = targetRect.top - viewRect.top;
        const bottom = targetRect.bottom - viewRect.top;
        const margin = CARET_REVEAL_MARGIN_PX;
        let delta = 0;
        if (top < margin) delta = top - margin;
        else if (bottom > scroller.clientHeight - margin)
          delta = bottom - (scroller.clientHeight - margin);
        if (Math.abs(delta) > 0.5) {
          scroller.scrollTop += delta;
          setScrollTop(scroller.scrollTop);
        }
        return;
      }
      // Focus jumped past the mounted window: estimate the target offset so it
      // mounts near the viewport bottom; the next reveal settles it precisely.
      const index = store.order.indexOf(id);
      if (index < 0) return;
      let offset = 0;
      for (let i = 0; i < index; i += 1) {
        offset +=
          heightCacheRef.current.get(store.order[i]!) ?? estimateRef.current;
      }
      const next = Math.max(
        0,
        offset - scroller.clientHeight + estimateRef.current,
      );
      scroller.scrollTop = next;
      setScrollTop(next);
    },
    [store, virtualize],
  );

  const serializeSelection = useCallback(
    () => collectSelectionText(store, store.selection),
    [store],
  );

  const onClipboardCopy = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      // Clipboard reads the model, not the DOM, so a range spanning virtualized
      // gaps copies the full text including the offscreen middle (docs/011 §13.9).
      const text = collectSelectionText(store, store.selection);
      if (!text) return;
      event.clipboardData?.setData("text/plain", text);
      event.preventDefault();
    },
    [store],
  );

  // Focus and reveal the block the model selection now points at, after a
  // structural/clipboard command moves the caret. Deferred a frame so the new
  // block has mounted (React flushes the order change after the handler).
  const syncFocusToSelection = useCallback(() => {
    requestFrame(() => {
      const sel = store.selection;
      const focusNode = sel?.type === "text" ? sel.focus.node : null;
      if (!focusNode) return;
      registryRef.current.blockRefs
        .get(focusNode)
        ?.focus({ preventScroll: true });
    });
  }, [store]);

  const onClipboardCut = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      // Cut writes the model serialization, then deletes the selection through
      // the command layer so the delete is one invertible transaction (AC5).
      const text = collectSelectionText(store, store.selection);
      if (!text) return;
      event.clipboardData?.setData("text/plain", text);
      event.preventDefault();
      store.command({ type: "delete-selection" });
      syncFocusToSelection();
    },
    [store, syncFocusToSelection],
  );

  const onClipboardPaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      // Paste inserts plain text at the selection, replacing a range (AC5).
      const text = event.clipboardData?.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      store.command({ type: "insert-text", text });
      syncFocusToSelection();
    },
    [store, syncFocusToSelection],
  );

  const onScroll = useCallback(() => {
    if (!virtualize || scrollFrameRef.current !== null) return;
    // Coalesce scroll onto one frame; recompute the window per painted frame,
    // never per scroll tick (docs/011 §10.3).
    scrollFrameRef.current = requestFrame(() => {
      scrollFrameRef.current = null;
      const element = rootRef.current;
      if (element) setScrollTop(element.scrollTop);
    });
  }, [virtualize]);

  const beginDrag = useCallback((anchor: TextPoint) => {
    dragAnchorRef.current = anchor;
    draggingRef.current = true;
  }, []);

  const extendDragToPointer = useCallback(() => {
    // Extend the model selection from the drag anchor to whatever block/offset
    // the pointer is over (docs/011 §8.3). Reads the model, so the range is
    // valid even though only the mounted window is in the DOM.
    const anchor = dragAnchorRef.current;
    const pointer = lastPointerRef.current;
    const root = rootRef.current;
    if (!anchor || !pointer || !root) return;
    // Resolve to the nearest text leaf, so a drag passes through the `[list]`
    // placeholder and the gaps instead of stalling on a non-text block.
    const hit = resolveTextPointAt(store, root, pointer.x, pointer.y);
    if (!hit) return;
    const target = store.getNode(hit.node);
    if (!target || target.kind !== "text") return;
    const focus = pointAtOffset(
      hit.node,
      target.content,
      clampOffset(hit.offset, target.content.text.length),
    );
    store.dispatch({
      origin: "local",
      selectionAfter: { anchor, focus, type: "text" },
      steps: [],
    });
  }, [store]);

  // Clicking the white gaps around the content (most visibly the empty area
  // below the last block) places the caret in the nearest text leaf, the way a
  // real editor maps a click in empty space to the closest text position. Block
  // clicks are handled per-block; this only fires when the click misses them.
  const onRootMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as Element;
      if (target.closest("[data-engine-block-id]")) return;
      const root = rootRef.current;
      if (!root) return;
      const point = resolveTextPointAt(
        store,
        root,
        event.clientX,
        event.clientY,
      );
      if (!point) return;
      const node = store.requireTextNode(point.node);
      const focus = pointAtOffset(
        point.node,
        node.content,
        clampOffset(point.offset, node.content.text.length),
      );
      const existing = store.selection;
      const anchor =
        event.shiftKey && existing?.type === "text" ? existing.anchor : focus;
      store.dispatch({
        origin: "local",
        selectionAfter: { anchor, focus, type: "text" },
        steps: [],
      });
      focusBlock(point.node);
      beginDrag(anchor);
    },
    [beginDrag, focusBlock, store],
  );

  const stopAutoscroll = useCallback(() => {
    if (autoscrollFrameRef.current !== null) {
      cancelFrame(autoscrollFrameRef.current);
      autoscrollFrameRef.current = null;
    }
  }, []);

  const handleDragMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!draggingRef.current) return;
      lastPointerRef.current = { x: clientX, y: clientY };
      extendDragToPointer();
      // Autoscroll while a drag is held near a viewport edge so the selection
      // can reach offscreen blocks (docs/010 Phase 5 AC4).
      const scroller = rootRef.current;
      if (!virtualize || !scroller) return;
      const rect = scroller.getBoundingClientRect();
      const edge = 28;
      const below = clientY - rect.top < edge;
      const above = rect.bottom - clientY < edge;
      if (!below && !above) {
        stopAutoscroll();
        return;
      }
      if (autoscrollFrameRef.current !== null) return;
      const step = () => {
        if (!draggingRef.current) {
          autoscrollFrameRef.current = null;
          return;
        }
        const delta = below ? -AUTOSCROLL_STEP_PX : AUTOSCROLL_STEP_PX;
        scroller.scrollTop += delta;
        setScrollTop(scroller.scrollTop);
        extendDragToPointer();
        autoscrollFrameRef.current = requestFrame(step);
      };
      autoscrollFrameRef.current = requestFrame(step);
    },
    [extendDragToPointer, stopAutoscroll, virtualize],
  );

  const endDrag = useCallback(() => {
    draggingRef.current = false;
    dragAnchorRef.current = null;
    lastPointerRef.current = null;
    stopAutoscroll();
  }, [stopAutoscroll]);

  // Track the drag on the document, not the editor element, so it keeps
  // extending when the pointer leaves the editor and resumes on re-entry, and
  // ends on pointerup anywhere — the way a real text drag behaves. The listeners
  // early-out unless a drag is active, so they are cheap when idle.
  useEffect(() => {
    const view = rootRef.current?.ownerDocument.defaultView ?? globalThis;
    const onMove = (event: PointerEvent) => {
      if (draggingRef.current) handleDragMove(event.clientX, event.clientY);
    };
    const onUp = () => {
      if (draggingRef.current) endDrag();
    };
    view.addEventListener("pointermove", onMove);
    view.addEventListener("pointerup", onUp);
    return () => {
      view.removeEventListener("pointermove", onMove);
      view.removeEventListener("pointerup", onUp);
    };
  }, [endDrag, handleDragMove]);

  useLayoutEffect(() => {
    if (!virtualize) return;
    const cache = heightCacheRef.current;
    let changed = false;
    let total = 0;
    let count = 0;
    for (const [id, element] of registryRef.current.blockRefs) {
      const height = element.offsetHeight;
      if (height <= 0) continue;
      total += height;
      count += 1;
      if (cache.get(id) !== height) {
        cache.set(id, height);
        changed = true;
      }
    }
    /*
     * Lock the unmeasured-block estimate to the first real measurement. The
     * offset model the window math builds (docs/011 §2.6) must stay stable
     * across frames; letting the estimate drift per frame would re-derive every
     * offset and walk the window away from a scroll-to-block target (AC3).
     */
    if (!estimateLockedRef.current && count > 0) {
      estimateRef.current = Math.max(1, Math.round(total / count));
      estimateLockedRef.current = true;
    }
    const pending = pendingScrollRef.current;
    if (pending) {
      const element = registryRef.current.blockRefs.get(pending.id);
      const scroller = rootRef.current;
      if (element && scroller) {
        const target = element.offsetTop;
        // Re-assert the target's real position across frames until it stops
        // moving (newly measured blocks can shift it), so a variable-height
        // document still lands within tolerance, not only the uniform story.
        if (
          Math.abs(scroller.scrollTop - target) <= 1 ||
          pending.attempts >= 6
        ) {
          pendingScrollRef.current = null;
        } else {
          pendingScrollRef.current = {
            attempts: pending.attempts + 1,
            id: pending.id,
          };
          scroller.scrollTop = target;
          setScrollTop(target);
        }
      }
    }
    if (changed) setMeasureVersion((value) => value + 1);
  }, [virtualize, windowRange.ids, measureVersion]);

  const diagnostics = useCallback((): OwnedModelEditorViewDiagnostics => {
    const blockTexts: Record<NodeId, string> = {};
    for (const id of store.order) {
      const node = store.requireNode(id);
      if (node.kind === "text") blockTexts[id] = node.content.text;
    }
    const activeNodeId = activeSelectionNode(store.selection);
    return {
      activeInputBackend: activeNodeId
        ? (registryRef.current.inputBackends.get(activeNodeId) ?? null)
        : null,
      activeNodeId,
      blockTexts,
      mountedCount: registryRef.current.blockRefs.size,
      order: [...store.order],
      renderCounts: Object.fromEntries(registryRef.current.renderCounts),
      scheduler: scheduler.snapshot(),
      scrollTop: rootRef.current?.scrollTop ?? scrollTop,
      selection: store.selection,
      selectionOverlayRenderCount:
        registryRef.current.selectionOverlayRenderCount,
      selectionRectCount: registryRef.current.selectionRectCount,
      totalHeight: windowRange.totalHeight,
      virtualized: virtualize,
      windowEnd: windowRange.endIndex,
      windowStart: windowRange.startIndex,
    };
  }, [scheduler, scrollTop, store, virtualize, windowRange]);

  // One public handle per store; the focuser re-points DOM focus at whatever
  // block the model selection currently names.
  const editorHandleRef = useRef<{
    store: EditorStore;
    handle: OwnedEditorHandle;
  } | null>(null);
  const getEditorHandle = useCallback((): OwnedEditorHandle => {
    if (editorHandleRef.current?.store !== store) {
      editorHandleRef.current = {
        handle: createOwnedEditorHandle(store, {
          focus: () => syncFocusToSelection(),
        }),
        store,
      };
    }
    return editorHandleRef.current.handle;
  }, [store, syncFocusToSelection]);

  const api = useMemo<OwnedModelEditorViewHandle>(
    () => ({
      diagnostics,
      focusBlock,
      getEditorHandle,
      scrollToBlock,
      selectText,
      serializeSelection,
    }),
    [
      diagnostics,
      focusBlock,
      getEditorHandle,
      scrollToBlock,
      selectText,
      serializeSelection,
    ],
  );

  useImperativeHandle(ref, () => api, [api]);

  useEffect(() => {
    if (!diagnosticsKey || typeof window === "undefined") return;
    (window as unknown as Record<string, unknown>)[diagnosticsKey] = api;
    return () => {
      delete (window as unknown as Record<string, unknown>)[diagnosticsKey];
    };
  }, [api, diagnosticsKey]);

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) cancelFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    },
    [],
  );

  const blocks = windowRange.ids.map((id) => (
    <EngineBlock
      beginDrag={beginDrag}
      forcePolyfill={forcePolyfill}
      id={id}
      key={id}
      onRender={recordBlockRender}
      registerBlock={registerBlock}
      registerInputBackend={registerInputBackend}
      requestFocus={focusBlock}
      revealBlock={revealBlock}
      store={store}
    />
  ));

  if (!virtualize) {
    return (
      <div
        ref={rootRef}
        className={className}
        data-engine-view-root=""
        onCopy={onClipboardCopy}
        onCut={onClipboardCut}
        onMouseDown={onRootMouseDown}
        onPaste={onClipboardPaste}
        role="application"
        style={{ ...baseViewStyle, padding: 16, ...style }}
      >
        {blocks}
        <SelectionOverlay
          registry={registryRef.current}
          rootRef={rootRef}
          scheduler={scheduler}
          store={store}
        />
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={className}
      data-engine-view-root=""
      data-engine-virtualized=""
      onCopy={onClipboardCopy}
      onCut={onClipboardCut}
      onMouseDown={onRootMouseDown}
      onPaste={onClipboardPaste}
      onScroll={onScroll}
      role="application"
      style={{
        ...baseViewStyle,
        height: viewportHeight,
        overflowY: "auto",
        padding: 0,
        ...style,
      }}
    >
      <div
        ref={contentRef}
        data-engine-view-content=""
        style={{ height: windowRange.totalHeight, position: "relative" }}
      >
        <div
          data-engine-view-spacer="top"
          style={{ height: windowRange.beforeHeight }}
        />
        {blocks}
        <SelectionOverlay
          registry={registryRef.current}
          rootRef={contentRef}
          scheduler={scheduler}
          store={store}
        />
      </div>
    </div>
  );
});

const DEFAULT_VIEWPORT_HEIGHT = 480;
const DEFAULT_OVERSCAN = 4;
const DEFAULT_BLOCK_ESTIMATE = 40;
const AUTOSCROLL_STEP_PX = 12;
// Lead the caret keeps from the viewport edge when keyboard movement scrolls it
// into view (~one line). Small enough that each line-move scrolls about one
// line, not a whole block. Trivially promotable to a prop if a knob is wanted.
const CARET_REVEAL_MARGIN_PX = 24;

const baseViewStyle: CSSProperties = {
  border: "1px solid color-mix(in srgb, CanvasText 18%, transparent)",
  borderRadius: 8,
  color: "CanvasText",
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  lineHeight: 1.55,
  maxWidth: 920,
  position: "relative",
};

function requestFrame(callback: () => void): number {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame(callback);
  }
  return setTimeout(callback, 16) as unknown as number;
}

function cancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
  clearTimeout(handle);
}

function EngineBlock(props: {
  readonly id: NodeId;
  readonly store: EditorStore;
  readonly forcePolyfill: boolean;
  readonly registerBlock: (id: NodeId, element: HTMLElement | null) => void;
  readonly registerInputBackend: (
    id: NodeId,
    backend: "native" | "polyfill" | null,
  ) => void;
  readonly onRender: (id: NodeId) => void;
  readonly requestFocus: (id: NodeId) => void;
  readonly revealBlock: (id: NodeId) => void;
  readonly beginDrag: (anchor: TextPoint) => void;
}) {
  const {
    id,
    store,
    forcePolyfill,
    registerBlock,
    registerInputBackend,
    onRender,
    requestFocus,
    revealBlock,
    beginDrag,
  } = props;
  const node = useEditorNode(store, id);
  onRender(id);
  // The node was removed in the same tick (merge/delete); render nothing until
  // the order change unmounts this block.
  if (!node) return null;
  if (node.kind === "text") {
    return (
      <EngineTextBlock
        beginDrag={beginDrag}
        forcePolyfill={forcePolyfill}
        node={node}
        registerBlock={registerBlock}
        registerInputBackend={registerInputBackend}
        requestFocus={requestFocus}
        revealBlock={revealBlock}
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
  readonly registerInputBackend: (
    id: NodeId,
    backend: "native" | "polyfill" | null,
  ) => void;
  readonly requestFocus: (id: NodeId) => void;
  readonly revealBlock: (id: NodeId) => void;
  readonly beginDrag: (anchor: TextPoint) => void;
}) {
  const {
    node,
    store,
    forcePolyfill,
    registerBlock,
    registerInputBackend,
    requestFocus,
    revealBlock,
    beginDrag,
  } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<TextBlockController | null>(null);

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
    patchHostText(hostRef.current, editContext.text);
    // The DOM text is now current, so the commit may skip re-rendering this leaf
    // (the typing fast path). Command-driven edits never call this, so they
    // re-render and stay visible.
    store.markActiveLeafDomSynced();
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
    const current = store.requireTextNode(node.id);
    const length = current.content.text.length;
    const editContext = new Ctor({
      selectionEnd: length,
      selectionStart: length,
      text: current.content.text,
    });
    editContext.addEventListener("textupdate", onTextUpdate);
    (host as unknown as { editContext: EditContextLike }).editContext =
      editContext;
    const destroy = () => {
      editContext.removeEventListener("textupdate", onTextUpdate);
      (host as unknown as { editContext: EditContextLike | null }).editContext =
        null;
      registerInputBackend(node.id, null);
      if (forcePolyfill) releaseForcedInstall();
    };
    registerInputBackend(node.id, backend);
    controllerRef.current = { backend, destroy, editContext };
    return controllerRef.current;
  }, [forcePolyfill, node.id, onTextUpdate, registerInputBackend, store]);

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
      store.deactivateTextLeaf(node.id);
    },
    [node.id, store],
  );

  const bindRef = useCallback(
    (element: HTMLDivElement | null) => {
      hostRef.current = element;
      registerBlock(node.id, element);
    },
    [node.id, registerBlock],
  );

  const applyCaret = useCallback(
    (offset: number, extendFrom?: TextPoint) => {
      const current = store.getNode(node.id);
      if (!current || current.kind !== "text") return;
      const clamped = clampOffset(offset, current.content.text.length);
      store.activateTextLeaf(node.id);
      const controller = ensureController();
      const focus = pointAtOffset(node.id, current.content, clamped);
      store.dispatch({
        origin: "local",
        selectionAfter: { anchor: extendFrom ?? focus, focus, type: "text" },
        steps: [],
      });
      controller?.editContext.updateSelection(clamped, clamped);
      if (controller?.backend === "polyfill" && hostRef.current) {
        syncPolyfillSelection(hostRef.current);
      }
    },
    [ensureController, node.id, store],
  );

  const focusAtEnd = useCallback(() => {
    const current = store.requireTextNode(node.id);
    const existing = store.selection;
    // When focus follows the caret into this block (e.g. shift+arrow extending a
    // range across a boundary), keep the existing anchor so the selection is not
    // collapsed by the programmatic focus. Only a fresh focus drops a caret.
    if (existing?.type === "text" && existing.focus.node === node.id) {
      applyCaret(existing.focus.offset, existing.anchor);
      return;
    }
    applyCaret(current.content.text.length);
  }, [applyCaret, node.id, store]);

  const selectRangeInBlock = useCallback(
    (from: number, to: number) => {
      const current = store.requireTextNode(node.id);
      const anchor = pointAtOffset(node.id, current.content, from);
      const focus = pointAtOffset(node.id, current.content, to);
      store.activateTextLeaf(node.id);
      const controller = ensureController();
      store.dispatch({
        origin: "local",
        selectionAfter: { anchor, focus, type: "text" },
        steps: [],
      });
      controller?.editContext.updateSelection(
        Math.min(from, to),
        Math.max(from, to),
      );
      if (controller?.backend === "polyfill" && hostRef.current) {
        syncPolyfillSelection(hostRef.current);
      }
      beginDrag(anchor);
    },
    [beginDrag, ensureController, node.id, store],
  );

  const focusAtClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // Map the click to a model offset (docs/011 \u00a78.3 click-to-position), not
      // the end of the block. Fall back to the end only if the point misses the
      // text (e.g. a click in the block padding).
      const host = hostRef.current;
      const current = store.requireTextNode(node.id);
      const offset = clampOffset(
        (host
          ? offsetFromClientPoint(host, event.clientX, event.clientY)
          : null) ?? current.content.text.length,
        current.content.text.length,
      );
      // Double-click selects the word under the pointer; triple-click selects
      // the whole block (docs/011 \u00a78.3 gesture-to-range via Intl.Segmenter).
      if (event.detail === 2) {
        const [from, to] = wordRangeAt(current.content.text, offset);
        selectRangeInBlock(from, to);
        return;
      }
      if (event.detail >= 3) {
        selectRangeInBlock(0, current.content.text.length);
        return;
      }
      const focus = pointAtOffset(node.id, current.content, offset);
      // Shift-click extends from the existing anchor; a plain click collapses.
      // Either way the anchor becomes the drag anchor so a press-move-release
      // paints a range (docs/010 Phase 5 AC4 selection).
      const existing = store.selection;
      const anchor =
        event.shiftKey && existing?.type === "text" ? existing.anchor : focus;
      store.activateTextLeaf(node.id);
      const controller = ensureController();
      store.dispatch({
        origin: "local",
        selectionAfter: { anchor, focus, type: "text" },
        steps: [],
      });
      controller?.editContext.updateSelection(offset, offset);
      if (controller?.backend === "polyfill" && hostRef.current) {
        syncPolyfillSelection(hostRef.current);
      }
      beginDrag(anchor);
    },
    [beginDrag, ensureController, node.id, selectRangeInBlock, store],
  );

  const moveSelection = useCallback(
    (next: EditorSelection) => {
      store.dispatch({ origin: "local", selectionAfter: next, steps: [] });
      // Keep DOM focus on the block the caret now lives in, or the next
      // keystroke (typing or another arrow) lands on the stale block. This is
      // the focus-follows-caret rule a model-owned selection needs.
      const focusNode = next.type === "text" ? next.focus.node : node.id;
      if (focusNode !== node.id) requestFocus(focusNode);
      else syncSelectionIntoEditContext();
      // Follow the caret: scroll the focus into view on every keyboard move,
      // including same-block moves down a tall block, so it never slides off.
      revealBlock(focusNode);
    },
    [node.id, requestFocus, revealBlock, store, syncSelectionIntoEditContext],
  );

  // After a command/undo/redo moves the caret, focus and reveal the block it
  // now lives in, deferred a frame so the structural change has committed.
  const focusSelectionSoon = useCallback(() => {
    requestFrame(() => {
      const sel = store.selection;
      const focusNode = sel?.type === "text" ? sel.focus.node : null;
      if (!focusNode) return;
      if (focusNode !== node.id) requestFocus(focusNode);
      else syncSelectionIntoEditContext();
      revealBlock(focusNode);
    });
  }, [node.id, requestFocus, revealBlock, store, syncSelectionIntoEditContext]);

  const runEditCommand = useCallback(
    (command: EditorCommand) => {
      if (store.command(command)) focusSelectionSoon();
    },
    [focusSelectionSoon, store],
  );

  const selectAll = useCallback(() => {
    // Select the whole virtualized document, end to end, in document order.
    const leaves = orderedTextLeaves(store);
    if (leaves.length === 0) return;
    const first = leaves[0]!.node;
    const last = leaves.at(-1)!.node;
    store.dispatch({
      origin: "local",
      selectionAfter: {
        anchor: pointAtOffset(first.id, first.content, 0),
        focus: pointAtOffset(last.id, last.content, last.content.text.length),
        type: "text",
      },
      steps: [],
    });
    focusSelectionSoon();
  }, [focusSelectionSoon, store]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const selection = store.selection;
      if (selection?.type !== "text" || selection.focus.node !== node.id) {
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === "z") {
          event.preventDefault();
          if (event.shiftKey) store.redo();
          else store.undo();
          focusSelectionSoon();
        } else if (key === "y") {
          event.preventDefault();
          store.redo();
          focusSelectionSoon();
        } else if (key === "a") {
          event.preventDefault();
          selectAll();
        }
        // copy/cut/paste flow through the root clipboard events, not here.
        return;
      }
      // Structural editing keys compile to commands (docs/010 §6.12, AC3/AC5).
      if (event.key === "Enter") {
        event.preventDefault();
        // Shift+Enter inserts a soft line break inside the current block (blocks
        // render `\n` as pre-wrap); plain Enter splits into a new block.
        runEditCommand(
          event.shiftKey
            ? { text: "\n", type: "insert-text" }
            : { type: "split-block" },
        );
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        runEditCommand({ type: event.shiftKey ? "outdent" : "indent" });
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        const current = store.requireTextNode(node.id);
        const collapsed = isCollapsedSelection(selection);
        const atStart = selection.focus.offset === 0;
        const atEnd = selection.focus.offset === current.content.text.length;
        if (!collapsed) {
          event.preventDefault();
          runEditCommand({ type: "delete-selection" });
        } else if (event.key === "Backspace" && atStart) {
          event.preventDefault();
          runEditCommand({ type: "delete-backward" });
        } else if (event.key === "Delete" && atEnd) {
          event.preventDefault();
          runEditCommand({ type: "delete-forward" });
        }
        // A mid-leaf collapsed delete falls through to the input controller,
        // which already mutates this leaf's text on the fast path.
        return;
      }
      event.stopPropagation();
      const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
      // Vertical nav uses browser line geometry inside a wrapped block; at the
      // first/last line the probe lands in the inter-block gap and returns
      // nothing or the same spot, so fall back to a block-level jump.
      const lineMove = vertical
        ? verticalNavigation(
            store,
            selection,
            hostRef.current,
            event.key === "ArrowUp" ? -1 : 1,
            event.shiftKey,
          )
        : null;
      const next =
        lineMove && !samePoint(lineMove, selection)
          ? lineMove
          : selectionForNavigation(store, selection, event.key, event.shiftKey);
      if (!next || samePoint(next, selection)) return;
      event.preventDefault();
      moveSelection(next);
    },
    [moveSelection, node.id, store],
  );

  return (
    <div
      aria-label={`Block ${node.id}`}
      data-engine-block-id={node.id}
      data-engine-text-id={node.id}
      onFocus={focusAtEnd}
      onKeyDown={handleKeyDown}
      onMouseDown={focusAtClick}
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
      <style>{CARET_BLINK_KEYFRAMES}</style>
      {rects.map((rect, index) => {
        const isCaret = rect.kind === "caret";
        return (
          <div
            data-engine-caret={isCaret ? "" : undefined}
            data-engine-selection-rect=""
            // Keying a caret by its pixel position recreates the element when it
            // moves, restarting the blink so it shows solid right after a move,
            // the way a native insertion bar does (mirrors the spike).
            key={
              isCaret
                ? `caret-${Math.round(rect.left)}-${Math.round(rect.top)}`
                : `range-${rect.node}-${index}`
            }
            style={{
              animation: isCaret
                ? "idco-caret-blink 1.06s step-end infinite"
                : undefined,
              background: isCaret
                ? "CanvasText"
                : "color-mix(in srgb, Highlight 36%, transparent)",
              borderRadius: isCaret ? 1 : 3,
              height: rect.height,
              left: rect.left,
              position: "absolute",
              top: rect.top,
              // The caret must snap, not slide; a global `transition: all` would
              // otherwise animate its position and make it look laggy.
              transition: "none",
              width: rect.width,
            }}
          />
        );
      })}
    </div>
  );
}

const CARET_BLINK_KEYFRAMES =
  "@keyframes idco-caret-blink{0%,50%{opacity:1}51%,100%{opacity:0}}";

function useEditorOrder(store: EditorStore): readonly NodeId[] {
  return useSyncExternalStore(
    (listener) => store.subscribeOrder(listener),
    () => store.order,
    () => store.order,
  );
}

function useEditorNode(store: EditorStore, id: NodeId) {
  // Tolerate a just-removed node: a merge/delete notifies the removed block's
  // subscribers before React reconciles the order change and unmounts it, so the
  // snapshot must return undefined rather than throw. The block renders null for
  // that one frame and then unmounts.
  return useSyncExternalStore(
    (listener) => store.subscribeNode(id, listener),
    () => store.getViewNode(id),
    () => store.getViewNode(id),
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

/** The nearest text leaf to `fromIndex` in `direction`, skipping non-text blocks. */
function adjacentTextLeaf(
  store: EditorStore,
  fromIndex: number,
  direction: -1 | 1,
): TextLeafNode | null {
  const order = store.order;
  for (
    let i = fromIndex + direction;
    i >= 0 && i < order.length;
    i += direction
  ) {
    const node = store.getNode(order[i]!);
    if (node && node.kind === "text") return node;
  }
  return null;
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
  // Non-text blocks (a structural `list` placeholder) are stepped over, not
  // treated as a wall: navigation lands on the nearest text leaf so arrows and
  // shift+arrow cross the list to the next/previous paragraph.
  if (key === "ArrowRight") {
    if (offset < current.content.text.length) {
      offset += 1;
    } else {
      const next = adjacentTextLeaf(store, currentIndex, 1);
      if (!next) return null;
      targetNode = next;
      offset = 0;
    }
  } else if (key === "ArrowLeft") {
    if (offset > 0) {
      offset -= 1;
    } else {
      const prev = adjacentTextLeaf(store, currentIndex, -1);
      if (!prev) return null;
      targetNode = prev;
      offset = prev.content.text.length;
    }
  } else if (key === "ArrowDown") {
    const next = adjacentTextLeaf(store, currentIndex, 1);
    if (!next) return null;
    targetNode = next;
    offset = Math.min(offset, targetNode.content.text.length);
  } else if (key === "ArrowUp") {
    const prev = adjacentTextLeaf(store, currentIndex, -1);
    if (!prev) return null;
    targetNode = prev;
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

/**
 * Vertical caret movement by visual line, using browser geometry.
 *
 * docs/011 §8.3 reuses `caretPositionFromPoint`: drop a probe one line above or
 * below the caret's current pixel position and ask the browser which model
 * offset sits there. This moves by the rendered line, so it works inside a
 * wrapped multi-line block, not only block-to-block. A persistent goal column
 * across several presses is the Phase 7 refinement and is not tracked here.
 */
function verticalNavigation(
  store: EditorStore,
  selection: Extract<EditorSelection, { type: "text" }>,
  host: HTMLElement | null,
  direction: -1 | 1,
  extend: boolean,
): EditorSelection | null {
  if (!host) return null;
  const rect = caretClientRect(host, selection.focus.offset);
  if (!rect) return null;
  const probeX = rect.left;
  const lineStep = Math.max(8, rect.height || 16);
  const probeY =
    direction < 0 ? rect.top - lineStep * 0.5 : rect.bottom + lineStep * 0.5;
  const hit = pointToModelPosition(host.ownerDocument, probeX, probeY);
  if (!hit) return null;
  const target = store.getNode(hit.id);
  if (!target || target.kind !== "text") return null;
  const focus = pointAtOffset(
    hit.id,
    target.content,
    clampOffset(hit.offset, target.content.text.length),
  );
  return { anchor: extend ? selection.anchor : focus, focus, type: "text" };
}

/** Whether a text selection is a collapsed caret (anchor === focus). */
function isCollapsedSelection(
  selection: Extract<EditorSelection, { type: "text" }>,
): boolean {
  return (
    selection.anchor.node === selection.focus.node &&
    selection.anchor.offset === selection.focus.offset
  );
}

/** Whether a navigation result leaves the caret where it already is. */
function samePoint(
  next: EditorSelection,
  current: Extract<EditorSelection, { type: "text" }>,
): boolean {
  return (
    next.type === "text" &&
    next.focus.node === current.focus.node &&
    next.focus.offset === current.focus.offset
  );
}

/**
 * Map a client point to a model offset within one block's text node.
 *
 * A click in the block's padding or at its left/right/top/bottom edge makes
 * `caretPositionFromPoint` miss the text node (it returns the block element with
 * a child index, or a neighbour), which previously dropped the caret at the end
 * of the block. We clamp the point into the text's bounding box and retry, so an
 * edge click lands on the nearest character — the reliable behaviour a user
 * expects when clicking just outside the glyphs.
 */
function offsetFromClientPoint(
  host: HTMLElement,
  clientX: number,
  clientY: number,
): number | null {
  const direct = caretPositionAtPoint(host.ownerDocument, clientX, clientY);
  if (direct && host.contains(direct.node) && isTextNode(direct.node)) {
    return direct.offset;
  }
  const textRect = textBoundingRect(host);
  if (textRect) {
    const cx = clampNumber(clientX, textRect.left + 1, textRect.right - 1);
    const cy = clampNumber(clientY, textRect.top + 1, textRect.bottom - 1);
    const clamped = caretPositionAtPoint(host.ownerDocument, cx, cy);
    if (clamped && host.contains(clamped.node)) return clamped.offset;
  }
  return direct && host.contains(direct.node) ? direct.offset : null;
}

function isTextNode(node: Node): boolean {
  return node.nodeType === node.TEXT_NODE;
}

// Word segmentation for double-click selection (docs/011 §8.3: Intl.Segmenter
// supplies the word gesture; we map it to a model range).
const wordSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : null;

/** The [start, end) range of the word at `offset`, or a collapsed point. */
function wordRangeAt(text: string, offset: number): [number, number] {
  if (!wordSegmenter || text.length === 0) return [offset, offset];
  let result: [number, number] = [offset, offset];
  for (const segment of wordSegmenter.segment(text)) {
    const start = segment.index;
    const end = start + segment.segment.length;
    if (offset >= start && offset < end) {
      result = [start, end];
      if (segment.isWordLike) return result;
    } else if (offset === end && segment.isWordLike) {
      // A click at the trailing edge of a word selects that word.
      result = [start, end];
    }
  }
  return result;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Bounding rect of a block's rendered text (its first text node), or null. */
function textBoundingRect(host: HTMLElement): DOMRect | null {
  const textNode = firstTextNode(host);
  if (!textNode) return null;
  const range = host.ownerDocument.createRange();
  range.selectNodeContents(textNode);
  const rect = range.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 ? rect : null;
}

/** Map a client point to the block id and offset it falls on. */
function pointToModelPosition(
  doc: Document,
  clientX: number,
  clientY: number,
): { readonly id: NodeId; readonly offset: number } | null {
  const caret = caretPositionAtPoint(doc, clientX, clientY);
  if (!caret) return null;
  const element =
    caret.node.nodeType === caret.node.TEXT_NODE
      ? caret.node.parentElement
      : (caret.node as Element);
  const block = element?.closest("[data-engine-block-id]");
  const id = block?.getAttribute("data-engine-block-id");
  return id ? { id: id as NodeId, offset: caret.offset } : null;
}

/**
 * Resolve any pointer position to a model text point, mapping to the nearest
 * text leaf when the pointer lands on a non-text block (the `[list]` placeholder)
 * or misses the content (the white gaps). This is what lets a drag or a gap
 * click pass through a placeholder instead of hitting a wall, and what places
 * the caret in the nearest paragraph when clicking the empty area below the text.
 */
function resolveTextPointAt(
  store: EditorStore,
  root: HTMLElement,
  clientX: number,
  clientY: number,
): { node: NodeId; offset: number } | null {
  const direct = pointToModelPosition(root.ownerDocument, clientX, clientY);
  if (direct) {
    const node = store.getNode(direct.id);
    if (node && node.kind === "text")
      return { node: direct.id, offset: direct.offset };
  }
  // Pick the mounted text block whose vertical span is nearest the pointer.
  let best: {
    id: NodeId;
    el: HTMLElement;
    below: boolean;
    dist: number;
  } | null = null;
  for (const el of root.querySelectorAll<HTMLElement>(
    "[data-engine-block-id]",
  )) {
    const id = el.getAttribute("data-engine-block-id") as NodeId;
    const node = store.getNode(id);
    if (!node || node.kind !== "text") continue;
    const rect = el.getBoundingClientRect();
    const dist =
      clientY < rect.top
        ? rect.top - clientY
        : clientY > rect.bottom
          ? clientY - rect.bottom
          : 0;
    if (!best || dist < best.dist) {
      best = { below: clientY > rect.bottom, dist, el, id };
    }
  }
  if (!best) return null;
  const offset = offsetFromClientPoint(best.el, clientX, clientY);
  if (offset !== null) return { node: best.id, offset };
  const node = store.requireTextNode(best.id);
  return { node: best.id, offset: best.below ? node.content.text.length : 0 };
}

/** Feature-detect the two browser point-to-caret APIs. */
function caretPositionAtPoint(
  doc: Document,
  clientX: number,
  clientY: number,
): { readonly node: Node; readonly offset: number } | null {
  const withPosition = doc as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  };
  if (typeof withPosition.caretPositionFromPoint === "function") {
    const position = withPosition.caretPositionFromPoint(clientX, clientY);
    return position
      ? { node: position.offsetNode, offset: position.offset }
      : null;
  }
  if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(clientX, clientY);
    return range
      ? { node: range.startContainer, offset: range.startOffset }
      : null;
  }
  return null;
}

/** Pixel rect of the collapsed caret at an offset inside one block. */
function caretClientRect(host: HTMLElement, offset: number): DOMRect | null {
  return robustCaretRect(host, offset) ?? host.getBoundingClientRect();
}

/**
 * A single-line-height caret rect for a collapsed position, robust across soft
 * line breaks. A collapsed `Range` returns no client rects at a `\n` boundary
 * (and at the end of a block ending in `\n`), so we measure a neighbouring
 * character and place a zero-width caret at its edge — never the block's full
 * bounding box, which made the caret as tall as the block and grow per line.
 */
function robustCaretRect(host: HTMLElement, offset: number): DOMRect | null {
  const textNode = firstTextNode(host);
  if (!textNode) return null;
  const text = textNode.textContent ?? "";
  const length = text.length;
  const at = clampOffset(offset, length);
  const doc = host.ownerDocument;

  if (at > 0 && text[at - 1] === "\n") {
    const r = softBreakCaretRect(host, doc, textNode, text, at);
    if (r) return r;
  }

  const collapsed = boundingRectOf(doc, textNode, at, at);
  if (collapsed && collapsed.height > 0) return collapsed;

  // Caret sitting just after a visible character: its right edge.
  if (at > 0 && text[at - 1] !== "\n") {
    const r = edgeRectOf(doc, textNode, at - 1, at, "last");
    if (r) return makeRect(r.right, r.top, 0, r.height);
  }
  // Caret sitting just before a visible character: its left edge.
  if (at < length && text[at] !== "\n") {
    const r = edgeRectOf(doc, textNode, at, at + 1, "first");
    if (r) return makeRect(r.left, r.top, 0, r.height);
  }
  // Line boundary or empty line: measure the adjoining box and take its start.
  if (at < length) {
    const r = edgeRectOf(doc, textNode, at, Math.min(length, at + 1), "first");
    if (r) return makeRect(r.left, r.top, 0, r.height);
  }
  if (at > 0) {
    const r = edgeRectOf(doc, textNode, at - 1, at, "last");
    if (r) return makeRect(r.left, r.top, 0, r.height);
  }
  return null;
}

/**
 * Browser `Range` geometry reports a selected `\n` on the previous visual line.
 * That is correct for highlighting the break character, but wrong for the
 * collapsed caret after Shift+Enter: the caret belongs at the start of the next
 * line even when there is no following glyph to measure. We synthesize that
 * missing empty-line rect from the previous measurable line plus the computed
 * line-height, preserving the glyph-height from the previous rect when possible.
 */
function softBreakCaretRect(
  host: HTMLElement,
  doc: Document,
  textNode: Text,
  text: string,
  offset: number,
): DOMRect | null {
  const lineHeight = computedLineHeight(host);
  const contentLeft = contentBoxLeft(host);
  const contentTop = contentBoxTop(host);
  let previousRect: DOMRect | null = null;
  let previousIndex = -1;

  for (let i = offset - 2; i >= 0; i -= 1) {
    if (text[i] === "\n") continue;
    previousRect = edgeRectOf(doc, textNode, i, i + 1, "last");
    if (previousRect) {
      previousIndex = i;
      break;
    }
  }

  const breakCount = softBreakCount(text, previousIndex + 1, offset);
  if (breakCount === 0) return null;
  const baseTop = previousRect?.top ?? contentTop;
  const height = previousRect?.height ?? lineHeight;
  return makeRect(contentLeft, baseTop + lineHeight * breakCount, 0, height);
}

function boundingRectOf(
  doc: Document,
  textNode: Text,
  from: number,
  to: number,
): DOMRect | null {
  const range = doc.createRange();
  range.setStart(textNode, from);
  range.setEnd(textNode, to);
  if (typeof range.getBoundingClientRect !== "function") return null;
  return range.getBoundingClientRect();
}

function edgeRectOf(
  doc: Document,
  textNode: Text,
  from: number,
  to: number,
  pick: "first" | "last",
): DOMRect | null {
  const range = doc.createRange();
  range.setStart(textNode, from);
  range.setEnd(textNode, to);
  if (typeof range.getClientRects !== "function") return null;
  const rects = Array.from(range.getClientRects()).filter((r) => r.height > 0);
  if (rects.length === 0) return null;
  return pick === "first" ? rects[0]! : rects[rects.length - 1]!;
}

function computedLineHeight(element: HTMLElement): number {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  const lineHeight = cssPx(style?.lineHeight);
  if (lineHeight !== null) return lineHeight;
  const fontSize = cssPx(style?.fontSize);
  return fontSize !== null ? fontSize * 1.2 : 18;
}

function contentBoxLeft(element: HTMLElement): number {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return (
    element.getBoundingClientRect().left + (cssPx(style?.paddingLeft) ?? 0)
  );
}

function contentBoxTop(element: HTMLElement): number {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return element.getBoundingClientRect().top + (cssPx(style?.paddingTop) ?? 0);
}

function cssPx(value: string | undefined): number | null {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

function softBreakCount(text: string, from: number, to: number): number {
  let count = 0;
  for (let i = Math.max(0, from); i < Math.min(text.length, to); i += 1) {
    if (text[i] === "\n") count += 1;
  }
  return count;
}

function makeRect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    toJSON: () => ({}),
    top,
    width,
    x: left,
    y: top,
  } as DOMRect;
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
  /*
   * Index endpoints through the same document-order text-leaf walk the
   * clipboard serializer uses (docs/011 §8.5/§13.9), not the top-level body
   * order. That keeps nested leaves (a list item's text) paintable and skips
   * object/structural blocks, which carry no text range to paint. Only mounted
   * leaves produce rects, so offscreen middles are never painted (§8.5).
   */
  const leaves = orderedTextLeaves(store);
  const indexOf = new Map(leaves.map((leaf, index) => [leaf.id, index]));
  const anchorIndex = indexOf.get(selection.anchor.node);
  const focusIndex = indexOf.get(selection.focus.node);
  if (anchorIndex === undefined || focusIndex === undefined) return [];
  const forward =
    anchorIndex < focusIndex ||
    (anchorIndex === focusIndex &&
      selection.anchor.offset <= selection.focus.offset);
  const start = forward ? selection.anchor : selection.focus;
  const end = forward ? selection.focus : selection.anchor;
  const startIndex = Math.min(anchorIndex, focusIndex);
  const endIndex = Math.max(anchorIndex, focusIndex);
  const collapsed =
    selection.anchor.node === selection.focus.node &&
    selection.anchor.offset === selection.focus.offset;
  if (collapsed) {
    const leaf = leaves[focusIndex]!;
    const element = blockRefs.get(leaf.id);
    if (!element) return [];
    return caretRectsFromRange(
      element,
      rootRect,
      leaf.id,
      selection.focus.offset,
      leaf.node.content.text.length,
    );
  }
  const rects: OverlayRect[] = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    const leaf = leaves[index]!;
    const element = blockRefs.get(leaf.id);
    if (!element) continue;
    const length = leaf.node.content.text.length;
    const from = leaf.id === start.node ? start.offset : 0;
    const to = leaf.id === end.node ? end.offset : length;
    rects.push(
      ...rangeRectsFromText(element, rootRect, leaf.id, from, to, length),
    );
  }
  return rects;
}

function caretRectsFromRange(
  element: HTMLElement,
  rootRect: DOMRect,
  node: NodeId,
  offset: number,
  textLength: number,
): readonly OverlayRect[] {
  // A single-line caret rect, robust at soft-break and end-of-block boundaries
  // (a plain collapsed Range yields nothing there). Never the block box.
  const rect = robustCaretRect(element, offset);
  if (rect && rect.height > 0) {
    // The line box includes leading above/below the glyphs; a caret that tall
    // looks heavy next to a native one. Inset it and center it in the line so
    // it reads like a real insertion bar (mirrors the spike's caret metrics).
    const lineHeight = Math.max(14, rect.height);
    const caretHeight = Math.round(lineHeight * 0.82);
    return [
      {
        height: caretHeight,
        kind: "caret",
        left: rect.left - rootRect.left,
        node,
        top: rect.top - rootRect.top + (lineHeight - caretHeight) / 2,
        width: 1.5,
      },
    ];
  }
  return [fallbackCaretRect(element, rootRect, node, offset, textLength)];
}

function rangeRectsFromText(
  element: HTMLElement,
  rootRect: DOMRect,
  node: NodeId,
  from: number,
  to: number,
  textLength: number,
): readonly OverlayRect[] {
  const rects = textRangeClientRects(element, from, to);
  if (rects.length > 0) {
    return rects.map((rect) => ({
      height: Math.max(1, rect.height),
      kind: "range",
      left: rect.left - rootRect.left,
      node,
      top: rect.top - rootRect.top,
      width: Math.max(1, rect.width),
    }));
  }
  return [fallbackRangeRect(element, rootRect, node, from, to, textLength)];
}

function textRangeClientRects(
  element: HTMLElement,
  from: number,
  to: number,
): readonly DOMRect[] {
  /*
   * The production path is real DOM Range geometry. That lets the browser own line
   * wrapping, font metrics, bidi fragments, and subpixel layout while the engine
   * owns which model offsets are selected. jsdom has no layout engine, so callers
   * fall back to deterministic block-relative rectangles only when Range produces
   * no measurable rects.
   */
  const textNode = firstTextNode(element);
  if (!textNode) return [];
  const length = textNode.textContent?.length ?? 0;
  const start = clampOffset(from, length);
  const end = clampOffset(to, length);
  const range = element.ownerDocument.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, Math.max(start, end));
  if (
    typeof range.getClientRects !== "function" ||
    typeof range.getBoundingClientRect !== "function"
  ) {
    return [];
  }
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 || rect.height > 0,
  );
  if (rects.length > 0) return rects;
  const rect = range.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 ? [rect] : [];
}

function firstTextNode(element: HTMLElement): Text | null {
  const textNodeType = element.ownerDocument.defaultView?.Node.TEXT_NODE ?? 3;
  return element.firstChild?.nodeType === textNodeType
    ? (element.firstChild as Text)
    : null;
}

function fallbackCaretRect(
  element: HTMLElement,
  rootRect: DOMRect,
  node: NodeId,
  offset: number,
  textLength: number,
): OverlayRect {
  const rect = element.getBoundingClientRect();
  const usableWidth = Math.max(1, rect.width - 24);
  return {
    height: Math.max(18, rect.height - 10),
    kind: "caret",
    left:
      rect.left -
      rootRect.left +
      12 +
      (usableWidth * offset) / Math.max(1, textLength),
    node,
    top: rect.top - rootRect.top + 5,
    width: 2,
  };
}

function fallbackRangeRect(
  element: HTMLElement,
  rootRect: DOMRect,
  node: NodeId,
  from: number,
  to: number,
  textLength: number,
): OverlayRect {
  const rect = element.getBoundingClientRect();
  const usableWidth = Math.max(1, rect.width - 16);
  const width =
    from === 0 && to === textLength
      ? usableWidth
      : Math.max(
          1,
          (usableWidth * Math.max(1, to - from)) / Math.max(1, textLength),
        );
  return {
    height: Math.max(18, rect.height - 10),
    kind: "range",
    left:
      rect.left -
      rootRect.left +
      8 +
      (usableWidth * from) / Math.max(1, textLength),
    node,
    top: rect.top - rootRect.top + 5,
    width,
  };
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

function patchHostText(element: HTMLElement | null, text: string): void {
  /*
   * While the leaf is active, React keeps reading the pinned snapshot from the
   * store. The visible glyph still has to appear synchronously with the input
   * event, so the controller owns this one textContent patch until the leaf
   * deactivates or a structural command forces a React refresh.
   */
  if (!element) return;
  element.textContent = text.length > 0 ? text : "\u200b";
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
  // The model owns caret painting. Chromium native EditContext can still draw a
  // platform caret on the focused host, so hide that browser caret or native
  // comparison mode double-paints.
  caretColor: "transparent",
  minHeight: 28,
  outline: "none",
  padding: "5px 8px",
  position: "relative",
  // The engine paints selection through model-derived overlay rects, so the
  // browser's own selection must not compete during a pointer drag (§8.5).
  userSelect: "none",
  WebkitUserSelect: "none",
  whiteSpace: "pre-wrap",
};
