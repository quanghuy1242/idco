import { describe, expect, it } from "vitest";
import { BlockEstimator, type BlockMetrics } from "@idco/editor";

const text = (chars: number, type = "paragraph"): BlockMetrics => ({
  chars,
  kind: "text",
  typeKey: `text:${type}`,
});
const code = (lines: number): BlockMetrics => ({
  kind: "code",
  lines,
  typeKey: "code:code-block",
});
const image = (aspectRatio: number): BlockMetrics => ({
  aspectRatio,
  kind: "image",
  typeKey: "image:media",
});
const opaque = (typeKey: string): BlockMetrics => ({ kind: "opaque", typeKey });
const fixed = (height: number, typeKey = "fixed:post-ref"): BlockMetrics => ({
  height,
  kind: "fixed",
  typeKey,
});

describe("BlockEstimator — analytic seeds (cold, no calibration)", () => {
  it("is monotonic in content length and width-adaptive for text", () => {
    const e = new BlockEstimator({ contentWidth: 720 });
    expect(e.seed(text(500))).toBeGreaterThan(e.seed(text(50)));

    // Narrower column → more wraps → taller for the same text.
    const wide = new BlockEstimator({ contentWidth: 1200 });
    const narrow = new BlockEstimator({ contentWidth: 320 });
    expect(narrow.seed(text(800))).toBeGreaterThan(wide.seed(text(800)));
  });

  it("is monotonic in code line count and width-invariant", () => {
    const e = new BlockEstimator();
    expect(e.seed(code(30))).toBeGreaterThan(e.seed(code(3)));
    const narrow = new BlockEstimator({ contentWidth: 200 });
    const wide = new BlockEstimator({ contentWidth: 2000 });
    expect(narrow.seed(code(20))).toBe(wide.seed(code(20))); // no width dependence
  });

  it("scales image height with width and aspect ratio", () => {
    const e = new BlockEstimator({ contentWidth: 800 });
    expect(e.seed(image(0.75))).toBeGreaterThan(e.seed(image(0.25)));
    const narrow = new BlockEstimator({ contentWidth: 400 });
    expect(narrow.seed(image(0.5))).toBeLessThan(e.seed(image(0.5)));
  });

  it("never returns below 1px", () => {
    const e = new BlockEstimator();
    expect(e.seed(text(0))).toBeGreaterThanOrEqual(1);
    expect(e.seed(code(0))).toBeGreaterThanOrEqual(1);
    expect(e.seed(image(0))).toBeGreaterThanOrEqual(1);
  });
});

describe("BlockEstimator — the ladder and cold-start baseline", () => {
  it("opaque blocks with no samples fall back to the default (== old baseline)", () => {
    const e = new BlockEstimator({ defaultHeight: 40 });
    expect(e.seed(opaque("obj:divider"))).toBe(40);
    expect(e.globalMean()).toBe(40);
  });

  it("opaque blocks converge to their own per-type bucket mean", () => {
    const e = new BlockEstimator({ alpha: 0.5 });
    for (let i = 0; i < 30; i += 1) e.observe(opaque("obj:embed"), 300);
    expect(e.seed(opaque("obj:embed"))).toBeCloseTo(300, 0);
    // a different opaque type is unaffected (separate bucket)
    expect(e.seed(opaque("obj:divider"))).toBe(e.globalMean());
  });

  it("falls back to the global mean for an unseen opaque type once anything is measured", () => {
    const e = new BlockEstimator({ alpha: 0.5 });
    for (let i = 0; i < 20; i += 1) e.observe(text(400), 120);
    // global mean now reflects measured text; an unseen opaque type uses it
    expect(e.seed(opaque("obj:never-seen"))).toBeCloseTo(e.globalMean(), 5);
    expect(e.globalMean()).toBeGreaterThan(40);
  });
});

