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
import type { OwnedEditorHandle } from "../core";
import {
  EngineContextMenu,
  useContextMenu,
  type ContextMenuController,
} from "./chrome";
import { EditorToolbar } from "./chrome";
import type { ToolbarCapabilities, ToolbarLayoutConfig } from "./spi";
import { FindBar, useFindController, type FindController } from "./chrome";
import { LinkPopover, useLinkInteraction } from "./chrome";
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
};

export const OwnedModelEditor = forwardRef(function OwnedModelEditor(
  props: OwnedModelEditorProps,
  ref: Ref<OwnedModelEditorHandle>,
) {
  const {
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
          data: { alt: result.alt ?? "", caption: "", src: result.src },
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
  const contextMenu: ContextMenuController = useContextMenu(store);

  // A click on an inert link mark opens the link editor over it (legacy
  // floating-link-editor parity); other clicks fall through to the editing
  // surface untouched.
  const onClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      linkInteraction.openAt(event.target as HTMLElement);
    },
    [linkInteraction],
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
      openFind: () => find.open(),
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
    [find],
  );

  // Autosave is always called (hooks rule); it no-ops until a handle exists and
  // an `autosave` config is supplied.
  useAutosave(handle, autosave ?? { enabled: false, onSave: async () => {} });

  const openFind = find.open;
  const toolbar = useMemo(
    () =>
      hideToolbar ? null : (
        <EditorToolbar
          capabilities={toolbarCapabilities}
          focusEditor={focusEditor}
          layout={toolbarLayout}
          onFind={openFind}
          store={store}
        />
      ),
    [
      focusEditor,
      hideToolbar,
      openFind,
      store,
      toolbarCapabilities,
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
        {/* `relative` so the find card floats over the editor's top-right corner
            instead of pushing the surface down when it opens (no layout shift). */}
        <div
          className="relative"
          data-engine-surface=""
          onClick={onClick}
          onContextMenu={contextMenu.onContextMenu}
        >
          <FindBar controller={find} />
          <div className={proseClassName} data-engine-prose="">
            <OwnedModelEditorView ref={viewRef} store={store} {...viewProps} />
          </div>
          <LinkPopover
            focusEditor={focusEditor}
            interaction={linkInteraction}
            store={store}
          />
          <EngineContextMenu
            controller={contextMenu}
            focusEditor={focusEditor}
            store={store}
          />
        </div>
      </div>
    </UploadProvider>
  );
});
