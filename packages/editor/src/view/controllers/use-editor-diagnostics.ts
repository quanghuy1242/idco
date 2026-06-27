/**
 * Diagnostics + imperative-handle controller (docs/020 §4.3, R3).
 *
 * Owns the Playwright-facing diagnostics snapshot, the public `OwnedEditorHandle`
 * accessor, and the assembled imperative `api`. The diagnostics/handle TYPES live
 * here (re-exported by `react-view.tsx`) so the controller is self-contained.
 * Lifted verbatim from `react-view.tsx`.
 */
import { useCallback, useMemo, useRef } from "react";
import {
  createOwnedEditorHandle,
  type DocumentIndex,
  type EditorSelection,
  type EditorStore,
  type EnginePerformanceSnapshot,
  type EngineScheduler,
  type NodeId,
  type OwnedEditorHandle,
} from "../../core";
import { activeSelectionNode } from "../overlays";
import type { ImeBoundsSnapshot } from "../types";
import type { ViewRefs } from "./refs";
import type { VirtualWindow } from "./use-virtual-window";

/**
 * @categoryDefault Editor Components
 */

/** Per-object-block diagnostics: its type, status, resting/live state, and whether its data is baked. */
export type ObjectBlockDiagnostics = {
  readonly type: string;
  readonly status: string;
  readonly state: "resting" | "live";
  readonly hasBaked: boolean;
};

/** The Playwright-facing diagnostics snapshot of the editor view: selection, window range, mounted blocks, object states, IME, and index. */
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

/** The imperative handle exposed by the editor view: diagnostics, focus/selection control, scroll-to-block, and the public editor handle. */
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

export function useEditorDiagnostics(args: {
  readonly refs: ViewRefs;
  readonly store: EditorStore;
  readonly scheduler: EngineScheduler;
  readonly scrollTop: number;
  readonly virtualize: boolean;
  readonly windowRange: VirtualWindow;
  readonly focusBlock: (id: NodeId) => boolean;
  readonly selectText: (
    anchorNode: NodeId,
    anchorOffset: number,
    focusNode: NodeId,
    focusOffset: number,
  ) => void;
  readonly scrollToBlock: (id: NodeId) => void;
  readonly placeCaretAt: (clientX: number, clientY: number) => void;
  readonly serializeSelection: () => string;
  readonly syncFocusToSelection: () => void;
}): {
  readonly diagnostics: () => OwnedModelEditorViewDiagnostics;
  readonly api: OwnedModelEditorViewHandle;
} {
  const {
    refs,
    store,
    scheduler,
    scrollTop,
    virtualize,
    windowRange,
    focusBlock,
    selectText,
    scrollToBlock,
    placeCaretAt,
    serializeSelection,
    syncFocusToSelection,
  } = args;
  const {
    registryRef,
    documentIndexRef,
    indexFromWorkerRef,
    workerRoundTripsRef,
    rootRef,
  } = refs;

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
  }, [
    scheduler,
    scrollTop,
    store,
    virtualize,
    windowRange,
    registryRef,
    documentIndexRef,
    indexFromWorkerRef,
    workerRoundTripsRef,
    rootRef,
  ]);

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

  return { api, diagnostics };
}
