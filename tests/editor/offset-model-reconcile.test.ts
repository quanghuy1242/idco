import { describe, expect, it } from "vitest";
import {
  FlatOffsetModel,
  reconcileOffsetModel,
  TreapOffsetModel,
} from "@idco/editor";

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

// Stable height per id so seedFor is deterministic and a reconciled model must
// exactly equal a fresh build from the target order.
function heightOf(id: string): number {
  let h = 7;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 491;
  return 1 + h;
}

// Mirror the controller exactly: reconcile in place, or rebuild on the
// edit-storm fallback (docs/025 §10). Returns the resulting model + which path.
function apply(
  model: TreapOffsetModel,
  from: readonly string[],
  to: readonly string[],
  seedFor: (id: string) => number,
  rng: () => number,
): { model: TreapOffsetModel; reused: boolean } {
  const reused = reconcileOffsetModel(model, from, to, seedFor);
  if (reused) return { model, reused };
  return { model: new TreapOffsetModel(to.map(seedFor), rng), reused };
}

function expectEqualsFreshBuild(
  model: TreapOffsetModel,
  to: readonly string[],
  seedFor: (id: string) => number = heightOf,
) {
  const fresh = new FlatOffsetModel(to.map(seedFor));
  expect(model.count).toBe(to.length);
  expect(model.total()).toBe(fresh.total());
  for (let i = 0; i <= to.length; i += 1) {
    expect(model.prefix(i)).toBe(fresh.prefix(i));
  }
}

describe("reconcileOffsetModel — incremental path (single contiguous edit)", () => {
  it("reconciles a single middle insert in place (reused=true)", () => {
    const from = ["a", "b", "c", "d"];
    const to = ["a", "b", "x", "c", "d"];
    const model = new TreapOffsetModel(from.map(heightOf), mulberry32(1));
    expect(reconcileOffsetModel(model, from, to, heightOf)).toBe(true);
    expectEqualsFreshBuild(model, to);
  });

  it("reconciles a single remove in place (reused=true)", () => {
    const from = ["a", "b", "c", "d", "e"];
    const to = ["a", "b", "d", "e"];
    const model = new TreapOffsetModel(from.map(heightOf), mulberry32(2));
    expect(reconcileOffsetModel(model, from, to, heightOf)).toBe(true);
    expectEqualsFreshBuild(model, to);
  });

  it("reconciles a single deep insert in a 5000-block document (reused=true)", () => {
    const from = Array.from({ length: 5000 }, (_, i) => `n${i}`);
    const to = [...from];
    to.splice(2500, 0, "inserted");
    const model = new TreapOffsetModel(from.map(heightOf), mulberry32(13));
    expect(reconcileOffsetModel(model, from, to, heightOf)).toBe(true);
    expect(model.count).toBe(5001);
    const fresh = new FlatOffsetModel(to.map(heightOf));
    expect(model.total()).toBe(fresh.total());
    expect(model.prefix(2501)).toBe(fresh.prefix(2501));
  });

  it("preserves the exact heights of surviving prefix/suffix blocks across an insert", () => {
    const from = ["a", "b", "c", "d", "e"];
    // Distinct measured heights NOT equal to heightOf(id), so a reconcile that
    // re-seeded a survivor (instead of keeping its node) would change its height
    // and fail here.
    const measured = new Map<string, number>([
      ["a", 111],
      ["b", 222],
      ["c", 333],
      ["d", 444],
      ["e", 555],
    ]);
    const seedFor = (id: string) => measured.get(id) ?? heightOf(id);
    const model = new TreapOffsetModel(from.map(seedFor), mulberry32(21));
    const to = ["a", "b", "x", "c", "d", "e"];
    expect(reconcileOffsetModel(model, from, to, seedFor)).toBe(true);
    const h = (i: number) => model.prefix(i + 1) - model.prefix(i);
    expect(h(0)).toBe(111); // a (prefix, untouched)
    expect(h(1)).toBe(222); // b (prefix, untouched)
    expect(h(3)).toBe(333); // c (suffix, shifted but height preserved)
    expect(h(4)).toBe(444); // d
    expect(h(5)).toBe(555); // e
  });

  it("keeps a moved block's measured height (seedFor by id)", () => {
    const from = ["a", "b", "c"];
    const to = ["a", "c", "b"];
    const measured = new Map<string, number>([["b", 999]]);
    const seedFor = (id: string) => measured.get(id) ?? heightOf(id);
    const model = new TreapOffsetModel(from.map(seedFor), mulberry32(4));
    model.setHeight(1, 999); // b at index 1
    const { model: next } = apply(model, from, to, seedFor, mulberry32(40));
    expectEqualsFreshBuild(next, to, seedFor);
    expect(next.prefix(3) - next.prefix(2)).toBe(999); // b is now last, still 999
  });
});

describe("reconcileOffsetModel — fallback paths stay correct", () => {
  it("prepend+append is two regions → falls back, and rebuild is correct", () => {
    const from = ["b", "c"];
    const to = ["a", "b", "c", "d"];
    const model = new TreapOffsetModel(from.map(heightOf), mulberry32(3));
    const { model: next } = apply(model, from, to, heightOf, mulberry32(30));
    expectEqualsFreshBuild(next, to);
  });

  it("bails without mutating when churn exceeds the threshold", () => {
    const from = Array.from({ length: 100 }, (_, i) => `a${i}`);
    const to = Array.from({ length: 100 }, (_, i) => `b${i}`); // fully disjoint
    const model = new TreapOffsetModel(from.map(heightOf), mulberry32(9));
    const before = model.total();
    expect(reconcileOffsetModel(model, from, to, heightOf)).toBe(false);
    // untouched on the bail, so the caller's rebuild is the source of truth
    expect(model.count).toBe(100);
    expect(model.total()).toBe(before);
  });
});

describe("reconcileOffsetModel — random walk vs fresh build", () => {
  it("stays equal to a fresh build across 200 random edits (insert/remove/move)", () => {
    const rng = mulberry32(0xabcdef);
    let order = Array.from({ length: 20 }, (_, i) => `n${i}`);
    let nextId = 20;
    let model = new TreapOffsetModel(order.map(heightOf), mulberry32(0x111));

    for (let step = 0; step < 200; step += 1) {
      const from = order;
      const to = [...order];
      const roll = rng();
      if (roll < 0.4 && to.length > 1) {
        to.splice(Math.floor(rng() * to.length), 1);
      } else if (roll < 0.8) {
        to.splice(Math.floor(rng() * (to.length + 1)), 0, `n${nextId++}`);
      } else if (to.length > 2) {
        const i = Math.floor(rng() * to.length);
        const [moved] = to.splice(i, 1);
        to.splice(Math.floor(rng() * (to.length + 1)), 0, moved!);
      }

      ({ model } = apply(model, from, to, heightOf, mulberry32(step)));
      expectEqualsFreshBuild(model, to);
      order = to;
    }
  });
});
