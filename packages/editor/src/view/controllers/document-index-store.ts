/**
 * The reactive fan-out for the document index (note.md read-side SPI).
 *
 * The document index (TOC + plain-text + comments) is whole-document derived
 * state: the bake worker computes it off-thread and the index controller lands it
 * here. A *view* cannot read it from its own node — the per-node SPI is scoped by
 * design (docs/016) — so this tiny external store is the one sanctioned channel a
 * node view subscribes to (`useDocumentIndex`), instead of reaching into the whole
 * store (an O(N) `toSnapshot` per render) or a DOM heading registry (which breaks
 * under virtualization — windowed-out headings never register).
 *
 * It is deliberately separate from `documentIndexRef`: the ref stays a *ref* so
 * landing a new index never re-renders the mounted block list (that would pollute
 * per-block render counts, see `use-document-index`). This store fans out to only
 * the components that opt in by calling the hook (a TOC, a list-of-figures), so
 * liveness costs one re-render of those, not the document.
 */
import type { DocumentIndex } from "../../core";

/**
 * @categoryDefault Document Index
 */

/** The read side a node view subscribes to via `useSyncExternalStore`. */
export type DocumentIndexStore = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): DocumentIndex | null;
};

/** The write side the index controller (or a static reader) publishes through. */
export type MutableDocumentIndexStore = DocumentIndexStore & {
  publish(index: DocumentIndex | null): void;
};

/**
 * Create an index store. The editor creates one mutable store per view and the
 * worker round-trip publishes into it; the reader creates one seeded with a
 * synchronously-built index (it already holds the whole document).
 */
export function createDocumentIndexStore(
  initial: DocumentIndex | null = null,
): MutableDocumentIndexStore {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => current,
    publish(index) {
      // Reference-equal publishes are no-ops so an unchanged index never wakes a
      // subscriber; the worker already hands back a fresh object only on change.
      if (index === current) return;
      current = index;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
