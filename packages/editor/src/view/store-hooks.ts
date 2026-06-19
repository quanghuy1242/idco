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
  EditorStore,
  EngineScheduler,
  EngineSchedulerTask,
  NodeId,
  StoreDirty,
} from "../core";

type SelectionFramePayload = {
  readonly dirty: StoreDirty;
};

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
  #storeUnsubscribe: (() => void) | null = null;
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
    if (!this.#storeUnsubscribe) {
      this.#storeUnsubscribe = this.#store.subscribeSelection((dirty) => {
        this.#task.schedule({ dirty });
      });
    }
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) {
        this.#storeUnsubscribe?.();
        this.#storeUnsubscribe = null;
        this.#task.cancel();
      }
    };
  };

  readonly getSnapshot = (): number => this.#version;
}
