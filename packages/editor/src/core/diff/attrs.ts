/**
 * Attribute/settings diff and the structural JSON equality it rests on (docs/036 §5.6, R6-B).
 *
 * Why this file exists
 * --------------------
 * Node attrs, document settings, object data, and collection items are all opaque
 * JSON bags the engine stores but does not interpret. To tell whether one changed
 * between two snapshots the diff needs a *value* comparison, and it must be
 * key-order insensitive: two snapshots authored independently (one loaded from
 * disk, one freshly edited) can carry the same attrs in a different key order, and
 * a diff that reported that as "changed" would be wrong. The store's hot paths use
 * `JSON.stringify(a) === JSON.stringify(b)` (order-sensitive) because it constructs
 * attrs in a stable order and only needs a cheap dirty check; the diff cannot make
 * that assumption, so it walks the values. Arrays stay order-sensitive (order is
 * content for a list); objects are order-insensitive (key order is not content).
 */
import { isRecord } from "@quanghuy1242/idco-lib";
import type { DocumentSettings, JsonObject, JsonValue } from "../model";
import type { AttrDiff } from "./types";

/**
 * Structural equality for two JSON values.
 *
 * Key-order insensitive for objects (key order is not content), order-sensitive
 * for arrays (order is content), strict for primitives. `undefined` is treated as
 * an absent optional (an absent attrs bag equals an empty one) so a node with no
 * attrs and a node with `attrs: {}` compare equal.
 */
export function jsonEqual(
  a: JsonValue | undefined,
  b: JsonValue | undefined,
): boolean {
  if (a === b) return true;
  // Treat an absent value and an empty object as equal so `attrs: undefined` vs
  // `attrs: {}` never reads as a change (the store omits an empty attrs bag).
  if (a === undefined) return isEmptyRecord(b);
  if (b === undefined) return isEmptyRecord(a);
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i += 1) {
      if (!jsonEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isRecord(a) && isRecord(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.hasOwn(b, key)) return false;
      if (!jsonEqual(a[key] as JsonValue, b[key] as JsonValue)) return false;
    }
    return true;
  }
  // One is a record and the other a primitive/array mismatch, or two unequal
  // primitives: not equal (the `a === b` fast path already caught equal ones).
  return false;
}

/**
 * Diff two attribute bags (node attrs or document settings) into added/removed/changed keys.
 *
 * An absent bag is treated as empty, so `undefined` vs `{}` yields an all-empty
 * diff. A key present on both sides with an unequal value (by {@link jsonEqual})
 * lands in `changed` with both sides; the caller decides whether a non-empty
 * result makes the owning block `"changed"`.
 */
export function diffAttrs(
  base: JsonObject | DocumentSettings | undefined,
  target: JsonObject | DocumentSettings | undefined,
): AttrDiff {
  const added: Record<string, JsonValue> = {};
  const removed: Record<string, JsonValue> = {};
  const changed: Record<string, { base: JsonValue; target: JsonValue }> = {};
  const baseBag = base ?? {};
  const targetBag = target ?? {};
  for (const key of Object.keys(targetBag)) {
    if (!Object.hasOwn(baseBag, key)) {
      added[key] = targetBag[key]!;
    } else if (!jsonEqual(baseBag[key], targetBag[key])) {
      changed[key] = { base: baseBag[key]!, target: targetBag[key]! };
    }
  }
  for (const key of Object.keys(baseBag)) {
    if (!Object.hasOwn(targetBag, key)) {
      removed[key] = baseBag[key]!;
    }
  }
  return { added, changed, removed };
}

/** Whether an attr diff carries no add/remove/change (the two bags are equal). */
export function attrDiffIsEmpty(diff: AttrDiff): boolean {
  return (
    Object.keys(diff.added).length === 0 &&
    Object.keys(diff.removed).length === 0 &&
    Object.keys(diff.changed).length === 0
  );
}

function isEmptyRecord(value: JsonValue | undefined): boolean {
  return (
    value !== undefined && isRecord(value) && Object.keys(value).length === 0
  );
}
