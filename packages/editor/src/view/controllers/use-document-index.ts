/**
 * Off-thread bake/index controller (docs/010 §7.5, docs/020 §4.3 R3).
 *
 * Creates the bake/index Web Worker once and rebuilds the document index (TOC +
 * plain text) off-thread, debounced across bursts of structural edits, so the
 * main thread is never blocked computing it. Results land in refs the diagnostics
 * read. Lifted verbatim from `react-view.tsx`.
 */
import { useEffect } from "react";
import {
  createLoopbackBakeService,
  createWorkerBakeService,
  type EditorStore,
} from "../../core";
import { INDEX_REBUILD_DEBOUNCE_MS } from "./constants";
import type { ViewRefs } from "./refs";

export function useDocumentIndexController(args: {
  readonly refs: ViewRefs;
  readonly store: EditorStore;
  readonly createBakeWorker: () => Worker | null;
}): void {
  const { refs, store, createBakeWorker } = args;
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
  // Debounced: a burst (holding Enter, fast typing in a heading, paste) would
  // otherwise fire `store.toSnapshot()` — an O(N) clone of the whole node map —
  // per keystroke. The debounce collapses the burst to one snapshot + one worker
  // round-trip after the edits settle; the snapshot is taken *inside* the
  // debounced callback so the clone itself is coalesced, not just the worker call.
  useEffect(() => {
    const service = bakeServiceRef.current;
    if (!service) return;
    let cancelled = false;
    let handle: ReturnType<typeof setTimeout> | null = null;
    const rebuild = () => {
      if (handle !== null) clearTimeout(handle);
      handle = setTimeout(() => {
        void (async () => {
          const index = await service.buildIndex(store.toSnapshot());
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
      }, INDEX_REBUILD_DEBOUNCE_MS);
    };
    rebuild();
    const unsubscribe = store.subscribeCommit(rebuild);
    return () => {
      cancelled = true;
      if (handle !== null) clearTimeout(handle);
      unsubscribe();
    };
  }, [
    store,
    bakeServiceRef,
    documentIndexRef,
    documentIndexStoreRef,
    workerRoundTripsRef,
  ]);
}
