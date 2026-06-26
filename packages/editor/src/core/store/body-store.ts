/**
 * The cold-store SPI for purged node bodies (docs/030 §7.6 D6 Stage two, SLP-4).
 *
 * Why this file exists
 * --------------------
 * Memory virtualization (the skeleton/body split, D6) splits each node into a tiny
 * always-resident *skeleton* (id, parent, order index, height) and a heavy *body*
 * (`TextContent` + marks, or an object's `data`). Cold bodies purge to a *cold store* and
 * re-materialize on access. The cold store is injected, not hard-wired, so `core/**` stays
 * framework- and DOM-free (the architecture lint): the in-memory default here serves tests
 * and today's behavior, and the view layer can supply an IndexedDB-backed implementation
 * for durable, larger-than-heap paging — both behind this one `{ get, put, evict }` seam.
 * The same seam is where docs/031's native-arena `BodyStore` (Tier 1, a wasm linear-memory
 * arena that *hard*-caps bodies) plugs in without touching the model graph.
 *
 * Scope note (honest): the full skeleton/body *pager* — purge-on-scroll, read-fault via
 * `getNode`, velocity prefetch, and lazy-load-as-cold-start — is the "larger, later"
 * memory project (docs/030 §7.6 / SLP-4, and §1's "can land later"). This file ships the
 * SPI and the in-memory realization so the first cut does not paint the pager into a
 * corner; the store accepts a `bodyStore` and exposes it for that follow-on. A dirty
 * (touched, unsaved) body must page to a *durable* store, never be dropped (D6 edge case),
 * which is why `put`/`get` are the contract rather than a drop-only eviction.
 */
import type { EditorNode, NodeId } from "../model";

/**
 * A node body in the cold store. The whole immutable node *is* the body: its heavy fields
 * (text content + marks, or object `data` + baked) are exactly what costs memory, and
 * re-materializing the node from the cold store restores them with no aliasing hazard
 * because nodes are immutable (D6: "a purged body re-materializes with no aliasing hazard").
 */
export type NodeBody = EditorNode;

/**
 * The injectable cold store for purged bodies. Synchronous here for the in-memory default
 * and the synchronous undo/cold-store path; an async (IndexedDB) implementation in the
 * view layer satisfies the same shape with promise-returning members, read-faulted ahead
 * of the viewport so the ~1–5 ms read overlaps the scroll (the velocity prefetch, §7.6).
 */
export type BodyStore = {
  /** The cold-stored body for `id`, or undefined when it was never paged out. */
  get(id: NodeId): NodeBody | undefined;
  /** Page a body out to the cold store. */
  put(id: NodeId, body: NodeBody): void;
  /** Drop a cold-stored body (the node was removed, or re-materialized for good). */
  evict(id: NodeId): void;
};

/**
 * The default in-memory cold store: a plain `Map`. It is *not* durable across a reload, so
 * a host that needs dirty-body durability (D6) supplies the IndexedDB implementation; this
 * default is the test/SSR and "no paging configured" behavior.
 */
export function createInMemoryBodyStore(): BodyStore {
  const bodies = new Map<NodeId, NodeBody>();
  return {
    evict(id) {
      bodies.delete(id);
    },
    get(id) {
      return bodies.get(id);
    },
    put(id, body) {
      bodies.set(id, body);
    },
  };
}
