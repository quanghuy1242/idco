import { describe, expect, it } from "vitest";
import { FlatOffsetModel, TreapOffsetModel } from "@idco/editor";

// Deterministic PRNG: one stream seeds the treap's priorities, another drives
// the op sequence. A failure therefore reproduces with the exact same tree shape
// and the exact same operations.
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

// The treap is checked against FlatOffsetModel, which Phase A already validated
// against an independent brute-force oracle. Integer heights make findIndex and
// lowerBound exact; offsets are sampled across and beyond the document.
function assertSameAsFlat(
  treap: TreapOffsetModel,
  flat: FlatOffsetModel,
  rng: () => number,
): void {
  const count = flat.count;
  expect(treap.count).toBe(count);
  expect(treap.total()).toBe(flat.total());
  for (let i = 0; i <= count; i += 1) {
    expect(treap.prefix(i)).toBe(flat.prefix(i));
  }
  const total = flat.total();
  const probes = [-25, 0, 1, total - 1, total, total + 50];
  for (let s = 0; s < 8; s += 1) probes.push(Math.floor(rng() * (total + 20)));
  for (const offset of probes) {
    expect(treap.findIndex(offset)).toBe(flat.findIndex(offset));
    expect(treap.lowerBound(offset)).toBe(flat.lowerBound(offset));
  }
}

describe("TreapOffsetModel — differential vs FlatOffsetModel", () => {
  it("agrees after random setHeight/insert/remove sequences", () => {
    for (let trial = 0; trial < 40; trial += 1) {
      const priRng = mulberry32(0x1000 + trial);
      const opRng = mulberry32(0x9000 + trial);
      // Mix integers with the occasional sub-1px/fractional height so the 1px
      // floor branch is exercised by the structural ops, not only by build, in
      // BOTH models — a floor bug in one would surface as a differential mismatch.
      const randHeight = (range: number): number =>
        opRng() < 0.1 ? opRng() : 1 + Math.floor(opRng() * range);
      const init = Array.from({ length: 8 }, () => randHeight(300));
      const flat = new FlatOffsetModel(init);
      const treap = new TreapOffsetModel(init, priRng);

      for (let step = 0; step < 300; step += 1) {
        const roll = opRng();
        if (roll < 0.45 && flat.count > 0) {
          const i = Math.floor(opRng() * flat.count);
          const h = randHeight(500);
          flat.setHeight(i, h);
          treap.setHeight(i, h);
        } else if (roll < 0.75) {
          const i = Math.floor(opRng() * (flat.count + 1));
          const h = randHeight(500);
          flat.insert(i, h);
          treap.insert(i, h);
        } else if (flat.count > 0) {
          const i = Math.floor(opRng() * flat.count);
          flat.remove(i);
          treap.remove(i);
        }
        // Validate every ~10 steps to keep the trial fast but thorough.
        if (step % 10 === 0) assertSameAsFlat(treap, flat, opRng);
      }
      assertSameAsFlat(treap, flat, opRng);
    }
  });

  it("agrees when built directly from random height fixtures", () => {
    for (let trial = 0; trial < 60; trial += 1) {
      const opRng = mulberry32(0xa000 + trial);
      const n = Math.floor(opRng() * 50);
      const heights = Array.from(
        { length: n },
        () => 1 + Math.floor(opRng() * 600),
      );
      const flat = new FlatOffsetModel(heights);
      const treap = new TreapOffsetModel(heights, mulberry32(0xb000 + trial));
      assertSameAsFlat(treap, flat, opRng);
    }
  });
});

describe("TreapOffsetModel — edge operations", () => {
  it("starts empty and survives insert→remove back to empty", () => {
    const t = new TreapOffsetModel([], mulberry32(7));
    expect(t.count).toBe(0);
    expect(t.total()).toBe(0);
    expect(t.findIndex(100)).toBe(0);
    expect(t.lowerBound(100)).toBe(1); // matches flat cum=[0] overflow
    t.insert(0, 50);
    t.insert(1, 70);
    t.insert(0, 30); // [30,50,70]
    expect(t.count).toBe(3);
    expect(t.total()).toBe(150);
    expect(t.prefix(2)).toBe(80);
    t.remove(0);
    t.remove(1); // remove the 70 → [50]
    expect(t.count).toBe(1);
    expect(t.total()).toBe(50);
  });

  it("ignores out-of-range setHeight/remove and clamps insert position", () => {
    const flat = new FlatOffsetModel([10, 20, 30]);
    const treap = new TreapOffsetModel([10, 20, 30], mulberry32(11));
    for (const m of [flat, treap]) {
      m.setHeight(-1, 999);
      m.setHeight(5, 999);
      m.remove(9);
      m.insert(99, 40); // clamps to end
      m.insert(-3, 5); // clamps to start
    }
    assertSameAsFlat(treap, flat, mulberry32(3));
  });

  it("floors heights at 1px like the flat model", () => {
    const treap = new TreapOffsetModel([0, -4, 0.2], mulberry32(5));
    expect(treap.total()).toBe(3);
    expect(treap.prefix(1)).toBe(1);
    treap.setHeight(0, -100);
    expect(treap.prefix(1)).toBe(1);
  });
});

describe("TreapOffsetModel — fractional accuracy and scale", () => {
  it("keeps total/prefix close to the flat sum with fractional heights", () => {
    const opRng = mulberry32(0xfeed);
    const heights = Array.from({ length: 500 }, () => 1 + opRng() * 100);
    const flat = new FlatOffsetModel(heights);
    const treap = new TreapOffsetModel(heights, mulberry32(0xdead));
    expect(treap.total()).toBeCloseTo(flat.total(), 6);
    for (let i = 0; i <= heights.length; i += 37) {
      expect(treap.prefix(i)).toBeCloseTo(flat.prefix(i), 6);
    }
  });

  it("stays correct at 20k blocks under many in-place updates (no rebuild, no stack blowup)", () => {
    const n = 20000;
    const priRng = mulberry32(0x5eed);
    const opRng = mulberry32(0x6eed);
    const heights = Array.from(
      { length: n },
      () => 1 + Math.floor(opRng() * 200),
    );
    const flat = new FlatOffsetModel(heights);
    const treap = new TreapOffsetModel(heights, priRng);

    for (let k = 0; k < 2000; k += 1) {
      const i = Math.floor(opRng() * n);
      const h = 1 + Math.floor(opRng() * 400);
      flat.setHeight(i, h);
      treap.setHeight(i, h);
    }
    expect(treap.count).toBe(n);
    expect(treap.total()).toBe(flat.total());
    for (let s = 0; s < 50; s += 1) {
      const i = Math.floor(opRng() * (n + 1));
      expect(treap.prefix(i)).toBe(flat.prefix(i));
      const px = Math.floor(opRng() * (flat.total() + 100));
      expect(treap.findIndex(px)).toBe(flat.findIndex(px));
      expect(treap.lowerBound(px)).toBe(flat.lowerBound(px));
    }
  });
});
