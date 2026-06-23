/**
 * Shared, framework-free data helpers for object node views and the object
 * dispatcher (docs/020 §7.2). These were inline in `object-block.tsx` before the
 * one-file-per-node split; lifting them here lets each `view/nodes/*` file and the
 * dispatcher read object data the same way without re-deriving it.
 */
import { type EditorStore, type JsonValue, type NodeId } from "../core";

/** Coerce an opaque object `data`/`payload` value to a plain string-keyed record. */
export function asRecord(value: unknown): Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
}

/** Read a string field from an object record, defaulting to "". */
export function stringField(
  record: Record<string, JsonValue>,
  key: string,
): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

/** The object's current data as a record, read live from the store. */
export function currentObjectRecord(
  store: EditorStore,
  id: NodeId,
): Record<string, JsonValue> {
  const node = store.getNode(id);
  return node && node.kind === "object" ? asRecord(node.data) : {};
}

/*
 * Reference-block data helpers (docs/026 §4.3, §14.7).
 *
 * A reference block's `data` is `{ ref, snapshot, local? }`: `ref` is the stable
 * host id, `snapshot` is the projected display copy (`resolve`-refreshed), and
 * `local` is author-typed fields the record does not own (a media caption) that a
 * refresh must never touch. Keeping these readers and the patch/replace in one
 * place is what makes the projected-vs-author-local split (the thing that lets
 * `resolve` patch the snapshot without clobbering a caption, §7.2) mechanical
 * rather than re-derived at every call site.
 */

/** A reference block's stable record id (docs/026 §4.3); "" when not yet picked. */
export function refField(data: unknown): string {
  return stringField(asRecord(data), "ref");
}

/** The projected snapshot — the `resolve`-refreshed display copy (docs/026 §4.3). */
export function snapshotRecord(data: unknown): Record<string, JsonValue> {
  return asRecord(asRecord(data).snapshot);
}

/** The author-local fields a `resolve` must never overwrite (docs/026 §4.3). */
export function localRecord(data: unknown): Record<string, JsonValue> {
  return asRecord(asRecord(data).local);
}

/**
 * Set a reference block's `ref` and *replace* its `snapshot`, preserving `local`.
 * This is the **pick** commit (docs/026 §7.1): a pick chooses a *different*
 * record, so its projection replaces the old snapshot wholesale rather than
 * merging — merging two records' fields would be incoherent. `ref`/`local` keys
 * outside the snapshot are kept.
 */
export function setReference(
  data: unknown,
  ref: string,
  snapshot: Record<string, JsonValue>,
): Record<string, JsonValue> {
  return { ...asRecord(data), ref, snapshot };
}

/**
 * Merge a fresh projection into the existing `snapshot`, preserving `ref` and
 * `local`. This is the **resolve** patch (docs/026 §7.2, Phase 2): the same
 * record refreshed, so projected keys are merged in and any author-local field is
 * left untouched — store-only would be a dead copy, a full replace could drop a
 * key the new projection omits, so a key-wise merge is the correct middle.
 */
export function patchSnapshot(
  data: unknown,
  projected: Record<string, JsonValue>,
): Record<string, JsonValue> {
  const current = asRecord(data);
  return { ...current, snapshot: { ...snapshotRecord(current), ...projected } };
}
