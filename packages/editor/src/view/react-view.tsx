import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
  type RefObject,
} from "react";
import {
  collectSelectionText,
  createEngineScheduler,
  createLoopbackBakeService,
  createOwnedEditorHandle,
  createWorkerBakeService,
  editorSnapshotFromCompat,
  pointAtOffset,
  type BakeService,
  type DocumentIndex,
  type EditorSelection,
  type EditorStore,
  type OwnedEditorHandle,
  type EnginePerformanceSnapshot,
  type EngineScheduler,
  type NodeId,
  type TextPoint,
} from "../core";
import { calculateVirtualRange } from "../core/virtual-range";
import { caretClientRect, clampOffset, resolveTextPointAt } from "./geometry";
import { activeSelectionNode, pointForStoreOffset } from "./navigation";
import {
  feedImeBounds,
  SelectionAnnouncer,
  SelectionOverlay,
} from "./selection-overlay";
import { EngineObjectBlock } from "./object-block";
import { sanitizeHtmlToCompat } from "./paste-html";
import { cancelFrame, requestFrame } from "./raf";
import { useEditorNode, useEditorOrder } from "./store-hooks";
import { EngineTextBlock } from "./text-block";
import type { ImeBoundsSnapshot, RenderRegistry } from "./types";
import { baseViewStyle, blockStyle } from "./styles";

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

