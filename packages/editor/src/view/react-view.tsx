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
  childrenOf,
  collectSelectionText,
  createEngineScheduler,
  createLoopbackBakeService,
  createOwnedEditorHandle,
  createWorkerBakeService,
  editorSnapshotFromCompat,
  makeTextNode,
  pointAtOffset,
  type BakeService,
  type DocumentIndex,
  type EditorSelection,
  type EditorStore,
  type GapSelection,
  type OwnedEditorHandle,
  type EnginePerformanceSnapshot,
  type EngineScheduler,
  type NodeId,
  type TextMarkKind,
  type TextPoint,
} from "../core";
import { calculateVirtualRange } from "../core/virtual-range";
import { caretClientRect, clampOffset, resolveTextPointAt } from "./geometry";
import { gapAtY, gapCandidates, type RectLike } from "./gap-cursor";
import {
  activeSelectionNode,
  pointForStoreOffset,
  selectionForGapNavigation,
  wordRangeAt,
} from "./navigation";
import {
  feedImeBounds,
  SelectionAnnouncer,
  SelectionOverlay,
} from "./selection-overlay";
import { AlertGlyph } from "@quanghuy1242/idco-ui";
import { CalloutChrome } from "./callout-chrome";
import { EngineObjectBlock } from "./object-block";
import { calloutTone } from "./resting-document";
import { sanitizeHtmlToCompat } from "./paste-html";
import { cancelFrame, requestFrame } from "./raf";
import { useEditorNode, useEditorOrder } from "./store-hooks";
import { EngineTextBlock } from "./text-block";
import {
  TouchSelectionLayer,
  useTouchDevice,
  type TouchSelectionActions,
} from "./touch-selection";
import type { ImeBoundsSnapshot, RenderRegistry } from "./types";
import {
  baseViewStyle,
  computeWindowListMeta,
  structuralContainerStyle,
  structuralListStyle,
  type ListItemMeta,
} from "./styles";

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
  // Coalesces drag-extend work to one frame: `mousemove` fires far more often
  // than the display refreshes, and each extend does a DOM hit-test + dispatch,
  // so processing every event makes the painted selection lag the pointer.
  const dragMoveFrameRef = useRef<number | null>(null);
  // Lifts the drag hit-test above the fingertip during a touch-grip drag, so the
  // resolved point lands on the selected line, not under the finger/grip that
  // covers it. Zero for mouse and long-press drags (finger is on the text).
  const touchPointerOffsetRef = useRef(0);
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
  // Touch-selection chrome state: whether a grip/long-press drag is live (hides
  // the floating toolbar mid-drag) and whether this is a touch-first device (so
  // grips never paint on desktop).
  const [touchInteracting, setTouchInteracting] = useState(false);
  const [touchCaretActionsOpen, setTouchCaretActionsOpen] = useState(false);
  const isTouchDevice = useTouchDevice();
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

  // Returns whether the block was mounted and focused. The caller uses this to
  // tell "focused synchronously, now" from "not mounted yet" so it can focus a
  // merge survivor in the same gesture but defer a split's new block a frame
  // (B1, the mobile-keyboard fix in `focusSelectionSoon`).
  const focusBlock = useCallback((id: NodeId): boolean => {
    const element = registryRef.current.blockRefs.get(id);
    if (!element) return false;
    element.focus({ preventScroll: true });
    return true;
  }, []);

  // A gap/node selection has no EditContext host, so the surface root takes focus
  // and the root key handler drives it (docs/019 §4.9). The root carries
  // `tabIndex={-1}` so it is focusable programmatically without joining tab order.
  const focusRoot = useCallback(() => {
    rootRef.current?.focus({ preventScroll: true });
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
        // Horizontal reveal of a long unwrapped line (docs/018 §2.4): if the
        // caret sits past the scroller's horizontal viewport, nudge scrollLeft so
        // it stays visible. No-op when the content fits (the common wrapped case).
        if (focusOffset !== null) {
          const left = targetRect.left - viewRect.left;
          const right = targetRect.right - viewRect.left;
          let dx = 0;
          if (left < margin) dx = left - margin;
          else if (right > scroller.clientWidth - margin)
            dx = right - (scroller.clientWidth - margin);
          if (Math.abs(dx) > 0.5) scroller.scrollLeft += dx;
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

  // PageUp/PageDown caret paging (docs/018 §2.4). The caret jumps to the line at
  // the far edge of the viewport (same goal column), then `revealBlock` scrolls
  // it back to a margin — so a second press pages again. No model mutation: this
  // is scroll + a selection-only dispatch. Returns whether it moved the caret.
  const pageCaret = useCallback(
    (direction: -1 | 1, extend: boolean): boolean => {
      const scroller = rootRef.current;
      const sel = store.selection;
      if (!scroller || sel?.type !== "text") return false;
      const viewRect = scroller.getBoundingClientRect();
      const focusEl = registryRef.current.blockRefs.get(sel.focus.node);
      const caretRect = focusEl
        ? caretClientRect(focusEl, sel.focus.offset)
        : null;
      const x = goalColumnRef.current ?? caretRect?.left ?? viewRect.left + 8;
      const margin = CARET_REVEAL_MARGIN_PX;
      const probeY =
        direction < 0 ? viewRect.top + margin : viewRect.bottom - margin;
      const point = resolveTextPointAt(store, scroller, x, probeY);
      if (point) {
        const node = store.getNode(point.node);
        if (node && node.kind === "text") {
          const focus = pointAtOffset(
            point.node,
            node.content,
            clampOffset(point.offset, node.content.text.length),
          );
          const moved =
            focus.node !== sel.focus.node || focus.offset !== sel.focus.offset;
          if (moved) {
            store.dispatch({
              origin: "local",
              selectionAfter: {
                anchor: extend ? sel.anchor : focus,
                focus,
                type: "text",
              },
              steps: [],
            });
            goalColumnRef.current = x;
            if (focus.node !== sel.focus.node) focusBlock(focus.node);
            revealBlock(focus.node);
            return true;
          }
        }
      }
      // No resolvable line at the edge (e.g. the empty area past the last block):
      // fall back to a plain page scroll so the surface still pages.
      const page = scroller.clientHeight * PAGE_SCROLL_FRACTION;
      const next = Math.max(0, scroller.scrollTop + direction * page);
      if (Math.abs(next - scroller.scrollTop) < 0.5) return false;
      scroller.scrollTop = next;
      setScrollTop(next);
      return true;
    },
    [focusBlock, goalColumnRef, revealBlock, store],
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
      // A clipboard event from a real native field — a live object editor (the
      // code <textarea>) or a config-popover <input> — must keep its native
      // clipboard. React portals bubble synthetic events through the React tree,
      // so the popover's paste reaches this root handler even though its DOM lives
      // elsewhere; without this guard the root would preventDefault and route the
      // paste into the document model instead of the focused field.
      if (isNativeEditableTarget(event.target)) return;
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
    // Sync-first focus (B1): when an edit (cut, delete-selection) removes the
    // focused block and the caret lands in an already-mounted block, focus it
    // now — in the same gesture, before React commits the unmount of the removed
    // block — so the mobile soft keyboard never sees a focusless moment and does
    // not flicker. Only fall back to the next frame when the destination is not
    // mounted yet (e.g. paste inserting fresh blocks above the caret).
    const apply = (): boolean => {
      const sel = store.selection;
      const focusNode = sel?.type === "text" ? sel.focus.node : null;
      if (!focusNode) return false;
      return focusBlock(focusNode);
    };
    if (!apply()) requestFrame(apply);
  }, [focusBlock, store]);

  const onClipboardCut = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      // A native field (code editor / config-popover input) keeps native cut.
      if (isNativeEditableTarget(event.target)) return;
      // Cut writes the model serialization, then deletes the selection through
      // the command layer so the delete is one invertible transaction (AC5).
      const text = collectSelectionText(store, store.selection);
      if (!text) return;
      event.clipboardData?.setData("text/plain", text);
      event.preventDefault();
      // Cut is a hard undo boundary (docs/011 §7.5): never fold into a typing run.
      store.breakUndoCoalescing();
      store.command({ type: "delete-selection" });
      syncFocusToSelection();
    },
    [store, syncFocusToSelection],
  );

  const onClipboardPaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      // A native field (code editor / config-popover input) keeps native paste —
      // otherwise the root would swallow the paste and insert it into the document
      // instead of the focused field (the popover Ctrl+V bug).
      if (isNativeEditableTarget(event.target)) return;
      // Rich HTML paste parses through the single sanitization boundary into
      // model blocks (AC8); plain text falls back to an inline insert (AC5).
      // Either way paste is a hard undo boundary (docs/011 §7.5).
      store.breakUndoCoalescing();
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
    // Mouse and long-press drags hit-test at the pointer; a grip drag re-sets
    // this after begin. Reset here so a mouse drag never inherits a touch offset.
    touchPointerOffsetRef.current = 0;
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
    // placeholder and the gaps instead of stalling on a non-text block. The
    // touch offset lifts the hit-test above the fingertip for grip drags.
    const hit = resolveTextPointAt(
      store,
      root,
      pointer.x,
      pointer.y - touchPointerOffsetRef.current,
    );
    if (!hit) return;
    const target = store.getNode(hit.node);
    if (!target || target.kind !== "text") return;
    const focus = pointAtOffset(
      hit.node,
      target.content,
      clampOffset(hit.offset, target.content.text.length),
    );
    // Skip the dispatch when the pointer is still over the same model position —
    // a pixel move within one glyph should not churn a selection notify + repaint.
    const current = store.selection;
    if (
      current?.type === "text" &&
      current.focus.node === focus.node &&
      current.focus.offset === focus.offset &&
      current.anchor.node === anchor.node &&
      current.anchor.offset === anchor.offset
    ) {
      return;
    }
    store.dispatch({
      origin: "local",
      selectionAfter: { anchor, focus, type: "text" },
      steps: [],
    });
    // Paint the new selection in *this* frame. `extendDragToPointer` already runs
    // inside a rAF, so the overlay's frame task `dispatch` just queued would fire
    // on the next rAF — one frame behind the pointer. Draining the frame lane now
    // closes that gap so the painted selection tracks the drag (docs/010 §7.4).
    scheduler.flushLane("frame");
  }, [scheduler, store]);

  // Run a drag-extend at most once per animation frame, against the latest
  // pointer (`lastPointerRef`), so a burst of `mousemove`s collapses to one
  // hit-test + dispatch on the frame the browser is about to paint.
  const scheduleDragExtend = useCallback(() => {
    if (dragMoveFrameRef.current !== null) return;
    dragMoveFrameRef.current = requestFrame(() => {
      dragMoveFrameRef.current = null;
      extendDragToPointer();
    });
  }, [extendDragToPointer]);

  // Clicking the white gaps around the content (most visibly the empty area
  // Hit-test a pointer against the body's inter-block gaps; returns a gap
  // selection only when the slot is adjacent to an atom (an object) or a
  // structural container (a callout) — the body-level position a text caret
  // cannot occupy, since a caret there would land *inside* the container or its
  // sibling, never between them (docs/019 §4.9/§5.8). Elsewhere the caller falls
  // back to the nearest-text-leaf caret.
  const gapAtPointer = useCallback(
    (clientX: number, clientY: number): GapSelection | null => {
      void clientX;
      const root = rootRef.current;
      if (!root) return null;
      const scope = store.bodyId;
      const children = childrenOf(store, scope);
      const rects: RectLike[] = [];
      const atomicFlags: boolean[] = [];
      const bodyIndex: number[] = [];
      for (let i = 0; i < children.length; i += 1) {
        const element = registryRef.current.blockRefs.get(children[i]!);
        if (!element) continue;
        const r = element.getBoundingClientRect();
        rects.push({
          bottom: r.bottom,
          left: r.left,
          right: r.right,
          top: r.top,
        });
        const kind = store.getNode(children[i]!)?.kind;
        atomicFlags.push(kind === "object" || kind === "structural");
        bodyIndex.push(i);
      }
      if (rects.length === 0) return null;
      const rootRect = root.getBoundingClientRect();
      const hit = gapAtY(
        gapCandidates({
          atomicFlags,
          rects,
          scopeBottom: rootRect.bottom,
          scopeTop: rootRect.top,
        }),
        clientY,
      );
      if (!hit || !hit.atomic) return null;
      const index =
        hit.index < rects.length
          ? bodyIndex[hit.index]!
          : bodyIndex[rects.length - 1]! + 1;
      return { index, scope, type: "gap" };
    },
    [store],
  );

  // Insert a real paragraph at the gap and land a text caret in it (docs/019
  // §4.9 materialize). The pending gap is the live selection, so `insert-blocks`
  // resolves to it (identity) and the typed first character seeds the new leaf.
  const materializeGap = useCallback(
    (initial: string) => {
      const paragraph = makeTextNode({
        content: store.allocator.createTextSlice(initial),
        id: store.allocator.createNodeId(),
        type: "paragraph",
      });
      store.command({ nodes: [paragraph], type: "insert-blocks" });
      syncFocusToSelection();
    },
    [store, syncFocusToSelection],
  );

  // Apply a gap-navigation result: a text caret focuses its leaf; a still-gap
  // result keeps the root focused so the next arrow continues the walk.
  const applyGapMove = useCallback(
    (next: EditorSelection) => {
      store.dispatch({ origin: "local", selectionAfter: next, steps: [] });
      if (next.type === "text") syncFocusToSelection();
      else focusRoot();
    },
    [focusRoot, store, syncFocusToSelection],
  );

  // Delete the block flanking a gap (docs/019 §4.12.6): an atom (divider/image),
  // or an empty placeholder paragraph — the "remove this block from here"
  // gesture. A non-empty text/container neighbour is left to ordinary editing.
  const deleteAtGap = useCallback(
    (selection: GapSelection, direction: -1 | 1) => {
      const children = childrenOf(store, selection.scope);
      const targetIndex = direction < 0 ? selection.index - 1 : selection.index;
      const targetId = children[targetIndex];
      const target = targetId ? store.getNode(targetId) : undefined;
      const removable =
        target?.kind === "object" ||
        (target?.kind === "text" &&
          target.type === "paragraph" &&
          target.content.text.length === 0);
      if (!targetId || !removable) return;
      store.command({ node: targetId, type: "remove-block" });
      // Backspace removes the block before the gap, so the gap slides down one;
      // Delete removes the block after it, so the index is unchanged.
      const nextIndex = direction < 0 ? selection.index - 1 : selection.index;
      store.dispatch({
        origin: "local",
        selectionAfter: {
          index: Math.max(0, nextIndex),
          scope: selection.scope,
          type: "gap",
        },
        steps: [],
      });
      focusRoot();
    },
    [focusRoot, store],
  );

  // Escape leaves the gap for the nearest real caret (docs/019 §4.9 dismiss).
  const dismissGap = useCallback(
    (selection: GapSelection) => {
      const back = selectionForGapNavigation(store, selection, "ArrowLeft");
      const forward = selectionForGapNavigation(store, selection, "ArrowRight");
      const target =
        back?.type === "text"
          ? back
          : forward?.type === "text"
            ? forward
            : null;
      if (!target) return;
      store.dispatch({ origin: "local", selectionAfter: target, steps: [] });
      syncFocusToSelection();
    },
    [store, syncFocusToSelection],
  );

  // The document key handler for a gap selection (docs/019 §4.9). The per-leaf
  // handlers early-out when the selection is not their text, so a gap's keys
  // bubble here: arrows walk/escape the gap, Enter/printable materialize a
  // paragraph, Escape dismisses, and undo/redo stay available.
  const onRootKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const selection = store.selection;
      if (selection?.type !== "gap") return;
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === "z") {
          event.preventDefault();
          if (event.shiftKey) store.redo();
          else store.undo();
          syncFocusToSelection();
        } else if (key === "y") {
          event.preventDefault();
          store.redo();
          syncFocusToSelection();
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        dismissGap(selection);
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        // Delete the atom on the relevant side of the gap (docs/019 §4.12.6) —
        // "remove this block from here." Backspace eats the block before the
        // gap, Delete the one after; the gap stays put across the removal.
        event.preventDefault();
        deleteAtGap(selection, event.key === "Backspace" ? -1 : 1);
        return;
      }
      if (GAP_NAV_KEYS.has(event.key)) {
        event.preventDefault();
        const next = selectionForGapNavigation(store, selection, event.key);
        if (next) applyGapMove(next);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        materializeGap("");
        return;
      }
      // A single printable character (no Alt/AltGr combo) materializes and seeds.
      if (event.key.length === 1 && !event.altKey) {
        event.preventDefault();
        materializeGap(event.key);
      }
    },
    [
      applyGapMove,
      deleteAtGap,
      dismissGap,
      materializeGap,
      store,
      syncFocusToSelection,
    ],
  );

  // below the last block) places the caret in the nearest text leaf, the way a
  // real editor maps a click in empty space to the closest text position. Block
  // clicks are handled per-block; this only fires when the click misses them.
  const onRootMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // Left button only: a right-click must not move the caret / collapse the
      // selection (it opens the context menu instead, mirrors the per-block rule).
      if (event.button !== 0) return;
      const target = event.target as Element;
      if (target.closest("[data-engine-block-id]")) return;
      const root = rootRef.current;
      if (!root) return;
      // A click in the inter-block whitespace adjacent to an atom places a gap
      // cursor there (docs/019 §4.9, legacy Part C), the position a text caret
      // cannot represent. Elsewhere the click maps to the nearest text leaf.
      const gap = gapAtPointer(event.clientX, event.clientY);
      if (gap) {
        store.dispatch({ origin: "local", selectionAfter: gap, steps: [] });
        focusRoot();
        return;
      }
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
    [beginDrag, focusBlock, focusRoot, gapAtPointer, store],
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
      scheduleDragExtend();
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
    [extendDragToPointer, scheduleDragExtend, stopAutoscroll, virtualize],
  );

  const endDrag = useCallback(() => {
    draggingRef.current = false;
    registryRef.current.dragging = false;
    dragAnchorRef.current = null;
    lastPointerRef.current = null;
    if (dragMoveFrameRef.current !== null) {
      cancelFrame(dragMoveFrameRef.current);
      dragMoveFrameRef.current = null;
    }
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

  // Place the caret at a touch point and focus its block (so the soft keyboard
  // opens), the touch equivalent of a click. Used for a tap (press + release, no
  // drag, no long-press).
  const caretAtPointAndFocus = useCallback(
    (clientX: number, clientY: number) => {
      placeCaretAt(clientX, clientY);
      const sel = store.selection;
      if (sel?.type === "text") focusBlock(sel.focus.node);
    },
    [focusBlock, placeCaretAt, store],
  );

  // Select the word under a touch point and arm a drag from its start, so a
  // long-press selects a word and keeping the finger down extends the range —
  // the mobile gesture that stands in for double-click + drag.
  const selectWordAtPoint = useCallback(
    (clientX: number, clientY: number): boolean => {
      const root = rootRef.current;
      if (!root) return false;
      const hit = resolveTextPointAt(store, root, clientX, clientY);
      if (!hit) return false;
      const node = store.getNode(hit.node);
      if (!node || node.kind !== "text") return false;
      const [from, to] = wordRangeAt(
        node.content.text,
        clampOffset(hit.offset, node.content.text.length),
      );
      const anchor = pointAtOffset(hit.node, node.content, from);
      const focus = pointAtOffset(hit.node, node.content, to);
      store.activateTextLeaf(hit.node);
      store.dispatch({
        origin: "local",
        selectionAfter: { anchor, focus, type: "text" },
        steps: [],
      });
      focusBlock(hit.node);
      beginDrag(anchor);
      return true;
    },
    [beginDrag, focusBlock, store],
  );

  // Arm a drag from a selection grip: dragging a grip moves THAT end of the
  // range, so the opposite end becomes the fixed drag anchor. The touch offset
  // lifts the hit-test above the fingertip so it tracks the line under the grip.
  const armHandleDrag = useCallback(
    (end: "start" | "end") => {
      const sel = store.selection;
      if (sel?.type !== "text") return;
      const forward = store.comparePoints(sel.anchor, sel.focus) <= 0;
      const startPt = forward ? sel.anchor : sel.focus;
      const endPt = forward ? sel.focus : sel.anchor;
      beginDrag(end === "start" ? endPt : startPt);
      touchPointerOffsetRef.current = HANDLE_TOUCH_LIFT_PX;
    },
    [beginDrag, store],
  );

  const isTouchOnCollapsedCaret = useCallback(
    (clientX: number, clientY: number): boolean => {
      const selection = store.selection;
      if (
        selection?.type !== "text" ||
        selection.anchor.node !== selection.focus.node ||
        selection.anchor.offset !== selection.focus.offset
      ) {
        return false;
      }
      const element = registryRef.current.blockRefs.get(selection.focus.node);
      if (!element) return false;
      const rect = caretClientRect(element, selection.focus.offset);
      if (!rect) return false;
      return (
        clientX >= rect.left - TOUCH_CARET_HIT_SLOP_X &&
        clientX <= rect.right + TOUCH_CARET_HIT_SLOP_X &&
        clientY >= rect.top - TOUCH_CARET_HIT_SLOP_Y &&
        clientY <= rect.bottom + TOUCH_CARET_HIT_SLOP_Y
      );
    },
    [store],
  );

  const touchActions = useMemo<TouchSelectionActions>(
    () => ({
      copy: () => {
        const text = collectSelectionText(store, store.selection);
        if (text) void navigator.clipboard?.writeText(text).catch(() => {});
      },
      cut: () => {
        const text = collectSelectionText(store, store.selection);
        if (text) void navigator.clipboard?.writeText(text).catch(() => {});
        store.breakUndoCoalescing();
        if (store.command({ type: "delete-selection" })) syncFocusToSelection();
      },
      paste: () => {
        void (async () => {
          try {
            const text = await navigator.clipboard?.readText();
            store.breakUndoCoalescing();
            if (text && store.command({ text, type: "insert-text" })) {
              syncFocusToSelection();
            }
          } catch {
            // Clipboard read unavailable or denied; nothing to paste.
          }
        })();
      },
      toggleMark: (mark: TextMarkKind) => {
        store.command({ mark, type: "toggle-mark" });
      },
    }),
    [store, syncFocusToSelection],
  );

  // Touch gesture controller (docs/010 Phase 7 AC8). Owns the scroll-vs-select
  // decision on the touch device: a plain drag scrolls (we never preventDefault
  // it), a long-press selects a word and then extends, a grip drag adjusts an
  // end, and a tap places the caret. Once selecting, `preventDefault` on
  // `touchmove` claims the gesture from the scroller; `preventDefault` on
  // `touchend` suppresses the synthesized mouse events that would otherwise
  // re-place the caret and collapse the selection.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let mode:
      | "idle"
      | "pressing"
      | "scrolling"
      | "selecting"
      | "handle"
      | "caret" = "idle";
    let startX = 0;
    let startY = 0;
    let dragActivated = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clearTimer = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return; // ignore pinch/multi-touch
      const touch = event.touches[0]!;
      const target = touch.target as Element | null;
      if (
        target?.closest(
          "[data-engine-sel-toolbar], [data-engine-caret-toolbar]",
        )
      ) {
        return; // action popover button press
      }
      setTouchCaretActionsOpen(false);
      startX = touch.clientX;
      startY = touch.clientY;
      dragActivated = false;
      const handle = target?.closest("[data-engine-sel-handle]");
      if (handle) {
        event.preventDefault();
        mode = "handle";
        armHandleDrag(
          handle.getAttribute("data-engine-sel-handle") === "start"
            ? "start"
            : "end",
        );
        setTouchInteracting(true);
        return;
      }
      if (!target?.closest("[data-engine-block-id]")) {
        mode = "idle";
        return;
      }
      mode = "pressing";
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        if (mode !== "pressing") return;
        if (isTouchOnCollapsedCaret(startX, startY)) {
          mode = "caret";
          setTouchCaretActionsOpen(true);
          return;
        }
        if (selectWordAtPoint(startX, startY)) {
          mode = "selecting";
          setTouchInteracting(true);
        }
      }, TOUCH_LONG_PRESS_MS);
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      if (mode === "pressing") {
        if (
          Math.hypot(touch.clientX - startX, touch.clientY - startY) >
          TOUCH_MOVE_CANCEL_PX
        ) {
          clearTimer();
          mode = "scrolling"; // a pre-long-press drag is a scroll; let it scroll
        }
        return;
      }
      if (mode === "selecting" || mode === "handle") {
        event.preventDefault(); // claim the gesture from the scroller
        if (!dragActivated) {
          const threshold =
            mode === "handle"
              ? TOUCH_HANDLE_DRAG_START_PX
              : TOUCH_SELECTION_DRAG_START_PX;
          if (
            Math.hypot(touch.clientX - startX, touch.clientY - startY) <
            threshold
          ) {
            return;
          }
          dragActivated = true;
        }
        handleDragMove(touch.clientX, touch.clientY);
        return;
      }
      if (mode === "caret") {
        event.preventDefault();
        if (
          Math.hypot(touch.clientX - startX, touch.clientY - startY) >
          TOUCH_SELECTION_DRAG_START_PX
        ) {
          setTouchCaretActionsOpen(false);
          mode = "idle";
        }
      }
    };
    const onEnd = (event: TouchEvent) => {
      if (mode === "pressing") {
        clearTimer();
        event.preventDefault(); // suppress the synthesized mouse tap
        caretAtPointAndFocus(startX, startY);
      } else if (mode === "selecting" || mode === "handle") {
        event.preventDefault(); // keep the range; no synthesized mousedown
        const touch = event.changedTouches[0];
        if (touch && dragActivated) {
          lastPointerRef.current = { x: touch.clientX, y: touch.clientY };
          extendDragToPointer();
        }
        endDrag();
        setTouchInteracting(false);
      } else if (mode === "caret") {
        event.preventDefault(); // keep the paste popover; no synthesized tap
      }
      mode = "idle";
    };
    const onCancel = () => {
      clearTimer();
      if (mode === "selecting" || mode === "handle") {
        endDrag();
        setTouchInteracting(false);
      } else if (mode === "caret") {
        setTouchCaretActionsOpen(false);
      }
      mode = "idle";
    };
    root.addEventListener("touchstart", onStart, { passive: false });
    root.addEventListener("touchmove", onMove, { passive: false });
    root.addEventListener("touchend", onEnd, { passive: false });
    root.addEventListener("touchcancel", onCancel);
    return () => {
      clearTimer();
      root.removeEventListener("touchstart", onStart);
      root.removeEventListener("touchmove", onMove);
      root.removeEventListener("touchend", onEnd);
      root.removeEventListener("touchcancel", onCancel);
    };
  }, [
    armHandleDrag,
    caretAtPointAndFocus,
    endDrag,
    extendDragToPointer,
    handleDragMove,
    isTouchOnCollapsedCaret,
    selectWordAtPoint,
  ]);

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
  //
  // Debounced: every structural edit (each Enter/split, paste, block move)
  // changes `order` and would otherwise fire `store.toSnapshot()` — an O(N) clone
  // of the whole node map — on the main thread, per keystroke. A burst (holding
  // Enter, pasting) collapses to one snapshot + one worker round-trip after the
  // edits settle. The snapshot is taken *inside* the debounced callback so the
  // clone itself is coalesced, not just the worker call.
  useEffect(() => {
    const service = bakeServiceRef.current;
    if (!service) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        const index = await service.buildIndex(store.toSnapshot());
        if (cancelled) return;
        // The index lives in a ref the diagnostics read live; updating it must
        // not re-render mounted blocks (that would pollute per-block render
        // counts).
        documentIndexRef.current = index;
        workerRoundTripsRef.current += 1;
      })();
    }, INDEX_REBUILD_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [store, order]);

  // Reflect a selected atomic object through `aria-activedescendant` on the
  // surface (docs/011 §8.7, docs/018 §2.3). Text blocks use real element focus
  // and need no roving descendant, so this is set only for a node selection and
  // cleared otherwise. Imperative + selection-subscribed, so it never re-renders
  // the virtualized block list.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const update = () => {
      const sel = store.selection;
      const objectId =
        sel?.type === "node" && store.getNode(sel.node)?.kind === "object"
          ? sel.node
          : null;
      if (objectId) root.setAttribute("aria-activedescendant", objectId);
      else root.removeAttribute("aria-activedescendant");
    };
    update();
    return store.subscribeSelection(update);
  }, [store]);

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
      if (dragMoveFrameRef.current !== null)
        cancelFrame(dragMoveFrameRef.current);
      dragMoveFrameRef.current = null;
      if (autoscrollFrameRef.current !== null)
        cancelFrame(autoscrollFrameRef.current);
      autoscrollFrameRef.current = null;
    },
    [],
  );

  // Lists are flat-by-design (docs/018 §2.10): the per-item ordinal + first/last
  // boundary is computed here from body-order adjacency, once per render of the
  // current window, and handed to each block. It is recomputed when the order is
  // re-published (a structural edit, or a list-flavour/type change — see the
  // store's `#republishOrderForListLayout`), so a run renumbers correctly even
  // though a numbered item mounted alone could not from a CSS counter.
  const listMetaForWindow = computeWindowListMeta(
    store,
    windowRange.ids,
    windowRange.startIndex,
  );
  const blocks = windowRange.ids.map((id) => (
    <EngineBlock
      beginDrag={beginDrag}
      focusRoot={focusRoot}
      forcePolyfill={forcePolyfill}
      goalColumnRef={goalColumnRef}
      id={id}
      key={id}
      listMeta={listMetaForWindow.get(id)}
      onRender={recordBlockRender}
      pageCaret={pageCaret}
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
        onKeyDown={onRootKeyDown}
        onMouseDown={onRootMouseDown}
        onPaste={onClipboardPaste}
        role="application"
        style={{ ...baseViewStyle, padding: 16, ...style }}
        tabIndex={-1}
      >
        {blocks}
        <SelectionOverlay
          registry={registryRef.current}
          rootRef={rootRef}
          scheduler={scheduler}
          store={store}
        />
        {isTouchDevice && (
          <TouchSelectionLayer
            actions={touchActions}
            caretActionsOpen={touchCaretActionsOpen}
            containerRef={rootRef}
            interacting={touchInteracting}
            onCaretActionsOpenChange={setTouchCaretActionsOpen}
            registry={registryRef.current}
            scheduler={scheduler}
            store={store}
          />
        )}
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
      onKeyDown={onRootKeyDown}
      onMouseDown={onRootMouseDown}
      onPaste={onClipboardPaste}
      onScroll={onScroll}
      role="application"
      tabIndex={-1}
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
        {isTouchDevice && (
          <TouchSelectionLayer
            actions={touchActions}
            caretActionsOpen={touchCaretActionsOpen}
            containerRef={contentRef}
            interacting={touchInteracting}
            onCaretActionsOpenChange={setTouchCaretActionsOpen}
            registry={registryRef.current}
            scheduler={scheduler}
            store={store}
          />
        )}
        <SelectionAnnouncer scheduler={scheduler} store={store} />
      </div>
    </div>
  );
});

