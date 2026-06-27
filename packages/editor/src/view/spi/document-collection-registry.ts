/**
 * Document Collections registry — the Document Collections SPI (docs/027 §5.2).
 *
 * A feature declares a document-owned collection (glossary first, a future
 * bibliography) by registering one definition, the same registry-by-id pattern as
 * nodes, marks, commands, data sources, and side panels. The model core stores the
 * collection's items opaquely in `EditorDocumentSnapshot.collections[id]` (docs/027
 * §5.1) and knows none of their shapes; this registry is how the *view* learns a
 * collection exists, so a pane can gate on it (the Glossary pane appears when the
 * glossary collection is registered, docs/027 §7.7) and so a future tenant is a
 * registration, not a model change (§5.5).
 *
 * The item→index path is deliberately *not* a function on this definition: the
 * document index is built off-thread in the bake worker, where a registered function
 * could not be `postMessage`d, so `buildDocumentIndex` passes the raw `collections`
 * through (docs/027 §5.4) and a pane joins them with the occurrence marks on the main
 * thread. `validate` is an optional dev-time guard only; production trusts the stored
 * items. Mirrors the sibling registries: module singleton, idempotent by id,
 * registration-order listing.
 *
 * @categoryDefault Document Collections SPI
 */
import type { CollectionItem } from "../../core";

/** One registered document-owned collection (docs/027 §5.2). */
export type DocumentCollectionDefinition = {
  readonly id: string;
  /**
   * Optional dev-time validation of one item; production trusts the snapshot
   * (docs/027 §5.2). A registered collection whose items fail this in development
   * signals a producer bug, not a runtime branch.
   */
  validate?(item: CollectionItem): boolean;
};

const COLLECTIONS = new Map<string, DocumentCollectionDefinition>();

/** Register a document-owned collection. Idempotent by id (HMR / test-safe). */
export function registerDocumentCollection(
  definition: DocumentCollectionDefinition,
): void {
  COLLECTIONS.set(definition.id, definition);
}

/** The definition for an id, or undefined — the lookup a pane's gating reads. */
export function getDocumentCollection(
  id: string,
): DocumentCollectionDefinition | undefined {
  return COLLECTIONS.get(id);
}

/** Every registered collection, in registration (insertion) order (docs/027 §5.5). */
export function listDocumentCollections(): readonly DocumentCollectionDefinition[] {
  return [...COLLECTIONS.values()];
}

/** Drop a registration (host teardown / test cleanup). */
export function unregisterDocumentCollection(id: string): void {
  COLLECTIONS.delete(id);
}