export type ObjectBlockDiagnostics = {
  readonly type: string;
  readonly status: string;
  readonly state: "resting" | "live";
  readonly hasBaked: boolean;
};

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
  /** The heavy object in live-edit mode, or null when all rest baked (§6.4). */
  readonly activeObjectId: NodeId | null;
  /** Per-object resting/live state and bake status, keyed by node id. */
  readonly objects: Readonly<Record<NodeId, ObjectBlockDiagnostics>>;
  /** Mounted live object-editor surfaces; the slot is capped at one (AC2). */
  readonly liveObjectEditorCount: number;
  /** The active IME composition (preedit) range, or null (Phase 7 AC5). */
  readonly composition: { node: NodeId; from: number; to: number } | null;
  /** Last IME bounds fed to the active leaf's EditContext (Phase 7 AC4). */
  readonly imeBounds: ImeBoundsSnapshot | null;
  /** The derived TOC/text index, once the worker round-trip resolves (AC6). */
  readonly documentIndex: DocumentIndex | null;
  /** True once a worker (not just main-thread fallback) returned the index. */
  readonly indexFromWorker: boolean;
  /** How many worker bake/index round-trips have resolved (AC6). */
  readonly workerRoundTrips: number;
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
  /** Drop the caret at a client point (used by drag-drop to insert at the drop). */
  readonly placeCaretAt: (clientX: number, clientY: number) => void;
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
  /**
   * Factory for the bake/index Web Worker (docs/010 §7.5). Defaults to a worker
   * built over `core/bake.worker`; return null to force the in-memory loopback
   * (tests/SSR, or where `Worker` is unavailable).
   */
  readonly createBakeWorker?: () => Worker | null;
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
    createBakeWorker = defaultCreateBakeWorker,
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
  // The remembered caret X (viewport px) for vertical navigation. Persists across
  // consecutive ArrowUp/ArrowDown so the caret tracks a goal column through
  // ragged-width lines (docs/010 Phase 7 AC7); any horizontal move/click/type
  // resets it to null so the next vertical run re-seeds from the live caret.
  const goalColumnRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const autoscrollFrameRef = useRef<number | null>(null);
  const registryRef = useRef<RenderRegistry>({
    blockRefs: new Map(),
    dragging: false,
    imeBounds: null,
    inputBackends: new Map(),
    objectEditors: new Set(),
    renderCounts: new Map(),
    selectionOverlayRenderCount: 0,
    selectionRectCount: 0,
  });
  const order = useEditorOrder(store);
  const [scrollTop, setScrollTop] = useState(0);
  const [measureVersion, setMeasureVersion] = useState(0);
  // The off-thread bake/index service (docs/010 §7.5). The view derives the
  // document index (TOC + plain-text) in the worker so the main thread is never
  // blocked by the pure-compute pass; results land in refs the diagnostics read.
  const documentIndexRef = useRef<DocumentIndex | null>(null);
  const indexFromWorkerRef = useRef(false);
  const workerRoundTripsRef = useRef(0);
  const bakeServiceRef = useRef<BakeService | null>(null);

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

  // A live object-editor surface registers here when it mounts and unregisters
  // on unmount, so diagnostics can assert the one-live-at-a-time cap (AC2).
  const registerObjectEditor = useCallback((id: NodeId, mounted: boolean) => {
    const editors = registryRef.current.objectEditors;
    if (mounted) editors.add(id);
    else editors.delete(id);
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

  const placeCaretAt = useCallback(
    (clientX: number, clientY: number) => {
      const root = rootRef.current;
      if (!root) return;
      const point = resolveTextPointAt(store, root, clientX, clientY);
      if (!point) return;
      const node = store.requireTextNode(point.node);
      const focus = pointAtOffset(
        point.node,
        node.content,
        clampOffset(point.offset, node.content.text.length),
      );
      store.dispatch({
        origin: "local",
        selectionAfter: { anchor: focus, focus, type: "text" },
        steps: [],
      });
    },
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
      // Rich HTML paste parses through the single sanitization boundary into
      // model blocks (AC8); plain text falls back to an inline insert (AC5).
      const html = event.clipboardData?.getData("text/html");
      if (html) {
        const compat = sanitizeHtmlToCompat(html);
        if (compat.length > 0) {
          event.preventDefault();
          const snapshot = editorSnapshotFromCompat(
            { root: { children: compat } },
            {
              allocator: store.allocator,
              registry: store.registry,
              unknownObjectPolicy: "drop",
            },
          );
          const nodes = snapshot.body.order.map(
            (id) => snapshot.body.blocks[id]!,
          );
          store.command({ nodes, type: "insert-blocks" });
          syncFocusToSelection();
          return;
        }
      }
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
      // Re-feed IME bounds after scroll so the OS candidate window follows the
      // caret to its new viewport position (docs/010 §7.4, Phase 7 AC4).
      feedImeBounds(rootRef.current, store, registryRef.current);
    });
  }, [store, virtualize]);

  const beginDrag = useCallback((anchor: TextPoint) => {
    dragAnchorRef.current = anchor;
    draggingRef.current = true;
    registryRef.current.dragging = true;
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
    registryRef.current.dragging = false;
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
    // Track on BOTH mouse and pointer events. Desktop drag is mouse-driven and
    // every browser dispatches `mousemove`/`mouseup`; `pointermove` covers touch
    // but is not reliably synthesized from mouse input on WebKit/Firefox, which
    // is why a pointer-only listener let cross-browser drags stall (Phase 7).
    // `handleDragMove` is idempotent, so the overlap is harmless.
    const onMove = (event: MouseEvent) => {
      if (draggingRef.current) handleDragMove(event.clientX, event.clientY);
    };
    const onUp = () => {
      if (draggingRef.current) endDrag();
    };
    view.addEventListener("mousemove", onMove);
    view.addEventListener("pointermove", onMove);
    view.addEventListener("mouseup", onUp);
    view.addEventListener("pointerup", onUp);
    return () => {
      view.removeEventListener("mousemove", onMove);
      view.removeEventListener("pointermove", onMove);
      view.removeEventListener("mouseup", onUp);
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

  // Create the bake/index worker once. The worker keeps pure-compute bake and
  // indexing off the editing thread (§7.5); when `Worker` is unavailable the
  // loopback service runs the same handler on a microtask so behaviour is equal.
  useEffect(() => {
    const worker = createBakeWorker();
    indexFromWorkerRef.current = worker !== null;
    const service = worker
      ? createWorkerBakeService(worker)
      : createLoopbackBakeService();
    bakeServiceRef.current = service;
    return () => {
      service.dispose();
      bakeServiceRef.current = null;
    };
  }, [createBakeWorker]);

  // Rebuild the document index off-thread on mount and after any structural
  // change. The round-trip is async by construction, so the index is null for
  // the first frame and the main thread is never blocked computing it (AC6).
  useEffect(() => {
    const service = bakeServiceRef.current;
    if (!service) return;
    let cancelled = false;
    void (async () => {
      const index = await service.buildIndex(store.toSnapshot());
      if (cancelled) return;
      // The index lives in a ref the diagnostics read live; updating it must not
      // re-render mounted blocks (that would pollute per-block render counts).
      documentIndexRef.current = index;
      workerRoundTripsRef.current += 1;
    })();
    return () => {
      cancelled = true;
    };
  }, [store, order]);

  const diagnostics = useCallback((): OwnedModelEditorViewDiagnostics => {
    const blockTexts: Record<NodeId, string> = {};
    const objects: Record<NodeId, ObjectBlockDiagnostics> = {};
    for (const id of store.order) {
      const node = store.requireNode(id);
      if (node.kind === "text") blockTexts[id] = node.content.text;
      if (node.kind === "object") {
        objects[id] = {
          hasBaked: node.baked !== undefined,
          state: store.activeObjectId === id ? "live" : "resting",
          status: node.status,
          type: node.type,
        };
      }
    }
    const activeNodeId = activeSelectionNode(store.selection);
    return {
      activeInputBackend: activeNodeId
        ? (registryRef.current.inputBackends.get(activeNodeId) ?? null)
        : null,
      activeNodeId,
      activeObjectId: store.activeObjectId,
      blockTexts,
      composition: store.composition,
      documentIndex: documentIndexRef.current,
      imeBounds: registryRef.current.imeBounds,
      indexFromWorker: indexFromWorkerRef.current,
      liveObjectEditorCount: registryRef.current.objectEditors.size,
      mountedCount: registryRef.current.blockRefs.size,
      objects,
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
      workerRoundTrips: workerRoundTripsRef.current,
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
      placeCaretAt,
      scrollToBlock,
      selectText,
      serializeSelection,
    }),
    [
      diagnostics,
      focusBlock,
      getEditorHandle,
      placeCaretAt,
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
      goalColumnRef={goalColumnRef}
      id={id}
      key={id}
      onRender={recordBlockRender}
      registerBlock={registerBlock}
      registerInputBackend={registerInputBackend}
      registerObjectEditor={registerObjectEditor}
      requestFocus={focusBlock}
      revealBlock={revealBlock}
      store={store}
    />
  ));

  if (!virtualize) {
    return (
      <div
        ref={rootRef}
        aria-label="Document editor"
        aria-roledescription="rich text editor"
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
        <SelectionAnnouncer scheduler={scheduler} store={store} />
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      aria-label="Document editor"
      aria-roledescription="rich text editor"
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
        <SelectionAnnouncer scheduler={scheduler} store={store} />
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
  readonly registerObjectEditor: (id: NodeId, mounted: boolean) => void;
  readonly goalColumnRef: RefObject<number | null>;
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
    registerObjectEditor,
    goalColumnRef,
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
        goalColumnRef={goalColumnRef}
        node={node}
        registerBlock={registerBlock}
        registerInputBackend={registerInputBackend}
        requestFocus={requestFocus}
        revealBlock={revealBlock}
        store={store}
      />
    );
  }
  if (node.kind === "object") {
    return (
      <EngineObjectBlock
        node={node}
        registerBlock={registerBlock}
        registerObjectEditor={registerObjectEditor}
        store={store}
      />
    );
  }
  // Structural nodes (a `list`) still render a placeholder; nested structural
  // rendering inside the editing surface is the Phase 5.5/8 follow-on.
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

/** Build the default bake/index worker, or null where `Worker` is unavailable. */
function defaultCreateBakeWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  try {
    return new Worker(new URL("../core/bake.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return null;
  }
}

// The object container box must be identical whether resting or live so
// activation never shifts layout (AC3). Padding/border are constant; only the
// inner content swaps (in-place for code, an absolute config overlay otherwise).
