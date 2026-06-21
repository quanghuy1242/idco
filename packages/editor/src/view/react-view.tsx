/**
 * React binding for the owned-model engine — the view orchestrator (docs/020 §4.3).
 *
 * This file is where Phase 4 became real: React renders every block, but the
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
 * After the docs/020 §4.3 decomposition this component is thin wiring: it creates
 * the shared ref bag (`useViewRefs`), derives the scheduler and body order, calls
 * the controller hooks (virtual window, focus/navigation, clipboard, drag, gap,
 * touch, document index, diagnostics) in the order that preserves the original
 * effect sequence, assembles the imperative handle, and renders the windowed block
 * list (`EngineBlock`) plus the overlays.
 *
 * With `virtualize` (default true, docs/011 §2.6) only the viewport slice plus
 * overscan mounts; `virtualize={false}` keeps the all-mounted render docs/015's
 * reader builds on.
 */
import {
  forwardRef,
  Fragment,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import {
  createEngineScheduler,
  type EditorStore,
  type EngineScheduler,
  type NodeId,
} from "../core";
import { SelectionAnnouncer, SelectionOverlay } from "./selection-overlay";
import { registerBuiltInNodeViews } from "./nodes";
import { useEditorOrder } from "./store-hooks";
import { TouchSelectionLayer } from "./touch-selection";
import { baseViewStyle, computeWindowListMeta } from "./styles";
import { cancelFrame } from "./raf";
import { EngineBlock } from "./block-dispatch";
import { listOverlayStructuralViews } from "./structural-view";
import { listOverlayNodeViews } from "./node-view";
import {
  DEFAULT_OVERSCAN,
  DEFAULT_VIEWPORT_HEIGHT,
} from "./controllers/constants";
import { useViewRefs } from "./controllers/refs";
import { useVirtualWindow } from "./controllers/use-virtual-window";
import { useFocusNavigation } from "./controllers/use-focus-navigation";
import { useClipboard } from "./controllers/use-clipboard";
import { useDragSelection } from "./controllers/use-drag-selection";
import { useGapCursor } from "./controllers/use-gap-cursor";
import { useTouchSelection } from "./controllers/use-touch-selection";
import { useDocumentIndex } from "./controllers/use-document-index";
import {
  useEditorDiagnostics,
  type ObjectBlockDiagnostics,
  type OwnedModelEditorViewDiagnostics,
  type OwnedModelEditorViewHandle,
} from "./controllers/use-editor-diagnostics";

// Register the built-in node views once when the editor module loads (docs/020
// §4.4); the call is idempotent so repeated module loads are safe.
registerBuiltInNodeViews();

// The diagnostics + imperative-handle types live in the diagnostics controller;
// re-export them here so the public view surface keeps the same names.
export type {
  ObjectBlockDiagnostics,
  OwnedModelEditorViewDiagnostics,
  OwnedModelEditorViewHandle,
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
  const refs = useViewRefs();
  const { registryRef, rootRef, contentRef, goalColumnRef } = refs;
  const order = useEditorOrder(store);

  // Block-registry wiring (docs/020 §4.3): tiny ref-setters the dispatcher uses
  // to register mounted block elements, input backends, render counts, and live
  // object-editor surfaces.
  const registerBlock = useCallback(
    (id: NodeId, element: HTMLElement | null) => {
      if (element) {
        registryRef.current.blockRefs.set(id, element);
      } else {
        registryRef.current.blockRefs.delete(id);
        registryRef.current.inputBackends.delete(id);
      }
    },
    [registryRef],
  );
  const registerInputBackend = useCallback(
    (id: NodeId, backend: "native" | "polyfill" | null) => {
      if (backend) {
        registryRef.current.inputBackends.set(id, backend);
      } else {
        registryRef.current.inputBackends.delete(id);
      }
    },
    [registryRef],
  );
  const recordBlockRender = useCallback(
    (id: NodeId) => {
      const counts = registryRef.current.renderCounts;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    },
    [registryRef],
  );
  // A live object-editor surface registers here when it mounts and unregisters
  // on unmount, so diagnostics can assert the one-live-at-a-time cap (AC2).
  const registerObjectEditor = useCallback(
    (id: NodeId, mounted: boolean) => {
      const editors = registryRef.current.objectEditors;
      if (mounted) editors.add(id);
      else editors.delete(id);
    },
    [registryRef],
  );

  const { windowRange, scrollTop, setScrollTop, onScroll } = useVirtualWindow({
    order,
    overscan,
    refs,
    store,
    viewportHeight,
    virtualize,
  });
  const {
    focusBlock,
    focusRoot,
    pageCaret,
    placeCaretAt,
    revealBlock,
    scrollToBlock,
    selectText,
    serializeSelection,
    syncFocusToSelection,
  } = useFocusNavigation({ refs, setScrollTop, store, virtualize });
  const { onClipboardCopy, onClipboardCut, onClipboardPaste } = useClipboard({
    store,
    syncFocusToSelection,
  });
  const { beginDrag, endDrag, extendDragToPointer, handleDragMove } =
    useDragSelection({ refs, scheduler, setScrollTop, store, virtualize });
  const { onRootKeyDown, onRootMouseDown } = useGapCursor({
    beginDrag,
    focusBlock,
    focusRoot,
    refs,
    store,
    syncFocusToSelection,
  });
  const {
    isTouchDevice,
    setTouchCaretActionsOpen,
    touchActions,
    touchCaretActionsOpen,
    touchInteracting,
  } = useTouchSelection({
    beginDrag,
    endDrag,
    extendDragToPointer,
    focusBlock,
    handleDragMove,
    placeCaretAt,
    refs,
    store,
    syncFocusToSelection,
  });
  useDocumentIndex({ createBakeWorker, order, refs, store });
  const { api } = useEditorDiagnostics({
    focusBlock,
    placeCaretAt,
    refs,
    scheduler,
    scrollToBlock,
    scrollTop,
    selectText,
    serializeSelection,
    store,
    syncFocusToSelection,
    virtualize,
    windowRange,
  });

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
  }, [store, rootRef]);

  useImperativeHandle(ref, () => api, [api]);

  useEffect(() => {
    if (!diagnosticsKey || typeof window === "undefined") return;
    (window as unknown as Record<string, unknown>)[diagnosticsKey] = api;
    return () => {
      delete (window as unknown as Record<string, unknown>)[diagnosticsKey];
    };
  }, [api, diagnosticsKey]);

  const { scrollFrameRef, dragMoveFrameRef, autoscrollFrameRef } = refs;
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
    [scrollFrameRef, dragMoveFrameRef, autoscrollFrameRef],
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
        {renderEngineOverlays(store, rootRef)}
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
        {renderEngineOverlays(store, contentRef)}
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

/**
 * Mount every registered view-level overlay once (docs/020 §4.2, note.md W1).
 * Each registered `StructuralNodeView`/`NodeView` overlay is a singleton portal
 * that serves all instances of its type (the table's hover controls + cell
 * layer), so the orchestrator enumerates the registries and mounts each here.
 * This keeps a feature's floating chrome out of this file — before W1 the table
 * overlays were hardcoded imports in both render branches. `rootRef` is the
 * branch's anchor element (the scroller content when virtualized, else the root).
 */
function renderEngineOverlays(
  store: EditorStore,
  rootRef: RefObject<HTMLElement | null>,
): ReactNode[] {
  return [
    ...listOverlayStructuralViews().map((view) => (
      <Fragment key={`structural:${view.type}`}>
        {view.renderOverlay({ rootRef, store })}
      </Fragment>
    )),
    ...listOverlayNodeViews().map((view) => (
      <Fragment key={`object:${view.type}`}>
        {view.renderOverlay({ rootRef, store })}
      </Fragment>
    )),
  ];
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
