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
  type NodeId,
} from "../../core";
import { INDEX_REBUILD_DEBOUNCE_MS } from "./constants";
import type { ViewRefs } from "./refs";

export function useDocumentIndex(args: {
  readonly refs: ViewRefs;
  readonly store: EditorStore;
  readonly order: readonly NodeId[];
  readonly createBakeWorker: () => Worker | null;
}): void {
  const { refs, store, order, createBakeWorker } = args;
  const {
    bakeServiceRef,
    indexFromWorkerRef,
    documentIndexRef,
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

  // Rebuild the document index off-thread on mount and after any structural
  // change. The round-trip is async by construction, so the index is null for
  // the first frame and the main thread is never blocked computing it (AC6).
  //
  // Debounced: every structural edit (each Enter/split, paste, block move)
  // changes `order` and would otherwise fire `store.toSnapshot()` — an O(N) clone
  // of the whole node map — on the main thread, per keystroke. A burst (holding
  // Enter, pasting) collapses to one snapshot + one worker round-trip after the
  // edits settle. The snapshot is taken *inside* the debounced callback so the
  // clone itself is coalesced, not just the worker call.
  useEffect(() => {
    const service = bakeServiceRef.current;
    if (!service) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        const index = await service.buildIndex(store.toSnapshot());
        if (cancelled) return;
        // The index lives in a ref the diagnostics read live; updating it must
        // not re-render mounted blocks (that would pollute per-block render
        // counts).
        documentIndexRef.current = index;
        workerRoundTripsRef.current += 1;
      })();
    }, INDEX_REBUILD_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [store, order, bakeServiceRef, documentIndexRef, workerRoundTripsRef]);
}
