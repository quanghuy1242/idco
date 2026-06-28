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
  useMemo,
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
import { SelectionAnnouncer, SelectionOverlay } from "./overlays";
import { registerBuiltInNodeViews } from "./nodes";
import { useEditorOrder } from "./store-hooks";
import { TouchPasteAction, TouchSelectionLayer } from "./overlays";
import { ObjectEditorRegistryProvider } from "./render/object-editor-registry";
import { computeWindowListMeta, resolveViewStyle } from "./styles";
import { cancelFrame, requestFrame } from "./raf";
import { EngineBlock } from "./render";
import { PlaceholderProvider, type PlaceholderContextValue } from "./render";
import { listOverlayStructuralViews } from "./spi";
import { listOverlayNodeViews } from "./spi";
import { registerBuiltInMarks } from "./render";
import { registerBuiltInBlockTypes } from "./spi";
import type { OverlayAuthority, OverlayAuthorityRef, PanelHost } from "./spi";
import {
  registerBuiltInCommands,
  registerBuiltInOverlays,
  SelectionSurfaceHost,
} from "./chrome";
import {
  DEFAULT_OVERSCAN,
  DEFAULT_VIEWPORT_HEIGHT,
} from "./controllers/constants";
import { useViewRefs } from "./controllers/refs";
import type { MutableDocumentIndexStore } from "./controllers/document-index-store";
import { useVirtualWindow } from "./controllers/use-virtual-window";
import { useFocusNavigation } from "./controllers/use-focus-navigation";
import { useClipboard } from "./controllers/use-clipboard";
import { useDragSelection } from "./controllers/use-drag-selection";
import { useGapCursor } from "./controllers/use-gap-cursor";
import { useTouchSelection } from "./controllers/use-touch-selection";
import { useDocumentIndexController } from "./controllers/use-document-index";
import { DocumentIndexProvider } from "./document-index";
import {
  useEditorDiagnostics,
  type ObjectBlockDiagnostics,
  type OwnedModelEditorViewDiagnostics,
  type OwnedModelEditorViewHandle,
} from "./controllers/use-editor-diagnostics";

// Register the built-in node views once when the editor module loads (docs/020
// §4.4); the call is idempotent so repeated module loads are safe.
registerBuiltInNodeViews();
// Register the built-in marks too (note.md W4). Explicit here so the toolbar +
// context menu (which read `listMarks()`) see a populated registry regardless of
// import order; the call is idempotent with mark-render's own module-load call.
registerBuiltInMarks();
// And the built-in block types (note.md W5), same rationale: the toolbar + context
// menu read `listBlockTypes()`, and `selection-overlay` reads `blockTypeRole`.
registerBuiltInBlockTypes();
// And the built-in commands — ribbon tabs/slots + the cross-surface commands
// (docs/023 §5.2/§9, docs/024 §5.3): this explicit call — not a bare module-load side
// effect — is what keeps the package `sideEffects: false` safe while guaranteeing the
// resolvers see the built-in commands regardless of import order. Idempotent with the
// builtins module's own self-call.
registerBuiltInCommands();
// And the built-in overlay contributors (docs/029 R1-D): the one selection surface that
// replaces the desktop flyout + the touch range toolbar. Same explicit-call rationale as
// the commands above; idempotent by id.
registerBuiltInOverlays();

// The diagnostics + imperative-handle types live in the diagnostics controller;
// re-export them here so the public view surface keeps the same names.
export type {
  ObjectBlockDiagnostics,
  OwnedModelEditorViewDiagnostics,
  OwnedModelEditorViewHandle,
};

/**
 * @categoryDefault Editor Components
 */

