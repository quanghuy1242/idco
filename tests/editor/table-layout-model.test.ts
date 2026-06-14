import { describe, expect, it } from "vitest";
import {
  columnWidthRatios,
  moveArrayItem,
  scaleColumnWidths,
} from "../../packages/editor/src/model/layout";

const sum = (widths: readonly number[]) =>
  widths.reduce((total, width) => total + width, 0);

describe("scaleColumnWidths (responsive reflow)", () => {
  it("scales proportionally to the target total and sums exactly", () => {
    const next = scaleColumnWidths([100, 200, 100], 800);
    expect(next).toEqual([200, 400, 200]);
    expect(sum(next)).toBe(800);
  });

  it("preserves proportions when shrinking, folding drift into the last column", () => {
    const next = scaleColumnWidths([300, 300, 300], 1000);
    expect(sum(next)).toBe(1000);
    // Even thirds of 1000 can't be integers; the drift lands in the last column.
    expect(next[0]).toBe(next[1]);
    expect(Math.abs(next[2]! - next[0]!)).toBeLessThanOrEqual(2);
  });

  it("falls back to an even split when the current widths sum to zero", () => {
    expect(scaleColumnWidths([0, 0], 600)).toEqual([300, 300]);
  });

  it("returns [] for empty widths or a non-positive target", () => {
    expect(scaleColumnWidths([], 800)).toEqual([]);
    expect(scaleColumnWidths([100, 100], 0)).toEqual([]);
  });
});

describe("columnWidthRatios (renderer percentages)", () => {
  it("returns the fraction each column occupies, summing to 1", () => {
    const ratios = columnWidthRatios([100, 300]);
    expect(ratios).toEqual([0.25, 0.75]);
    expect(sum(ratios)).toBeCloseTo(1);
  });

  it("returns [] when widths are missing or sum to zero", () => {
    expect(columnWidthRatios([])).toEqual([]);
    expect(columnWidthRatios([0, 0])).toEqual([]);
  });
});

describe("moveArrayItem (column reorder)", () => {
  it("moves an item forward, shifting the rest", () => {
    expect(moveArrayItem([120, 200, 80], 0, 2)).toEqual([200, 80, 120]);
  });

  it("moves an item backward", () => {
    expect(moveArrayItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("leaves the array unchanged for out-of-range indices", () => {
    expect(moveArrayItem([1, 2, 3], 0, 5)).toEqual([1, 2, 3]);
    expect(moveArrayItem([1, 2, 3], -1, 1)).toEqual([1, 2, 3]);
  });
});
