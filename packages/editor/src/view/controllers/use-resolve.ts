/**
 * Reference-block resolve controller (docs/026 §7.2 / §14.5, RB-5).
 *
 * A reference block caches a projection of a host record (`{ ref, snapshot }`,
 * docs/026 §4.3). This hook is the stale-while-revalidate half: the snapshot
 * already renders, and on mount the controller refreshes it from the `ref` and
 * patches the projected keys, so a record renamed host-side updates instead of
 * showing a dead copy. It also drives the reference-block status lifecycle (§7.5):
 * an empty (unpicked) block reads `unresolved`, a successful refresh `ready`, a
 * dangling ref or failed fetch `invalid` (with the stale snapshot kept, §7.3).
 *
 * All status/snapshot writes go through `store.resolveObject`, which records *no*
 * undo history (§14.6) and no-ops when nothing changed — so the hook can run on
 * every virtualization remount without churning history or looping. Per-mount
 * `AbortController`: a block scrolled out of the window mid-fetch drops its result
 * rather than writing it; a cross-ref dedupe cache (one fetch for many blocks that
 * reference the same record) is a named future optimization (§14.5), not needed
 * for correctness because the writes are idempotent.
 */
import { useEffect } from "react";
import type { ResourceOption } from "@quanghuy1242/idco-ui";
import type { JsonValue } from "../../core";
import { type EditorStore, type ObjectNode } from "../../core";
import {
  getDataSource,
  getNodeView,
  type NodeViewResourceConfigField,
} from "../spi";
import { currentObjectRecord, patchSnapshot, refField } from "../object-data";

type ResolveFn = (
  ref: string,
  signal: AbortSignal,
) => Promise<ResourceOption | null>;

/**
 * In-flight resolve dedupe (docs/026 §14.5): many blocks that reference the same
 * record — and every virtualization remount of one — share a single fetch instead
 * of each firing its own. Keyed by `sourceId::ref`; the entry clears when the fetch
 * settles. The shared fetch owns its own `AbortController`, because one consumer
 * unmounting must NOT cancel the result the others are waiting on — each consumer
 * instead gates *applying* the result on its own per-mount signal (below), so an
 * unmounted block still drops its write. This dedupes concurrent fetches; result
 * memoization across time is a separate future optimization.
 */
const inFlightResolves = new Map<string, Promise<ResourceOption | null>>();

function sharedResolve(
  sourceId: string,
  resolve: ResolveFn,
  ref: string,
): Promise<ResourceOption | null> {
  const key = `${sourceId}::${ref}`;
  let pending = inFlightResolves.get(key);
  if (!pending) {
    const controller = new AbortController();
    pending = Promise.resolve(resolve(ref, controller.signal)).finally(() => {
      inFlightResolves.delete(key);
    });
    inFlightResolves.set(key, pending);
  }
  return pending;
}

/**
 * The reference field of a node's view, or null for a non-reference object. A
 * reference block is exactly an object whose `NodeView` declares a `resource`
 * config field (docs/026 §4.2); the dispatcher uses this both to drive resolve and
 * to render the three resting states.
 */
export function referenceFieldOf(
  type: string,
): NodeViewResourceConfigField | null {
  const field = getNodeView(type)?.configFields?.find(
    (candidate) => candidate.kind === "resource",
  );
  return field?.kind === "resource" ? field : null;
}

export function useResolveReference(
  node: ObjectNode,
  store: EditorStore,
): void {
  const field = referenceFieldOf(node.type);
  const ref = refField(node.data);
  const nodeId = node.id;
  // Depend on `ref` (a string), not `node`: a successful resolve rewrites the
  // node's snapshot/status, but the ref is unchanged, so the effect must not
  // re-run and re-fetch. It re-runs only when the author picks a *different*
  // record (ref changes) — which aborts the old fetch and issues a new one.
  useEffect(() => {
    if (!field) return;
    if (ref === "") {
      // No record picked yet: an unresolved empty reference (drives the
      // "Pick a {label}" resting state, §7.1). Overrides the always-ready
      // post-ref bake via `resolveObject`'s caller-supplied status.
      store.resolveObject(
        nodeId,
        currentObjectRecord(store, nodeId),
        "unresolved",
      );
      return;
    }
    const source = getDataSource(field.source);
    if (!source?.resolve) {
      // Browse-only source: the snapshot written at pick is the only truth.
      store.resolveObject(nodeId, currentObjectRecord(store, nodeId), "ready");
      return;
    }
    // Per-mount controller gates *applying* the result (an unmounted block drops
    // its write); the fetch itself is shared and deduped across blocks (§14.5).
    const controller = new AbortController();
    const resolve = source.resolve;
    void (async () => {
      try {
        const option = await sharedResolve(field.source, resolve, ref);
        if (controller.signal.aborted) return;
        if (!option) {
          // Dangling ref or refusal: keep the stale snapshot, mark invalid (§7.3).
          store.resolveObject(
            nodeId,
            currentObjectRecord(store, nodeId),
            "invalid",
          );
          return;
        }
        // Patch only the projected keys; `local` author fields are never touched
        // by a refresh (§7.2). `toData` returns a partial, coerced to the record.
        const projected = { ...field.toData(option) } as Record<
          string,
          JsonValue
        >;
        const next = patchSnapshot(
          currentObjectRecord(store, nodeId),
          projected,
        );
        store.resolveObject(nodeId, next, "ready");
      } catch {
        if (controller.signal.aborted) return;
        store.resolveObject(
          nodeId,
          currentObjectRecord(store, nodeId),
          "invalid",
        );
      }
    })();
    return () => controller.abort();
  }, [field, ref, nodeId, store]);
}