/** Props for {@link OwnedModelEditorView}: the store plus virtualization, worker, index, and overlay-authority wiring. */
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
  /**
   * Fixed scroller height in pixels for the virtualized path; ignored when
   * `virtualize` is false or when `fillHeight` is set (then the surface measures
   * its flex container instead). The windowing math needs a concrete height, so
   * this is the fallback used until the container is measured.
   */
  readonly viewportHeight?: number;
  /**
   * Stretch the surface to fill its container's height (R3, note.md §5.9) — for a
   * document-centric CMS where the editor *is* the page and the whole tall area is
   * a click-to-type target. On the virtualized path the scroller height is measured
   * from the flex container (so windowing tracks the real height); on the
   * non-virtualized path the surface takes `height: 100%`. Pair with a parent that
   * has a height (a flex column, `h-screen`, etc.). A click in the blank area below
   * the last block then places the caret at the end of the document.
   */
  readonly fillHeight?: boolean;
  /**
   * Drop the editor's default card chrome — no border, no rounded corners, no
   * max-width cap (R3, note.md §5.9) — so the surface reads as the page itself.
   * Replaces the previous `style={{ border: "none", ... }}` escape hatch with a
   * typed prop; an explicit `style` still merges over the result.
   */
  readonly chromeless?: boolean;
  /**
   * Muted hint painted in an empty document's first/only block (R2, note.md §5.8),
   * like a normal editor's empty state ("Type here…"). It paints as a
   * non-interactive overlay that respects the engine's painted caret and disappears
   * on the first character; it shows only while the document is a single empty
   * block (use `emptyDocument()` to seed one).
   */
  readonly placeholder?: string;
  /** Overscan blocks kept mounted on each side of the viewport. */
  readonly overscan?: number;
  /**
   * Factory for the bake/index Web Worker (docs/010 §7.5). Defaults to a worker
   * built over `core/bake/bake.worker`; return null to force the in-memory loopback
   * (tests/SSR, or where `Worker` is unavailable).
   */
  readonly createBakeWorker?: () => Worker | null;
  /**
   * A document-index store to share with a side-panel dock (docs/027 §2.2). When the
   * composed `OwnedModelEditor` passes one, the off-thread index controller publishes
   * into it and the dock's panes read the same live index; omitted, the view owns a
   * private store as before. The block tree itself never re-renders on a publish.
   */
  readonly documentIndexStore?: MutableDocumentIndexStore;
  /**
   * A stable overlay-authority ref created by the composing editor (docs/029 §7.4). The
   * selection-surface host writes the live authority into it so the composing editor's
   * surfaces (right-click menu, mark-click popovers, table cell `…`) can open overlays.
   * Omitted in the bare view, where the host owns the authority privately.
   */
  readonly overlayAuthorityRef?: OverlayAuthorityRef;
  /**
   * The side-panel dock seam (docs/027 §8.2), threaded into the overlay authority so a
   * surface rendered through it (the glossary read card's "Open in Glossary", a flyout
   * command that opens a pane) can reach the dock. Omitted in the bare view, which has no
   * dock.
   */
  readonly overlayPanelHost?: PanelHost;
};

