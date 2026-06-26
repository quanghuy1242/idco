/**
 * Bake LRU (docs/030 §7.6 Stage one, SLP-3).
 *
 * The baked-snapshot cache is the largest unbounded allocator and the cheapest to
 * reclaim because re-baking is pure (an evicted bake regenerates identically). These
 * tests pin: a byte ceiling that evicts least-recently-used first, recency promotion on
 * read, identical recomputation on a miss after eviction, and the `MemoryPool` contract
 * (`estimateBytes`/`evict`) the budget arbiter drives.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createBakeCache,
  type BakedSnapshot,
} from "../../packages/editor/src/core";

function bake(payload: string): BakedSnapshot {
  return { kind: "html", payload };
}

describe("bake LRU (SLP-3)", () => {
  it("evicts least-recently-used entries past the byte ceiling", () => {
    // Each "x"*20 payload is JSON.stringify length 22 + kind length 4 = 26 bytes.
    const cache = createBakeCache({ maxBytes: 60 });
    const payload = "x".repeat(20);
    cache.set("a", bake(payload));
    cache.set("b", bake(payload));
    expect(cache.size).toBe(2);

    // A third 26-byte entry pushes the total to 78 > 60, evicting the LRU entry ("a").
    cache.set("c", bake(payload));
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
    expect(cache.estimateBytes()).toBeLessThanOrEqual(60);
  });

  it("promotes an entry to most-recently-used on read", () => {
    const cache = createBakeCache({ maxBytes: 60 });
    const payload = "x".repeat(20);
    cache.set("a", bake(payload));
    cache.set("b", bake(payload));
    // Touch "a" so it is now the most recent; "b" becomes the LRU victim.
    expect(cache.get("a")).toEqual(bake(payload));
    cache.set("c", bake(payload));
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
  });

  it("recomputes an evicted bake identically", () => {
    const cache = createBakeCache({ maxBytes: 60 });
    const payload = "x".repeat(20);
    const compute = vi.fn<() => BakedSnapshot>(() => bake(payload));

    const first = cache.getOrCompute("a", compute);
    expect(compute).toHaveBeenCalledTimes(1);
    // A cached hit does not recompute.
    expect(cache.getOrCompute("a", compute)).toBe(first);
    expect(compute).toHaveBeenCalledTimes(1);

    // Evict "a" by overfilling, then recompute: identical result, fresh compute.
    cache.set("b", bake(payload));
    cache.set("c", bake(payload));
    expect(cache.has("a")).toBe(false);
    const recomputed = cache.getOrCompute("a", compute);
    expect(compute).toHaveBeenCalledTimes(2);
    expect(recomputed).toEqual(first);
  });

  it("implements the MemoryPool contract", () => {
    const cache = createBakeCache();
    expect(cache.name).toBe("bake");
    const payload = "y".repeat(30);
    cache.set("a", bake(payload));
    cache.set("b", bake(payload));
    const total = cache.estimateBytes();
    expect(total).toBeGreaterThan(0);

    // Evict toward half the current size; the pool reports the bytes it actually freed and
    // settles at or below the target.
    const freed = cache.evict(total / 2);
    expect(freed).toBeGreaterThan(0);
    expect(cache.estimateBytes()).toBeLessThanOrEqual(total / 2);
  });
});
