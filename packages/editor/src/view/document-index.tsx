/**
 * The read-side document-index SPI for views (note.md read-side SPI).
 *
 * Every other SPI in this package is a *write* SPI — `registerNode`,
 * `registerMark`, … teach the editor a new thing. This is the one *read* SPI: it
 * lets a node view consume the whole-document index reactively without reaching
 * across the document itself. Any whole-document-aware block uses it — a table of
 * contents, a list of figures, footnotes, backlinks — so the channel is
 * generalized once here rather than per block.
 *
 * The orchestrator (`react-view`) wraps the block tree in `DocumentIndexProvider`
 * with the view's mutable store (fed by the bake worker) and a `revealNode`
 * callback (the engine's scroll-to-block, for in-editor TOC navigation under
 * virtualization, where a plain `#hash` cannot reach a windowed-out heading). The
 * reader (`RestingDocument`) wraps with a static store built from its snapshot and
 * no `revealNode` (it renders the full document, so native `#hash` links work).
 */
import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { DocumentIndex, NodeId } from "../core";
import type { DocumentIndexStore } from "./controllers/document-index-store";

type DocumentIndexContextValue = {
  readonly store: DocumentIndexStore;
  readonly revealNode?: (id: NodeId) => void;
};

/**
 * The store a hook reads when it is rendered outside any provider (a bare resting
 * render with no index wiring). Always empty, never notifies — so `useDocumentIndex`
 * is always safe to call and simply returns `null` there.
 */
const EMPTY_STORE: DocumentIndexStore = {
  getSnapshot: () => null,
  subscribe: () => () => undefined,
};

const DocumentIndexContext = createContext<DocumentIndexContextValue | null>(
  null,
);

export function DocumentIndexProvider(props: {
  readonly store: DocumentIndexStore;
  readonly revealNode?: (id: NodeId) => void;
  readonly children: ReactNode;
}) {
  const { store, revealNode, children } = props;
  // Stable context value so a re-render of the orchestrator does not re-render
  // every consumer through the context (the value identity is the trigger).
  const value = useMemo<DocumentIndexContextValue>(
    () => ({ revealNode, store }),
    [revealNode, store],
  );
  return (
    <DocumentIndexContext.Provider value={value}>
      {children}
    </DocumentIndexContext.Provider>
  );
}

/**
 * Subscribe the calling view to the live document index (the read-side SPI). Only
 * components that call this re-render when the index changes; the block list does
 * not. Returns `null` until the first index lands (the worker round-trip is async)
 * or when there is no provider.
 */
export function useDocumentIndex(): DocumentIndex | null {
  const ctx = useContext(DocumentIndexContext);
  const store = ctx?.store ?? EMPTY_STORE;
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}

/**
 * The engine's scroll-to-block, when a provider supplies one (the editor). A node
 * view uses it to navigate to a heading by NodeId under virtualization; absent (the
 * reader), the view falls back to a native `#hash` link.
 */
export function useDocumentReveal(): ((id: NodeId) => void) | undefined {
  return useContext(DocumentIndexContext)?.revealNode;
}