/** The bare engine view: renders the document as windowed blocks with caret, selection, and virtualization, with no toolbar or chrome. */
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
    fillHeight = false,
    chromeless = false,
    placeholder,
    overscan = DEFAULT_OVERSCAN,
    createBakeWorker = defaultCreateBakeWorker,
    documentIndexStore,
    overlayAuthorityRef,
    overlayPanelHost,
  } = props;
  const localSchedulerRef = useRef<EngineScheduler | null>(null);
  if (!providedScheduler && !localSchedulerRef.current) {
    localSchedulerRef.current = createEngineScheduler();
  }
  const scheduler = providedScheduler ?? localSchedulerRef.current!;
  // The view reads the live authority (owned by the leaf SelectionSurfaceHost) through a ref.
  // A composing editor passes its own stable ref so its chrome shares the handle; the bare
  // view gets none, so a local fallback keeps the touch caret-paste affordance working there
  // too. Only one authority exists; this is just the handle the view reads it through.
  const localAuthorityRef = useRef<OverlayAuthority | null>(null);
  const authorityRef = overlayAuthorityRef ?? localAuthorityRef;
  const refs = useViewRefs(documentIndexStore);
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

  const { windowRange, scrollTop, setScrollTop, onScroll, fling } =
    useVirtualWindow({
      fillHeight,
      order,
      overscan,
      refs,
      store,
      viewportHeight,
      virtualize,
    });

  // Empty-document placeholder slot (R2, note.md §5.8). The hint shows only while
  // the document is a single text block; this names that block as the slot (the
  // leaf paints the hint when it is the slot AND its own text is empty). Derived
  // from `order` (a structural signal the view already re-renders on), so a split
  // clears it; memoized so a scroll re-render does not churn the context value and
  // re-render every mounted leaf.
  const placeholderValue = useMemo<PlaceholderContextValue>(() => {
    if (!placeholder) return null;
    const firstId = order.length === 1 ? order[0]! : null;
    const firstNode = firstId ? store.getNode(firstId) : null;
    return {
      targetId: firstId && firstNode?.kind === "text" ? firstId : null,
      text: placeholder,
    };
  }, [order, placeholder, store]);
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
  // Mirror the touch controller's caret long-press flag into the overlay authority (docs/029
  // R1-G): open the `caret` actions surface (Paste) when the long-press fires, dismiss when it
  // clears. `caretPasteOpenRef` guards against re-opening on unrelated re-renders; the surface
  // body ({@link TouchPasteAction}) calls back on unmount so an authority-side dismissal (an
  // outside touch / Escape) syncs the flag back. This replaces the old in-layer AnchoredPopover
  // with `shouldCloseOnInteractOutside={() => true}` — the authority owns dismissal now.
  const caretPasteOpenRef = useRef(false);
  useEffect(() => {
    const authority = authorityRef.current;
    if (!authority) return;
    if (touchCaretActionsOpen && !touchInteracting) {
      if (caretPasteOpenRef.current) return;
      caretPasteOpenRef.current = true;
      authority.openCaretActions(() => (
        <TouchPasteAction
          onClose={() => {
            caretPasteOpenRef.current = false;
            setTouchCaretActionsOpen(false);
          }}
          onPaste={() => {
            touchActions.paste();
            authority.dismiss("caret");
          }}
        />
      ));
    } else if (caretPasteOpenRef.current) {
      caretPasteOpenRef.current = false;
      authority.dismiss("caret");
    }
  }, [
    authorityRef,
    setTouchCaretActionsOpen,
    touchActions,
    touchCaretActionsOpen,
    touchInteracting,
  ]);
  useDocumentIndexController({ createBakeWorker, refs, scheduler, store });
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

  // Focus reclaim after an edit unmounts the focused host (note.md §5.3, B3).
  //
  // A structural edit can remove the very DOM host that held focus: deleting the
  // table the caret sat in, merging the focused block into its predecessor, etc.
  // Removing a focused element drops browser focus to <body> (confirmed: the cell
  // host fires a capture-phase `blur` mid-dispatch with `document.activeElement`
  // already `body`, and no `focusout` reaches the document). The model meanwhile
  // remapped the selection onto a surviving block (commit pipeline apply→
  // mapSelection), so it still names a text caret — but the painted caret is gated
  // on focus being inside the surface (selection-overlay `useEditorFocusWithin`),
  // so an orphaned focus hides the caret and kills typing until a re-click. The
  // toolbar returns focus via `focusEditor`, but a bare `store.command` delete (a
  // host button, a programmatic edit) does not, so the engine must re-home it.
  //
  // The trigger is the commit, not a focus event: only a *local structural* commit
  // can orphan the user's own focus (a remote/collaborative edit must never grab
  // focus; a pure text edit never unmounts the host). We re-check on the next frame
  // — the same "let focus settle" deferral the focus-within gate uses, here across
  // the view's structural re-render — and reclaim only when focus actually fell to
  // body, the selection's block is mounted, and a focus-taking overlay is not
  // deliberately holding focus (the docs/029 §7.1 reclaim seam). Virtualization
  // scroll-away is excluded for free: the focus block is then unmounted, so the
  // `blockRefs.has` guard fails and nothing is reclaimed.
  useEffect(() => {
    return store.subscribeCommit((committed) => {
      if (committed.origin !== "local" || !committed.structureChanged) return;
      requestFrame(() => {
        if (store.isReclaimSuspended()) return;
        const sel = store.selection;
        if (sel?.type !== "text") return;
        const root = rootRef.current;
        if (!root) return;
        const doc = root.ownerDocument;
        const active = doc.activeElement;
        const orphaned =
          !active || active === doc.body || active === doc.documentElement;
        if (!orphaned) return;
        if (!registryRef.current.blockRefs.has(sel.focus.node)) return;
        syncFocusToSelection();
      });
    });
  }, [store, syncFocusToSelection, rootRef, registryRef]);

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
  const blocks = windowRange.ids.map((id, positionInWindow) => {
    /*
     * Velocity-gated mount (docs/025 §5.5): during a fling, render a cheap
     * height-preserving placeholder for RESTING object blocks instead of
     * hydrating their decorator, so a fast flywheel scroll does no per-frame
     * decorator work and shows no blank gap. The height is the block's SEED-or-
     * measured height from the offset model (§5.3), so even a never-mounted block
     * gets a correctly sized box instead of falling through to full hydration.
     * It stays registered with the same data-engine-block-id so the
     * ResizeObserver keeps measuring it, and it swaps back to the live block on
     * idle. Guards: only objects (text is cheap and may hold the caret); never
     * the active object (would drop its live editor) nor a node-selected object
     * (the selection overlay/AT points at it).
     */
    if (fling) {
      const node = store.getNode(id);
      const selection = store.selection;
      const nodeSelected = selection?.type === "node" && selection.node === id;
      if (
        node?.kind === "object" &&
        store.activeObjectId !== id &&
        !nodeSelected
      ) {
        const index = windowRange.startIndex + positionInWindow;
        const model = refs.offsetModelRef.current;
        const height = model
          ? model.prefix(index + 1) - model.prefix(index)
          : refs.heightCacheRef.current.get(id);
        if (height !== undefined && height > 0) {
          return (
            <div
              aria-hidden="true"
              data-engine-block-id={id}
              data-engine-block-placeholder=""
              key={id}
              ref={(element) => registerBlock(id, element)}
              style={{ height }}
            />
          );
        }
      }
    }
    return (
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
    );
  });

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
        style={resolveViewStyle({
          chromeless,
          fillHeight,
          style,
          viewportHeight,
          virtualize,
        })}
        tabIndex={-1}
      >
        <DocumentIndexProvider
          revealNode={scrollToBlock}
          store={refs.documentIndexStoreRef.current}
        >
          <PlaceholderProvider value={placeholderValue}>
            {blocks}
          </PlaceholderProvider>
          <SelectionOverlay
            registry={registryRef.current}
            rootRef={rootRef}
            scheduler={scheduler}
            store={store}
          />
          {renderEngineOverlays(store, rootRef)}
          {isTouchDevice && (
            <TouchSelectionLayer
              containerRef={rootRef}
              registry={registryRef.current}
              scheduler={scheduler}
              store={store}
            />
          )}
          <SelectionAnnouncer scheduler={scheduler} store={store} />
          <ObjectEditorRegistryProvider value={registerObjectEditor}>
            <SelectionSurfaceHost
              authorityRef={authorityRef}
              focusEditor={syncFocusToSelection}
              panelHost={overlayPanelHost}
              store={store}
            />
          </ObjectEditorRegistryProvider>
        </DocumentIndexProvider>
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
      // `resolveViewStyle` keeps the docs/025 §5.4 `overflowAnchor: "none"` (the
      // controller owns the scroll anchor) and applies `chromeless`/`fillHeight`;
      // `fillHeight` here sets the scroller box to `100%` while `useVirtualWindow`
      // measures the real container height for the windowing math.
      style={resolveViewStyle({
        chromeless,
        fillHeight,
        style,
        viewportHeight,
        virtualize,
      })}
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
        <DocumentIndexProvider
          revealNode={scrollToBlock}
          store={refs.documentIndexStoreRef.current}
        >
          <PlaceholderProvider value={placeholderValue}>
            {blocks}
          </PlaceholderProvider>
          <SelectionOverlay
            registry={registryRef.current}
            rootRef={contentRef}
            scheduler={scheduler}
            store={store}
          />
          {renderEngineOverlays(store, contentRef)}
          {isTouchDevice && (
            <TouchSelectionLayer
              containerRef={contentRef}
              registry={registryRef.current}
              scheduler={scheduler}
              store={store}
            />
          )}
          <SelectionAnnouncer scheduler={scheduler} store={store} />
          <ObjectEditorRegistryProvider value={registerObjectEditor}>
            <SelectionSurfaceHost
              authorityRef={authorityRef}
              focusEditor={syncFocusToSelection}
              panelHost={overlayPanelHost}
              store={store}
            />
          </ObjectEditorRegistryProvider>
        </DocumentIndexProvider>
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
    return new Worker(new URL("../core/bake/bake.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return null;
  }
}
