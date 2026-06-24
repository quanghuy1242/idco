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
  type Ref,
} from "react";
import type { NodeId, OwnedEditorHandle } from "../core";
import {
  EditorToolbar,
  EngineContextMenu,
  SelectionFlyout,
  SidePanelDock,
  SlashMenu,
  useCommandSurfaces,
} from "./chrome";
import type {
  PanelHost,
  ToolbarCapabilities,
  ToolbarLayoutConfig,
} from "./spi";
import { getDataSource, registerDataSource } from "./spi";
import {
  createDocumentIndexStore,
  type MutableDocumentIndexStore,
} from "./controllers/document-index-store";
import { FindBar, useFindController, type FindController } from "./chrome";
import { LinkPopover, useLinkInteraction } from "./chrome";
import { AnnotationPopover, useAnnotationInteraction } from "./chrome";
import { CommentAffordance } from "./chrome";
import {
  OwnedModelEditorView,
  type OwnedModelEditorViewHandle,
  type OwnedModelEditorViewProps,
} from "./react-view";
import { UploadProvider, type UploadImage } from "./upload-context";
import { useAutosave, type AutosaveOptions } from "./use-autosave";

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
};

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

export const OwnedModelEditor = forwardRef(function OwnedModelEditor(
  props: OwnedModelEditorProps,
  ref: Ref<OwnedModelEditorHandle>,
) {
  const {
    allowedEmbedDomains,
    autosave,
    hideToolbar,
    proseClassName = "prose max-w-none",
    store,
    toolbarCapabilities,
    toolbarLayout,
    uploadImage,
    ...viewProps
  } = props;
  const viewRef = useRef<OwnedModelEditorViewHandle | null>(null);
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
    viewRef.current?.getEditorHandle().focus();
  }, []);

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

  const find: FindController = useFindController(store, (id) =>
    viewRef.current?.scrollToBlock(id),
  );

  const linkInteraction = useLinkInteraction(store);
  // Click-to-read for glossary/comment marks (docs/027 §16 P6); tried before the link
  // interaction so the innermost annotation claims the click.
  const annotationInteraction = useAnnotationInteraction();

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

  // A click on an annotation/link mark opens a popover over it. Annotations
  // (glossary/comment) are tried first so the innermost mark claims the click
  // (docs/027 §16 P6); a plain link falls through to the link editor (legacy
  // floating-link-editor parity). Other clicks pass through to the editing surface.
  const onClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const element = event.target as HTMLElement;
      if (annotationInteraction.openAt(element)) return;
      linkInteraction.openAt(element);
    },
    [annotationInteraction, linkInteraction],
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
        find.open();
      }
    },
    [find],
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
      openFind: () => find.open(),
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
    [find, panelHost],
  );

  // Autosave is always called (hooks rule); it no-ops until a handle exists and
  // an `autosave` config is supplied.
  useAutosave(handle, autosave ?? { enabled: false, onSave: async () => {} });

  const openFind = find.open;
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

  return (
    <UploadProvider value={uploadImage ?? null}>
      <div
        className="flex flex-col"
        data-engine-editor=""
        onDragOver={uploadImage ? (event) => event.preventDefault() : undefined}
        onDrop={onDrop}
        onKeyDown={onKeyDown}
      >
        {toolbar}
        {/* Surface + dock are a flex row so the dock is a *sibling* of the scroller,
            never inside it (docs/027 §8.3/§8.4): opening it only narrows the surface's
            width, which the virtual window already treats as a resize, so it cannot
            corrupt offset measurement (docs/025). The dock renders nothing when closed,
            so the surface reclaims the full width. */}
        {/* `gap-1 p-1` puts one even 4px frame around the row and a single 4px gap
            between the editor and the dock — the margin lives on the row, not on both
            children, so the gap between them is not doubled. */}
        <div
          className="flex items-stretch gap-1 p-1"
          data-engine-editor-body=""
        >
          {/* `relative` so the find card floats over the surface's top-right corner
              instead of pushing it down when it opens (no layout shift). `min-w-0` lets
              the surface shrink when the dock takes its column. */}
          <div
            className="relative min-w-0 flex-1"
            data-engine-surface=""
            onClick={onClick}
            onContextMenu={onContextMenu}
          >
            <FindBar controller={find} />
            <div className={proseClassName} data-engine-prose="">
              <OwnedModelEditorView
                ref={viewRef}
                store={store}
                {...viewProps}
                documentIndexStore={indexStoreRef.current}
              />
            </div>
            <LinkPopover
              focusEditor={focusEditor}
              interaction={linkInteraction}
              store={store}
            />
            <AnnotationPopover
              interaction={annotationInteraction}
              panelHost={panelHost}
              store={store}
            />
            <CommentAffordance panelHost={panelHost} store={store} />
            {/* The three flat command surfaces, all driven by the one coordinator so
                only one is open at a time (docs/024 §8). */}
            <EngineContextMenu
              close={closeSurfaces}
              ctx={surfaces.ctx}
              focusEditor={focusEditor}
              pos={
                surfaces.surface?.kind === "context" ? surfaces.surface : null
              }
              store={store}
            />
            <SelectionFlyout
              close={closeSurfaces}
              ctx={surfaces.ctx}
              focusEditor={focusEditor}
              open={surfaces.surface?.kind === "flyout"}
              store={store}
            />
            <SlashMenu
              close={closeSurfaces}
              ctx={surfaces.ctx}
              focusEditor={focusEditor}
              slash={
                surfaces.surface?.kind === "slash" ? surfaces.surface : null
              }
              store={store}
            />
          </div>
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
        </div>
      </div>
    </UploadProvider>
  );
});
