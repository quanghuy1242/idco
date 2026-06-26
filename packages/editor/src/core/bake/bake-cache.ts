/**
 * Size-bounded LRU cache for baked object snapshots (docs/030 §7.6 Stage one, SLP-3).
 *
 * Why this file exists
 * --------------------
 * A baked snapshot (an object's SVG / highlighted-HTML / GFM-table payload — `bake.ts`)
 * is the single static representation the reader and export consume, and it is by far the
 * largest per-object allocation. Re-baking is *pure* (`bakeObjectData`: a function of
 * registry + type + data), so a baked snapshot is always recomputable and therefore the
 * cheapest thing to reclaim under memory pressure — evicting one is free correctness-wise
 * because it regenerates identically (docs/030 §3.4/§7.6 D6 Stage one). Today nothing
 * bounds it; this module is the recency-ordered, byte-bounded cache that does.
 *
 * It is a *plain compute cache*, not wired to a node: the view's bake service stores a
 * baked payload here keyed by a content key (object id + a data fingerprint) and looks it
 * up before re-baking. The cache implements `MemoryPool` so the budget arbiter
 * (`core/memory/pool.ts`) can size it alongside history (and, later, resident bodies)
 * under one ceiling. Both a standalone `maxBytes` floor and the arbiter can drive
 * eviction; they compose (the local cap is a hard per-cache limit, the arbiter steals
 * further under global pressure).
 *
 * Eviction is strict LRU: `get`/`set` mark an entry most-recently-used, and eviction
 * drops the least-recently-used first. A JS `Map` preserves insertion order, so "move to
 * most-recent" is delete-then-set and "evict oldest" is the first key — O(1) amortized,
 * no separate linked list.
 */
import type { BakedSnapshot } from "../model";
import type { MemoryPool } from "../memory/pool";

export type BakeCacheOptions = {
  /**
   * The cache's own hard byte ceiling (default `Infinity`). Eviction to this floor runs on
   * every `set`; the arbiter can drive the resident size lower still under global pressure.
   */
  readonly maxBytes?: number;
};

export type BakeCache = MemoryPool & {
  /** The baked snapshot for `key`, marking it most-recently-used; undefined on a miss. */
  get(key: string): BakedSnapshot | undefined;
  /** Whether `key` is resident (does *not* affect recency). */
  has(key: string): boolean;
  /** Store (or refresh) a baked snapshot, evicting LRU entries past the byte ceiling. */
  set(key: string, baked: BakedSnapshot): void;
  /**
   * Return the cached bake for `key`, or compute it via `compute`, store it, and return it.
   * The miss path is the pure re-bake; a cached hit never recomputes (the §7.6 promise:
   * eviction is invisible because regeneration is identical).
   */
  getOrCompute(key: string, compute: () => BakedSnapshot): BakedSnapshot;
  /** Drop one entry if present. */
  delete(key: string): void;
  /** Drop every entry. */
  clear(): void;
  /** The number of resident entries. */
  readonly size: number;
};

/**
 * Coarse byte estimate for one baked snapshot: the JSON length of its payload plus its
 * kind tag. Accounted bytes are intentionally approximate (D6: true heap is 2–5× this);
 * the estimate only has to be *monotonic and proportional* so LRU eviction tracks real
 * pressure and the arbiter can compare pools.
 */
function estimateBakedBytes(baked: BakedSnapshot): number {
  return JSON.stringify(baked.payload).length + baked.kind.length;
}

/** Create a recency-ordered, byte-bounded bake cache that also serves as a `MemoryPool`. */
export function createBakeCache(options?: BakeCacheOptions): BakeCache {
  const maxBytes = options?.maxBytes ?? Number.POSITIVE_INFINITY;
  // Insertion-ordered map: the first key is the least-recently-used entry. A parallel
  // byte tally avoids re-summing the whole map on every `set`/`evict`.
  const entries = new Map<string, BakedSnapshot>();
  const sizes = new Map<string, number>();
  let totalBytes = 0;

  const drop = (key: string): void => {
    const bytes = sizes.get(key);
    if (bytes === undefined) return;
    totalBytes -= bytes;
    sizes.delete(key);
    entries.delete(key);
  };

  /** Evict least-recently-used entries until the tally is at or below `targetBytes`. */
  const evictTo = (targetBytes: number): number => {
    const before = totalBytes;
    // Map iteration order is insertion order, so the first key is always the LRU one.
    for (const key of entries.keys()) {
      if (totalBytes <= targetBytes) break;
      drop(key);
    }
    return before - totalBytes;
  };

  const touch = (key: string, baked: BakedSnapshot): void => {
    // Refreshing recency = delete then re-insert so the key moves to the most-recent end.
    drop(key);
    const bytes = estimateBakedBytes(baked);
    entries.set(key, baked);
    sizes.set(key, bytes);
    totalBytes += bytes;
    evictTo(maxBytes);
  };

  return {
    name: "bake",
    clear() {
      entries.clear();
      sizes.clear();
      totalBytes = 0;
    },
    delete(key) {
      drop(key);
    },
    estimateBytes() {
      return totalBytes;
    },
    evict(targetBytes) {
      return evictTo(targetBytes);
    },
    get(key) {
      const baked = entries.get(key);
      if (baked === undefined) return undefined;
      // A read counts as use: move the entry to the most-recent end.
      touch(key, baked);
      return baked;
    },
    getOrCompute(key, compute) {
      const cached = entries.get(key);
      if (cached !== undefined) {
        touch(key, cached);
        return cached;
      }
      const baked = compute();
      touch(key, baked);
      return baked;
    },
    has(key) {
      return entries.has(key);
    },
    set(key, baked) {
      touch(key, baked);
    },
    get size() {
      return entries.size;
    },
  };
}
