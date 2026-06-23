import { describe, expect, it } from "vitest";
import {
  calculateVirtualRange,
  FlatOffsetModel,
  rangeFromModel,
} from "@idco/editor";

// ---------------------------------------------------------------------------
// Independent brute-force oracle. Deliberately dumb: floor each height at 1,
// build a plain cumulative array, and answer every query by direct scan. It
// shares no code with FlatOffsetModel, so agreement is real evidence, and it is
// reused in Phase B as the oracle the treap is differentially tested against.
// ---------------------------------------------------------------------------
function floor1(h: number): number {
  return Math.max(1, h);
}
function cum(heights: readonly number[]): number[] {
  const out = [0];
  for (let i = 0; i < heights.length; i += 1)
    out.push(out[i]! + floor1(heights[i]!));
  return out;
}
function bfTotal(heights: readonly number[]): number {
  return cum(heights).at(-1)!;
}
function bfPrefix(heights: readonly number[], index: number): number {
  const c = cum(heights);
  const i = Math.max(0, Math.min(heights.length, index));
  return c[i]!;
}
function bfLowerBound(heights: readonly number[], target: number): number {
  const c = cum(heights);
  for (let k = 0; k < c.length; k += 1) if (c[k]! >= target) return k;
  return c.length; // all below target → count + 1
}
function bfFindIndex(heights: readonly number[], offset: number): number {
  const c = cum(heights);
  let best = 0;
  for (let i = 0; i < c.length; i += 1) if (c[i]! <= offset) best = i;
  return best; // largest i with cum[i] <= offset (and 0 for offset <= 0)
}

// Deterministic PRNG so a failing fuzz case reproduces exactly.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("FlatOffsetModel — queries vs brute-force oracle", () => {
  it("matches total/prefix/findIndex/lowerBound across random fixtures", () => {
    const rng = mulberry32(0xc0ffee);
    for (let trial = 0; trial < 200; trial += 1) {
      const n = Math.floor(rng() * 60);
      const heights = Array.from({ length: n }, () =>
        // mix tiny, normal, and giant blocks plus the occasional sub-1px so the
        // floor and the strictly-increasing invariant are both exercised.
        rng() < 0.1 ? rng() : Math.floor(rng() * 800),
      );
      const model = new FlatOffsetModel(heights);

      expect(model.count).toBe(n);
      expect(model.total()).toBe(bfTotal(heights));

      for (let i = 0; i <= n; i += 1) {
        expect(model.prefix(i)).toBe(bfPrefix(heights, i));
      }
      const total = bfTotal(heights);
      for (const offset of [
        -50,
        0,
        1,
        Math.floor(total / 3),
        total - 1,
        total,
        total + 100,
      ]) {
        expect(model.findIndex(offset)).toBe(bfFindIndex(heights, offset));
        expect(model.lowerBound(offset)).toBe(bfLowerBound(heights, offset));
      }
    }
  });

  it("keeps queries correct through random setHeight/insert/remove sequences", () => {
    const rng = mulberry32(0x1234);
    const heights: number[] = Array.from({ length: 10 }, () =>
      Math.floor(rng() * 300),
    );
    const model = new FlatOffsetModel(heights);

    for (let step = 0; step < 500; step += 1) {
      const roll = rng();
      if (roll < 0.45 && heights.length > 0) {
        const i = Math.floor(rng() * heights.length);
        const h = Math.floor(rng() * 500);
        heights[i] = h;
        model.setHeight(i, h);
      } else if (roll < 0.75) {
        const i = Math.floor(rng() * (heights.length + 1));
        const h = Math.floor(rng() * 500);
        heights.splice(i, 0, h);
        model.insert(i, h);
      } else if (heights.length > 0) {
        const i = Math.floor(rng() * heights.length);
        heights.splice(i, 1);
        model.remove(i);
      }

      expect(model.count).toBe(heights.length);
      expect(model.total()).toBe(bfTotal(heights));
      // spot-check a prefix and the two query primitives each step
      const probe = Math.floor(rng() * (heights.length + 1));
      expect(model.prefix(probe)).toBe(bfPrefix(heights, probe));
      const px = Math.floor(rng() * (bfTotal(heights) + 10));
      expect(model.findIndex(px)).toBe(bfFindIndex(heights, px));
      expect(model.lowerBound(px)).toBe(bfLowerBound(heights, px));
    }
  });
});

