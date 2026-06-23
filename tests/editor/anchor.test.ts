import { describe, expect, it } from "vitest";
import { anchorScrollAdjustment, isFlingVelocity } from "@idco/editor";

describe("anchorScrollAdjustment — keep the visible block fixed", () => {
  it("shifts scrollTop by the anchor's top-edge delta when content above grows", () => {
    // The anchor's top edge moved from 1000 to 1080 (80px of corrections above).
    expect(
      anchorScrollAdjustment({
        fling: false,
        newPrefix: 1080,
        prevPrefix: 1000,
        scrollTop: 1200,
      }),
    ).toBe(1280);
  });

  it("shifts up when content above shrank", () => {
    expect(
      anchorScrollAdjustment({
        fling: false,
        newPrefix: 940,
        prevPrefix: 1000,
        scrollTop: 1200,
      }),
    ).toBe(1140);
  });

  it("returns null when the anchor did not move (correction below or to itself)", () => {
    expect(
      anchorScrollAdjustment({
        fling: false,
        newPrefix: 1000,
        prevPrefix: 1000,
        scrollTop: 1200,
      }),
    ).toBeNull();
  });

  it("ignores sub-tolerance jitter", () => {
    expect(
      anchorScrollAdjustment({
        fling: false,
        newPrefix: 1000.3,
        prevPrefix: 1000,
        scrollTop: 500,
      }),
    ).toBeNull();
  });

  it("never anchors during a fling (protects native inertia)", () => {
    expect(
      anchorScrollAdjustment({
        fling: true,
        newPrefix: 2000,
        prevPrefix: 1000,
        scrollTop: 1200,
      }),
    ).toBeNull();
  });

  it("clamps the result to a non-negative scrollTop", () => {
    expect(
      anchorScrollAdjustment({
        fling: false,
        newPrefix: 10,
        prevPrefix: 500,
        scrollTop: 100,
      }),
    ).toBe(0);
  });
});

describe("isFlingVelocity — fling detection", () => {
  it("is true above the threshold and false below it", () => {
    // 300px in 100ms = 3px/ms; threshold 2px/ms → fling.
    expect(isFlingVelocity(300, 100, 2)).toBe(true);
    // 100px in 100ms = 1px/ms → not a fling.
    expect(isFlingVelocity(100, 100, 2)).toBe(false);
  });

  it("uses absolute speed (direction-independent)", () => {
    expect(isFlingVelocity(-300, 100, 2)).toBe(true);
  });

  it("treats a zero or negative time delta as not a fling", () => {
    expect(isFlingVelocity(500, 0, 2)).toBe(false);
    expect(isFlingVelocity(500, -5, 2)).toBe(false);
  });

  it("is exclusive at exactly the threshold", () => {
    // 200px in 100ms = exactly 2px/ms; strictly-greater means not a fling.
    expect(isFlingVelocity(200, 100, 2)).toBe(false);
  });
});
