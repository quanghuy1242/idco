/**
 * In-place reconciliation of a persistent {@link OffsetModel} across an order
 * change (docs/025 §7.4, §9.2). Keeps the model's measured heights instead of
 * rebuilding, which is what makes a structural edit O(log n) per changed block
 * rather than an O(n) rebuild.
 *
 * Returns `false` — without mutating the model — when the change is too large to
 * be worth incremental edits, signalling the caller to rebuild from scratch (the
 * edit-storm fallback, docs/025 §10). Returning before any mutation means a
 * `false` result leaves the model exactly as it was.
 */
import type { OffsetModel } from "./index";

/**
 * @categoryDefault Virtual Geometry
 */

/**
 * Generic, key-agnostic so it is testable with plain string ids. The view binds
 * `Key = NodeId` and `seedFor = (id) => heightCache.get(id) ?? estimate`, so a
 * block that merely *moved* keeps its measured height (the cache is keyed by id).
 *
 * Strategy: trim the common prefix and suffix — structural edits are almost
 * always localized, so the differing "middle" is tiny — then remove the old
 * middle high index → low (so earlier removals do not shift the indices still to
 * remove) and insert the new middle low → high. A precise minimal diff (LCS) is
 * not worth its cost; this is O(prefix/suffix scan) + O(middle · log n).
 */
export function reconcileOffsetModel<Key>(
  model: OffsetModel,
  from: readonly Key[],
  to: readonly Key[],
  seedFor: (key: Key) => number,
): boolean {
  const fn = from.length;
  const tn = to.length;

  let p = 0;
  while (p < fn && p < tn && from[p] === to[p]) p += 1;

  let i = fn;
  let j = tn;
  while (i > p && j > p && from[i - 1] === to[j - 1]) {
    i -= 1;
    j -= 1;
  }

  const removeCount = i - p;
  const insertCount = j - p;

  // Edit-storm fallback (docs/025 §10): when churn approaches the document size,
  // one O(n) rebuild beats thousands of O(log n) splices. `count / log2(count)`
  // is the crossover; tiny documents (<= 2) just always reconcile.
  const span = Math.max(fn, tn);
  const threshold = span <= 2 ? span : span / Math.log2(span);
  if (removeCount + insertCount > threshold) return false;

  for (let k = i - 1; k >= p; k -= 1) model.remove(k);
  for (let k = 0; k < insertCount; k += 1) {
    model.insert(p + k, seedFor(to[p + k]!));
  }
  return true;
}
