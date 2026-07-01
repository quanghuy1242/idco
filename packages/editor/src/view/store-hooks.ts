/**
 * React `useSyncExternalStore` bindings for the owned-model engine (docs/017
 * §3.1).
 *
 * The document never enters React state; these hooks subscribe a component to
 * exactly one slice of the store — the body order, one node, or the
 * scheduler-batched selection frame (docs/010 §7.3) — so a model change
 * re-renders only what depends on it.
 */
import { useMemo, useSyncExternalStore } from "react";
import type {
  EditorDocumentSnapshot,
  EditorStore,
  EngineScheduler,
  EngineSchedulerTask,
  NodeId,
  StoreDirty,
} from "../core";

type SelectionFramePayload = {
  readonly dirty: StoreDirty;
};

/**
 * The one publicly-exported hook here (`useReviewSnapshot`) is diff-view infrastructure; this
 * standalone block is also the api-map module header, so the first real symbol's own doc is not
 * consumed as it (docs/032 / `scripts/gen-api-map.mjs`).
 *
 * @categoryDefault Diff View
 */

export function useEditorOrder(store: EditorStore): readonly NodeId[] {
  return useSyncExternalStore(
    (listener) => store.subscribeOrder(listener),
    () => store.order,
    () => store.order,
  );
}

export function useEditorNode(store: EditorStore, id: NodeId) {
  // Tolerate a just-removed node: a merge/delete notifies the removed block's
  // subscribers before React reconciles the order change and unmounts it, so the
  // snapshot must return undefined rather than throw. The block renders null for
  // that one frame and then unmounts.
  return useSyncExternalStore(
    (listener) => store.subscribeNode(id, listener),
    () => store.getViewNode(id),
    () => store.getViewNode(id),
  );
}

/**
 * Subscribe to the live document as a native snapshot for the inline review overlay (docs/036
 * §6.2.1, R6-I). A host captures a `baseline` snapshot once (e.g. at load/last-save) and diffs it
 * against this live `current` — `diffSnapshots(baseline, useReviewSnapshot(store))` — to feed
 * `<InlineDiffOverlay>`.
 *
 * The snapshot is recomputed lazily (during React's render, not inside the commit callback) and
 * cached, so `useSyncExternalStore`'s getSnapshot returns a stable reference between commits — a
 * fresh `toSnapshot()` on every call would tear or loop. `toSnapshot()` is incremental
 * (docs/030 SLP-1), so recomputing per commit is cheap. Idle-lane coalescing of the re-diff
 * itself is the R6-J live-review refinement (docs/036 §8); this read-only surface recomputes on
 * each commit.
 */
export function useReviewSnapshot(store: EditorStore): EditorDocumentSnapshot {
  const external = useMemo(() => new ReviewSnapshotStore(store), [store]);
  return useSyncExternalStore(
    external.subscribe,
    external.getSnapshot,
    external.getSnapshot,
  );
}

class ReviewSnapshotStore {
  readonly #store: EditorStore;
  // Null means "invalidated, recompute on next read". Caching is what keeps getSnapshot stable
  // between commits (the useSyncExternalStore contract); the commit callback only invalidates and
  // notifies, so the actual toSnapshot() runs during the batched React render, not on the
  // synchronous dispatch/keystroke path.
  #cache: EditorDocumentSnapshot | null = null;

  constructor(store: EditorStore) {
    this.#store = store;
  }

  readonly subscribe = (listener: () => void): (() => void) =>
    this.#store.subscribeCommit(() => {
      this.#cache = null;
      listener();
    });

  readonly getSnapshot = (): EditorDocumentSnapshot => {
    if (this.#cache === null) this.#cache = this.#store.toSnapshot();
    return this.#cache;
  };
}

export function useSelectionFrameVersion(
  store: EditorStore,
  scheduler: EngineScheduler,
): number {
  const externalStore = useMemo(
    () => new SelectionFrameStore(store, scheduler),
    [scheduler, store],
  );
  return useSyncExternalStore(
    externalStore.subscribe,
    externalStore.getSnapshot,
    externalStore.getSnapshot,
  );
}

class SelectionFrameStore {
  readonly #listeners = new Set<() => void>();
  readonly #store: EditorStore;
  readonly #task: EngineSchedulerTask<SelectionFramePayload>;
  readonly #storeUnsubscribers: (() => void)[] = [];
  #version = 0;

  constructor(store: EditorStore, scheduler: EngineScheduler) {
    this.#store = store;
    this.#task = scheduler.createTask<SelectionFramePayload>(
      {
        budgetMs: 2,
        cost: "Notify the React selection overlay after model selection changes.",
        frequency: "on owned-model selection dirty",
        label: "engine-selection-overlay",
        lane: "frame",
        priority: "high",
      },
      () => {
        this.#version += 1;
        this.#listeners.forEach((listener) => listener());
      },
    );
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    if (this.#storeUnsubscribers.length === 0) {
      const schedule = (dirty: StoreDirty) => this.#task.schedule({ dirty });
      this.#storeUnsubscribers.push(this.#store.subscribeSelection(schedule));
      // Also repaint after any committed transaction, not only when the model
      // selection changed. A mark toggle (or link/block-type change) keeps the
      // selection identical (`tr.setSelection(store.selection)`), so `dispatch`
      // reports `selectionChanged === false` and the selection lane would never
      // fire — leaving the painted rects pinned to the pre-toggle geometry while
      // the leaf re-renders from bare text to mark spans (the ~1s stale-selection
      // bug). The task coalesces to one frame, so this is at most one extra
      // geometry pass per commit, after React has reconciled and laid out.
      this.#storeUnsubscribers.push(
        this.#store.subscribeCommit(() =>
          this.#task.schedule({
            dirty: {
              nodes: new Set(),
              selection: false,
              settings: false,
              structure: false,
            },
          }),
        ),
      );
    }
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) {
        for (const off of this.#storeUnsubscribers.splice(0)) off();
        this.#task.cancel();
      }
    };
  };

  readonly getSnapshot = (): number => this.#version;
}