describe("FlatOffsetModel — edge cases", () => {
  it("handles the empty model", () => {
    const m = new FlatOffsetModel([]);
    expect(m.count).toBe(0);
    expect(m.total()).toBe(0);
    expect(m.prefix(0)).toBe(0);
    expect(m.findIndex(0)).toBe(0);
    expect(m.findIndex(500)).toBe(0);
    expect(m.lowerBound(0)).toBe(0);
  });

  it("floors heights at 1px (parity with legacy cumulativeOffsets)", () => {
    const m = new FlatOffsetModel([0, 0.4, -3, 1]);
    // every block contributes at least 1px
    expect(m.total()).toBe(4);
    expect(m.prefix(2)).toBe(2);
  });

  it("preserves fractional heights above the floor", () => {
    const m = new FlatOffsetModel([10.5, 20.25]);
    expect(m.total()).toBeCloseTo(30.75, 10);
    expect(m.prefix(1)).toBeCloseTo(10.5, 10);
  });

  it("clamps prefix index and ignores out-of-range mutations", () => {
    const m = new FlatOffsetModel([100, 100, 100]);
    expect(m.prefix(-5)).toBe(0);
    expect(m.prefix(99)).toBe(300);
    m.setHeight(-1, 999); // no-op
    m.setHeight(7, 999); // no-op
    m.remove(7); // no-op
    expect(m.total()).toBe(300);
  });

  it("findIndex lands on the block containing the pixel, with edges on the lower block boundary", () => {
    const m = new FlatOffsetModel([100, 100, 100]); // edges at 0,100,200,300
    expect(m.findIndex(0)).toBe(0);
    expect(m.findIndex(50)).toBe(0);
    expect(m.findIndex(100)).toBe(1); // exactly on an edge → that block
    expect(m.findIndex(150)).toBe(1);
    expect(m.findIndex(299)).toBe(2);
    expect(m.findIndex(300)).toBe(3); // total edge → count
    expect(m.findIndex(99999)).toBe(3);
  });
});

describe("calculateVirtualRange — legacy parity over the model", () => {
  it("reproduces the documented uniform-height result", () => {
    const range = calculateVirtualRange({
      getItemSize: () => 100,
      itemCount: 20,
      overscan: 1,
      scrollOffset: 450,
      viewportSize: 250,
    });
    expect(range).toEqual({
      afterHeight: 1200,
      beforeHeight: 300,
      endIndex: 8,
      startIndex: 3,
      totalHeight: 2000,
    });
  });

  it("returns the empty range for an empty list", () => {
    const range = calculateVirtualRange({
      getItemSize: () => 100,
      itemCount: 0,
      scrollOffset: 0,
      viewportSize: 500,
    });
    expect(range).toEqual({
      afterHeight: 0,
      beforeHeight: 0,
      endIndex: 0,
      startIndex: 0,
      totalHeight: 0,
    });
  });

  it("matches an independent legacy-formula reimplementation on variable heights", () => {
    const rng = mulberry32(0x9e3779b9);
    for (let trial = 0; trial < 100; trial += 1) {
      const n = 1 + Math.floor(rng() * 40);
      const heights = Array.from(
        { length: n },
        () => 1 + Math.floor(rng() * 200),
      );
      const total = bfTotal(heights);
      const scrollOffset = Math.floor(rng() * (total + 50)) - 10;
      const viewportSize = Math.floor(rng() * 400);
      const overscan = Math.floor(rng() * 5);

      const actual = calculateVirtualRange({
        getItemSize: (i) => heights[i]!,
        itemCount: n,
        overscan,
        scrollOffset,
        viewportSize,
      });

      // Independent reimplementation of the pre-OffsetModel formula.
      const s = Math.max(0, scrollOffset);
      const v = Math.max(0, viewportSize);
      const visibleStart = bfLowerBound(heights, s) - 1;
      const visibleEnd = bfLowerBound(heights, s + v);
      const os = Math.max(0, overscan);
      const startIndex = Math.max(0, visibleStart - os);
      const endIndex = Math.min(n, visibleEnd + os);
      expect(actual).toEqual({
        afterHeight: total - bfPrefix(heights, endIndex),
        beforeHeight: bfPrefix(heights, startIndex),
        endIndex,
        startIndex,
        totalHeight: total,
      });
    }
  });
});

describe("rangeFromModel — direct queries reuse a prebuilt model", () => {
  it("produces the same slice as calculateVirtualRange without rebuilding", () => {
    const model = new FlatOffsetModel(Array(20).fill(100));
    const a = rangeFromModel(model, {
      overscan: 1,
      scrollOffset: 450,
      viewportSize: 250,
    });
    const b = calculateVirtualRange({
      getItemSize: () => 100,
      itemCount: 20,
      overscan: 1,
      scrollOffset: 450,
      viewportSize: 250,
    });
    expect(a).toEqual(b);
  });
});
