/**
 * The public control surface for the owned-model editor (docs/011 §12.2).
 *
 * Why this file exists
 * --------------------
 * The host, toolbar, shortcuts, and slash menus drive the editor through one
 * opt-in handle that speaks commands and compat JSON, never raw steps or the
 * store internals (§12.4). This keeps the machine room (`EditorStore`, `Step`,
 * `mapSelection`) sealed while the host gets invertible history, scoped notify,
 * and the no-cascade guarantee for free.
 *
 * It is framework-free. `focus` is the one capability that needs the DOM, so the
 * view injects a focuser; everything else is pure store access.
 */
import { compatFromEditorStore } from "./compat";
import type { EditorCommand } from "./commands";
import type {
  EditorDocumentSnapshot,
  EditorSelection,
  JsonValue,
  NodeId,
  RichTextCompatDocument,
} from "./model";
import type { BlockRegistry } from "./registry";
import type { EditorStore } from "./store";

/**
 * @categoryDefault Engine Core — Store
 */

/** The handle events a host can subscribe to: selection, dirty-state, and content change. */
export type OwnedEditorHandleEvent =
  | "selectionchange"
  | "dirtychange"
  | "change";

/** The host-facing control surface for an editor: command dispatch, history, selection, and serialization. */
export type OwnedEditorHandle = {
  /** Current compat projection (the persisted JSON shape). */
  getDocument(): RichTextCompatDocument;
  /** The authoritative owned-model snapshot. */
  getEditorSnapshot(): EditorDocumentSnapshot;
  /** Whether a public save may serialize the live store now. False during proposal review mode. */
  canSave(): boolean;
  /** Whether the document changed since creation or the last `markClean`. */
  isDirty(): boolean;
  /** Reset the dirty baseline (call after a successful save). */
  markClean(): void;

  getSelection(): EditorSelection | null;
  setSelection(selection: EditorSelection): void;
  /** Move DOM focus to the editing surface (a no-op without a view focuser). */
  focus(): void;

  /** Compile and dispatch a high-level command (never a raw `Step`). */
  dispatch(command: EditorCommand): void;
  undo(): void;
  redo(): void;

  /** The heavy object in live-edit mode, or null when all rest baked (§6.4). */
  getActiveObjectId(): NodeId | null;
  /** Enter live-edit on one object; deactivates any other live object first. */
  activateObject(node: NodeId): void;
  /** Leave live-edit; the object re-bakes to its resting snapshot. */
  deactivateObject(): void;
  /** Replace an object's data and re-bake it in one invertible transaction. */
  setObjectData(node: NodeId, data: JsonValue): void;

  on(event: OwnedEditorHandleEvent, callback: () => void): () => void;
};

/** Construction options for an owned editor handle. */
export type OwnedEditorHandleOptions = {
  readonly registry?: BlockRegistry;
  /** The view's DOM focuser; omitted in headless use. */
  readonly focus?: () => void;
};

/** Build the host-facing handle that drives an `EditorStore` through commands and events. */
export function createOwnedEditorHandle(
  store: EditorStore,
  options: OwnedEditorHandleOptions = {},
): OwnedEditorHandle {
  // Dirty is edit-count based: any committed content change since the clean
  // baseline marks the document dirty (a standard "changed since save" model),
  // O(1) per commit instead of a per-keystroke document compare.
  let revision = 0;
  let cleanRevision = 0;
  const dirtyListeners = new Set<() => void>();
  const changeListeners = new Set<() => void>();
  const selectionListeners = new Set<() => void>();

  const isDirty = () => revision !== cleanRevision;

  store.subscribeCommit((committed) => {
    const contentChanged =
      committed.steps.length > 0 ||
      committed.structureChanged ||
      committed.settingsChanged;
    if (!contentChanged) return;
    const wasDirty = isDirty();
    revision += 1;
    changeListeners.forEach((cb) => cb());
    if (wasDirty !== isDirty()) dirtyListeners.forEach((cb) => cb());
  });

  store.subscribeSelection(() => {
    selectionListeners.forEach((cb) => cb());
  });

  return {
    activateObject(node) {
      store.activateObject(node);
    },
    deactivateObject() {
      store.deactivateObject();
    },
    canSave() {
      return store.canSaveSnapshot;
    },
    dispatch(command) {
      store.command(command);
    },
    focus() {
      options.focus?.();
    },
    getActiveObjectId() {
      return store.activeObjectId;
    },
    getDocument() {
      return compatFromEditorStore(store, options.registry);
    },
    getEditorSnapshot() {
      store.assertCanSaveSnapshot();
      return store.toSnapshot();
    },
    getSelection() {
      return store.selection;
    },
    isDirty,
    markClean() {
      const wasDirty = isDirty();
      cleanRevision = revision;
      if (wasDirty) dirtyListeners.forEach((cb) => cb());
    },
    on(event, callback) {
      const set =
        event === "change"
          ? changeListeners
          : event === "dirtychange"
            ? dirtyListeners
            : selectionListeners;
      set.add(callback);
      return () => set.delete(callback);
    },
    redo() {
      store.redo();
    },
    setObjectData(node, data) {
      store.command({ data, node, type: "set-object-data" });
    },
    setSelection(selection) {
      store.dispatch({ origin: "local", selectionAfter: selection, steps: [] });
    },
    undo() {
      store.undo();
    },
  };
}
