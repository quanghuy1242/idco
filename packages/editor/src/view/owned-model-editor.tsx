/**
 * `OwnedModelEditor` — the composed, opt-in owned-model editing surface
 * (docs/010 Phase 8 AC2/AC5).
 *
 * `OwnedModelEditorView` is the bare engine surface (blocks, caret, selection,
 * virtualization). This component wraps it with the Phase 8 chrome — the
 * formatting toolbar (`@idco/ui`) and the find bar — and threads the public
 * editor handle so the chrome drives the model, never the DOM. It is the surface
 * a host mounts to ship the engine; it is exported explicitly and never replaces
 * the default `RichTextEditor` (G6, AC5).
 *
 * Document theming is DaisyUI typography: the surface carries the `prose` class
 * so headings, lists, links, and marks are themed by the framework, not inline
 * styles (docs/010 §7.1). The engine's functional CSS (caret/selection suppression,
 * `pre-wrap`) stays in `styles.ts` and is unaffected.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "./chrome/surfaces/use-is-mobile";
import type { NodeId, OwnedEditorHandle } from "../core";
import {
  EditorToolbar,
  EngineContextMenu,
  SidePanelDock,
  useCommandSurfaces,
} from "./chrome";
import type {
  PanelHost,
  ToolbarCapabilities,
  ToolbarLayoutConfig,
} from "./spi";
import {
  getDataSource,
  OverlayAuthorityRefProvider,
  registerDataSource,
  type OverlayAuthority,
} from "./spi";
import {
  createDocumentIndexStore,
  type MutableDocumentIndexStore,
} from "./controllers/document-index-store";
import { FindBar } from "./chrome";
import { probeLinkMark } from "./chrome";
import { probeAnnotationMark } from "./chrome";
import { CommentAffordance } from "./chrome";
import {
  OwnedModelEditorView,
  type OwnedModelEditorViewHandle,
  type OwnedModelEditorViewProps,
} from "./react-view";
import { UploadProvider, type UploadImage } from "./upload-context";
import { useAutosave, type AutosaveOptions } from "./use-autosave";
import { requestFrame } from "./raf";

/**
 * @categoryDefault Editor Components
 */

/** Props for {@link OwnedModelEditor}: the view props plus the chrome, upload, embed, and autosave wiring. */
export type OwnedModelEditorProps = OwnedModelEditorViewProps & {
  /** Hide the formatting toolbar (default: shown). */
  readonly hideToolbar?: boolean;
  /** Document-theming class applied to the surface. Defaults to DaisyUI `prose`. */
  readonly proseClassName?: string;
  /** Host upload binding for image config + drag-drop (AC10); inert when absent. */
  readonly uploadImage?: UploadImage;
  /**
   * Allowed iframe-embed hostnames (docs/026 §4.4). The editor registers a default
   * `embed` source whose `resolve` refuses an off-allowlist URL (marking the block
   * `invalid`, §12). Empty/undefined allows any `http(s)` origin.
   */
  readonly allowedEmbedDomains?: readonly string[];
  /** Autosave wiring (AC10). When set, edits persist debounced through `onSave`. */
  readonly autosave?: AutosaveOptions;
  /** Replace/patch the built-in toolbar arrangement (docs/023 §6.3). */
  readonly toolbarLayout?: ToolbarLayoutConfig;
  /** Per-deployment toolbar capability flags (docs/023 §5.6). */
  readonly toolbarCapabilities?: Partial<ToolbarCapabilities>;
  /**
   * Host-placed chrome — the side-panel dock (docs/034 HPC-1, Tier 1 placement slot).
   * The editor builds the dock fully wired (store subscription, the `PanelHost`
   * open/active lifecycle, the shared document index, the overlay-authority context) and
   * hands that element here; return it wrapped in the host's own markup/CSS and it renders
   * in the dock's normal home — a sibling of the surface — so the overlay authority and the
   * focus wrapper still enclose it (docs/034 §7.1). The host owns the box, not the wiring.
   * The dock element renders `null` while the dock is closed or has no available pane, so a
   * host wrapper should react to emptiness and not reserve layout space for an empty dock.
   * Placement applies to the **desktop dock column only**: on a narrow viewport the dock is a
   * self-portaling overlay sheet (a `Drawer`, docs/027 §8.3), so `renderDock` is bypassed and
   * the sheet stays editor/authority-owned (wrapping a self-portaling sheet would leave an
   * empty host box). For DOM relocation into a structurally separate region the surrounding
   * CSS cannot reach, use {@link OwnedModelEditorProps.dockContainer} instead.
   */
  readonly renderDock?: (dock: ReactNode) => ReactNode;
  /**
   * Host-placed chrome escape hatch (docs/034 §7.1): portal the wired dock into a
   * host-owned element so it can live in a structurally separate region (a global app
   * sidebar) that CSS alone cannot reach. Pass the **element itself**, driven from host state
   * via a callback ref (`const [el, setEl] = useState<HTMLElement | null>(null)` then
   * `ref={setEl}`) so it stays render-pure and tracks the element mounting/unmounting. A
   * `null` value means "placement intended, the target is not mounted yet" — the dock renders
   * nowhere until the element exists (a dev warning fires if it stays `null` while a pane is
   * open); omitting the prop (`undefined`) means no placement. The dock stays in the editor's
   * React tree — so the overlay-authority context and focus wiring still flow through the
   * portal — but its DOM parent becomes the given element. Takes precedence over the default
   * sibling slot (the dock never renders in both places); composes with `renderDock` (the
   * wrapper is applied first, then portaled). Desktop-column only, like `renderDock` (the
   * mobile sheet stays a self-portaling overlay). The host MUST keep the editor's surface a
   * transform-free, independently-sized box (docs/034 §9.5), or virtual-geometry offset
   * measurement (docs/025) and the `position: fixed` overlays (docs/029) break.
   */
  readonly dockContainer?: HTMLElement | null;
};