describe("BlockEstimator — calibration converges toward truth", () => {
  it("learns a per-type correction so seeds approach measured heights", () => {
    // Ground truth: this paragraph type is 1.6x taller than the cold formula
    // predicts (e.g. larger line-height). Feed consistent measurements.
    const e = new BlockEstimator({ alpha: 0.3 });
    const samples = [120, 240, 480, 60, 300];
    const truth = (chars: number) => e.seed(text(chars)); // pre-calibration seed
    const coldSeed = truth(240);

    // Observe measured = 1.6 * cold formula prediction, repeatedly.
    for (let pass = 0; pass < 40; pass += 1) {
      for (const chars of samples) {
        const cold = new BlockEstimator().seed(text(chars)); // factor-1 prediction
        e.observe(text(chars), cold * 1.6);
      }
    }
    // After calibration the seed should be ~1.6x the cold prediction.
    const calibrated = e.seed(text(240));
    expect(calibrated / coldSeed).toBeGreaterThan(1.4);
    expect(calibrated / coldSeed).toBeLessThan(1.8);
  });

  it("calibrates code and text independently", () => {
    const e = new BlockEstimator({ alpha: 0.4 });
    const coldText = new BlockEstimator().seed(text(300));
    const coldCode = new BlockEstimator().seed(code(10));
    for (let i = 0; i < 50; i += 1) {
      e.observe(text(300), coldText * 2); // text runs tall
      e.observe(code(10), coldCode * 0.5); // code runs short
    }
    expect(e.seed(text(300))).toBeGreaterThan(coldText * 1.5);
    expect(e.seed(code(10))).toBeLessThan(coldCode * 0.7);
  });
});

describe("BlockEstimator — outlier resistance", () => {
  it("a single absurd measurement cannot blow up the seed (ratio clamp)", () => {
    const e = new BlockEstimator({ alpha: 0.5, ratioMax: 4 });
    const cold = new BlockEstimator().seed(text(200));
    e.observe(text(200), cold * 1_000_000); // pathological
    // one clamped sample with alpha 0.5 → factor ~ (1 + 4)/2 = 2.5, never millions
    expect(e.seed(text(200))).toBeLessThanOrEqual(cold * 4 + 1);
  });

  it("ignores non-positive and non-finite measurements", () => {
    const e = new BlockEstimator();
    const before = e.seed(text(200));
    e.observe(text(200), 0);
    e.observe(text(200), -50);
    e.observe(text(200), Number.NaN);
    e.observe(text(200), Number.POSITIVE_INFINITY);
    expect(e.seed(text(200))).toBe(before);
    expect(e.globalMean()).toBe(40);
  });
});

describe("BlockEstimator — declared fixed height (backlog §3)", () => {
  it("seeds a declared fixed height cold, before any measurement, and never below 1px", () => {
    const e = new BlockEstimator();
    expect(e.seed(fixed(96))).toBe(96);
    expect(e.seed(fixed(0))).toBeGreaterThanOrEqual(1);
    // Width-invariant: a card of declared height does not reflow with the column.
    e.setContentWidth(320);
    expect(e.seed(fixed(96))).toBe(96);
  });

  it("gives an async reference block a far better seed than the coarse opaque bucket", () => {
    // The whole point of the declared signal: a tall video/card seeds near its real
    // height instead of the ~40px default an unmeasured opaque block starts at.
    const e = new BlockEstimator({ defaultHeight: 40 });
    expect(e.seed(opaque("obj:post-ref"))).toBe(40);
    expect(e.seed(fixed(96))).toBeGreaterThan(e.seed(opaque("obj:post-ref")));
  });

  it("calibrates the declared height toward the measured truth per type", () => {
    const e = new BlockEstimator({ alpha: 0.5 });
    // Declared 96, but this card actually renders 140. Feed the real height.
    for (let i = 0; i < 30; i += 1) e.observe(fixed(96), 140);
    expect(e.seed(fixed(96))).toBeCloseTo(140, 0);
    // A different fixed type calibrates independently.
    expect(e.seed(fixed(96, "fixed:other"))).toBe(96);
  });
});

describe("BlockEstimator — width change re-seeds text/image, not code", () => {
  it("setContentWidth changes text and image seeds but leaves code seeds put", () => {
    const e = new BlockEstimator({ contentWidth: 800 });
    const textBefore = e.seed(text(800));
    const codeBefore = e.seed(code(15));
    const imageBefore = e.seed(image(0.5));

    e.setContentWidth(360);
    expect(e.seed(text(800))).not.toBe(textBefore);
    expect(e.seed(image(0.5))).not.toBe(imageBefore);
    expect(e.seed(code(15))).toBe(codeBefore);
  });
});