// Keys the root gap handler treats as a gap walk (docs/019 §4.10). Arrows step
// across atoms / descend / escape; Home/End jump to the scope's first/last slot.
const GAP_NAV_KEYS = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "End",
  "Home",
]);

const DEFAULT_VIEWPORT_HEIGHT = 480;
const DEFAULT_OVERSCAN = 4;
const DEFAULT_BLOCK_ESTIMATE = 40;
const AUTOSCROLL_STEP_PX = 12;
// Coalesce the off-thread document-index rebuild across a burst of structural
// edits. Short enough that the TOC/search index feels live after a pause, long
// enough that holding Enter or pasting does not fire an O(N) snapshot per edit.
const INDEX_REBUILD_DEBOUNCE_MS = 200;
// Lead the caret keeps from the viewport edge when keyboard movement scrolls it
// into view (~one line). Small enough that each line-move scrolls about one
// line, not a whole block. Trivially promotable to a prop if a knob is wanted.
const CARET_REVEAL_MARGIN_PX = 24;
// PageUp/PageDown fall-back scroll distance when no caret line sits at the edge
// (docs/018 §2.4). A touch under one viewport keeps a little overlap for context.
const PAGE_SCROLL_FRACTION = 0.9;
// A still-held touch this long becomes a word-select (vs a tap); a pre-threshold
// drag becomes a scroll. Matches the platform long-press feel.
const TOUCH_LONG_PRESS_MS = 450;
// Movement before the long-press fires that reclassifies the gesture as a scroll.
const TOUCH_MOVE_CANCEL_PX = 10;
// After long-press has selected text, require a deliberate move before extending
// the range. Without this post-long-press slop, normal finger drift during the
// hold turns into a range drag, which feels too light compared with native text.
const TOUCH_SELECTION_DRAG_START_PX = 18;
// Grip drags should start sooner than long-press drags, but still not jump from
// the tiny movement caused by touching the handle.
const TOUCH_HANDLE_DRAG_START_PX = 8;
// Hit slop around the collapsed caret for the native-style "hold caret -> Paste"
// gesture. The caret is engine-painted and very thin, so this intentionally
// targets the line around it rather than the one-pixel bar.
const TOUCH_CARET_HIT_SLOP_X = 24;
const TOUCH_CARET_HIT_SLOP_Y = 30;
// How far above the fingertip a grip drag hit-tests, so the resolved point lands
// on the selected line instead of under the finger/grip covering it.
const HANDLE_TOUCH_LIFT_PX = 28;

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
  readonly requestFocus: (id: NodeId) => boolean;
  readonly revealBlock: (id: NodeId) => void;
  readonly beginDrag: (anchor: TextPoint) => void;
  readonly registerObjectEditor: (id: NodeId, mounted: boolean) => void;
  readonly goalColumnRef: RefObject<number | null>;
  readonly pageCaret: (direction: -1 | 1, extend: boolean) => boolean;
  readonly focusRoot: () => void;
  readonly listMeta?: ListItemMeta;
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
    pageCaret,
    focusRoot,
    listMeta,
  } = props;
  const node = useEditorNode(store, id);
  onRender(id);
  // The node was removed in the same tick (merge/delete); render nothing until
  // the order change unmounts this block.
  if (!node) return null;
  if (node.kind === "text") {
    const textBlock = (
      <EngineTextBlock
        beginDrag={beginDrag}
        focusRoot={focusRoot}
        forcePolyfill={forcePolyfill}
        goalColumnRef={goalColumnRef}
        listMeta={listMeta}
        node={node}
        pageCaret={pageCaret}
        registerBlock={registerBlock}
        registerInputBackend={registerInputBackend}
        requestFocus={requestFocus}
        revealBlock={revealBlock}
        store={store}
      />
    );
    return textBlock;
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
  // A structural container renders its children recursively (docs/018 §2.11:
  // "Rendering is separable from virtualizing" — mapping a container's `children`
  // through the same block dispatch *is* the render, and block-level
  // virtualization already mounts/unmounts the whole small subtree as one
  // top-level block). The two producers today are a `list` over `listitem`
  // children and the genuine future use — a multi-block container (a quote/callout
  // holding block children). Everything under a structural node renders: nested
  // lists, paragraphs, objects (media/code), the lot — the same `EngineBlock`
  // dispatch recurses. A `list` numbers its items with the same render-time
  // ordinal pass the flat top-level lists use (a CSS counter would misnumber a
  // virtualized run); other containers just stack their children.
  //
  // Large containers (a single subtree big enough that mounting it whole hurts)
  // are the *separate* recursive-windowing tier (docs/018 §2.11), built against
  // the measurement guardrail when a real consumer needs it — that is the only
  // deferred half, and it is a virtualization concern, not this render.
  // Any structural container numbers the list runs among its children — a `list`,
  // but also a callout holding list items — so a nested numbered list renders as
  // `N.`, not bullets. Containers with no list items get an empty map (paragraphs
  // are unaffected). Without this, nested items fell back to the bullet default.
  const childListMeta = computeWindowListMeta(store, node.children, 0);
  // A callout is a tinted box (the `[data-engine-callout-tone]` CSS) carrying
  // floating block chrome (badge + tone + delete) and the tone glyph in the left
  // gutter — the same `AlertGlyph` the resting render uses, so the two surfaces
  // read alike. Its tone rides the `tone` attr and defaults to info. Other
  // containers (a `list`, a future quote-with-blocks) just stack their children.
  const isCallout = node.type === "callout";
  const tone = calloutTone(node.attrs?.tone);
  const container = (
    <div
      data-engine-block-id={node.id}
      data-engine-callout-tone={isCallout ? tone : undefined}
      data-engine-structural={node.type}
      ref={(element) => registerBlock(node.id, element)}
      style={
        node.type === "list" ? structuralListStyle : structuralContainerStyle
      }
    >
      {isCallout ? (
        <span aria-hidden="true" data-engine-callout-glyph="">
          <AlertGlyph tone={tone} />
        </span>
      ) : null}
      {node.children.map((childId) => (
        <EngineBlock
          beginDrag={beginDrag}
          focusRoot={focusRoot}
          forcePolyfill={forcePolyfill}
          goalColumnRef={goalColumnRef}
          id={childId}
          key={childId}
          listMeta={childListMeta?.get(childId)}
          onRender={onRender}
          pageCaret={pageCaret}
          registerBlock={registerBlock}
          registerInputBackend={registerInputBackend}
          registerObjectEditor={registerObjectEditor}
          requestFocus={requestFocus}
          revealBlock={revealBlock}
          store={store}
        />
      ))}
    </div>
  );
  // The chrome is a sibling overlay in a `group/block relative` wrapper (never
  // inside the measured container box), mirroring the object blocks' chrome.
  if (isCallout) {
    return (
      <div className="group/block relative">
        <CalloutChrome node={node} store={store} />
        {container}
      </div>
    );
  }
  return container;
}

/**
 * Whether a (synthetic) clipboard event came from a real native editable field —
 * a live object editor's `<textarea>` or a config-popover `<input>`. React portals
 * bubble synthetic events through the React tree, so such events reach the editor
 * root even when their DOM is elsewhere; the root must let them keep their native
 * clipboard rather than routing them into the document model.
 */
function isNativeEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
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