/** Imperative handle for {@link OwnedModelEditor}: the view handle plus find-bar and side-panel control. */
export type OwnedModelEditorHandle = OwnedModelEditorViewHandle & {
  /** Open the in-editor find bar (the Ctrl/Cmd+F replacement). */
  readonly openFind: () => void;
  /**
   * Open the side-panel dock on a registered pane, optionally focused on an item
   * (docs/027 §16 P7). The host already holds this handle, so this is how host code
   * outside the command system (a host button, a custom mark's onClick) drives the
   * dock — the imperative twin of a command's `ctx.panelHost.open`.
   */
  readonly openPanel: (paneId: string, focusId?: string) => void;
  /** Close the side-panel dock. */
  readonly closePanel: () => void;
};

/** The batteries-included owned-model editor: the engine view wrapped with the formatting toolbar, find bar, side-panel dock, and upload/autosave wiring. */
export const OwnedModelEditor = forwardRef(function OwnedModelEditor(
  props: OwnedModelEditorProps,
  ref: Ref<OwnedModelEditorHandle>,
) {
  const {
    allowedEmbedDomains,
    autosave,
    dockContainer,
    hideToolbar,
    proseClassName = "prose max-w-none",
    renderDock,
    store,
    toolbarCapabilities,
    toolbarLayout,
    uploadImage,
    ...viewProps
  } = props;
  // `fillHeight`/`chromeless` stay in `viewProps` (read but not destructured out)
  // so they still reach the view; `fillHeight` is also read here to stretch the
  // chrome's flex chain (wrapper → body → surface → prose) so the view's
  // `height: 100%`/`minHeight: 100%` has a definite height to fill (R3, note.md
  // §5.9). Needs the consuming page to give this root a height.
  const fillHeight = props.fillHeight ?? false;
  const wrapperClass = fillHeight ? "flex flex-col h-full" : "flex flex-col";
  const bodyClass = fillHeight
    ? "flex items-stretch gap-1 p-1 min-h-0 flex-1"
    : "flex items-stretch gap-1 p-1";
  const surfaceClass = fillHeight
    ? "relative min-w-0 flex-1 min-h-0"
    : "relative min-w-0 flex-1";
  const proseFillClass = fillHeight
    ? `${proseClassName} h-full`
    : proseClassName;
  const viewRef = useRef<OwnedModelEditorViewHandle | null>(null);
  // The shared overlay-authority ref (docs/029 §7.4): created here (stable), populated by the
  // editing view's `SelectionSurfaceHost`, and provided to the whole editor subtree so the
  // right-click menu, mark-click popovers, and the table cell `…` can open overlays without
  // subscribing to the authority's envelope state.
  const overlayAuthorityRef = useRef<OverlayAuthority | null>(null);
  const [handle, setHandle] = useState<OwnedEditorHandle | null>(null);

  // The public handle is created by the view after mount; capture it once so
  // autosave can subscribe to change/dirty events (AC10).
  useEffect(() => {
    setHandle(viewRef.current?.getEditorHandle() ?? null);
  }, []);

  // Fold the legacy `uploadImage` prop into the data-provider SPI (docs/026
  // §14.12): expose it as an upload-only `media` source so the image config's
  // upload button works without the host registering a source. A host that
  // registers a richer `media` source (browse + upload) wins — the shim only fills
  // the gap, and it never unregisters so it cannot clobber a host source.
  useEffect(() => {
    if (!uploadImage || getDataSource("media")) return;
    registerDataSource({
      id: "media",
      upload: async (file) => {
        const result = await uploadImage(file);
        return { id: result.src, image: result.src, label: result.alt ?? "" };
      },
    });
  }, [uploadImage]);

  // The default `embed` source (docs/026 §4.4): embed is a resolve-only reference
  // block, so the editor provides the source that validates a pasted URL against
  // `allowedEmbedDomains`. A `null` from `resolve` marks the block `invalid` and the
  // embed render suppresses the iframe (§12). Guarded like the media shim: a host
  // that registered its own `embed` source (oEmbed title fetch, etc.) wins, and the
  // guard also stops the re-registration churn when `allowedEmbedDomains` is passed
  // as a fresh array literal each render. `allowedEmbedDomains` is captured at first
  // registration (it is a static deployment config).
  useEffect(() => {
    if (getDataSource("embed")) return;
    const allowed = allowedEmbedDomains;
    registerDataSource({
      id: "embed",
      resolve: async (refUrl) => {
        if (!/^https?:\/\//i.test(refUrl)) return null;
        if (allowed && allowed.length > 0) {
          try {
            if (!allowed.includes(new URL(refUrl).hostname)) return null;
          } catch {
            return null;
          }
        }
        return { id: refUrl, label: "" };
      },
    });
  }, [allowedEmbedDomains]);

  const focusEditor = useCallback(() => {
    // Focus-reclaim seam (docs/029 §7.1): the courtesy "return focus to the editor" call
    // that surfaces fire after a command must not steal focus from a focus-taking overlay
    // that is currently open (a link/glossary/comment form). The authority resumes the
    // reclaim and restores focus itself on dismissal, so this no-ops only while a taking
    // surface owns focus and behaves exactly as before otherwise.
    if (store.isReclaimSuspended()) return;
    viewRef.current?.getEditorHandle().focus();
  }, [store]);

  // Sticky editor focus (note.md §5.8 follow-up — the author's "editor loses focus too
  // easily" report). A mousedown that ORIGINATES inside the editor but lands on a
  // non-focusable dead zone (the surface padding/margin, the gutter, a chrome gap)
  // makes the browser blur the painted caret to <body>. Defer a frame and, only if
  // focus actually fell to <body>/<html> and no focus-taking overlay is deliberately
  // holding focus, return focus to the model selection. Deliberately scoped so it is
  // safe: it is wired on the editor wrapper, so it never runs for clicks OUTSIDE the
  // editor (clicking away still blurs normally — focus is not trapped); the body-only
  // check means a click that legitimately focuses a control/modal input (which lands
  // on that element, not <body>) is left alone; and `isReclaimSuspended` defers to an
  // open link/find/comment surface. Primary button only.
  const onEditorMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const doc = (event.currentTarget as HTMLElement).ownerDocument;
      requestFrame(() => {
        if (store.isReclaimSuspended()) return;
        const active = doc.activeElement;
        const orphaned =
          !active || active === doc.body || active === doc.documentElement;
        if (!orphaned) return;
        focusEditor();
      });
    },
    [focusEditor, store],
  );

  // Drag-drop an image file: route through the host upload binding and insert a
  // media node with the resolved src (AC10, §10.5). Inert without a binding.
  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const file = event.dataTransfer?.files?.[0];
      if (!file || !uploadImage || !file.type.startsWith("image/")) return;
      event.preventDefault();
      // Drop the caret at the drop point first so the image inserts where the
      // pointer is, not at the stale selection (insert-object inserts after the
      // selected block).
      viewRef.current?.placeCaretAt(event.clientX, event.clientY);
      void (async () => {
        const result = await uploadImage(file);
        store.command({
          data: {
            // The uploaded asset is referenced by its src (the same id the
            // `uploadImage` media-source shim uses, §14.12). A non-empty ref is
            // essential: an empty ref would read `unresolved` on mount and paint the
            // "Pick an image" empty-state badge over a perfectly good image.
            local: { caption: "" },
            ref: result.src,
            snapshot: { alt: result.alt ?? "", src: result.src },
          },
          objectType: "media",
          type: "insert-object",
        });
      })();
    },
    [store, uploadImage],
  );

  // Find is opened through the overlay authority as a *sticky* form (docs/029 R1-G): the bar
  // owns its own search state, the authority owns its lifecycle. `openFind` anchors it near
  // the surface's top-right corner (a `point`) and the `sticky` focus-mode keeps its field
  // focused while the author clicks matches in the document — what the old in-`data-engine-
  // surface` absolute popover did via a `shouldCloseOnInteractOutside` hack.
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const scrollToBlock = useCallback(
    (id: NodeId) => viewRef.current?.scrollToBlock(id),
    [],
  );
  const openFind = useCallback(() => {
    const authority = overlayAuthorityRef.current;
    if (!authority) return;
    const rect = surfaceRef.current?.getBoundingClientRect();
    // Anchor a bar-width in from the right edge so the box lands at the top-right; the central
    // positioning solve clamps/flips it into the viewport regardless.
    const x = rect ? Math.max(0, rect.right - 380) : 8;
    const y = rect ? rect.top + 8 : 8;
    authority.openStickyForm(x, y, (ctx) => (
      <FindBar onClose={ctx.dismiss} scrollTo={scrollToBlock} store={store} />
    ));
  }, [scrollToBlock, store]);

  // The flat command surfaces (context menu, selection flyout, slash menu) share one
  // capability set + one coordinator (docs/024 §8). Defaults mirror the ribbon's so a
  // host's `toolbarCapabilities` gates every surface identically.
  const capabilities = useMemo(
    () =>
      ({
        ai: false,
        insertTable: true,
        media: false,
        review: false,
        ...toolbarCapabilities,
      }) as ToolbarCapabilities,
    [toolbarCapabilities],
  );
  // --- The side-panel dock (docs/027 §8) --------------------------------------
  // A document-index store shared with the dock so its panes read the same off-thread
  // index the block tree does, not a second worker round-trip (docs/027 §2.2 — one
  // pipeline). Created once and threaded into the view (which publishes into it) and
  // the dock (whose panes subscribe through `useDocumentIndex`).
  const indexStoreRef = useRef<MutableDocumentIndexStore | null>(null);
  if (!indexStoreRef.current)
    indexStoreRef.current = createDocumentIndexStore();
  // The dock's only persistent state: open/closed, the active pane id (docs/027 §8.5),
  // and an optional item the pane should reveal when routed to from a clicked
  // annotation (docs/027 §16 P6).
  const [panelOpen, setPanelOpen] = useState(false);
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const [activePanelFocusId, setActivePanelFocusId] = useState<string | null>(
    null,
  );
  // docs/034 HPC-1 host placement applies to the desktop dock column only. On a narrow
  // viewport the dock is a self-portaling overlay sheet (a `Drawer`, docs/027 §8.3), so
  // wrapping it with `renderDock` or portaling it via `dockContainer` would leave an empty
  // host box and float the sheet elsewhere; the placement is bypassed and the sheet stays
  // editor/authority-owned. We read the same shared breakpoint the dock and ribbon use so
  // the three stay in lockstep.
  const isMobile = useIsMobile();
  // Dev diagnostic (gated like the overlay-layer transform assert): a `dockContainer` that is
  // `null` while a pane is open on desktop means the host wired placement to an element that
  // never mounted (a sidebar not rendered, a ref not forwarded) — the dock would silently
  // render nowhere. `null` is distinct from `undefined` (no placement intended), so this only
  // warns when the host asked to portal but gave no target.
  useEffect(() => {
    if (
      typeof process !== "undefined" &&
      process.env?.NODE_ENV === "production"
    )
      return;
    if (!isMobile && dockContainer === null && panelOpen) {
      // eslint-disable-next-line no-console
      console.warn(
        "[idco] OwnedModelEditor: a side panel is open but `dockContainer` is null — the dock renders nowhere. Pass the host element once it mounts (a callback ref / state element), docs/034 §7.1.",
      );
    }
  }, [dockContainer, isMobile, panelOpen]);
  // Jump-to-anchor for panes (docs/027 §9): the engine's scroll-to-block reaches a
  // windowed-out node a plain `#hash` cannot under virtualization.
  const revealNode = useCallback((id: NodeId) => {
    viewRef.current?.scrollToBlock(id);
  }, []);
  // The panel host seam (docs/027 §8.2): a tab command opens a pane through this; an
  // annotation popover opens a pane *focused* on a term/thread (§16 P6).
  const panelHost = useMemo<PanelHost>(
    () => ({
      close: () => setPanelOpen(false),
      open: (paneId, focusId) => {
        setActivePanelId(paneId);
        setActivePanelFocusId(focusId ?? null);
        setPanelOpen(true);
      },
      toggle: (paneId, focusId) => {
        // Toggling the active pane closes the dock; toggling another pane (or opening
        // when closed, or with a focus target) switches to and reveals it (docs/027
        // §8.2/§16 P6). A focus request always opens (never toggles closed).
        if (panelOpen && activePanelId === paneId && !focusId) {
          setPanelOpen(false);
        } else {
          setActivePanelId(paneId);
          setActivePanelFocusId(focusId ?? null);
          setPanelOpen(true);
        }
      },
    }),
    [activePanelId, panelOpen],
  );

  // The flat command surfaces share the capability set + the dock seam so a flyout
  // command can open a pane too (docs/027 §8.2).
  const surfaces = useCommandSurfaces(store, capabilities, panelHost);
  const { requestContextMenu, closeAll: closeSurfaces } = surfaces;

  // A click on an annotation/link mark opens its surface over it through the overlay
  // authority (docs/029 R1-G): the mark is *probed* into a `{ nodeId, markId }` and
  // `openMark` opens the first matching `mark` contributor (glossary read card / link form).
  // Annotations are tried first so the innermost mark claims the click (docs/027 §16 P6); a
  // plain link falls through. Other clicks pass to the editing surface. The authority owns the
  // popover's focus/positioning/dismissal — no per-interaction hook or anchored popover here.
  const onClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const authority = overlayAuthorityRef.current;
      if (!authority) return;
      const element = event.target as HTMLElement;
      const annotation = probeAnnotationMark(element);
      if (annotation) {
        authority.openMark(annotation);
        return;
      }
      const link = probeLinkMark(store, element);
      if (link) authority.openMark(link);
    },
    [store],
  );

  // Right-click: open the one scope-merged context menu when commands resolve,
  // otherwise leave the native menu (docs/024 §6.4/§9).
  const onContextMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (requestContextMenu(event.clientX, event.clientY)) {
        event.preventDefault();
      }
    },
    [requestContextMenu],
  );

  // Intercept Ctrl/Cmd+F at the surface so virtualization does not break find
  // (native find sees only mounted blocks). AC1 / §10.5 find-in-page.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        openFind();
      }
    },
    [openFind],
  );

  useImperativeHandle(
    ref,
    () => ({
      get diagnostics() {
        return viewRef.current!.diagnostics;
      },
      get focusBlock() {
        return viewRef.current!.focusBlock;
      },
      get getEditorHandle() {
        return viewRef.current!.getEditorHandle;
      },
      closePanel: () => panelHost.close(),
      openFind: () => openFind(),
      openPanel: (paneId, focusId) => panelHost.open(paneId, focusId),
      get placeCaretAt() {
        return viewRef.current!.placeCaretAt;
      },
      get scrollToBlock() {
        return viewRef.current!.scrollToBlock;
      },
      get selectText() {
        return viewRef.current!.selectText;
      },
      get serializeSelection() {
        return viewRef.current!.serializeSelection;
      },
    }),
    [openFind, panelHost],
  );

  // Autosave is always called (hooks rule); it no-ops until a handle exists and
  // an `autosave` config is supplied.
  useAutosave(handle, autosave ?? { enabled: false, onSave: async () => {} });

  const toolbar = useMemo(
    () =>
      hideToolbar ? null : (
        <EditorToolbar
          capabilities={capabilities}
          focusEditor={focusEditor}
          layout={toolbarLayout}
          onFind={openFind}
          panelHost={panelHost}
          store={store}
        />
      ),
    [
      capabilities,
      focusEditor,
      hideToolbar,
      openFind,
      panelHost,
      store,
      toolbarLayout,
    ],
  );

  // docs/034 HPC-1 — host-placed dock. Build the fully-wired dock ONCE, then decide where it
  // mounts through a single resolution, so the embedded (Tier 0) and host-placed (Tier 1)
  // forms share identical wiring — one wiring path, never a second composition root
  // (docs/034 §9.4). The dock is the same element in every branch; only its parent changes.
  const dock = (
    <SidePanelDock
      activeId={activePanelId}
      capabilities={capabilities}
      focusId={activePanelFocusId}
      indexStore={indexStoreRef.current}
      onClose={() => setPanelOpen(false)}
      open={panelOpen}
      panelHost={panelHost}
      reveal={revealNode}
      store={store}
    />
  );
  // Placement applies to the desktop column only (above): on mobile, bypass it so the
  // self-portaling Drawer renders from the default slot. `renderDock` (primary, §7.1): the
  // host wraps/frames the dock while it stays a sibling of the surface. `dockContainer`
  // (escape hatch, §7.1): portal it into a host element, keeping the React tree so the
  // overlay-authority context and focus wiring still flow. `dockContainer === undefined`
  // means no placement; `null` means placement intended but the target is not mounted yet
  // (render nowhere until it is). The dock is never mounted in two places.
  const placed = !isMobile;
  const wrappedDock = placed && renderDock ? renderDock(dock) : dock;
  const dockSlot: ReactNode =
    placed && dockContainer !== undefined
      ? dockContainer
        ? createPortal(wrappedDock, dockContainer)
        : null
      : wrappedDock;

  return (
    <OverlayAuthorityRefProvider value={overlayAuthorityRef}>
      <UploadProvider value={uploadImage ?? null}>
        <div
          className={wrapperClass}
          data-engine-editor=""
          onDragOver={
            uploadImage ? (event) => event.preventDefault() : undefined
          }
          onDrop={onDrop}
          onKeyDown={onKeyDown}
          onMouseDown={onEditorMouseDown}
        >
          {toolbar}
          {/* Surface + dock are a flex row so the dock is a *sibling* of the scroller,
            never inside it (docs/027 §8.3/§8.4): opening it only narrows the surface's
            width, which the virtual window already treats as a resize, so it cannot
            corrupt offset measurement (docs/025). The dock renders nothing when closed,
            so the surface reclaims the full width. Under host placement (docs/034 HPC-1)
            the dock element (`dockSlot`) is wrapped by the host's `renderDock` and stays
            here as a sibling, or is portaled out via `dockContainer`; either way the
            surface must stay a transform-free, independently-sized box (docs/034 §9.5). */}
          {/* `gap-1 p-1` puts one even 4px frame around the row and a single 4px gap
            between the editor and the dock — the margin lives on the row, not on both
            children, so the gap between them is not doubled. */}
          <div className={bodyClass} data-engine-editor-body="">
            {/* `relative` so the find card floats over the surface's top-right corner
              instead of pushing it down when it opens (no layout shift). `min-w-0` lets
              the surface shrink when the dock takes its column. */}
            <div
              className={surfaceClass}
              data-engine-surface=""
              onClick={onClick}
              onContextMenu={onContextMenu}
              ref={surfaceRef}
            >
              <div className={proseFillClass} data-engine-prose="">
                <OwnedModelEditorView
                  ref={viewRef}
                  store={store}
                  {...viewProps}
                  documentIndexStore={indexStoreRef.current}
                  overlayAuthorityRef={overlayAuthorityRef}
                  overlayPanelHost={panelHost}
                />
              </div>
              <CommentAffordance panelHost={panelHost} store={store} />
              {/* The right-click context menu — the last surface still on the legacy
                coordinator (its overlay-authority migration is the remaining P3 step). The
                selection bar (R1-D) and the slash menu (R1-F) are now overlay-authority
                contributors rendered by the editing view's `SelectionSurfaceHost` / its
                `OverlayLayer`, portaled to a transform-free body layer. */}
              <EngineContextMenu
                close={closeSurfaces}
                ctx={surfaces.ctx}
                focusEditor={focusEditor}
                pos={
                  surfaces.surface?.kind === "context" ? surfaces.surface : null
                }
                store={store}
              />
            </div>
            {dockSlot}
          </div>
        </div>
      </UploadProvider>
    </OverlayAuthorityRefProvider>
  );
});
