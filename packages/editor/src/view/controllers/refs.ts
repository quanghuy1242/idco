/**
 * The shared mutable-ref bag for the editor view (docs/020 §5.3).
 *
 * The orchestrator (`react-view.tsx`) and its controller hooks all run in one
 * component instance and share these refs. Creating them once here and passing
 * the bag to each controller makes the shared state explicit instead of implicit
 * closure capture, while keeping a single DOM root and one set of event wiring.
 */
import { useRef } from "react";
import type { BakeService, DocumentIndex, NodeId, TextPoint } from "../../core";
import type { OffsetModel } from "../../core/offset-model";
import type { RenderRegistry } from "../types";
import { DEFAULT_BLOCK_ESTIMATE } from "./constants";
import {
  createDocumentIndexStore,
  type MutableDocumentIndexStore,
} from "./document-index-store";

/**
 * Create the shared view refs once. The return type is the `ViewRefs` contract.
 *
 * `documentIndexStore` lets a composed surface (`OwnedModelEditor`) pass in a store
 * it *shares* with its side-panel dock, so the dock's panes read the same off-thread
 * index the block tree does instead of a second worker round-trip (docs/027 §2.2 —
 * one pipeline). Omitted (bare view), the view owns a private store as before.
 */
export function useViewRefs(documentIndexStore?: MutableDocumentIndexStore) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const heightCacheRef = useRef<Map<NodeId, number>>(new Map());
  const estimateRef = useRef<number>(DEFAULT_BLOCK_ESTIMATE);
  // The persistent virtualization geometry (docs/025 §5.2), shared so scroll-to-
  // block and off-window reveal query the treap's prefix in O(log n) instead of
  // an O(n) flat walk over the height cache. Owned/maintained by useVirtualWindow.
  const offsetModelRef = useRef<OffsetModel | null>(null);
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
  // The off-thread bake/index service (docs/010 §7.5). The view derives the
  // document index (TOC + plain-text) in the worker so the main thread is never
  // blocked by the pure-compute pass; results land in refs the diagnostics read.
  const documentIndexRef = useRef<DocumentIndex | null>(null);
  const indexFromWorkerRef = useRef(false);
  const workerRoundTripsRef = useRef(0);
  const bakeServiceRef = useRef<BakeService | null>(null);
  // The reactive twin of `documentIndexRef`: the controller publishes each landed
  // index here so views (a TOC) re-render, while the ref stays a ref so the block
  // list does not (note.md read-side SPI). Created once per view instance.
  const documentIndexStoreRef = useRef<MutableDocumentIndexStore>(
    documentIndexStore ?? createDocumentIndexStore(),
  );

  return {
    autoscrollFrameRef,
    bakeServiceRef,
    contentRef,
    documentIndexRef,
    documentIndexStoreRef,
    dragAnchorRef,
    dragMoveFrameRef,
    draggingRef,
    estimateRef,
    offsetModelRef,
    goalColumnRef,
    heightCacheRef,
    indexFromWorkerRef,
    lastPointerRef,
    pendingScrollRef,
    registryRef,
    rootRef,
    scrollFrameRef,
    touchPointerOffsetRef,
    workerRoundTripsRef,
  };
}

/** The shared mutable-ref bag passed to every view controller (docs/020 §5.3). */
export type ViewRefs = ReturnType<typeof useViewRefs>;
