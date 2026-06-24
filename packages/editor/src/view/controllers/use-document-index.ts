/**
 * Off-thread bake/index controller (docs/010 §7.5, docs/020 §4.3 R3).
 *
 * Creates the bake/index Web Worker once and rebuilds the document index (TOC +
 * plain text) off-thread, coalesced across bursts of structural edits, so the
 * main thread is never blocked computing it. Results land in refs the diagnostics
 * read. Lifted from `react-view.tsx`; the rebuild now runs through the engine
 * scheduler's idle lane rather than a hand-rolled timer (note.md §7 P1).
 */
import { useEffect } from "react";
import {
  createLoopbackBakeService,
  createWorkerBakeService,
  type EditorStore,
  type EngineScheduler,
} from "../../core";
import type { ViewRefs } from "./refs";

export function useDocumentIndexController(args: {
  readonly refs: ViewRefs;
  readonly store: EditorStore;
  readonly scheduler: EngineScheduler;
  readonly createBakeWorker: () => Worker | null;
}): void {
  const { refs, store, scheduler, createBakeWorker } = args;
  const {
    bakeServiceRef,
    indexFromWorkerRef,
    documentIndexRef,
    documentIndexStoreRef,
    workerRoundTripsRef,
  } = refs;

  // Create the bake/index worker once. The worker keeps pure-compute bake and
  // indexing off the editing thread (§7.5); when `Worker` is unavailable the
  // loopback service runs the same handler on a microtask so behaviour is equal.
  useEffect(() => {
    const worker = createBakeWorker();
    indexFromWorkerRef.current = worker !== null;
    const service = worker
      ? createWorkerBakeService(worker)
      : createLoopbackBakeService();
    bakeServiceRef.current = service;
    return () => {
      service.dispose();
      bakeServiceRef.current = null;
    };
  }, [createBakeWorker, bakeServiceRef, indexFromWorkerRef]);

  // Rebuild the document index off-thread on mount and after *any* committed
  // transaction. The round-trip is async by construction, so the index is null
  // for the first frame and the main thread is never blocked computing it (AC6).
  //
  // The trigger is `subscribeCommit`, not the body `order`: a heading's text edit
  // or a paragraph→heading type change leaves `order` untouched yet changes the
  // TOC, so an order-only trigger left the index (and the live TOC) stale until
  // the next structural edit. Commits cover structural, content, and type changes
  // alike.
  //
  // Routed through the engine scheduler's idle lane (note.md §7 P1), replacing the
  // former hand-rolled `setTimeout` debounce. Three things follow from that:
  //   - Coalescing is the lane's job: a burst (holding Enter, fast typing in a
  //     heading, paste) calls `task.schedule` per commit, but `coalesce: "latest"`
  //     keeps one pending run, and the single outstanding idle callback fires once
  //     after the main thread settles — not a fixed timer that can fire mid-burst.
  //   - `store.toSnapshot()` (an O(N) clone of the whole node map) runs *inside*
  //     the task body, so the clone itself coalesces with the worker round-trip,
  //     not just the `buildIndex` call.
  //   - The work appears in `__IDCO_EDITOR_PERF__` next to the selection overlay,
  //     so the rebuild's cost and coalescing are observable instead of being an
  //     invisible timer spending its own budget.
  // `cancelled` still guards the async tail: `task.cancel()` stops future runs but
  // an already-dispatched `buildIndex` promise can still resolve after unmount, and
  // its result must not be written into a torn-down view's refs.
  useEffect(() => {
    if (!bakeServiceRef.current) return;
    let cancelled = false;
    const task = scheduler.createTask<null>(
      {
        coalesce: "latest",
        cost: "Clone the document snapshot and rebuild the TOC/text/comment index off-thread.",
        frequency: "after committed transactions settle (idle, coalesced)",
        label: "engine-document-index",
        lane: "idle",
        priority: "low",
      },
      () => {
        // Re-read the service ref at run time: the worker effect above can swap or
        // null it (remount, dispose) between scheduling and the idle slot firing.
        const service = bakeServiceRef.current;
        if (!service) return;
        const snapshot = store.toSnapshot();
        void (async () => {
          const index = await service.buildIndex(snapshot);
          if (cancelled) return;
          // The index lives in a ref the diagnostics read live; updating it must
          // not re-render mounted blocks (that would pollute per-block render
          // counts).
          documentIndexRef.current = index;
          workerRoundTripsRef.current += 1;
          // The ref above is read live by diagnostics and must not re-render
          // blocks; the store is the opt-in reactive channel that wakes only index
          // consumers (a TOC view) — note.md read-side SPI.
          documentIndexStoreRef.current.publish(index);
        })();
      },
    );
    task.schedule(null);
    const unsubscribe = store.subscribeCommit(() => task.schedule(null));
    return () => {
      cancelled = true;
      task.cancel();
      unsubscribe();
    };
  }, [
    store,
    scheduler,
    bakeServiceRef,
    documentIndexRef,
    documentIndexStoreRef,
    workerRoundTripsRef,
  ]);
}
