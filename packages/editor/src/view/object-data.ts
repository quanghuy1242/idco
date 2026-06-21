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
